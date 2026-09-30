import type { AIProvider, ReproSuggestion } from "../ai/provider.js";
import { PRODUCT_LABELS, type ProductId } from "../schema/report.js";

export interface ReproResult {
  steps: string[];
  expected: string;
  actual: string;
  /** Open questions instead of fabricated steps. */
  questions: string[];
  source: "rules" | "ai" | "user";
  needsConfirmation: true;
}

const JA_SPLIT = /(?:して|したら|すると|したところ|押したら|押して|開いて|開いたら|たら|ら、|、そして|、その後|、次に|→|->)/;
const EN_SPLIT = /(?:,?\s+(?:and\s+)?then\s+|,\s+and\s+|\s+after\s+that\s+|;\s+|→|->)/i;

const JA_FAIL = /(できな(?:い|かった)|失敗|エラー|落ち|止ま|表示されな|開かな|反応しな|真っ白|フリーズ|固ま)/;
const EN_FAIL = /(fail|error|crash|could ?n[o']t|cannot|can't|unable|nothing happens|blank|freeze|froze|stuck|not (?:load|open|respond)|didn't|doesn't)/i;

function isJapanese(s: string): boolean {
  return /[぀-ヿ一-龯]/.test(s);
}

function contextStep(product: ProductId, lang: "ja" | "en"): string | null {
  const label = PRODUCT_LABELS[product]?.[lang];
  if (!label || product === "unknown" || product === "other") return null;
  if (product.startsWith("chatgpt")) return lang === "ja" ? `${label}で会話を開く。` : `Open a conversation in ${label}.`;
  if (product === "codex_cli") return lang === "ja" ? "ターミナルで Codex CLI を起動する。" : "Start Codex CLI in a terminal.";
  if (product === "codex_desktop" || product === "codex_ide") return lang === "ja" ? `${label}を開く。` : `Open ${label}.`;
  if (product === "openai_api") return lang === "ja" ? "OpenAI API へリクエストを送る。" : "Send a request to the OpenAI API.";
  return null;
}

function normalizeClause(c: string, lang: "ja" | "en"): string {
  let s = c.trim().replace(/^[、,。.\s]+|[、,\s]+$/g, "");
  if (!s) return "";
  if (lang === "ja") {
    // Convert casual "してもらって" / "頼んで" endings into request form; keep user words, avoid inventing.
    s = s.replace(/(作って|生成して|出して)もらっ?て?$/, "$1もらうよう依頼する").replace(/(押し|タップし|クリックし)$/, "$1た");
    if (!/[。]$/.test(s)) s += "。";
  } else {
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (!/[.]$/.test(s)) s += ".";
  }
  return s;
}

/**
 * Rule-based conversion. Splits the user's description into clauses in order; the last failing
 * clause becomes the actual result. It never adds steps that are not in the text except the
 * product context step (which is derived from the chosen product, not invented).
 */
export function buildReproFromText(description: string, product: ProductId, language?: "ja" | "en"): ReproResult {
  const lang = language ?? (isJapanese(description) ? "ja" : "en");
  const raw = description.replace(/\s+/g, " ").trim();
  const clauses = raw.split(lang === "ja" ? JA_SPLIT : EN_SPLIT).map((c) => c.trim()).filter(Boolean);
  const steps: string[] = [];
  const ctx = contextStep(product, lang);
  if (ctx) steps.push(ctx);
  let actual = "";
  const failRe = lang === "ja" ? JA_FAIL : EN_FAIL;
  clauses.forEach((c, idx) => {
    const isLast = idx === clauses.length - 1;
    if (isLast && failRe.test(c)) {
      actual = normalizeClause(c, lang);
    } else {
      const n = normalizeClause(c, lang);
      if (n) steps.push(n);
    }
  });
  const questions: string[] = [];
  if (steps.length <= (ctx ? 1 : 0)) questions.push(lang === "ja" ? "エラーの直前に何をしましたか？（押したボタン・入力内容など）" : "What did you do right before the error (button pressed, input)?");
  if (!actual) {
    questions.push(lang === "ja" ? "実際には何が起きましたか？（表示されたメッセージ等）" : "What actually happened (message shown, etc.)?");
  }
  const expected = actual ? deriveExpected(actual, lang) : "";
  return { steps, expected, actual, questions, source: "rules", needsConfirmation: true };
}

/** Very conservative expected-behaviour template from the failing clause. Marked for user confirmation. */
export function deriveExpected(actual: string, lang: "ja" | "en"): string {
  if (lang === "ja") {
    const m = /(.+?)(?:が|を)?(?:できな(?:い|かった)|失敗(?:した|する)|エラー(?:になった|が出た|が表示された)?)/.exec(actual);
    if (m && m[1]) return `${m[1].replace(/[。]$/, "")}が正常に完了する。`;
    return "操作が正常に完了する。";
  }
  const m = /(?:could ?n[o']t|cannot|can't|unable to|failed to|fails? to|didn't|doesn't)\s+(.+?)[.]?$/i.exec(actual);
  if (m && m[1]) return `The app ${m[1].replace(/\.$/, "")} successfully.`;
  return "The operation completes without an error.";
}

/** Prefer AI when enabled; fall back to rules. AI output is validated: empty or unsupported → rules. */
export async function buildRepro(
  provider: AIProvider,
  input: { description: string; errorText: string; product: ProductId; language: "ja" | "en" },
): Promise<ReproResult> {
  if (provider.enabled) {
    try {
      const s: ReproSuggestion = await provider.suggestReproduction(input);
      if (s.steps.length > 0 || s.actual) {
        return { steps: s.steps, expected: s.expected, actual: s.actual, questions: s.questions, source: "ai", needsConfirmation: true };
      }
    } catch {
      /* fall back */
    }
  }
  return buildReproFromText(input.description, input.product, input.language);
}

export const REPRO_QUESTIONS = {
  ja: [
    "何をしていましたか？",
    "何を押した直後に起きましたか？",
    "初めてですか？毎回ですか？時々ですか？",
    "再試行しましたか？結果は？",
    "本来どうなるはずでしたか？（Expected）",
    "実際にはどうなりましたか？（Actual）",
  ],
  en: [
    "What were you doing?",
    "What did you press right before it happened?",
    "First time, every time, or sometimes?",
    "Did you retry? What happened?",
    "What did you expect to happen?",
    "What actually happened?",
  ],
};
