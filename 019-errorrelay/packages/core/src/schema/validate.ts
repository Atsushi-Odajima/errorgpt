import { ReportSchema, type Report, SCHEMA_VERSION } from "./report.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  report?: Report;
}

export function validateReport(input: unknown): ValidationResult {
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const errors: string[] = [];
  if (parsed.data.schemaVersion.split(".")[0] !== SCHEMA_VERSION.split(".")[0]) {
    errors.push(`schemaVersion ${parsed.data.schemaVersion} is not compatible with ${SCHEMA_VERSION}`);
  }
  // Submitted requires a DIRECT submission with receipt.
  if (parsed.data.status === "submitted") {
    const ok = parsed.data.submissions.some(
      (s) => s.capability === "DIRECT" && s.status === "sent" && s.receipt,
    );
    if (!ok) errors.push("status 'submitted' requires a DIRECT submission with status 'sent' and a receipt");
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], report: parsed.data };
}

/** JSON Schema export for documentation / external validators. */
export function reportJsonSchema(): Record<string, unknown> {
  // zod v3 has no built-in JSON schema; we ship a hand-maintained summary in REPORT_SCHEMA.md
  // and expose the top-level keys here for tooling.
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "ErrorRelay Report",
    schemaVersion: SCHEMA_VERSION,
    required: Object.keys(ReportSchema.shape),
  };
}
