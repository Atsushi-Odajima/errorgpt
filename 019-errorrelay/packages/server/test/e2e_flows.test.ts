import { describe, it, expect } from "vitest";
import { createApp, ReportService, MemoryStorage, parseTokenEnv, createLogger, mountMcp } from "../src/index.js";
import { NullProvider } from "@errorrelay/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TOKENS = parseTokenEnv("tokA:tenantA:userA");
function mk() {
  const service = new ReportService({ storage: new MemoryStorage(), logger: createLogger(() => undefined), ai: new NullProvider(), fetchImpl: (async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as typeof fetch });
  const app = createApp({ service, auth: TOKENS, signingSecret: "s", rateLimitPerMinute: 500 });
  const call = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: { authorization: "Bearer tokA", "x-errorrelay-client": "1", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { app, service, call };
}

describe("E2E-2 Codex flow (API level)", () => {
  it("error text → version → doctor redaction → capability check → handoff/export", async () => {
    const { call } = mk();
    const { report } = await (await call("POST", "/api/reports", { language: "en", errorText: "codex-cli 0.154.0 panicked: thread 'main' panicked at /Users/taro/.codex/x.rs" })).json();
    expect(report.product).toBe("codex_cli");
    await call("PATCH", `/api/reports/${report.id}`, { summary: "Codex CLI panics on start", environment: { cliVersion: "0.154.0", os: "macOS", osVersion: "15.0" }, occurredAt: "now", timezone: "Asia/Tokyo", steps: ["Run codex", "Type a prompt"], expected: "Prompt runs", actual: "Panic" });
    const doctor = await (await call("POST", "/api/tools/codex-doctor-redact", { raw: JSON.stringify({ version: "0.154.0", home: "/Users/taro", auth: { token: "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ" } }) })).json();
    expect(doctor.redactedJson).not.toContain("taro");
    expect(doctor.redactedJson).not.toContain("sk-ABC");
    const red = await (await call("POST", `/api/reports/${report.id}/redact`, {})).json();
    expect(red.report.errorText).toContain("[REDACTED_USER_PATH_1]");
    await call("POST", `/api/reports/${report.id}/ready`);
    const { channels } = await (await call("GET", `/api/reports/${report.id}/channels`)).json();
    const ids = channels.map((c: { adapterId: string; capability: string }) => `${c.adapterId}:${c.capability}`);
    expect(ids).toContain("codex_feedback:INTERACTIVE_HANDOFF");
    expect(ids).toContain("github_issue_codex:INTERACTIVE_HANDOFF");
    expect(ids).toContain("export:EXPORT_ONLY");
    expect(ids.some((i: string) => i.endsWith(":DIRECT"))).toBe(false);
    const pv = await (await call("POST", `/api/reports/${report.id}/preview`, { adapterId: "github_issue_codex", lang: "en" })).json();
    expect(pv.preview.prepared.prefillUrl).toContain("template=3-cli.yml");
    expect(pv.preview.prepared.prefillUrl).toContain("version=0.154.0");
    expect(decodeURIComponent(pv.preview.prepared.prefillUrl)).not.toContain("taro");
    const known = await (await call("GET", `/api/reports/${report.id}/known-issues`)).json();
    expect(known.status.state).toBe("unknown");
    expect(known.note.ja).toMatch(/同一とは限りません/);
    const pv2 = await (await call("POST", `/api/reports/${report.id}/preview`, { adapterId: "codex_feedback", lang: "ja" })).json();
    expect(pv2.channel.caveats.ja.join()).toMatch(/44847/);
    const sub = await (await call("POST", `/api/reports/${report.id}/submit`, { confirmationToken: pv2.preview.confirmationToken, idempotencyKey: "codex-flow-1" })).json();
    expect(sub.report.status).toBe("handoff_prepared");
  });
});

describe("E2E-3 OpenAI API error flow (API level)", () => {
  it("error JSON → request ID → SDK → secret redaction → developer report", async () => {
    const { call } = mk();
    const raw = `openai-python 1.60.0\nAuthorization: Bearer sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd\nPOST /v1/responses\nHTTP 429\nx-request-id: req_9f8e7d6c5b4a\n{"error":{"message":"Rate limit reached for gpt-5","type":"rate_limit_error","code":"rate_limit_exceeded"}}`;
    const parsed = await (await call("POST", "/api/tools/api-error", { raw })).json();
    expect(parsed.info.requestId).toBe("req_9f8e7d6c5b4a");
    expect(parsed.info.httpStatus).toBe(429);
    expect(parsed.info.endpoint).toBe("/v1/responses");
    expect(parsed.info.sdk).toMatch(/openai-python/);
    expect(parsed.reproduction.curl).not.toContain("sk-proj");
    const { report } = await (await call("POST", "/api/reports", { language: "en", errorText: raw })).json();
    expect(report.product).toBe("openai_api");
    expect(report.requestId).toBe("req_9f8e7d6c5b4a");
    expect(report.httpStatus).toBe(429);
    const red = await (await call("POST", `/api/reports/${report.id}/redact`, {})).json();
    expect(red.report.errorText).not.toContain("sk-proj");
    expect(red.report.errorText).toContain("req_9f8e7d6c5b4a");
    await call("PATCH", `/api/reports/${report.id}`, { summary: "429 on /v1/responses", occurredAt: "now", timezone: "UTC", steps: ["Call responses.create"], expected: "200", actual: "429" });
    const dev = await (await call("GET", `/api/reports/${report.id}/render?format=developer&lang=en`)).text();
    expect(dev).toContain("Request ID: req_9f8e7d6c5b4a");
    expect(dev).toContain("HTTP status: 429");
    expect(dev).not.toContain("sk-proj");
  });
});

describe("MCP over streamable HTTP + load", () => {
  it("serves MCP at /mcp with bearer auth", async () => {
    const { app, service } = mk();
    await mountMcp(app, service, TOKENS);
    expect((await app.request("/mcp", { method: "POST" })).status).toBe(401);
    const transport = new StreamableHTTPClientTransport(new URL("http://local.test/mcp"), { fetch: ((input: RequestInfo | URL, init?: RequestInit) => app.request(input instanceof Request ? input : new Request(input, init))) as typeof fetch, requestInit: { headers: { authorization: "Bearer tokA" } } });
    const client = new Client({ name: "t", version: "0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("submit_report");
    const res = await client.callTool({ name: "create_error_report", arguments: { language: "en", summary: "via http" } });
    expect(JSON.stringify(res.content)).toContain("via http");
    await client.close();
  });
  it("handles 200 concurrent requests and rate-limits beyond the window", async () => {
    const service = new ReportService({ storage: new MemoryStorage(), logger: createLogger(() => undefined), ai: new NullProvider() });
    const app = createApp({ service, auth: TOKENS, signingSecret: "s", rateLimitPerMinute: 150 });
    const hit = () => app.request("/api/reports", { method: "POST", headers: { authorization: "Bearer tokA", "x-errorrelay-client": "1", "content-type": "application/json" }, body: JSON.stringify({ summary: "load" }) });
    const t0 = Date.now();
    const results = await Promise.all(Array.from({ length: 200 }, hit));
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201).length).toBe(150);
    expect(codes.filter((c) => c === 429).length).toBe(50);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect((await service.list("tenantA")).length).toBe(150);
  });
});
