import { redactText, scanText } from "../privacy/index.js";

export interface ApiErrorInfo {
  requestId: string | null;
  endpoint: string | null;
  httpStatus: number | null;
  errorType: string | null;
  errorCode: string | null;
  message: string;
  category: "auth" | "rate_limit" | "quota" | "invalid_request" | "server" | "network" | "unknown";
  sdk: string | null;
  timestamp: string | null;
}

/** Parse an OpenAI API error (JSON body, SDK exception text, or curl output). */
export function parseApiError(raw: string, headers: Record<string, string> = {}): ApiErrorInfo {
  const t = raw ?? "";
  let json: Record<string, unknown> | null = null;
  try {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) json = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    json = null;
  }
  const err = (json?.error ?? json ?? {}) as Record<string, unknown>;
  const errorType = typeof err.type === "string" ? err.type : /\b(invalid_request_error|insufficient_quota|rate_limit_error|authentication_error|server_error|permission_error|not_found_error)\b/.exec(t)?.[1] ?? null;
  const errorCode = typeof err.code === "string" ? err.code : /"code":\s*"([^"]+)"/.exec(t)?.[1] ?? null;
  const message = typeof err.message === "string" ? err.message : (t.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();
  const status = /\b(?:status(?:\s*code)?|HTTP)[:=\s]*(\d{3})\b/i.exec(t)?.[1] ?? /\bError code:\s*(\d{3})\b/.exec(t)?.[1] ?? /\b(4\d\d|5\d\d)\b/.exec(t)?.[1];
  const httpStatus = status ? Number(status) : null;
  const hdr = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const requestId = hdr["x-request-id"] ?? /\b(req_[A-Za-z0-9]{8,})\b/.exec(t)?.[1] ?? /x-request-id[:=\s"']+([A-Za-z0-9_-]{8,})/i.exec(t)?.[1] ?? null;
  const endpoint = /(\/v1\/[a-z_/-]+)/i.exec(t)?.[1] ?? null;
  const sdk = /openai[-_ ](?:python|node|java|go|dotnet|ruby)[^\s]*\s*v?[\d.]+/i.exec(t)?.[0] ?? /"user-agent":\s*"([^"]+)"/i.exec(t)?.[1] ?? hdr["user-agent"] ?? null;
  const timestamp = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\b/.exec(t)?.[1] ?? null;
  let category: ApiErrorInfo["category"] = "unknown";
  if (httpStatus === 401 || errorType === "authentication_error") category = "auth";
  else if (errorType === "insufficient_quota" || errorCode === "insufficient_quota") category = "quota";
  else if (httpStatus === 429 || errorType === "rate_limit_error") category = "rate_limit";
  else if (httpStatus === 400 || httpStatus === 404 || errorType === "invalid_request_error") category = "invalid_request";
  else if ((httpStatus ?? 0) >= 500 || errorType === "server_error") category = "server";
  else if (/ECONN|ETIMEDOUT|timeout|network|socket hang up|ENOTFOUND/i.test(t)) category = "network";
  return { requestId, endpoint, httpStatus, errorType, errorCode, message, category, sdk, timestamp };
}

/** Minimal reproduction snippets with placeholder credentials. */
export function minimalReproduction(info: ApiErrorInfo, lang: "python" | "node" | "curl" = "curl", model = "<model>"): string {
  const ep = info.endpoint ?? "/v1/responses";
  if (lang === "curl") {
    return [
      `curl https://api.openai.com${ep} \\`,
      `  -H "Authorization: Bearer $OPENAI_API_KEY" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"model": "${model}", "input": "hello"}'`,
      `# Replace $OPENAI_API_KEY with your own key. Never paste a real key into a report.`,
    ].join("\n");
  }
  if (lang === "python") {
    return [
      "from openai import OpenAI",
      "client = OpenAI()  # reads OPENAI_API_KEY from the environment",
      `resp = client.responses.create(model="${model}", input="hello")`,
      "print(resp)",
    ].join("\n");
  }
  return [
    'import OpenAI from "openai";',
    "const client = new OpenAI(); // reads OPENAI_API_KEY from the environment",
    `const resp = await client.responses.create({ model: "${model}", input: "hello" });`,
    "console.log(resp);",
  ].join("\n");
}

/** Redact a request/response body for attachment; whole body is never attached automatically. */
export function redactApiBody(body: string): { redacted: string; findingsCount: number } {
  const f = scanText(body);
  const r = redactText(body, f);
  return { redacted: r.redacted, findingsCount: f.length };
}
