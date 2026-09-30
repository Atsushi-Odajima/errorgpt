import type { Report } from "../schema/report.js";

export type CheckStatus = "ok" | "missing" | "warn";
export interface QualityItem {
  id: string;
  status: CheckStatus;
  label: { ja: string; en: string };
  detail?: string;
}
export interface QualityResult {
  items: QualityItem[];
  missing: string[];
  warnings: string[];
  /** True when the user has previewed the report (must be set by the UI). */
  previewed: boolean;
  readyToSend: boolean;
}

/** Checklist only. No numeric score — we do not grade users. */
export function checkReportQuality(report: Report, opts: { previewed?: boolean; secretScanDone?: boolean; unresolvedFindings?: number } = {}): QualityResult {
  const items: QualityItem[] = [];
  const add = (id: string, ok: boolean, ja: string, en: string, warn = false, detail?: string) =>
    items.push({ id, status: ok ? "ok" : warn ? "warn" : "missing", label: { ja, en }, detail });

  add("summary", report.summary.trim().length > 0, "要約", "Summary");
  add("occurredAt", !!report.occurredAt, "発生日時", "Occurred at");
  add("timezone", !!report.occurredAt?.timezone, "タイムゾーン", "Timezone");
  add("product", report.product !== "unknown", "対象製品", "Product");
  const envKnown = Object.values(report.environment).some((f) => f.source !== "unknown");
  add("environment", envKnown, "環境情報", "Environment", true);
  add("steps", report.steps.length > 0, "再現手順", "Steps to reproduce");
  add("expected", report.expected.trim().length > 0, "期待する動作", "Expected behavior");
  add("actual", report.actual.trim().length > 0, "実際の動作", "Actual behavior");
  add("errorText", report.errorText.trim().length > 0, "エラー文", "Error message", true);
  add("screenshot", report.attachments.some((a) => a.kind === "screenshot" || a.kind === "image"), "スクリーンショット", "Screenshot", true, "optional");
  add("secretScan", opts.secretScanDone === true, "秘密情報スキャン", "Secret scan");
  add("unresolvedFindings", (opts.unresolvedFindings ?? 0) === 0, "未処理の検出項目", "Unresolved findings", false, opts.unresolvedFindings ? `${opts.unresolvedFindings} unresolved` : undefined);
  add("preview", opts.previewed === true, "利用者による確認", "User preview");

  const missing = items.filter((i) => i.status === "missing").map((i) => i.id);
  const warnings = items.filter((i) => i.status === "warn").map((i) => i.id);
  return { items, missing, warnings, previewed: opts.previewed === true, readyToSend: missing.length === 0 };
}
