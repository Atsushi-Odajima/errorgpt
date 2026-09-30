import type { Report } from "../schema/report.js";
import { ConfigAdapter, subjectFor } from "./base.js";
import type { PrepareContext, PreparedSubmission } from "./types.js";

/** mailto: handoff. Recipient comes from config (operator-supplied), never guessed. */
export class GenericEmailAdapter extends ConfigAdapter {
  prepare(report: Report, lang: "ja" | "en", ctx: PrepareContext): PreparedSubmission {
    const to = this.entry.options.to ?? "";
    const subject = subjectFor(report, lang);
    const prefillUrl = to ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(ctx.bodyText)}` : null;
    return {
      adapterId: this.id,
      capability: this.capability(),
      destination: to || (lang === "ja" ? "メール（宛先は利用者が指定）" : "Email (recipient chosen by user)"),
      subject,
      body: ctx.bodyText,
      attachmentIds: report.attachments.filter((a) => a.included).map((a) => a.id),
      prefillUrl,
      formFields: [],
    };
  }
}

/** Web form handoff: opens the configured official URL and gives copyable fields. */
export class GenericWebFormAdapter extends ConfigAdapter {
  prepare(report: Report, lang: "ja" | "en", ctx: PrepareContext): PreparedSubmission {
    return {
      adapterId: this.id,
      capability: this.capability(),
      destination: this.entry.officialUrl ?? "",
      subject: subjectFor(report, lang),
      body: ctx.bodyText,
      attachmentIds: report.attachments.filter((a) => a.included).map((a) => a.id),
      prefillUrl: this.entry.officialUrl,
      formFields: [
        { key: "summary", label: lang === "ja" ? "要約" : "Summary", value: report.summary },
        { key: "body", label: lang === "ja" ? "本文" : "Body", value: ctx.bodyText },
      ],
    };
  }
}

/** Export only: produces files, never sends. */
export class ExportAdapter extends ConfigAdapter {
  override capability() {
    return "EXPORT_ONLY" as const;
  }
  override supports(): boolean {
    return true;
  }
  prepare(report: Report, lang: "ja" | "en", ctx: PrepareContext): PreparedSubmission {
    return {
      adapterId: this.id,
      capability: "EXPORT_ONLY",
      destination: lang === "ja" ? "ローカルファイル（TXT/Markdown/JSON/ZIP）" : "Local files (TXT/Markdown/JSON/ZIP)",
      subject: subjectFor(report, lang),
      body: ctx.bodyText,
      attachmentIds: report.attachments.filter((a) => a.included).map((a) => a.id),
      prefillUrl: null,
      formFields: [],
    };
  }
}
