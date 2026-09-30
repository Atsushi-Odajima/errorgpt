import { describe, it, expect } from "vitest";
import {
  createReport, validateReport, transition, InvalidTransitionError, checkReportQuality, generateReport,
  parseManualTimestamp, captureBrowserEnvironment, mergeEnvironment, manualField, environmentLines, createFollowup,
  markUserSubmitted, buildReproFromText, deriveExpected, buildRepro, MockProvider, NullProvider,
} from "../src/index.js";

const tz = "Asia/Tokyo";

describe("report creation (test 1, 9, 17)", () => {
  it("creates a text-only report without a screenshot and validates", () => {
    const r = createReport({ tenantId: "t1", errorText: "Something went wrong", summary: "ChatGPT error" });
    r.occurredAt = parseManualTimestamp("2026-09-30 10:20", tz);
    r.steps = ["Open ChatGPT", "Send a message"];
    r.expected = "Reply appears";
    r.actual = "Error shown";
    r.product = "chatgpt_web";
    const v = validateReport(r);
    expect(v.ok, v.errors.join()).toBe(true);
    expect(r.attachments.length).toBe(0);
    const txt = generateReport(r, "short", "en");
    expect(txt).toContain("Attachments: (none)");
    expect(txt).not.toMatch(/undefined/);
  });
  it("does not fabricate unknown fields: unknown env fields are omitted, not filled", () => {
    const r = createReport({ tenantId: "t1" });
    const lines = environmentLines(r.environment, "en");
    expect(lines).toEqual([]);
    const detailed = generateReport(r, "detailed", "en");
    expect(detailed).toContain("## Occurred\nunknown");
    expect(detailed).not.toMatch(/iPhone|Windows 11/);
  });
  it("captured/occurred/reported are separate (test 7)", () => {
    const r = createReport({ tenantId: "t1", now: new Date("2026-09-30T05:00:00Z") });
    r.capturedAt = parseManualTimestamp("2026-09-30 10:20", tz);
    r.occurredAt = parseManualTimestamp("2026-09-30 10:15", tz);
    r.reportedAt = "2026-09-30T06:00:00.000Z";
    expect(r.capturedAt!.iso).not.toBe(r.occurredAt!.iso);
    expect(r.reportedAt).not.toBe(r.occurredAt!.iso);
    expect(validateReport(r).ok).toBe(true);
  });
  it("schema validation rejects bad input and 'submitted' without receipt", () => {
    const bad = validateReport({ id: "x" });
    expect(bad.ok).toBe(false);
    const r = createReport({ tenantId: "t1" });
    const fake = { ...r, status: "submitted" };
    const v = validateReport(fake);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/DIRECT/);
  });
});

describe("environment capture (test 3, 28)", () => {
  it("browser env never asserts device model", () => {
    const env = captureBrowserEnvironment({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", language: "ja", onLine: true, innerWidth: 390, innerHeight: 844, standalone: true });
    expect(env.os.value).toBe("iOS/iPadOS");
    expect(env.device.source).toBe("unknown");
    expect(env.viewport.value).toBe("390x844");
    expect(env.displayMode.value).toBe("pwa-standalone");
    const merged = mergeEnvironment(env, { device: manualField("iPhone 15") });
    expect(merged.device).toEqual({ value: "iPhone 15", source: "manual" });
  });
});

describe("state machine (test 13)", () => {
  it("HANDOFF cannot become submitted without DIRECT receipt", () => {
    let r = createReport({ tenantId: "t1" });
    r = transition(r, "ready");
    r = transition(r, "handoff_prepared");
    expect(() => transition(r, "submitted")).toThrow();
    expect(() => transition(r, "draft")).toThrow(InvalidTransitionError);
  });
  it("user marked submitted stays distinct", () => {
    let r = createReport({ tenantId: "t1" });
    r = transition(transition(r, "ready"), "handoff_prepared");
    r.submissions.push({ id: "s1", adapterId: "openai_support", capability: "INTERACTIVE_HANDOFF", status: "prepared", idempotencyKey: "k", destination: "help", receipt: null, ticketId: null, error: null, at: new Date().toISOString() });
    const u = markUserSubmitted(r, "s1", "TICKET-1");
    expect(u.status).toBe("user_marked_submitted");
    expect(u.submissions[0]!.ticketId).toBe("TICKET-1");
    expect(validateReport(u).ok).toBe(true);
  });
});

describe("quality check", () => {
  it("lists missing items without a score", () => {
    const r = createReport({ tenantId: "t1" });
    const q = checkReportQuality(r);
    expect(q.missing).toContain("summary");
    expect(q.missing).toContain("occurredAt");
    expect(q.readyToSend).toBe(false);
    expect((q as unknown as { score?: number }).score).toBeUndefined();
  });
});

describe("reproduction builder (tests 10, 11)", () => {
  it("converts Japanese natural text into steps without inventing", () => {
    const r = buildReproFromText("txt作ってもらってリンク押したらdownloadできなかった", "chatgpt_ios", "ja");
    expect(r.steps[0]).toBe("ChatGPT（iOS）で会話を開く。");
    expect(r.steps.length).toBeGreaterThanOrEqual(2);
    expect(r.actual).toMatch(/download/);
    expect(r.expected).toMatch(/正常に完了/);
    expect(r.needsConfirmation).toBe(true);
    // Nothing about "error dialog" was said, so it must not appear.
    expect(r.steps.join(" ")).not.toMatch(/ダイアログ/);
  });
  it("English text", () => {
    const r = buildReproFromText("I asked for a TXT file and then tapped the attachment, then it could not download", "chatgpt_ios", "en");
    expect(r.steps[0]).toBe("Open a conversation in ChatGPT iOS.");
    expect(r.actual).toMatch(/could not download/i);
    expect(r.expected).toMatch(/download/);
  });
  it("asks questions instead of fabricating when info is missing", () => {
    const r = buildReproFromText("エラー", "unknown", "ja");
    expect(r.questions.length).toBeGreaterThan(0);
    expect(r.steps).toEqual([]);
  });
  it("uses AI when enabled, falls back when off", async () => {
    const mock = new MockProvider({ repro: { steps: ["A", "B"], expected: "E", actual: "X", questions: [] } });
    const ai = await buildRepro(mock, { description: "d", errorText: "", product: "codex_cli", language: "en" });
    expect(ai.source).toBe("ai");
    const off = await buildRepro(new NullProvider(), { description: "run codex and then it crashed", errorText: "", product: "codex_cli", language: "en" });
    expect(off.source).toBe("rules");
    expect(deriveExpected("It failed to open the file.", "en")).toBe("The app open the file successfully.");
  });
});

describe("follow-up (test 26)", () => {
  it("adds a revision and does not overwrite original fields", () => {
    const r = createReport({ tenantId: "t1", summary: "orig" });
    r.steps = ["one"];
    const { report: after, followup } = createFollowup(r, { question: "Which OS?", additions: { OS: "macOS 15" }, language: "en", ticketId: "T-9" });
    expect(after.summary).toBe("orig");
    expect(after.steps).toEqual(["one"]);
    expect(after.followups.length).toBe(1);
    expect(after.revisions.length).toBe(1);
    expect(followup.reply).toContain("OS: macOS 15");
    expect(r.followups.length).toBe(0); // original untouched
    expect(validateReport(after).ok).toBe(true);
  });
});
