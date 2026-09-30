import type { Report, Submission } from "../schema/report.js";
import type { ProviderAdapter, PreparedSubmission } from "../adapters/types.js";
import { transition } from "../history/state.js";
import { generateShort, generateDeveloper } from "../generate/report.js";

export interface SubmissionPreview {
  prepared: PreparedSubmission;
  /** What the user sees before confirming. */
  destination: string;
  bodyText: string;
  attachmentNames: string[];
  personalDataSummary: Record<string, number>;
  keptCategories: string[];
  /** Identity that will be visible to the recipient (e.g. GitHub login) — 'none' for anonymous handoffs. */
  identity: string;
  capability: PreparedSubmission["capability"];
  /** Random token the UI must echo back to confirm; prevents accidental sends. */
  confirmationToken: string;
  createdAt: string;
}

export interface IdempotencyStore {
  get(key: string): Promise<Submission | undefined>;
  set(key: string, s: Submission): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private m = new Map<string, Submission>();
  async get(k: string) {
    return this.m.get(k);
  }
  async set(k: string, s: Submission) {
    this.m.set(k, s);
  }
}

function rnd(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function prepareSubmission(
  report: Report,
  adapter: ProviderAdapter,
  lang: "ja" | "en",
  opts: { identity?: string; now?: Date } = {},
): SubmissionPreview {
  const bodyText = generateShort(report, lang);
  const developerText = generateDeveloper(report, lang);
  const attachmentNames = report.attachments.filter((a) => a.included).map((a) => a.fileName);
  const prepared = adapter.prepare(report, lang, { bodyText, developerText, attachmentNames });
  return {
    prepared,
    destination: prepared.destination,
    bodyText: prepared.body,
    attachmentNames,
    personalDataSummary: report.redaction?.counts ?? {},
    keptCategories: report.redaction?.keptCategories ?? [],
    identity: opts.identity ?? "none",
    capability: prepared.capability,
    confirmationToken: `confirm_${rnd()}`,
    createdAt: (opts.now ?? new Date()).toISOString(),
  };
}

export class ConfirmationRequiredError extends Error {
  constructor() {
    super("Explicit confirmation token required before external send");
    this.name = "ConfirmationRequiredError";
  }
}

export interface SubmitResult {
  report: Report;
  submission: Submission;
  /** Human message to display. */
  message: { ja: string; en: string };
}

/**
 * Executes a submission. Only DIRECT adapters actually send; others mark handoff/export.
 * Requires the confirmation token from the preview (explicit user action) and an idempotency key.
 */
export async function executeSubmission(
  report: Report,
  adapter: ProviderAdapter,
  preview: SubmissionPreview,
  input: { confirmationToken: string; idempotencyKey: string; store: IdempotencyStore; now?: Date },
): Promise<SubmitResult> {
  if (!input.confirmationToken || input.confirmationToken !== preview.confirmationToken) throw new ConfirmationRequiredError();
  const now = (input.now ?? new Date()).toISOString();
  const cap = adapter.capability();

  const existing = await input.store.get(input.idempotencyKey);
  if (existing && existing.status === "sent") {
    return { report, submission: existing, message: { ja: "この報告は既に送信済みです（二重送信を防止しました）。", en: "Already sent (duplicate send prevented)." } };
  }

  if (cap === "DIRECT" && adapter.send) {
    const res = await adapter.send(preview.prepared, input.idempotencyKey);
    const status: Submission["status"] = res.outcome === "sent" ? "sent" : res.outcome === "unknown" ? "unknown" : "failed";
    const submission: Submission = {
      id: existing?.id ?? `sub_${rnd()}`,
      adapterId: adapter.id,
      capability: "DIRECT",
      status,
      idempotencyKey: input.idempotencyKey,
      destination: preview.destination,
      receipt: res.receipt,
      ticketId: null,
      error: res.error,
      at: now,
    };
    await input.store.set(input.idempotencyKey, submission);
    let next: Report = { ...report, submissions: [...report.submissions.filter((s) => s.idempotencyKey !== input.idempotencyKey), submission], reportedAt: report.reportedAt ?? now };
    if (status === "sent") next = transition(next, "submitted", new Date(now));
    else if (status === "unknown") next = transition(next, "submission_unknown", new Date(now));
    else next = transition(next, "submission_failed", new Date(now));
    return {
      report: next,
      submission,
      message:
        status === "sent"
          ? { ja: "公式経路へ送信し、受領を確認しました。", en: "Sent through the official channel; receipt confirmed." }
          : status === "unknown"
            ? { ja: "送信結果を確認できませんでした。同じキーで再送すると二重送信を防ぎます。", en: "Outcome unknown. Retrying with the same key prevents duplicates." }
            : { ja: `送信に失敗しました: ${res.error ?? ""}`, en: `Submission failed: ${res.error ?? ""}` },
    };
  }

  if (cap === "INTERACTIVE_HANDOFF" || cap === "EXPORT_ONLY") {
    const submission: Submission = {
      id: `sub_${rnd()}`,
      adapterId: adapter.id,
      capability: cap,
      status: "prepared",
      idempotencyKey: input.idempotencyKey,
      destination: preview.destination,
      receipt: null,
      ticketId: null,
      error: null,
      at: now,
    };
    const next = transition({ ...report, submissions: [...report.submissions, submission], reportedAt: report.reportedAt ?? now }, "handoff_prepared", new Date(now));
    return {
      report: next,
      submission,
      message:
        cap === "INTERACTIVE_HANDOFF"
          ? { ja: "報告文を準備しました。公式窓口で内容を確認して、ご自身で送信してください。", en: "The report is prepared. Review and send it yourself at the official channel." }
          : { ja: "ファイルへ書き出しました。送信は行っていません。", en: "Exported to files. Nothing was sent." },
    };
  }
  throw new Error(`Channel ${adapter.id} is unavailable`);
}

/** The user tells us they sent it themselves. Kept distinct from system-confirmed 'submitted'. */
export function markUserSubmitted(report: Report, submissionId: string, ticketId: string | null, now = new Date()): Report {
  const submissions = report.submissions.map((s) => (s.id === submissionId ? { ...s, status: "user_marked_submitted" as const, ticketId, at: now.toISOString() } : s));
  return transition({ ...report, submissions }, "user_marked_submitted", now);
}
