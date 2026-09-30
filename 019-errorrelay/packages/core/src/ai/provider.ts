/**
 * AI provider abstraction. The core never calls a network by itself unless an
 * enabled provider is injected. NullProvider is the default (AI OFF).
 */
export interface VisionAnalysisResult {
  visibleText: string[];
  observed: { field: string; value: string; evidence: string }[];
  inferred: { field: string; value: string; reason: string; confidence: "high" | "medium" | "low" }[];
}

export interface ReproSuggestion {
  steps: string[];
  expected: string;
  actual: string;
  /** Steps the model was unsure about — surfaced as questions instead of fabricated steps. */
  questions: string[];
}

export interface AIProvider {
  readonly id: string;
  readonly enabled: boolean;
  analyzeScreenshot(image: { bytes: Uint8Array; mimeType: string }, hints?: { language?: "ja" | "en" }): Promise<VisionAnalysisResult>;
  suggestReproduction(input: { description: string; errorText: string; product: string; language: "ja" | "en" }): Promise<ReproSuggestion>;
  draftText(input: { instruction: string; content: string; language: "ja" | "en" }): Promise<string>;
}

export class AIDisabledError extends Error {
  constructor() {
    super("AI provider is disabled");
    this.name = "AIDisabledError";
  }
}

/** AI OFF: never performs any request. */
export class NullProvider implements AIProvider {
  readonly id = "null";
  readonly enabled = false;
  async analyzeScreenshot(): Promise<VisionAnalysisResult> {
    throw new AIDisabledError();
  }
  async suggestReproduction(): Promise<ReproSuggestion> {
    throw new AIDisabledError();
  }
  async draftText(): Promise<string> {
    throw new AIDisabledError();
  }
}

export interface OpenAICompatibleConfig {
  enabled: boolean;
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const VISION_SYSTEM = `You read screenshots of software errors. Return strict JSON:
{"visibleText":[...lines actually visible...],"observed":[{"field":"...","value":"...","evidence":"quote from image"}],"inferred":[{"field":"...","value":"...","reason":"...","confidence":"low|medium|high"}]}
Rules: 'observed' only for things literally visible. Device model, OS version, app version, account or model name that are NOT visible go to 'inferred' or are omitted. Never invent timestamps. Do not include personal data beyond what is needed to describe the error.`;

const REPRO_SYSTEM = `You convert a user's natural-language description of a software error into a bug report. Return strict JSON:
{"steps":["..."],"expected":"...","actual":"...","questions":["..."]}
Rules: only include steps supported by the description. If a step is unknown, add a question instead of inventing it. Keep expected/actual to one sentence each. Do not state root causes.`;

/**
 * Generic OpenAI-compatible chat-completions client (works with OpenAI, Azure-compatible gateways, local servers).
 * Provider/model are configurable. Images are sent only when the caller explicitly invokes analyzeScreenshot.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  readonly enabled: boolean;
  private cfg: OpenAICompatibleConfig;
  constructor(cfg: OpenAICompatibleConfig) {
    this.cfg = cfg;
    this.enabled = cfg.enabled && !!cfg.apiKey;
    this.id = `openai-compatible:${cfg.model}`;
  }

  private async chat(messages: unknown[], jsonMode = true): Promise<string> {
    if (!this.enabled) throw new AIDisabledError();
    const f = this.cfg.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 60000);
    try {
      const res = await f(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature: 0,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`AI provider HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(t);
    }
  }

  async analyzeScreenshot(image: { bytes: Uint8Array; mimeType: string }, hints?: { language?: "ja" | "en" }): Promise<VisionAnalysisResult> {
    const b64 = bytesToBase64(image.bytes);
    const raw = await this.chat([
      { role: "system", content: VISION_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: `Language for values: ${hints?.language ?? "en"}.` },
          { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${b64}` } },
        ],
      },
    ]);
    return sanitizeVision(safeJson(raw));
  }

  async suggestReproduction(input: { description: string; errorText: string; product: string; language: "ja" | "en" }): Promise<ReproSuggestion> {
    const raw = await this.chat([
      { role: "system", content: REPRO_SYSTEM },
      { role: "user", content: JSON.stringify(input) },
    ]);
    const j = safeJson(raw) as Partial<ReproSuggestion>;
    return {
      steps: strArr(j.steps),
      expected: typeof j.expected === "string" ? j.expected : "",
      actual: typeof j.actual === "string" ? j.actual : "",
      questions: strArr(j.questions),
    };
  }

  async draftText(input: { instruction: string; content: string; language: "ja" | "en" }): Promise<string> {
    return this.chat(
      [
        { role: "system", content: `${input.instruction}\nRespond in ${input.language === "ja" ? "Japanese" : "English"}. Do not invent facts.` },
        { role: "user", content: input.content },
      ],
      false,
    );
  }
}

/** Deterministic provider for tests and offline demos. */
export class MockProvider implements AIProvider {
  readonly id = "mock";
  readonly enabled = true;
  calls: string[] = [];
  constructor(private canned: Partial<{ vision: VisionAnalysisResult; repro: ReproSuggestion; text: string }> = {}) {}
  async analyzeScreenshot(): Promise<VisionAnalysisResult> {
    this.calls.push("analyzeScreenshot");
    return sanitizeVision((this.canned.vision ?? { visibleText: [], observed: [], inferred: [] }) as unknown as Record<string, unknown>);
  }
  async suggestReproduction(): Promise<ReproSuggestion> {
    this.calls.push("suggestReproduction");
    return this.canned.repro ?? { steps: [], expected: "", actual: "", questions: [] };
  }
  async draftText(): Promise<string> {
    this.calls.push("draftText");
    return this.canned.text ?? "";
  }
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    return JSON.parse(start >= 0 ? raw.slice(start, end + 1) : raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Fields that can never be "observed" from a screenshot unless literally printed on screen. */
const NEVER_OBSERVED_WITHOUT_EVIDENCE = new Set(["device", "deviceModel", "osVersion", "appVersion", "model", "account", "email"]);

export function sanitizeVision(j: Record<string, unknown>): VisionAnalysisResult {
  const visibleText = strArr(j.visibleText);
  const observedRaw = Array.isArray(j.observed) ? (j.observed as Record<string, unknown>[]) : [];
  const inferredRaw = Array.isArray(j.inferred) ? (j.inferred as Record<string, unknown>[]) : [];
  const observed: VisionAnalysisResult["observed"] = [];
  const inferred: VisionAnalysisResult["inferred"] = [];
  for (const o of observedRaw) {
    const field = String(o.field ?? "");
    const value = String(o.value ?? "");
    const evidence = String(o.evidence ?? "");
    if (!field || !value) continue;
    // Demote to inferred when a sensitive field lacks visible evidence.
    const evidenceVisible = evidence.length > 0 && visibleText.some((t) => t.includes(evidence) || evidence.includes(t) || t.includes(value));
    if (NEVER_OBSERVED_WITHOUT_EVIDENCE.has(field) && !evidenceVisible) {
      inferred.push({ field, value, reason: "claimed as observed without visible evidence", confidence: "low" });
    } else observed.push({ field, value, evidence });
  }
  for (const i of inferredRaw) {
    const field = String(i.field ?? "");
    const value = String(i.value ?? "");
    if (!field || !value) continue;
    const c = i.confidence === "high" || i.confidence === "medium" ? i.confidence : "low";
    inferred.push({ field, value, reason: String(i.reason ?? ""), confidence: c });
  }
  return { visibleText, observed, inferred };
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
