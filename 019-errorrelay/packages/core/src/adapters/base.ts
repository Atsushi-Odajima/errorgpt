import type { Report } from "../schema/report.js";
import type { ChannelConfigEntry, ChannelInfo, PrepareContext, PreparedSubmission, ProviderAdapter } from "./types.js";

export abstract class ConfigAdapter implements ProviderAdapter {
  constructor(protected entry: ChannelConfigEntry) {}
  get id(): string {
    return this.entry.adapterId;
  }
  capability() {
    return this.entry.enabled ? this.entry.capability : "UNAVAILABLE";
  }
  info(): ChannelInfo {
    return {
      adapterId: this.entry.adapterId,
      name: this.entry.name,
      capability: this.capability(),
      officialUrl: this.entry.officialUrl,
      instructions: this.entry.instructions,
      verifiedAt: this.entry.verifiedAt,
      sourceUrls: this.entry.sourceUrls,
      caveats: this.entry.caveats,
    };
  }
  supports(report: Report): boolean {
    return this.entry.products.includes("*") || this.entry.products.includes(report.product);
  }
  abstract prepare(report: Report, lang: "ja" | "en", ctx: PrepareContext): PreparedSubmission;
}

export function subjectFor(report: Report, lang: "ja" | "en"): string {
  return report.summary || (lang === "ja" ? "エラー報告" : "Error report");
}
