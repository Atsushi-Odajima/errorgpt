import { scanText, redactText } from "@errorrelay/core";

/** Logger that never emits report bodies, screenshots or tokens. Every string field is scanned. */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const DENY_FIELDS = /^(body|errorText|description|screenshot|token|authorization|apiKey|api_key|secret|bytes)$/i;

function safeFields(fields?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (DENY_FIELDS.test(k)) {
      out[k] = "[omitted]";
      continue;
    }
    if (typeof v === "string") {
      const s = v.length > 300 ? v.slice(0, 300) + "…" : v;
      out[k] = redactText(s, scanText(s)).redacted;
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else out[k] = "[object]";
  }
  return out;
}

export function createLogger(sink: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (level: string, msg: string, fields?: Record<string, unknown>) =>
    sink(JSON.stringify({ t: new Date().toISOString(), level, msg, ...safeFields(fields) }));
  return {
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
