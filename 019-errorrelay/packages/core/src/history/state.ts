import type { Report, ReportStatus } from "../schema/report.js";

const TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["draft", "handoff_prepared", "submitted", "submission_failed", "submission_unknown", "cancelled"],
  handoff_prepared: ["ready", "user_marked_submitted", "closed", "cancelled"],
  submitted: ["closed"],
  user_marked_submitted: ["closed", "handoff_prepared"],
  submission_failed: ["ready", "submitted", "submission_unknown", "cancelled"],
  submission_unknown: ["ready", "submitted", "submission_failed", "closed"],
  closed: [],
  cancelled: ["draft"],
};

export class InvalidTransitionError extends Error {
  constructor(from: ReportStatus, to: ReportStatus) {
    super(`Invalid status transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Returns a new report object; original is untouched. Guards 'submitted' against non-DIRECT receipts. */
export function transition(report: Report, to: ReportStatus, now = new Date()): Report {
  if (!canTransition(report.status, to)) throw new InvalidTransitionError(report.status, to);
  if (to === "submitted") {
    const ok = report.submissions.some((s) => s.capability === "DIRECT" && s.status === "sent" && s.receipt);
    if (!ok) throw new Error("Cannot mark as submitted: no DIRECT submission with a receipt");
  }
  return { ...report, status: to, updatedAt: now.toISOString() };
}

export const STATUS_LABELS: Record<ReportStatus, { ja: string; en: string }> = {
  draft: { ja: "下書き", en: "Draft" },
  ready: { ja: "送信準備完了", en: "Ready" },
  handoff_prepared: { ja: "公式窓口へ手渡し準備済み", en: "Handoff Prepared" },
  submitted: { ja: "送信済み（公式受領確認あり）", en: "Submitted (receipt confirmed)" },
  user_marked_submitted: { ja: "利用者が送信済みと記録", en: "User Marked Submitted" },
  submission_failed: { ja: "送信失敗", en: "Submission Failed" },
  submission_unknown: { ja: "送信結果不明", en: "Submission Unknown" },
  closed: { ja: "完了", en: "Closed" },
  cancelled: { ja: "取り消し", en: "Cancelled" },
};

/** Append an immutable revision snapshot (content fields only). */
export function snapshotRevision(report: Report, reason: string, now = new Date()): Report {
  const {
    summary, product, productOther, description, steps, expected, actual, errorText, errorCode, httpStatus, requestId,
    conversationId, endpoint, frequency, retried, troubleshootingTried, additionalNotes, rootCause, environment, occurredAt,
  } = report;
  const snapshot = {
    summary, product, productOther, description, steps, expected, actual, errorText, errorCode, httpStatus, requestId,
    conversationId, endpoint, frequency, retried, troubleshootingTried, additionalNotes, rootCause, environment, occurredAt,
  };
  const rev = (report.revisions.at(-1)?.rev ?? 0) + 1;
  return { ...report, revisions: [...report.revisions, { rev, at: now.toISOString(), reason, snapshot: structuredClone(snapshot) }] };
}
