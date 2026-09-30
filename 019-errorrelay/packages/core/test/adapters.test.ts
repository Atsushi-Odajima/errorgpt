import { describe, it, expect } from "vitest";
import {
  AdapterRegistry, createReport, prepareSubmission, executeSubmission, MemoryIdempotencyStore, ConfirmationRequiredError,
  GitHubIssueAdapter, DEFAULT_CHANNELS, validateChannelsConfig, validateReport, parseManualTimestamp, type ChannelsConfig, type GitHubClient,
  OpenAIStatusAdapter, similarity, analyzeScreenshot, MockProvider, NullProvider, OpenAICompatibleProvider, analyzeErrorText, parseApiError, minimalReproduction, parseCodexVersion,
} from "../src/index.js";

function codexReport() {
  const r = createReport({ tenantId: "t1", summary: "Codex CLI crashes on /feedback", product: "codex_cli" });
  r.actual = "It crashed";
  r.steps = ["Run codex", "Type /feedback"];
  r.environment.cliVersion = { value: "0.154.0", source: "auto" };
  r.occurredAt = parseManualTimestamp("2026-09-30 10:20", "Asia/Tokyo");
  return r;
}

describe("adapter capabilities (tests 12, 13, 14, 15, 16)", () => {
  it("default channels are never DIRECT for OpenAI Support / Codex feedback", () => {
    const reg = new AdapterRegistry();
    expect(reg.get("openai_support")!.capability()).toBe("INTERACTIVE_HANDOFF");
    expect(reg.get("codex_feedback")!.capability()).toBe("INTERACTIVE_HANDOFF");
    expect(reg.get("github_issue_codex")!.capability()).toBe("INTERACTIVE_HANDOFF");
    expect(reg.get("export")!.capability()).toBe("EXPORT_ONLY");
    for (const a of reg.all()) expect(["DIRECT", "INTERACTIVE_HANDOFF", "EXPORT_ONLY", "UNAVAILABLE"]).toContain(a.capability());
  });
  it("orders adapters for a report and disabled ones are UNAVAILABLE", () => {
    const cfg: ChannelsConfig = structuredClone(DEFAULT_CHANNELS);
    cfg.channels.find((c) => c.adapterId === "codex_feedback")!.enabled = false;
    const reg = new AdapterRegistry({ config: cfg });
    const list = reg.forReport(codexReport());
    expect(list.at(-1)!.id).toBe("codex_feedback");
    expect(list.at(-1)!.capability()).toBe("UNAVAILABLE");
  });
  it("HANDOFF never sends and never yields 'submitted' (13, 14)", async () => {
    const reg = new AdapterRegistry();
    const adapter = reg.get("openai_support")!;
    const r = codexReport();
    let fetched = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => { fetched = true; throw new Error("no network allowed"); }) as typeof fetch;
    try {
      const preview = prepareSubmission(r, adapter, "ja");
      expect(preview.capability).toBe("INTERACTIVE_HANDOFF");
      expect(preview.bodyText).toContain("Codex CLI crashes");
      const res = await executeSubmission({ ...r, status: "ready" }, adapter, preview, { confirmationToken: preview.confirmationToken, idempotencyKey: "k1", store: new MemoryIdempotencyStore() });
      expect(res.report.status).toBe("handoff_prepared");
      expect(res.submission.status).toBe("prepared");
      expect(res.message.ja).toContain("ご自身で送信");
      expect(fetched).toBe(false);
      expect(validateReport(res.report).ok).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  it("requires explicit confirmation before any send (15)", async () => {
    const reg = new AdapterRegistry();
    const adapter = reg.get("openai_support")!;
    const preview = prepareSubmission(codexReport(), adapter, "en");
    await expect(executeSubmission(codexReport(), adapter, preview, { confirmationToken: "", idempotencyKey: "k", store: new MemoryIdempotencyStore() })).rejects.toBeInstanceOf(ConfirmationRequiredError);
    await expect(executeSubmission(codexReport(), adapter, preview, { confirmationToken: "wrong", idempotencyKey: "k", store: new MemoryIdempotencyStore() })).rejects.toBeInstanceOf(ConfirmationRequiredError);
  });
  it("DIRECT test double: send → receipt → submitted; timeout → unknown; retry is idempotent (16, E2E-6)", async () => {
    let calls = 0;
    let mode: "ok" | "timeout" = "timeout";
    const client: GitHubClient = {
      async createIssue() {
        calls++;
        if (mode === "timeout") throw new Error("ETIMEDOUT");
        return { number: 1, url: "https://github.com/openai/codex/issues/1" };
      },
    };
    const cfg: ChannelsConfig = structuredClone(DEFAULT_CHANNELS);
    cfg.channels.find((c) => c.adapterId === "github_issue_codex")!.capability = "DIRECT";
    const reg = new AdapterRegistry({ config: cfg, githubClient: client });
    const adapter = reg.get("github_issue_codex")!;
    expect(adapter.capability()).toBe("DIRECT");
    const store = new MemoryIdempotencyStore();
    const r = { ...codexReport(), status: "ready" as const };
    const preview = prepareSubmission(r, adapter, "en", { identity: "gh:someone" });
    expect(preview.identity).toBe("gh:someone");
    const first = await executeSubmission(r, adapter, preview, { confirmationToken: preview.confirmationToken, idempotencyKey: "same", store });
    expect(first.report.status).toBe("submission_unknown");
    mode = "ok";
    const second = await executeSubmission(first.report, adapter, preview, { confirmationToken: preview.confirmationToken, idempotencyKey: "same", store });
    expect(second.report.status).toBe("submitted");
    expect(second.submission.receipt).toContain("issues/1");
    const third = await executeSubmission(second.report, adapter, preview, { confirmationToken: preview.confirmationToken, idempotencyKey: "same", store });
    expect(calls).toBe(2); // third call did not hit the network
    expect(third.message.en).toMatch(/Already sent/);
    expect(second.report.submissions.filter((s) => s.idempotencyKey === "same").length).toBe(1);
  });
  it("GitHub DIRECT without a client degrades to HANDOFF with a prefilled template URL", () => {
    const cfg: ChannelsConfig = structuredClone(DEFAULT_CHANNELS);
    cfg.channels.find((c) => c.adapterId === "github_issue_codex")!.capability = "DIRECT";
    const adapter = new AdapterRegistry({ config: cfg }).get("github_issue_codex") as GitHubIssueAdapter;
    expect(adapter.capability()).toBe("INTERACTIVE_HANDOFF");
    const p = prepareSubmission(codexReport(), adapter, "en");
    expect(p.prepared.prefillUrl).toContain("github.com/openai/codex/issues/new?template=3-cli.yml");
    expect(p.prepared.prefillUrl).toContain("version=0.154.0");
  });
  it("config-driven route change does not touch the report schema (E2E-5)", () => {
    const cfg: ChannelsConfig = structuredClone(DEFAULT_CHANNELS);
    cfg.channels.push({ adapterId: "openai_support_v2", enabled: true, capability: "INTERACTIVE_HANDOFF", officialUrl: "https://help.openai.com/new-form", verifiedAt: "2027-01-01", sourceUrls: [], name: { ja: "新窓口", en: "New route" }, instructions: { ja: [], en: [] }, caveats: { ja: [], en: [] }, products: ["*"], options: { kind: "generic_webform" } });
    const reg = new AdapterRegistry({ config: cfg });
    const r = codexReport();
    const p = prepareSubmission(r, reg.get("openai_support_v2")!, "ja");
    expect(p.destination).toBe("https://help.openai.com/new-form");
    expect(validateReport(r).ok).toBe(true);
    expect(validateChannelsConfig({ configVersion: "x", channels: [{ adapterId: "a", capability: "MAGIC", enabled: true }] }).ok).toBe(false);
  });
});

describe("status & known issues (Phase 7)", () => {
  it("status adapter returns unknown without feed and never asserts no-incident", async () => {
    const a = new OpenAIStatusAdapter({ pageUrl: "https://status.openai.com", feedUrl: null });
    const r = await a.incidentsNear("2026-09-30T01:00:00Z");
    expect(r.state).toBe("unknown");
    expect(r.note.ja).toContain("障害でないとは限りません");
  });
  it("parses a feed and filters by time window", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ incidents: [{ id: "1", name: "Elevated errors", status: "resolved", started_at: "2026-09-30T00:30:00Z", updated_at: "2026-09-30T02:00:00Z" }, { id: "2", name: "Old", status: "resolved", started_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T01:00:00Z" }] }), { status: 200 })) as unknown as typeof fetch;
    const a = new OpenAIStatusAdapter({ pageUrl: "https://status.openai.com", feedUrl: "https://example.invalid/feed.json", fetchImpl });
    const r = await a.incidentsNear("2026-09-30T01:00:00Z", 2);
    expect(r.state).toBe("incidents");
    expect(r.incidents.map((i) => i.id)).toEqual(["1"]);
    expect(r.note.en).toMatch(/not confirmed/);
  });
  it("similarity never claims duplicate", () => {
    expect(similarity("download fails on iOS", "iOS download fails")).toBeGreaterThan(0.5);
    expect(similarity("abc", "")).toBe(0);
  });
});

describe("screenshot analysis (tests 2, 3, 22, 23)", () => {
  const img = { bytes: Uint8Array.from([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" };
  it("extracts visible error text via provider and separates observed/inferred", async () => {
    const mock = new MockProvider({ vision: { visibleText: ["ChatGPT", "Download failed", "10:20"], observed: [{ field: "errorMessage", value: "Download failed", evidence: "Download failed" }, { field: "device", value: "iPhone 15 Pro", evidence: "" }], inferred: [{ field: "os", value: "iOS", reason: "status bar style", confidence: "medium" }] } });
    const out = await analyzeScreenshot(mock, img, { language: "en" });
    expect(out.manualFallback).toBe(false);
    expect(out.errorTextCandidate).toBe("Download failed");
    expect(out.analysis.observed.map((o) => o.field)).toEqual(["errorMessage"]);
    // device model claimed without visible evidence must be demoted to inferred, unconfirmed
    const dev = out.analysis.inferred.find((i) => i.field === "device");
    expect(dev).toBeDefined();
    expect(dev!.confirmed).toBe(false);
    expect(dev!.confidence).toBe("low");
  });
  it("AI OFF: no provider request, manual fallback", async () => {
    let fetched = false;
    const provider = new OpenAICompatibleProvider({ enabled: false, baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", model: "x", fetchImpl: (async () => { fetched = true; return new Response("{}"); }) as typeof fetch });
    const out = await analyzeScreenshot(provider, img);
    expect(out.manualFallback).toBe(true);
    expect(fetched).toBe(false);
    const nul = await analyzeScreenshot(new NullProvider(), img);
    expect(nul.manualFallback).toBe(true);
  });
  it("provider failure still allows manual report", async () => {
    const provider = new OpenAICompatibleProvider({ enabled: true, baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", model: "x", fetchImpl: (async () => new Response("boom", { status: 500 })) as typeof fetch });
    const out = await analyzeScreenshot(provider, img);
    expect(out.manualFallback).toBe(true);
    expect(out.note).toMatch(/failed/);
  });
});

describe("error text / API error parsing (E2E-3)", () => {
  it("parses API error JSON with request id", () => {
    const raw = `openai.RateLimitError: Error code: 429 - {'error': {'message': 'Rate limit reached', 'type': 'rate_limit_error', 'code': 'rate_limit_exceeded'}} x-request-id: req_abc123def456`;
    const info = parseApiError(raw);
    expect(info.httpStatus).toBe(429);
    expect(info.requestId).toBe("req_abc123def456");
    expect(info.category).toBe("rate_limit");
    const a = analyzeErrorText(raw);
    expect(a.productGuess?.product).toBe("openai_api");
    expect(minimalReproduction(info, "curl")).toContain("$OPENAI_API_KEY");
    expect(minimalReproduction(info, "curl")).not.toMatch(/sk-/);
  });
  it("guesses product from text", () => {
    expect(analyzeErrorText("ChatGPT iOS app shows something went wrong").productGuess?.product).toBe("chatgpt_ios");
    expect(analyzeErrorText("codex --version 0.154.0 panicked").productGuess?.product).toBe("codex_cli");
    expect(parseCodexVersion("codex-cli 0.154.0")).toBe("0.154.0");
  });
});
