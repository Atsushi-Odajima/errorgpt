import type { AIProvider, VisionAnalysisResult } from "../ai/provider.js";
import { AIDisabledError } from "../ai/provider.js";
import type { Analysis } from "../schema/report.js";
import { analyzeErrorText } from "./errorText.js";

export interface ScreenshotAnalysisOutcome {
  analysis: Analysis;
  /** True when the AI provider was not used (AI OFF or failure) and the user must type the text manually. */
  manualFallback: boolean;
  errorTextCandidate: string;
  note: string;
}

/**
 * Analyze a screenshot with the injected provider. When AI is off or fails, returns an empty
 * analysis with manualFallback=true — the report can still be completed by hand.
 * Inferred values are never promoted to facts here; the caller shows them for confirmation.
 */
export async function analyzeScreenshot(
  provider: AIProvider,
  image: { bytes: Uint8Array; mimeType: string },
  opts: { language?: "ja" | "en"; now?: Date } = {},
): Promise<ScreenshotAnalysisOutcome> {
  const now = (opts.now ?? new Date()).toISOString();
  let result: VisionAnalysisResult | null = null;
  let note = "";
  if (!provider.enabled) {
    note = "AI analysis is off. Enter the error text manually.";
  } else {
    try {
      result = await provider.analyzeScreenshot(image, { language: opts.language });
    } catch (e) {
      note = e instanceof AIDisabledError ? "AI analysis is off." : `AI analysis failed: ${(e as Error).message}. Enter the error text manually.`;
    }
  }
  if (!result) {
    return {
      analysis: { observed: [], inferred: [], visibleText: [], provider: null, analyzedAt: null },
      manualFallback: true,
      errorTextCandidate: "",
      note,
    };
  }
  const visibleText = result.visibleText;
  const joined = visibleText.join("\n");
  const textAnalysis = analyzeErrorText(joined);
  const observed = [...result.observed];
  const inferred = result.inferred.map((i) => ({ ...i, confirmed: false }));
  if (textAnalysis.productGuess && !inferred.some((i) => i.field === "product")) {
    inferred.push({ field: "product", value: textAnalysis.productGuess.product, reason: textAnalysis.productGuess.reason, confidence: textAnalysis.productGuess.confidence, confirmed: false });
  }
  return {
    analysis: { observed, inferred, visibleText, provider: provider.id, analyzedAt: now },
    manualFallback: false,
    errorTextCandidate: pickErrorLines(visibleText).join("\n"),
    note: "Values under 'inferred' are guesses — confirm before use.",
  };
}

const ERROR_WORDS = /error|failed|fail|could not|couldn't|cannot|can't|unable|something went wrong|エラー|失敗|できません|問題が発生/i;

export function pickErrorLines(lines: string[]): string[] {
  const hits = lines.filter((l) => ERROR_WORDS.test(l));
  return hits.length ? hits : lines.slice(0, 5);
}
