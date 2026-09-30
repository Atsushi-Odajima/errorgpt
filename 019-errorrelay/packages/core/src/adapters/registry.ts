import type { Report, Capability } from "../schema/report.js";
import type { ChannelsConfig, ChannelConfigEntry, ProviderAdapter } from "./types.js";
import { OpenAISupportAdapter } from "./openaiSupport.js";
import { CodexFeedbackAdapter } from "./codexFeedback.js";
import { GitHubIssueAdapter, type GitHubClient } from "./githubIssue.js";
import { GenericEmailAdapter, GenericWebFormAdapter, ExportAdapter } from "./generic.js";
import { DEFAULT_CHANNELS } from "./defaultChannels.js";

export interface RegistryOptions {
  config?: ChannelsConfig;
  githubClient?: GitHubClient | null;
}

const VALID_CAPS: Capability[] = ["DIRECT", "INTERACTIVE_HANDOFF", "EXPORT_ONLY", "UNAVAILABLE"];

export function validateChannelsConfig(cfg: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const c = cfg as Partial<ChannelsConfig>;
  if (!c || typeof c !== "object") return { ok: false, errors: ["config is not an object"] };
  if (typeof c.configVersion !== "string") errors.push("configVersion missing");
  if (!Array.isArray(c.channels)) errors.push("channels missing");
  else
    c.channels.forEach((ch, i) => {
      if (!ch.adapterId) errors.push(`channels[${i}].adapterId missing`);
      if (!VALID_CAPS.includes(ch.capability)) errors.push(`channels[${i}].capability invalid`);
      if (typeof ch.enabled !== "boolean") errors.push(`channels[${i}].enabled missing`);
      if (!ch.verifiedAt) errors.push(`channels[${i}].verifiedAt missing`);
    });
  return { ok: errors.length === 0, errors };
}

export class AdapterRegistry {
  private adapters: ProviderAdapter[] = [];
  readonly config: ChannelsConfig;

  constructor(opts: RegistryOptions = {}) {
    this.config = opts.config ?? DEFAULT_CHANNELS;
    const v = validateChannelsConfig(this.config);
    if (!v.ok) throw new Error(`Invalid channels config: ${v.errors.join("; ")}`);
    for (const entry of this.config.channels) this.adapters.push(instantiate(entry, opts.githubClient ?? null));
  }

  all(): ProviderAdapter[] {
    return [...this.adapters];
  }
  get(id: string): ProviderAdapter | undefined {
    return this.adapters.find((a) => a.id === id);
  }
  /** Adapters applicable to the report, ordered: DIRECT, HANDOFF, EXPORT, UNAVAILABLE. */
  forReport(report: Report): ProviderAdapter[] {
    const order: Record<Capability, number> = { DIRECT: 0, INTERACTIVE_HANDOFF: 1, EXPORT_ONLY: 2, UNAVAILABLE: 3 };
    return this.adapters.filter((a) => a.supports(report)).sort((a, b) => order[a.capability()] - order[b.capability()]);
  }
}

function instantiate(entry: ChannelConfigEntry, gh: GitHubClient | null): ProviderAdapter {
  switch (entry.options.kind ?? entry.adapterId) {
    case "openai_support":
      return new OpenAISupportAdapter(entry);
    case "codex_feedback":
      return new CodexFeedbackAdapter(entry);
    case "github_issue":
      return new GitHubIssueAdapter(entry, gh);
    case "generic_email":
      return new GenericEmailAdapter(entry);
    case "generic_webform":
      return new GenericWebFormAdapter(entry);
    case "export":
      return new ExportAdapter(entry);
    default:
      // Unknown kinds are loaded as web-form handoffs so a config update can add a route without a code change.
      return new GenericWebFormAdapter(entry);
  }
}
