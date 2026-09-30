import { describe, it, expect, beforeEach } from "vitest";
import { createApp, ReportService, MemoryStorage, FileStorage, parseTokenEnv, createLogger, signBlobUrl, verifyBlobSignature, validateUpload } from "../src/index.js";
import { MockProvider } from "@errorrelay/core";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const SECRET = "test-signing-secret";
const TOKENS = parseTokenEnv("tokA:tenantA:userA,tokB:tenantB:userB");

function png(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  return Uint8Array.from([...sig, ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]), ...chunk("tEXt", [...new TextEncoder().encode("Author\0Taro")]), ...chunk("IDAT", [1, 2, 3]), ...chunk("IEND", [])]);
}

function mk(storage = new MemoryStorage()) {
  const logs: string[] = [];
  const service = new ReportService({ storage, logger: createLogger((l) => logs.push(l)), ai: new MockProvider({ vision: { visibleText: ["Something went wrong", "ChatGPT"], observed: [{ field: "errorMessage", value: "Something went wrong", evidence: "Something went wrong" }], inferred: [] } }), retentionDays: 30 });
  const app = createApp({ service, auth: TOKENS, signingSecret: SECRET, signedUrlTtlSeconds: 2 });
  const call = (token: string, method: string, url: string, body?: unknown, form?: FormData) =>
    app.request(url, { method, headers: { authorization: `Bearer ${token}`, "x-errorrelay-client": "1", ...(body ? { "content-type": "application/json" } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
  return { app, service, call, logs, storage };
}

describe("HTTP API + tenant isolation (tests 17, 19, 20, 21)", () => {
  let ctx: ReturnType<typeof mk>;
  beforeEach(() => {
    ctx = mk();
  });

  it("rejects unauthenticated and missing CSRF header", async () => {
    expect((await ctx.app.request("/api/reports")).status).toBe(401);
    const noHeader = await ctx.app.request("/api/reports", { method: "POST", headers: { authorization: "Bearer tokA", "content-type": "application/json" }, body: "{}" });
    expect(noHeader.status).toBe(403);
  });

  it("tenant A cannot read, modify or delete tenant B's report (19)", async () => {
    const created = await (await ctx.call("tokB", "POST", "/api/reports", { summary: "B's report" })).json();
    const id = created.report.id;
    expect((await ctx.call("tokA", "GET", `/api/reports/${id}`)).status).toBe(404);
    expect((await ctx.call("tokA", "PATCH", `/api/reports/${id}`, { summary: "hacked" })).status).toBe(404);
    expect((await ctx.call("tokA", "DELETE", `/api/reports/${id}`)).status).toBe(404);
    const listA = await (await ctx.call("tokA", "GET", "/api/reports")).json();
    expect(listA.reports).toEqual([]);
    const still = await (await ctx.call("tokB", "GET", `/api/reports/${id}`)).json();
    expect(still.report.summary).toBe("B's report");
  });

  it("validates schema on PATCH (17)", async () => {
    const { report } = await (await ctx.call("tokA", "POST", "/api/reports", {})).json();
    const bad = await ctx.call("tokA", "PATCH", `/api/reports/${report.id}`, { product: "windows_phone", httpStatus: "x" });
    expect(bad.status).toBe(400);
    const badTime = await ctx.call("tokA", "PATCH", `/api/reports/${report.id}`, { occurredAt: { text: "yesterday", timezone: "Asia/Tokyo" } });
    expect(badTime.status).toBe(400);
    const ok = await ctx.call("tokA", "PATCH", `/api/reports/${report.id}`, { occurredAt: { text: "2026-09-30 10:20", timezone: "Asia/Tokyo" }, product: "chatgpt_ios", environment: { device: "iPhone 15" } });
    const j = await ok.json();
    expect(j.report.occurredAt.display).toContain("2026-09-30 10:20");
    expect(j.report.environment.device).toEqual({ value: "iPhone 15", source: "manual" });
  });

  it("uploads strip EXIF, reject executables, and signed URLs expire (6, 20, 21)", async () => {
    const { report } = await (await ctx.call("tokA", "POST", "/api/reports", { summary: "s" })).json();
    const fd = new FormData();
    fd.append("file", new File([png()], "shot.png", { type: "image/png" }));
    const up = await ctx.call("tokA", "POST", `/api/reports/${report.id}/attachments`, undefined, fd);
    expect(up.status).toBe(201);
    const uj = await up.json();
    expect(uj.attachment.exifStripped).toBe(true);
    expect(uj.stripped).toContain("tEXt");
    expect(uj.attachment.storageRef).toMatch(/^blob_/);

    const exe = new FormData();
    exe.append("file", new File([Uint8Array.from([0x4d, 0x5a, 0, 0])], "evil.png", { type: "image/png" }));
    expect((await ctx.call("tokA", "POST", `/api/reports/${report.id}/attachments`, undefined, exe)).status).toBe(400);
    expect(validateUpload("a.exe", "application/octet-stream", Uint8Array.from([1])).ok).toBe(false);

    const urlRes = await (await ctx.call("tokA", "GET", `/api/reports/${report.id}/attachments/${uj.attachment.id}/url`)).json();
    const dl = await ctx.app.request(urlRes.url);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("image/png");
    // tenant B cannot get a URL for A's attachment
    expect((await ctx.call("tokB", "GET", `/api/reports/${report.id}/attachments/${uj.attachment.id}/url`)).status).toBe(404);
    // expired signature
    const expired = signBlobUrl(SECRET, "tenantA", uj.attachment.storageRef, -1);
    expect((await ctx.app.request(expired)).status).toBe(403);
    expect(verifyBlobSignature(SECRET, "tenantA", "x", Math.floor(Date.now() / 1000) + 10, "bad")).toBe(false);
    // tampered tenant in URL
    expect((await ctx.app.request(urlRes.url.replace("t=tenantA", "t=tenantB"))).status).toBe(403);
    // after delete, the still-valid signed URL is refused (21)
    expect((await ctx.call("tokA", "DELETE", `/api/reports/${report.id}`)).status).toBe(204);
    expect((await ctx.app.request(urlRes.url)).status).toBe(404);
    expect((await ctx.call("tokA", "GET", `/api/reports/${report.id}/attachments/${uj.attachment.id}/url`)).status).toBe(404);
    expect(ctx.storage.blobs.size).toBe(0);
  });

  it("full flow: analyze → repro → redact → ready → preview → submit (handoff) → mark sent → export (E2E-1 API level)", async () => {
    const { report } = await (await ctx.call("tokA", "POST", "/api/reports", { language: "ja", errorText: "ChatGPT iOS: download failed. contact taro@example.com" })).json();
    expect(report.product).toBe("chatgpt_ios");
    const fd = new FormData();
    fd.append("file", new File([png()], "shot.png", { type: "image/png" }));
    const { attachment } = await (await ctx.call("tokA", "POST", `/api/reports/${report.id}/attachments`, undefined, fd)).json();
    const an = await (await ctx.call("tokA", "POST", `/api/reports/${report.id}/analyze`, { attachmentId: attachment.id, consent: true })).json();
    expect(an.manualFallback).toBe(false);
    expect(an.report.analysis.observed[0].field).toBe("errorMessage");
    await ctx.call("tokA", "PATCH", `/api/reports/${report.id}`, { summary: "TXT download fails", occurredAt: "now", timezone: "Asia/Tokyo", steps: ["Open chat", "Tap TXT"], expected: "Downloads", actual: "Error dialog" });
    const red = await (await ctx.call("tokA", "POST", `/api/reports/${report.id}/redact`, {})).json();
    expect(red.findingsCount).toBeGreaterThan(0);
    expect(red.report.errorText).not.toContain("taro@example.com");
    const q = await (await ctx.call("tokA", "GET", `/api/reports/${report.id}/quality?previewed=1`)).json();
    expect(q.readyToSend).toBe(true);
    const ready = await ctx.call("tokA", "POST", `/api/reports/${report.id}/ready`);
    expect((await ready.json()).report.status).toBe("ready");
    const channels = await (await ctx.call("tokA", "GET", `/api/reports/${report.id}/channels`)).json();
    expect(channels.channels[0].adapterId).toBe("openai_support");
    expect(channels.channels[0].capability).toBe("INTERACTIVE_HANDOFF");
    const pv = await (await ctx.call("tokA", "POST", `/api/reports/${report.id}/preview`, { adapterId: "openai_support", lang: "ja" })).json();
    expect(pv.preview.identity).toBe("userA");
    expect(pv.preview.bodyText).toContain("TXT download fails");
    const bad = await ctx.call("tokA", "POST", `/api/reports/${report.id}/submit`, { confirmationToken: "nope", idempotencyKey: "abcdefgh1" });
    expect(bad.status).toBe(400);
    const sub = await (await ctx.call("tokA", "POST", `/api/reports/${report.id}/submit`, { confirmationToken: pv.preview.confirmationToken, idempotencyKey: "abcdefgh1" })).json();
    expect(sub.report.status).toBe("handoff_prepared");
    expect(sub.submission.status).toBe("prepared");
    const ms = await (await ctx.call("tokA", "POST", `/api/reports/${report.id}/mark-sent`, { submissionId: sub.submission.id, ticketId: "OA-123" })).json();
    expect(ms.report.status).toBe("user_marked_submitted");
    const exp = await ctx.call("tokA", "GET", `/api/reports/${report.id}/export`);
    expect(exp.status).toBe(200);
    const zip = new Uint8Array(await exp.arrayBuffer());
    expect(zip.length).toBeGreaterThan(100);
    const imp = new FormData();
    imp.append("file", new File([zip], "pkg.zip", { type: "application/zip" }));
    const impRes = await ctx.call("tokB", "POST", "/api/reports/import", undefined, imp);
    const imported = await impRes.json();
    expect(impRes.status, JSON.stringify(imported)).toBe(201);
    expect(imported.report.summary).toBe("TXT download fails");
    expect(imported.report.tenantId).toBe("tenantB");
    const fu = await (await ctx.call("tokA", "POST", `/api/reports/${report.id}/followups`, { question: "iOS version?", additions: { "iOS version": "18.0" } })).json();
    expect(fu.followup.reply).toContain("18.0");
    // logs never contain the email or the body
    expect(ctx.logs.join("\n")).not.toContain("taro@example.com");
    expect(ctx.logs.join("\n")).not.toContain("TXT download fails");
  });

  it("retention deletes old reports and blobs", async () => {
    const { report } = await (await ctx.call("tokA", "POST", "/api/reports", { summary: "old" })).json();
    const r = await ctx.storage.getReport("tenantA", report.id);
    r!.updatedAt = "2020-01-01T00:00:00.000Z";
    await ctx.storage.putReport(r!);
    const del = await ctx.service.runRetention();
    expect(del.map((d) => d.reportId)).toEqual([report.id]);
    expect((await ctx.call("tokA", "GET", `/api/reports/${report.id}`)).status).toBe(404);
  });
});

describe("FileStorage with encryption at rest", () => {
  it("round-trips encrypted blobs and isolates tenants on disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "er-"));
    const key = Buffer.alloc(32, 7);
    const st = new FileStorage(dir, key);
    const bytes = new TextEncoder().encode("secret image bytes sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    await st.putBlob({ id: "blob_1", tenantId: "tenantA", reportId: "rep_1", mimeType: "image/png", sizeBytes: bytes.length, sha256: "0".repeat(64), createdAt: new Date().toISOString() }, bytes);
    const raw = await fs.readFile(path.join(dir, "tenants", "tenantA", "blobs", "blob_1.bin"));
    expect(raw.toString("latin1")).not.toContain("sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const got = await st.getBlob("tenantA", "blob_1");
    expect(new TextDecoder().decode(got!.bytes)).toContain("secret image bytes");
    expect(await st.getBlob("tenantB", "blob_1")).toBeNull();
    await expect(st.getReport("../tenantA", "x")).rejects.toThrow();
    await st.deleteBlob("tenantA", "blob_1");
    expect(await st.getBlob("tenantA", "blob_1")).toBeNull();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
