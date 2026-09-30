import type { Report } from "../schema/report.js";
import { PRODUCT_LABELS } from "../schema/report.js";
import { environmentLines } from "../env/environment.js";
import { ConfigAdapter, subjectFor } from "./base.js";
import type { PrepareContext, PreparedSubmission } from "./types.js";

/**
 * OpenAI Support (help.openai.com chat widget / ticket form).
 * No public write API exists (see SOURCE_NOTES.md §1), so the capability is INTERACTIVE_HANDOFF:
 * we prepare the text and the user pastes it into the official widget. Account email is never auto-collected.
 */
export class OpenAISupportAdapter extends ConfigAdapter {
  prepare(report: Report, lang: "ja" | "en", ctx: PrepareContext): PreparedSubmission {
    const t = lang === "ja";
    const unknown = t ? "不明" : "unknown";
    const fields: PreparedSubmission["formFields"] = [
      { key: "issue_summary", label: "Issue Summary", value: report.summary },
      { key: "product", label: "Product", value: PRODUCT_LABELS[report.product][lang] },
      { key: "platform", label: "Platform", value: report.environment.platform.value ?? report.environment.os.value ?? unknown },
      { key: "device", label: "Device", value: report.environment.device.value ?? unknown },
      { key: "os", label: "OS", value: [report.environment.os.value, report.environment.osVersion.value].filter(Boolean).join(" ") || unknown },
      { key: "app_version", label: "App/CLI Version", value: report.environment.appVersion.value ?? report.environment.cliVersion.value ?? unknown },
      { key: "model", label: "Model", value: report.environment.model.value ?? unknown },
      { key: "occurred_at", label: "Occurred At", value: report.occurredAt?.display ?? unknown },
      { key: "timezone", label: "Timezone", value: report.occurredAt?.timezone ?? unknown },
      { key: "frequency", label: "Frequency", value: report.frequency },
      { key: "description", label: "Description", value: report.description },
      { key: "steps", label: "Steps to Reproduce", value: report.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") },
      { key: "expected", label: "Expected Behavior", value: report.expected },
      { key: "actual", label: "Actual Behavior", value: report.actual },
      { key: "error_message", label: "Error Message", value: report.errorText },
      { key: "ids", label: "Conversation/Request ID", value: [report.conversationId, report.requestId].filter(Boolean).join(" / ") || unknown },
      { key: "attachments", label: "Attachments", value: ctx.attachmentNames.join(", ") || (t ? "なし" : "none") },
      { key: "tried", label: "Troubleshooting Already Tried", value: report.troubleshootingTried.join("\n") || (t ? "なし" : "none") },
      { key: "notes", label: "Additional Notes", value: report.additionalNotes },
    ];
    void environmentLines;
    return {
      adapterId: this.id,
      capability: this.capability(),
      destination: this.entry.officialUrl ?? "help.openai.com",
      subject: subjectFor(report, lang),
      body: ctx.bodyText,
      attachmentIds: report.attachments.filter((a) => a.included).map((a) => a.id),
      prefillUrl: this.entry.officialUrl,
      formFields: fields,
    };
  }
}
