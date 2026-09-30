/**
 * ErrorRelay MCP tools (OpenAI Plugins / any MCP client).
 * Every tool declares explicit readOnlyHint / destructiveHint / openWorldHint per the OpenAI plugin
 * requirements (SOURCE_NOTES §5). submit_report only sends for DIRECT channels; everything else is a handoff.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Hono } from "hono";
import { ProductIdSchema, FrequencySchema, PRODUCT_LABELS } from "@errorrelay/core";
import type { ReportService } from "./service.js";
import { authenticate, type AuthConfig, type Principal } from "./auth.js";
import { randomUUID } from "node:crypto";

export const MCP_TOOL_NAMES = [
  "create_error_report",
  "analyze_error_screenshot",
  "add_reproduction_step",
  "add_environment_info",
  "redact_report",
  "preview_report",
  "find_official_report_channel",
  "prepare_submission_package",
  "submit_report",
  "export_report",
  "list_my_reports",
  "get_report",
] as const;

const NO_SEND_NOTE = "ErrorRelay never sends anything automatically unless the channel capability is DIRECT and the user has explicitly confirmed. OpenAI Support and Codex /feedback are INTERACTIVE_HANDOFF: the user sends the prepared text themselves.";

export function createMcpServer(svc: ReportService, principal: Principal): McpServer {
  const server = new McpServer({ name: "errorrelay", version: "0.1.0" }, { instructions: `ErrorRelay helps users turn an error (screenshot, text, logs) into a bug report for the official channel. ${NO_SEND_NOTE} Ask only for information that is missing; never invent device, version, or time values.` });
  const t = principal.tenantId;
  const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
  const compact = (r: Awaited<ReturnType<ReportService["get"]>>) => ({ id: r.id, status: r.status, product: r.product, summary: r.summary, occurredAt: r.occurredAt?.display ?? null, steps: r.steps, expected: r.expected, actual: r.actual, errorText: r.errorText, environment: Object.fromEntries(Object.entries(r.environment).filter(([, f]) => f.source !== "unknown").map(([k, f]) => [k, `${f.value}${f.source === "inferred" ? " (inferred, unconfirmed)" : ""}`])), attachments: r.attachments.map((a) => ({ id: a.id, fileName: a.fileName, kind: a.kind, redacted: a.redacted, included: a.included })), redaction: r.redaction?.counts ?? null, submissions: r.submissions.map((s) => ({ adapterId: s.adapterId, capability: s.capability, status: s.status, receipt: s.receipt })) });

  server.registerTool(
    "create_error_report",
    {
      title: "Create error report",
      description: "Create a new draft error report from error text and/or a description. Product may be inferred from the text but stays 'unknown' when unclear. Does not send anything.",
      inputSchema: { language: z.enum(["ja", "en"]).default("ja"), product: ProductIdSchema.optional(), summary: z.string().max(300).optional(), description: z.string().max(20000).optional(), error_text: z.string().max(50000).optional(), occurred_at: z.string().optional().describe("Local time 'YYYY-MM-DD HH:mm' or 'now'"), timezone: z.string().optional().describe("IANA timezone, e.g. Asia/Tokyo") },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    },
    async (a) => {
      let r = await svc.create(t, { language: a.language, product: a.product, summary: a.summary, description: a.description, errorText: a.error_text });
      if (a.occurred_at && a.timezone) r = await svc.update(t, r.id, { occurredAt: a.occurred_at === "now" ? "now" : { text: a.occurred_at, timezone: a.timezone }, timezone: a.timezone });
      return text({ report: compact(r), next: "Ask only for missing items: occurred time/timezone, product, steps, expected/actual." });
    },
  );

  server.registerTool(
    "analyze_error_screenshot",
    {
      title: "Analyze error screenshot",
      description: "Run AI vision on an already-uploaded screenshot attachment (uploaded via the PWA/Companion). Returns visible text ('observed') separately from guesses ('inferred'); inferred values must be confirmed by the user. Requires the user's consent to send the image to the configured AI provider. When AI is off, returns manualFallback=true.",
      inputSchema: { report_id: z.string(), attachment_id: z.string(), user_consented_to_ai: z.literal(true) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (a) => {
      const res = await svc.analyzeScreenshot(t, a.report_id, a.attachment_id);
      return text({ manualFallback: res.manualFallback, note: res.note, errorTextCandidate: res.errorTextCandidate, observed: res.analysis.observed, inferred: res.analysis.inferred, visibleText: res.analysis.visibleText });
    },
  );

  server.registerTool(
    "add_reproduction_step",
    {
      title: "Add reproduction steps / expected / actual",
      description: "Append reproduction steps and set expected/actual behaviour. Pass a natural-language description to let ErrorRelay propose steps (never invented; unknowns come back as questions).",
      inputSchema: { report_id: z.string(), description: z.string().max(20000).optional(), steps: z.array(z.string().max(1000)).max(50).optional(), expected: z.string().max(2000).optional(), actual: z.string().max(2000).optional(), frequency: FrequencySchema.optional(), retried: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    },
    async (a) => {
      let proposal = null;
      if (a.description) proposal = (await svc.buildRepro(t, a.report_id, a.description)).repro;
      const cur = await svc.get(t, a.report_id);
      const r = await svc.update(t, a.report_id, { steps: a.steps ? [...cur.steps, ...a.steps] : cur.steps, expected: a.expected, actual: a.actual, frequency: a.frequency, retried: a.retried });
      return text({ report: compact(r), proposal, note: proposal ? "Proposal needs user confirmation before it is applied via steps/expected/actual." : undefined });
    },
  );

  server.registerTool(
    "add_environment_info",
    {
      title: "Add environment info",
      description: "Record environment values the user stated (device, OS, app/CLI version, model, browser…). Values are stored as 'manual'. Do not pass guessed values.",
      inputSchema: { report_id: z.string(), environment: z.record(z.string().max(500).nullable()), occurred_at: z.string().optional(), timezone: z.string().optional(), product: ProductIdSchema.optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (a) => {
      const r = await svc.update(t, a.report_id, { environment: a.environment, product: a.product, occurredAt: a.occurred_at ? (a.occurred_at === "now" ? "now" : { text: a.occurred_at, timezone: a.timezone ?? "UTC" }) : undefined, timezone: a.timezone });
      return text({ report: compact(r) });
    },
  );

  server.registerTool(
    "redact_report",
    {
      title: "Scan and redact secrets / personal data",
      description: "Scan all text fields for emails, phone numbers, API keys, tokens, passwords, OTP, card numbers, user paths, etc. and replace them with solid placeholders. Automatic detection is not exhaustive; the user must still review. Images are redacted in the PWA/Companion, not here.",
      inputSchema: { report_id: z.string(), keep_categories: z.array(z.string()).optional().describe("Categories the user explicitly chose to keep as-is") },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (a) => {
      const decisions = Object.fromEntries((a.keep_categories ?? []).map((k) => [k, "keep"]));
      const res = await svc.redactReport(t, a.report_id, decisions as never);
      return text({ findingsCount: res.findingsCount, counts: res.report.redaction?.counts, kept: res.report.redaction?.keptCategories, disclaimer: "Automatic detection is not exhaustive. Review manually before sending." });
    },
  );

  server.registerTool(
    "preview_report",
    {
      title: "Preview report text",
      description: "Render the report in a given format and language for the user to review. Also returns the quality checklist (missing items, no score).",
      inputSchema: { report_id: z.string(), format: z.enum(["short", "detailed", "developer", "json", "diagnostic"]).default("short"), language: z.enum(["ja", "en"]).default("ja") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (a) => {
      const r = await svc.get(t, a.report_id);
      return text({ text: svc.render(r, a.format, a.language), quality: svc.quality(r, true) });
    },
  );

  server.registerTool(
    "find_official_report_channel",
    {
      title: "Find official report channel",
      description: "List the official channels applicable to this report with their capability: DIRECT (can send), INTERACTIVE_HANDOFF (user sends via official UI), EXPORT_ONLY, UNAVAILABLE. Also checks known incidents/issues when possible. Never asserts that no incident exists.",
      inputSchema: { report_id: z.string(), include_known_issues: z.boolean().default(false) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (a) => {
      const r = await svc.get(t, a.report_id);
      const channels = svc.channelsFor(r);
      const known = a.include_known_issues ? await svc.knownIssues(r) : undefined;
      return text({ channels, knownIssues: known, note: NO_SEND_NOTE });
    },
  );

  server.registerTool(
    "prepare_submission_package",
    {
      title: "Prepare submission (preview before sending)",
      description: "Marks the report ready (fails if required items are missing) and prepares the exact destination, body, attachments, personal-data summary and identity the user must confirm. Returns a confirmation_token; nothing is sent by this tool.",
      inputSchema: { report_id: z.string(), adapter_id: z.string(), language: z.enum(["ja", "en"]).default("ja") },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (a) => {
      const cur = await svc.get(t, a.report_id);
      if (cur.status === "draft") await svc.markReady(t, a.report_id);
      const res = await svc.preparePreview(t, a.report_id, a.adapter_id, a.language, principal.identity);
      return text({ capability: res.preview.capability, destination: res.preview.destination, subject: res.preview.prepared.subject, body: res.preview.bodyText, attachments: res.preview.attachmentNames, personalDataRedacted: res.preview.personalDataSummary, keptCategories: res.preview.keptCategories, identity: res.preview.identity, unresolvedFindings: res.unresolvedFindings, prefillUrl: res.preview.prepared.prefillUrl, instructions: res.channel.instructions[a.language], caveats: res.channel.caveats[a.language], confirmation_token: res.preview.confirmationToken, note: res.preview.capability === "DIRECT" ? "Show all of the above to the user and ask for explicit confirmation before calling submit_report." : "This channel is a handoff/export. submit_report will only record 'handoff prepared'; the user sends it themselves." });
    },
  );

  server.registerTool(
    "submit_report",
    {
      title: "Submit report (DIRECT channels only)",
      description: "Executes a submission after the user explicitly confirmed the preview. Sends ONLY when the channel capability is DIRECT; for INTERACTIVE_HANDOFF/EXPORT_ONLY it records 'Handoff Prepared' and returns the text for the user to send themselves. Retrying with the same idempotency_key never double-sends. 'submitted' is reported only when the official channel returned a receipt.",
      inputSchema: { report_id: z.string(), confirmation_token: z.string(), user_confirmed: z.literal(true).describe("Must be true; the user said 'send' after seeing the preview"), idempotency_key: z.string().min(8).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (a) => {
      const res = await svc.submit(t, a.report_id, a.confirmation_token, a.idempotency_key ?? `mcp_${randomUUID()}`);
      return text({ status: res.report.status, submission: res.submission, message: res.message, idempotency_key: res.submission.idempotencyKey });
    },
  );

  server.registerTool(
    "export_report",
    {
      title: "Export report",
      description: "Return the report as TXT/Markdown/JSON text for the user to save. ZIP packages with attachments are downloaded through the PWA export endpoint.",
      inputSchema: { report_id: z.string(), format: z.enum(["short", "detailed", "developer", "json"]).default("detailed"), language: z.enum(["ja", "en"]).default("ja") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (a) => text(svc.render(await svc.get(t, a.report_id), a.format, a.language)),
  );

  server.registerTool(
    "list_my_reports",
    { title: "List my reports", description: "List the caller's reports (own tenant only).", inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } },
    async () => text((await svc.list(t)).map((r) => ({ id: r.id, status: r.status, product: PRODUCT_LABELS[r.product].en, summary: r.summary, updatedAt: r.updatedAt }))),
  );

  server.registerTool(
    "get_report",
    { title: "Get report", description: "Get one report by id.", inputSchema: { report_id: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } },
    async (a) => text(compact(await svc.get(t, a.report_id))),
  );

  return server;
}

/** Mount a stateless streamable-HTTP MCP endpoint at /mcp (bearer auth → tenant). */
export async function mountMcp(app: Hono<any>, svc: ReportService, auth: AuthConfig, path = "/mcp") {
  app.all(path, async (c) => {
    const principal = authenticate(auth, c.req.header("authorization"));
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    const server = createMcpServer(svc, principal);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
