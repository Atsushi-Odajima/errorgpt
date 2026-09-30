import { PRODUCT_LABELS, type Report } from "../schema/report.js";
import { environmentLines } from "../env/environment.js";

export type ReportFormat = "short" | "detailed" | "developer" | "json" | "diagnostic";
export type Lang = "ja" | "en";

const L = {
  ja: {
    title: "件名",
    product: "製品",
    platform: "プラットフォーム",
    occurred: "発生日時",
    reported: "報告日時",
    frequency: "再現頻度",
    freq: { first_time: "初めて", sometimes: "時々", always: "毎回", unknown: "不明" },
    description: "説明",
    steps: "再現手順",
    expected: "期待する動作",
    actual: "実際の動作",
    error: "エラーメッセージ",
    env: "環境",
    requestId: "Request ID",
    conversationId: "Conversation ID",
    attachments: "添付",
    tried: "試したこと",
    notes: "補足",
    none: "（なし）",
    unknown: "不明",
    retried: "再試行",
    yes: "あり",
    no: "なし",
    rootCause: "原因の見立て",
    rc: { confirmed: "確認済み", likely: "可能性が高い", possible: "可能性あり", unknown: "不明（症状のみ報告）" },
    redaction: "秘密情報の処理",
    endpoint: "エンドポイント",
    httpStatus: "HTTPステータス",
    errorCode: "エラーコード",
  },
  en: {
    title: "Title",
    product: "Product",
    platform: "Platform",
    occurred: "Occurred",
    reported: "Reported",
    frequency: "Frequency",
    freq: { first_time: "First time", sometimes: "Sometimes", always: "Every time", unknown: "Unknown" },
    description: "Description",
    steps: "Steps to Reproduce",
    expected: "Expected Behavior",
    actual: "Actual Behavior",
    error: "Error Message",
    env: "Environment",
    requestId: "Request ID",
    conversationId: "Conversation ID",
    attachments: "Attachments",
    tried: "Troubleshooting Already Tried",
    notes: "Additional Notes",
    none: "(none)",
    unknown: "unknown",
    retried: "Retried",
    yes: "yes",
    no: "no",
    rootCause: "Root cause assessment",
    rc: { confirmed: "Confirmed", likely: "Likely", possible: "Possible", unknown: "Unknown (symptom report only)" },
    redaction: "Redaction",
    endpoint: "Endpoint",
    httpStatus: "HTTP status",
    errorCode: "Error code",
  },
} as const;

function productLabel(r: Report, lang: Lang): string {
  if (r.product === "other" && r.productOther) return r.productOther;
  return PRODUCT_LABELS[r.product][lang];
}

function attachmentsList(r: Report, lang: Lang): string {
  const inc = r.attachments.filter((a) => a.included);
  if (!inc.length) return L[lang].none;
  return inc.map((a) => `${a.fileName}${a.redacted ? (lang === "ja" ? "（マスク済み）" : " (redacted)") : ""}`).join(", ");
}

function stepsBlock(r: Report, lang: Lang): string {
  return r.steps.length ? r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : L[lang].none;
}

export function generateShort(r: Report, lang: Lang): string {
  const t = L[lang];
  const lines = [
    `${t.title}: ${r.summary || "-"}`,
    `${t.product}: ${productLabel(r, lang)}`,
    `${t.occurred}: ${r.occurredAt?.display ?? t.unknown}`,
    `${t.frequency}: ${t.freq[r.frequency]}`,
    "",
    `${t.steps}:`,
    stepsBlock(r, lang),
    "",
    `${t.expected}: ${r.expected || "-"}`,
    `${t.actual}: ${r.actual || "-"}`,
  ];
  if (r.errorText.trim()) lines.push("", `${t.error}:`, r.errorText.trim());
  if (r.requestId) lines.push(`${t.requestId}: ${r.requestId}`);
  if (r.conversationId) lines.push(`${t.conversationId}: ${r.conversationId}`);
  const env = environmentLines(r.environment, lang);
  if (env.length) lines.push("", `${t.env}:`, ...env);
  lines.push(`${t.attachments}: ${attachmentsList(r, lang)}`);
  return lines.join("\n");
}

export function generateDetailed(r: Report, lang: Lang): string {
  const t = L[lang];
  const env = environmentLines(r.environment, lang);
  const lines = [
    `# ${r.summary || "-"}`,
    "",
    `## ${t.product}`,
    productLabel(r, lang),
    "",
    `## ${t.occurred}`,
    `${r.occurredAt?.display ?? t.unknown}${r.occurredAt ? ` (${r.occurredAt.source}, confidence: ${r.occurredAt.confidence})` : ""}`,
    `${t.reported}: ${r.reportedAt ?? t.unknown}`,
    "",
    `## ${t.env}`,
    env.length ? env.join("\n") : t.unknown,
    "",
    `## ${t.description}`,
    r.description || "-",
    "",
    `## ${t.steps}`,
    stepsBlock(r, lang),
    "",
    `## ${t.expected}`,
    r.expected || "-",
    "",
    `## ${t.actual}`,
    r.actual || "-",
    "",
    `## ${t.error}`,
    r.errorText.trim() ? "```\n" + r.errorText.trim() + "\n```" : t.none,
    "",
    `## ${t.frequency}`,
    `${t.freq[r.frequency]}${r.retried === null ? "" : ` / ${t.retried}: ${r.retried ? t.yes : t.no}`}`,
  ];
  if (r.requestId || r.conversationId || r.endpoint || r.httpStatus || r.errorCode) {
    lines.push("", `## IDs`);
    if (r.requestId) lines.push(`- ${t.requestId}: ${r.requestId}`);
    if (r.conversationId) lines.push(`- ${t.conversationId}: ${r.conversationId}`);
    if (r.endpoint) lines.push(`- ${t.endpoint}: ${r.endpoint}`);
    if (r.httpStatus) lines.push(`- ${t.httpStatus}: ${r.httpStatus}`);
    if (r.errorCode) lines.push(`- ${t.errorCode}: ${r.errorCode}`);
  }
  lines.push("", `## ${t.tried}`, r.troubleshootingTried.length ? r.troubleshootingTried.map((x) => `- ${x}`).join("\n") : t.none);
  lines.push("", `## ${t.attachments}`, attachmentsList(r, lang));
  lines.push("", `## ${t.rootCause}`, `${t.rc[r.rootCause.level]}${r.rootCause.note ? ` — ${r.rootCause.note}` : ""}`);
  if (r.additionalNotes.trim()) lines.push("", `## ${t.notes}`, r.additionalNotes.trim());
  if (r.redaction) {
    const c = Object.entries(r.redaction.counts).map(([k, v]) => `${k}: ${v}`).join(", ");
    lines.push("", `## ${t.redaction}`, c || t.none);
  }
  return lines.join("\n");
}

/** GitHub-issue / developer style (English-first, but respects lang). */
export function generateDeveloper(r: Report, lang: Lang): string {
  const t = L[lang];
  const env = environmentLines(r.environment, lang);
  const lines = [
    `### ${t.actual}`,
    r.actual || "-",
    r.errorText.trim() ? "\n```\n" + r.errorText.trim() + "\n```" : "",
    "",
    `### ${t.steps}`,
    stepsBlock(r, lang),
    "",
    `### ${t.expected}`,
    r.expected || "-",
    "",
    `### ${t.env}`,
    env.length ? env.map((x) => `- ${x}`).join("\n") : `- ${t.unknown}`,
  ];
  if (r.requestId) lines.push(`- ${t.requestId}: ${r.requestId}`);
  if (r.httpStatus) lines.push(`- ${t.httpStatus}: ${r.httpStatus}`);
  if (r.errorCode) lines.push(`- ${t.errorCode}: ${r.errorCode}`);
  if (r.endpoint) lines.push(`- ${t.endpoint}: ${r.endpoint}`);
  lines.push(`- ${t.occurred}: ${r.occurredAt?.display ?? t.unknown}`, `- ${t.frequency}: ${t.freq[r.frequency]}`);
  lines.push("", `### ${t.notes}`, r.additionalNotes.trim() || t.none);
  return lines.join("\n");
}

/** Export-safe JSON: strips storage refs and tenant. */
export function generateJson(r: Report): string {
  const { tenantId: _t, ...rest } = r;
  const safe = { ...rest, attachments: r.attachments.map(({ storageRef: _s, ...a }) => a) };
  return JSON.stringify(safe, null, 2);
}

export function generateDiagnostic(r: Report, lang: Lang): string {
  const t = L[lang];
  const lines = [
    `ErrorRelay Diagnostic Package`,
    `Report ID: ${r.id}`,
    `Schema: ${r.schemaVersion}`,
    `Status: ${r.status}`,
    `${t.product}: ${productLabel(r, lang)}`,
    `${t.occurred}: ${r.occurredAt?.display ?? t.unknown}`,
    `Captured: ${r.capturedAt?.display ?? t.unknown}`,
    `${t.reported}: ${r.reportedAt ?? t.unknown}`,
    "",
    `${t.env}:`,
    ...(environmentLines(r.environment, lang).length ? environmentLines(r.environment, lang) : [t.unknown]),
    "",
    `Analysis (observed / inferred):`,
    ...(r.analysis?.observed.map((o) => `  observed ${o.field}=${o.value} [evidence: ${o.evidence}]`) ?? []),
    ...(r.analysis?.inferred.map((i) => `  inferred ${i.field}=${i.value} (${i.confidence}${i.confirmed ? ", confirmed" : ", unconfirmed"})`) ?? []),
    "",
    `Submissions: ${r.submissions.length ? r.submissions.map((s) => `${s.adapterId}:${s.capability}:${s.status}`).join(", ") : t.none}`,
  ];
  return lines.join("\n");
}

export function generateReport(r: Report, format: ReportFormat, lang: Lang): string {
  switch (format) {
    case "short":
      return generateShort(r, lang);
    case "detailed":
      return generateDetailed(r, lang);
    case "developer":
      return generateDeveloper(r, lang);
    case "json":
      return generateJson(r);
    case "diagnostic":
      return generateDiagnostic(r, lang);
  }
}
