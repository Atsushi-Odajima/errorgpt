import { redactJsonValue, redactText, scanText, type Finding } from "../privacy/index.js";

/** Parse `codex --version` output such as "codex-cli 0.154.0" or "0.154.0". */
export function parseCodexVersion(output: string): string | null {
  const m = /(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?)/.exec(output ?? "");
  return m ? m[1]! : null;
}

export interface DoctorRedactionResult {
  redactedJson: string;
  findings: Finding[];
  /** Keys removed entirely because they are known to carry identity/paths. */
  droppedKeys: string[];
}

const DROP_KEYS = /^(home|homedir|cwd|workspace|workspaces|project(?:_?name)?|user(?:name)?|account|email|auth|token|api_key|apikey|session|thread_id|turn_id)$/i;

/**
 * Redact `codex doctor --json` output before attaching: strip identity/path keys and scan every string.
 * The official report is documented as already redacted, but versions differ — we never rely on that.
 */
export function redactDoctorOutput(raw: string): DoctorRedactionResult {
  const dropped: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const r = redactText(raw);
    return { redactedJson: r.redacted, findings: r.findings, droppedKeys: [] };
  }
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (DROP_KEYS.test(k)) {
          dropped.push(k);
          o[k] = "[REMOVED]";
        } else o[k] = walk(x);
      }
      return o;
    }
    return v;
  };
  const stripped = walk(parsed);
  const { value, findings } = redactJsonValue(stripped);
  const text = JSON.stringify(value, null, 2);
  // Belt and braces: a final pass on the serialized text (e.g. paths inside long strings).
  const finalPass = redactText(text, scanText(text));
  return { redactedJson: finalPass.redacted, findings: [...findings, ...finalPass.findings], droppedKeys: [...new Set(dropped)] };
}

/** Commands the companion may run only after the user explicitly triggers them (read-only). */
export const CODEX_DIAGNOSTIC_COMMANDS = [
  { id: "version", cmd: ["codex", "--version"], readOnly: true, ja: "Codex のバージョンを取得", en: "Get Codex version" },
  { id: "doctor", cmd: ["codex", "doctor", "--json"], readOnly: true, ja: "診断レポート（JSON）を生成", en: "Generate diagnostic report (JSON)" },
] as const;
