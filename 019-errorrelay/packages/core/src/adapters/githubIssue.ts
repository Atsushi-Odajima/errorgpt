import type { Report } from "../schema/report.js";
import { ConfigAdapter, subjectFor } from "./base.js";
import type { ChannelConfigEntry, DirectSendResult, PrepareContext, PreparedSubmission } from "./types.js";

export interface GitHubClient {
  createIssue(input: { owner: string; repo: string; title: string; body: string; idempotencyKey: string }): Promise<{ number: number; url: string }>;
}

/**
 * GitHub Issues for openai/codex. Default capability is INTERACTIVE_HANDOFF with a prefilled
 * "new issue" URL using the official template. DIRECT is available only when the operator
 * injects an authenticated client AND the config entry says DIRECT (explicit opt-in).
 */
export class GitHubIssueAdapter extends ConfigAdapter {
  constructor(entry: ChannelConfigEntry, private client: GitHubClient | null = null) {
    super(entry);
  }
  override capability() {
    const base = super.capability();
    if (base === "DIRECT" && !this.client) return "INTERACTIVE_HANDOFF";
    return base;
  }
  private templateFor(report: Report): string {
    const o = this.entry.options;
    if (report.product === "codex_cli") return o.templateCli ?? "3-cli.yml";
    if (report.product === "codex_desktop") return o.templateApp ?? "1-codex-app.yml";
    if (report.product === "codex_ide") return o.templateExtension ?? "2-extension.yml";
    return o.templateBug ?? "4-bug-report.yml";
  }
  prepare(report: Report, lang: "ja" | "en", ctx: PrepareContext): PreparedSubmission {
    const owner = this.entry.options.owner ?? "openai";
    const repo = this.entry.options.repo ?? "codex";
    const title = subjectFor(report, "en");
    const unknown = "unknown";
    const version = report.environment.cliVersion.value ?? report.environment.appVersion.value ?? unknown;
    const params = new URLSearchParams({ template: this.templateFor(report), title });
    // Map to template ids (SOURCE_NOTES §4). Values are pre-redacted text.
    params.set("version", version);
    params.set("actual", `${report.actual}\n\n${report.errorText}`.trim());
    params.set("steps", report.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
    if (report.expected) params.set("expected", report.expected);
    if (report.environment.model.value) params.set("model", report.environment.model.value);
    const platform = [report.environment.os.value, report.environment.osVersion.value, report.environment.architecture.value].filter(Boolean).join(" ");
    if (platform) params.set("platform", platform);
    params.set("notes", `Occurred: ${report.occurredAt?.display ?? unknown}\nFrequency: ${report.frequency}\n${report.additionalNotes}`.trim());
    const prefillUrl = `https://github.com/${owner}/${repo}/issues/new?${params.toString()}`;
    return {
      adapterId: this.id,
      capability: this.capability(),
      destination: `github.com/${owner}/${repo} (issues)`,
      subject: title,
      body: ctx.developerText,
      attachmentIds: [],
      prefillUrl,
      formFields: [
        { key: "version", label: "What version of Codex CLI is running?", value: version },
        { key: "plan", label: "What subscription do you have?", value: lang === "ja" ? "利用者が入力" : "User enters" },
        { key: "actual", label: "What issue are you seeing?", value: report.actual },
        { key: "steps", label: "What steps can reproduce the bug?", value: report.steps.join("\n") },
        { key: "expected", label: "What is the expected behavior?", value: report.expected },
      ],
    };
  }
  async send(prepared: PreparedSubmission, idempotencyKey: string): Promise<DirectSendResult> {
    if (this.capability() !== "DIRECT" || !this.client) {
      return { ok: false, receipt: null, error: "GitHub DIRECT is not enabled", outcome: "failed" };
    }
    try {
      const r = await this.client.createIssue({
        owner: this.entry.options.owner ?? "openai",
        repo: this.entry.options.repo ?? "codex",
        title: prepared.subject,
        body: prepared.body,
        idempotencyKey,
      });
      return { ok: true, receipt: r.url, error: null, outcome: "sent" };
    } catch (e) {
      const msg = (e as Error).message;
      const unknown = /timeout|ETIMEDOUT|aborted|socket hang up/i.test(msg);
      return { ok: false, receipt: null, error: msg, outcome: unknown ? "unknown" : "failed" };
    }
  }
}
