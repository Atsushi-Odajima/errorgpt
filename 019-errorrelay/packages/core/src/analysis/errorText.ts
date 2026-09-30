import type { ProductId } from "../schema/report.js";

export interface ErrorTextAnalysis {
  productGuess: { product: ProductId; confidence: "high" | "medium" | "low"; reason: string } | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorType: string | null;
  requestId: string | null;
  conversationId: string | null;
  endpoint: string | null;
  cleanedMessage: string;
  /** Free-form hints for the UI (never asserted as facts). */
  hints: string[];
}

const PRODUCT_PATTERNS: { re: RegExp; product: ProductId; conf: "high" | "medium" | "low"; reason: string }[] = [
  { re: /codex\s+(?:cli|--version|doctor)|@openai\/codex|codex-cli/i, product: "codex_cli", conf: "high", reason: "mentions Codex CLI" },
  { re: /codex\s+(?:app|desktop)/i, product: "codex_desktop", conf: "medium", reason: "mentions Codex app" },
  { re: /codex.*(?:vs ?code|extension|ide)|(?:vs ?code|extension|ide).*codex/i, product: "codex_ide", conf: "medium", reason: "mentions Codex IDE extension" },
  { re: /\bcodex\b/i, product: "codex_cli", conf: "low", reason: "mentions Codex" },
  { re: /api\.openai\.com|"type":\s*"(?:invalid_request_error|insufficient_quota|server_error|rate_limit_error|authentication_error)"|x-request-id|openai\.(?:APIError|RateLimitError|AuthenticationError)|\/v1\/(?:chat\/completions|responses|embeddings)/i, product: "openai_api", conf: "high", reason: "OpenAI API error shape" },
  { re: /chatgpt.*(?:ios|iphone|ipad)|(?:ios|iphone|ipad).*chatgpt/i, product: "chatgpt_ios", conf: "medium", reason: "mentions ChatGPT and iOS" },
  { re: /chatgpt.*android|android.*chatgpt/i, product: "chatgpt_android", conf: "medium", reason: "mentions ChatGPT and Android" },
  { re: /chatgpt.*(?:desktop|mac app|windows app)|(?:desktop|mac app|windows app).*chatgpt/i, product: "chatgpt_desktop", conf: "medium", reason: "mentions ChatGPT desktop" },
  { re: /chatgpt\.com|chat\.openai\.com/i, product: "chatgpt_web", conf: "high", reason: "ChatGPT web URL" },
  { re: /\bchatgpt\b/i, product: "chatgpt_web", conf: "low", reason: "mentions ChatGPT (platform not stated)" },
];

export function analyzeErrorText(text: string): ErrorTextAnalysis {
  const t = text ?? "";
  const hints: string[] = [];
  let productGuess: ErrorTextAnalysis["productGuess"] = null;
  for (const p of PRODUCT_PATTERNS) {
    if (p.re.test(t)) {
      productGuess = { product: p.product, confidence: p.conf, reason: p.reason };
      break;
    }
  }
  const status = /\b(?:HTTP\s*|status(?:\s*code)?[:=]?\s*|Error\s+)?(400|401|403|404|408|409|413|422|429|500|502|503|504)\b/.exec(t);
  const httpStatus = status ? Number(status[1]) : null;
  const requestId =
    /\b(req_[A-Za-z0-9]{8,})\b/.exec(t)?.[1] ??
    /x-request-id[:=\s"']+([A-Za-z0-9_-]{8,})/i.exec(t)?.[1] ??
    /request[ _-]?id[:=\s"']+([A-Za-z0-9_-]{8,})/i.exec(t)?.[1] ??
    null;
  const conversationId =
    /chatgpt\.com\/c\/([a-f0-9-]{8,})/i.exec(t)?.[1] ?? /conversation[ _-]?id[:=\s"']+([A-Za-z0-9_-]{8,})/i.exec(t)?.[1] ?? null;
  const errorType = /"type":\s*"([a-z_]+)"/.exec(t)?.[1] ?? /\b([A-Za-z]+Error)\b/.exec(t)?.[1] ?? null;
  const errorCode =
    /"code":\s*"?([A-Za-z0-9_.-]+)"?/.exec(t)?.[1] ??
    /(?:error|err)\s*code[:=\s]+([A-Za-z0-9_.-]+)/i.exec(t)?.[1] ??
    /\b(E[A-Z]{3,}|ECONN[A-Z]+|ETIMEDOUT)\b/.exec(t)?.[1] ??
    null;
  const endpoint = /(\/v1\/[a-z_/-]+)/i.exec(t)?.[1] ?? null;
  const msg = /"message":\s*"([^"]{3,300})"/.exec(t)?.[1];
  const cleanedMessage = (msg ?? t.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "").trim();
  if (httpStatus === 429) hints.push("429 usually indicates rate limit or quota; exact cause is not confirmed.");
  if (/network|timeout|ECONN|offline/i.test(t)) hints.push("Text mentions network conditions; consider recording network state.");
  if (!productGuess) hints.push("Product could not be inferred from text; ask the user.");
  return { productGuess, httpStatus, errorCode, errorType, requestId, conversationId, endpoint, cleanedMessage, hints };
}
