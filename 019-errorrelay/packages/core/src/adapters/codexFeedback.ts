import type { Report } from "../schema/report.js";
import { ConfigAdapter, subjectFor } from "./base.js";
import type { PrepareContext, PreparedSubmission } from "./types.js";

/**
 * Codex official feedback flow (`/feedback` in CLI/Desktop; SOURCE_NOTES.md §4).
 * The flow runs inside Codex itself; ErrorRelay cannot call it, so this is INTERACTIVE_HANDOFF.
 * Known bugs (e.g. #44847) are surfaced as caveats and the fallback is the GitHub issue / support route.
 */
export class CodexFeedbackAdapter extends ConfigAdapter {
  prepare(report: Report, lang: "ja" | "en", ctx: PrepareContext): PreparedSubmission {
    const unknown = lang === "ja" ? "不明" : "unknown";
    return {
      adapterId: this.id,
      capability: this.capability(),
      destination: lang === "ja" ? "Codex 内の /feedback" : "/feedback inside Codex",
      subject: subjectFor(report, lang),
      body: ctx.developerText,
      attachmentIds: report.attachments.filter((a) => a.included && a.kind !== "screenshot").map((a) => a.id),
      prefillUrl: null,
      formFields: [
        { key: "version", label: "Codex version", value: report.environment.cliVersion.value ?? report.environment.appVersion.value ?? unknown },
        { key: "description", label: "Tell us about the bug", value: ctx.developerText },
        { key: "logs", label: "Include logs?", value: lang === "ja" ? "利用者が明示的に選択（既定: 含めない）" : "User's explicit choice (default: no)" },
      ],
    };
  }
}
