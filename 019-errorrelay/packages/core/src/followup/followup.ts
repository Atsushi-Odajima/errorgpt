import type { Report, Followup } from "../schema/report.js";
import { snapshotRevision } from "../history/state.js";
import { environmentLines } from "../env/environment.js";

export interface FollowupInput {
  question: string;
  additions: Record<string, string>;
  ticketId?: string | null;
  language: "ja" | "en";
  now?: Date;
}

/** Generates a reply draft and appends a follow-up + revision. Never overwrites original content fields. */
export function createFollowup(report: Report, input: FollowupInput): { report: Report; followup: Followup } {
  const now = input.now ?? new Date();
  const lang = input.language;
  const lines: string[] = [];
  lines.push(lang === "ja" ? "お問い合わせありがとうございます。追加情報をお送りします。" : "Thank you for the follow-up. Here is the additional information.");
  if (input.ticketId) lines.push(`${lang === "ja" ? "チケット" : "Ticket"}: ${input.ticketId}`);
  lines.push("", lang === "ja" ? "【ご質問】" : "[Question]", input.question.trim(), "", lang === "ja" ? "【回答】" : "[Answer]");
  for (const [k, v] of Object.entries(input.additions)) lines.push(`- ${k}: ${v}`);
  lines.push("", lang === "ja" ? "【元の報告の要点】" : "[Original report summary]", `- ${report.summary}`, `- ${lang === "ja" ? "発生" : "Occurred"}: ${report.occurredAt?.display ?? (lang === "ja" ? "不明" : "unknown")}`);
  const env = environmentLines(report.environment, lang);
  if (env.length) lines.push(...env.map((e) => `- ${e}`));
  const followup: Followup = {
    id: `fu_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    question: input.question,
    reply: lines.join("\n"),
    additions: { ...input.additions },
    ticketId: input.ticketId ?? null,
    createdAt: now.toISOString(),
  };
  const withRev = snapshotRevision(report, `followup:${followup.id}`, now);
  return { report: { ...withRev, followups: [...withRev.followups, followup], updatedAt: now.toISOString() }, followup };
}
