import { z } from "zod";

/** Bump when the report JSON shape changes incompatibly. */
export const SCHEMA_VERSION = "1.0.0";

export const ProductIdSchema = z.enum([
  "chatgpt_web",
  "chatgpt_ios",
  "chatgpt_android",
  "chatgpt_desktop",
  "codex_cli",
  "codex_desktop",
  "codex_ide",
  "openai_api",
  "other",
  "unknown",
]);
export type ProductId = z.infer<typeof ProductIdSchema>;

export const PRODUCT_LABELS: Record<ProductId, { ja: string; en: string }> = {
  chatgpt_web: { ja: "ChatGPT（Web）", en: "ChatGPT Web" },
  chatgpt_ios: { ja: "ChatGPT（iOS）", en: "ChatGPT iOS" },
  chatgpt_android: { ja: "ChatGPT（Android）", en: "ChatGPT Android" },
  chatgpt_desktop: { ja: "ChatGPT（Desktop）", en: "ChatGPT Desktop" },
  codex_cli: { ja: "Codex CLI", en: "Codex CLI" },
  codex_desktop: { ja: "Codex（Desktop App）", en: "Codex Desktop App" },
  codex_ide: { ja: "Codex（IDE 拡張）", en: "Codex IDE extension" },
  openai_api: { ja: "OpenAI API", en: "OpenAI API" },
  other: { ja: "その他", en: "Other" },
  unknown: { ja: "不明", en: "Unknown" },
};

/** Where a timestamp came from. Never guess: unknown stays unknown. */
export const TimestampSourceSchema = z.enum([
  "user_now",
  "user_manual",
  "screenshot_metadata",
  "screenshot_visible",
  "log",
  "system",
  "unknown",
]);
export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

export const TimestampSchema = z.object({
  /** UTC instant, ISO 8601 with Z. */
  iso: z.string().datetime({ offset: true }),
  /** IANA timezone, e.g. Asia/Tokyo. */
  timezone: z.string().min(1),
  /** Display string in local time e.g. "2026-09-30 13:44 JST / Asia/Tokyo". */
  display: z.string(),
  source: TimestampSourceSchema,
  confidence: ConfidenceSchema,
});
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Tri-state provenance for environment values: auto captured, manual, or unknown. */
export const EnvSourceSchema = z.enum(["auto", "manual", "inferred", "unknown"]);
export const EnvFieldSchema = z.object({
  value: z.string().nullable(),
  source: EnvSourceSchema,
});
export type EnvField = z.infer<typeof EnvFieldSchema>;

export const EnvironmentSchema = z.object({
  platform: EnvFieldSchema,
  os: EnvFieldSchema,
  osVersion: EnvFieldSchema,
  device: EnvFieldSchema,
  architecture: EnvFieldSchema,
  appVersion: EnvFieldSchema,
  cliVersion: EnvFieldSchema,
  model: EnvFieldSchema,
  browser: EnvFieldSchema,
  userAgent: EnvFieldSchema,
  viewport: EnvFieldSchema,
  displayMode: EnvFieldSchema,
  networkState: EnvFieldSchema,
  locale: EnvFieldSchema,
  sdk: EnvFieldSchema,
  region: EnvFieldSchema,
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const AttachmentKindSchema = z.enum(["screenshot", "image", "log", "har", "doctor", "text", "other"]);
export const AttachmentSchema = z.object({
  id: z.string().min(1),
  kind: AttachmentKindSchema,
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** True if this attachment is a redacted derivative. */
  redacted: z.boolean(),
  /** Attachment id this one was derived from (original stays untouched). */
  redactedFrom: z.string().nullable(),
  exifStripped: z.boolean(),
  /** Whether the user chose to include it in outgoing packages. */
  included: z.boolean(),
  /** Opaque storage reference (server side) — never a public URL. */
  storageRef: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const FrequencySchema = z.enum(["first_time", "sometimes", "always", "unknown"]);
export const RootCauseLevelSchema = z.enum(["confirmed", "likely", "possible", "unknown"]);

/** Observations are things visibly read from evidence; inferences are guesses and must be confirmed. */
export const ObservationSchema = z.object({
  field: z.string(),
  value: z.string(),
  evidence: z.string(),
});
export const InferenceSchema = z.object({
  field: z.string(),
  value: z.string(),
  reason: z.string(),
  confidence: ConfidenceSchema,
  confirmed: z.boolean().default(false),
});
export const AnalysisSchema = z.object({
  observed: z.array(ObservationSchema),
  inferred: z.array(InferenceSchema),
  visibleText: z.array(z.string()),
  provider: z.string().nullable(),
  analyzedAt: z.string().datetime({ offset: true }).nullable(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const RedactionSummarySchema = z.object({
  /** Category → count of redacted findings. Never contains the original strings. */
  counts: z.record(z.number().int().nonnegative()),
  /** Findings the user chose to keep as-is (category only). */
  keptCategories: z.array(z.string()),
  scannerVersion: z.string(),
  note: z.string(),
});
export type RedactionSummary = z.infer<typeof RedactionSummarySchema>;

export const ReportStatusSchema = z.enum([
  "draft",
  "ready",
  "handoff_prepared",
  "submitted",
  "user_marked_submitted",
  "submission_failed",
  "submission_unknown",
  "closed",
  "cancelled",
]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const CapabilitySchema = z.enum(["DIRECT", "INTERACTIVE_HANDOFF", "EXPORT_ONLY", "UNAVAILABLE"]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const SubmissionStatusSchema = z.enum([
  "prepared",
  "sent",
  "failed",
  "unknown",
  "user_marked_submitted",
]);
export const SubmissionSchema = z.object({
  id: z.string().min(1),
  adapterId: z.string().min(1),
  capability: CapabilitySchema,
  status: SubmissionStatusSchema,
  idempotencyKey: z.string().min(1),
  destination: z.string(),
  /** Receipt/id returned by the official channel on DIRECT success only. */
  receipt: z.string().nullable(),
  ticketId: z.string().nullable(),
  error: z.string().nullable(),
  at: z.string().datetime({ offset: true }),
});
export type Submission = z.infer<typeof SubmissionSchema>;

export const FollowupSchema = z.object({
  id: z.string().min(1),
  /** Question text pasted by the user (from support). */
  question: z.string(),
  /** Generated reply draft. */
  reply: z.string(),
  additions: z.record(z.string()),
  ticketId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Followup = z.infer<typeof FollowupSchema>;

export const RevisionSchema = z.object({
  rev: z.number().int().positive(),
  at: z.string().datetime({ offset: true }),
  reason: z.string(),
  /** Snapshot of the report content fields at that revision. */
  snapshot: z.record(z.unknown()),
});

export const LanguageSchema = z.enum(["ja", "en"]);

export const ReportContentSchema = z.object({
  summary: z.string(),
  product: ProductIdSchema,
  productOther: z.string().nullable(),
  description: z.string(),
  steps: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  errorText: z.string(),
  errorCode: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  requestId: z.string().nullable(),
  conversationId: z.string().nullable(),
  endpoint: z.string().nullable(),
  frequency: FrequencySchema,
  retried: z.boolean().nullable(),
  troubleshootingTried: z.array(z.string()),
  additionalNotes: z.string(),
  rootCause: z.object({ level: RootCauseLevelSchema, note: z.string() }),
});
export type ReportContent = z.infer<typeof ReportContentSchema>;

export const ReportSchema = ReportContentSchema.extend({
  id: z.string().min(1),
  schemaVersion: z.string(),
  tenantId: z.string().min(1),
  status: ReportStatusSchema,
  language: LanguageSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  /** When the evidence (screenshot etc.) was captured, if known. */
  capturedAt: TimestampSchema.nullable(),
  /** When the error occurred. Separate from reportedAt. */
  occurredAt: TimestampSchema.nullable(),
  /** When the report was created/finalised (system time, UTC). */
  reportedAt: z.string().datetime({ offset: true }).nullable(),
  environment: EnvironmentSchema,
  attachments: z.array(AttachmentSchema),
  analysis: AnalysisSchema.nullable(),
  redaction: RedactionSummarySchema.nullable(),
  submissions: z.array(SubmissionSchema),
  followups: z.array(FollowupSchema),
  revisions: z.array(RevisionSchema),
  targetChannel: z.string().nullable(),
  /** True when the report exists only in the client (offline draft) — never mixed with server-saved. */
  localOnly: z.boolean(),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
});
export type Report = z.infer<typeof ReportSchema>;

export function unknownEnv(): EnvField {
  return { value: null, source: "unknown" };
}
export function emptyEnvironment(): Environment {
  return {
    platform: unknownEnv(),
    os: unknownEnv(),
    osVersion: unknownEnv(),
    device: unknownEnv(),
    architecture: unknownEnv(),
    appVersion: unknownEnv(),
    cliVersion: unknownEnv(),
    model: unknownEnv(),
    browser: unknownEnv(),
    userAgent: unknownEnv(),
    viewport: unknownEnv(),
    displayMode: unknownEnv(),
    networkState: unknownEnv(),
    locale: unknownEnv(),
    sdk: unknownEnv(),
    region: unknownEnv(),
  };
}

export function newReportId(): string {
  const rnd = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `rep_${rnd}`;
}

export interface CreateReportInput {
  tenantId: string;
  language?: "ja" | "en";
  product?: ProductId;
  summary?: string;
  description?: string;
  errorText?: string;
  localOnly?: boolean;
  now?: Date;
  id?: string;
}

export function createReport(input: CreateReportInput): Report {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: input.id ?? newReportId(),
    schemaVersion: SCHEMA_VERSION,
    tenantId: input.tenantId,
    status: "draft",
    language: input.language ?? "ja",
    createdAt: now,
    updatedAt: now,
    capturedAt: null,
    occurredAt: null,
    reportedAt: null,
    summary: input.summary ?? "",
    product: input.product ?? "unknown",
    productOther: null,
    description: input.description ?? "",
    steps: [],
    expected: "",
    actual: "",
    errorText: input.errorText ?? "",
    errorCode: null,
    httpStatus: null,
    requestId: null,
    conversationId: null,
    endpoint: null,
    frequency: "unknown",
    retried: null,
    troubleshootingTried: [],
    additionalNotes: "",
    rootCause: { level: "unknown", note: "" },
    environment: emptyEnvironment(),
    attachments: [],
    analysis: null,
    redaction: null,
    submissions: [],
    followups: [],
    revisions: [],
    targetChannel: null,
    localOnly: input.localOnly ?? false,
    deletedAt: null,
  };
}
