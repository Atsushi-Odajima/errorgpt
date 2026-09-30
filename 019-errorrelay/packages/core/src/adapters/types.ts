import type { Capability, Report } from "../schema/report.js";

export interface ChannelInfo {
  adapterId: string;
  name: { ja: string; en: string };
  capability: Capability;
  /** Official URL the user is guided to (HANDOFF) — never an undocumented endpoint. */
  officialUrl: string | null;
  /** Human-readable instructions for the handoff. */
  instructions: { ja: string[]; en: string[] };
  /** Date the route was last verified against official docs (from config). */
  verifiedAt: string;
  sourceUrls: string[];
  /** Known limitations / caveats. */
  caveats: { ja: string[]; en: string[] };
}

export interface PreparedSubmission {
  adapterId: string;
  capability: Capability;
  destination: string;
  subject: string;
  body: string;
  attachmentIds: string[];
  /** Prefilled URL (e.g. GitHub new issue) when the channel supports it. */
  prefillUrl: string | null;
  /** Fields in the official form and their mapped values (for copy-paste guidance). */
  formFields: { key: string; label: string; value: string }[];
}

export interface DirectSendResult {
  ok: boolean;
  receipt: string | null;
  error: string | null;
  /** 'unknown' when the request timed out and the outcome could not be determined. */
  outcome: "sent" | "failed" | "unknown";
}

export interface ProviderAdapter {
  readonly id: string;
  /** Capability must be determined from config + official docs, never assumed. */
  capability(): Capability;
  info(): ChannelInfo;
  /** Decide if this adapter applies to the report's product. */
  supports(report: Report): boolean;
  prepare(report: Report, lang: "ja" | "en", ctx: PrepareContext): PreparedSubmission;
  /** Only implemented for DIRECT adapters. Must be idempotent w.r.t. idempotencyKey. */
  send?(prepared: PreparedSubmission, idempotencyKey: string): Promise<DirectSendResult>;
}

export interface PrepareContext {
  bodyText: string; // pre-generated report text (already redacted)
  developerText: string;
  attachmentNames: string[];
}

export interface ChannelConfigEntry {
  adapterId: string;
  enabled: boolean;
  capability: Capability;
  officialUrl: string | null;
  verifiedAt: string;
  sourceUrls: string[];
  name: { ja: string; en: string };
  instructions: { ja: string[]; en: string[] };
  caveats: { ja: string[]; en: string[] };
  products: string[];
  /** Adapter-specific options (e.g. GitHub owner/repo/template). Never secrets. */
  options: Record<string, string>;
}

export interface ChannelsConfig {
  configVersion: string;
  updatedAt: string;
  channels: ChannelConfigEntry[];
}
