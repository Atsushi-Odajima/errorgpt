import {
  createReport, validateReport, transition, snapshotRevision, checkReportQuality, generateReport, buildPackage, zipPackage, importPackage,
  scanText, redactText, stripImageMetadata, sha256Hex, analyzeScreenshot, analyzeErrorText, buildRepro, prepareSubmission, executeSubmission,
  markUserSubmitted, createFollowup, AdapterRegistry, NullProvider, OpenAIStatusAdapter, searchGitHubIssues, similarity, KNOWN_ISSUE_NOTE,
  redactDoctorOutput, parseApiError, minimalReproduction, parseManualTimestamp, nowTimestamp, mergeEnvironment, manualField,
  type Report, type ReportContent, type AIProvider, type Attachment, type ProductId, type Environment, type EnvField, type SubmissionPreview,
  type IdempotencyStore, type Finding, type ChannelsConfig, type GitHubClient, type ReportFormat, type Submission,
} from "@errorrelay/core";
import type { Storage, BlobMeta } from "./storage.js";
import { validateUpload, MAX_ATTACHMENTS_PER_REPORT } from "./mime.js";
import type { Logger } from "./logger.js";
import { randomUUID } from "node:crypto";

export interface ServiceConfig {
  storage: Storage;
  ai?: AIProvider;
  channels?: ChannelsConfig;
  githubClient?: GitHubClient | null;
  logger: Logger;
  statusFeedUrl?: string | null;
  /** Retention in days for reports+attachments (default 30). 0 = keep until deleted. */
  retentionDays?: number;
  fetchImpl?: typeof fetch;
}

export class NotFoundError extends Error {
  constructor(what = "report") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}
export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ValidationError";
  }
}

/** Preview cache: confirmation tokens are single-use and expire. */
interface PreviewEntry {
  preview: SubmissionPreview;
  adapterId: string;
  reportId: string;
  tenantId: string;
  exp: number;
}

export class ReportService {
  readonly registry: AdapterRegistry;
  readonly ai: AIProvider;
  private previews = new Map<string, PreviewEntry>();
  private status: OpenAIStatusAdapter;
  constructor(private cfg: ServiceConfig) {
    this.registry = new AdapterRegistry({ config: cfg.channels, githubClient: cfg.githubClient ?? null });
    this.ai = cfg.ai ?? new NullProvider();
    this.status = new OpenAIStatusAdapter({ pageUrl: "https://status.openai.com", feedUrl: cfg.statusFeedUrl ?? null, fetchImpl: cfg.fetchImpl });
  }

  get storage() {
    return this.cfg.storage;
  }

  private idemStore(tenantId: string): IdempotencyStore {
    const s = this.cfg.storage;
    return { get: (k) => s.getIdempotency(tenantId, k), set: (k, v) => s.setIdempotency(tenantId, k, v) };
  }

  async create(tenantId: string, input: { language?: "ja" | "en"; product?: ProductId; summary?: string; description?: string; errorText?: string }): Promise<Report> {
    const r = createReport({ tenantId, ...input });
    if (input.errorText) this.applyErrorText(r, input.errorText);
    await this.save(r);
    this.cfg.logger.info("report.created", { tenantId, reportId: r.id });
    return r;
  }

  private applyErrorText(r: Report, errorText: string) {
    r.errorText = errorText;
    const a = analyzeErrorText(errorText);
    if (r.product === "unknown" && a.productGuess && a.productGuess.confidence !== "low") r.product = a.productGuess.product;
    r.httpStatus ??= a.httpStatus;
    r.errorCode ??= a.errorCode;
    r.requestId ??= a.requestId;
    r.conversationId ??= a.conversationId;
    r.endpoint ??= a.endpoint;
    if (!r.summary && a.cleanedMessage) r.summary = a.cleanedMessage.slice(0, 120);
  }

  async get(tenantId: string, id: string): Promise<Report> {
    const r = await this.cfg.storage.getReport(tenantId, id);
    if (!r || r.deletedAt) throw new NotFoundError();
    return r;
  }

  async list(tenantId: string): Promise<Report[]> {
    return (await this.cfg.storage.listReports(tenantId)).filter((r) => !r.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async save(r: Report) {
    r.updatedAt = new Date().toISOString();
    const v = validateReport(r);
    if (!v.ok) throw new ValidationError(v.errors.join("; "));
    await this.cfg.storage.putReport(r);
  }

  async update(tenantId: string, id: string, patch: Partial<ReportContent> & { occurredAt?: { text: string; timezone: string } | "now" | null; capturedAt?: { text: string; timezone: string } | null; environment?: Partial<Record<keyof Environment, string | null>>; language?: "ja" | "en"; timezone?: string }): Promise<Report> {
    const r = await this.get(tenantId, id);
    if (r.status !== "draft" && r.status !== "ready" && r.status !== "handoff_prepared" && r.status !== "submission_failed") throw new ValidationError(`report in status ${r.status} is not editable`);
    const { occurredAt, capturedAt, environment, language, timezone, ...content } = patch;
    if (patch.errorText !== undefined) this.applyErrorText(r, patch.errorText);
    for (const [k, v] of Object.entries(content)) {
      if (v === undefined || k === "errorText") continue;
      (r as unknown as Record<string, unknown>)[k] = v;
    }
    if (occurredAt === "now") r.occurredAt = nowTimestamp(timezone ?? "UTC");
    else if (occurredAt === null) r.occurredAt = null;
    else if (occurredAt) {
      const ts = parseManualTimestamp(occurredAt.text, occurredAt.timezone);
      if (!ts) throw new ValidationError("invalid occurredAt (use YYYY-MM-DD HH:mm and an IANA timezone)");
      r.occurredAt = ts;
    }
    if (capturedAt === null) r.capturedAt = null;
    else if (capturedAt) {
      const ts = parseManualTimestamp(capturedAt.text, capturedAt.timezone);
      if (!ts) throw new ValidationError("invalid capturedAt");
      r.capturedAt = { ...ts, source: "screenshot_metadata", confidence: "medium" };
    }
    if (environment) {
      const p: Partial<Record<keyof Environment, EnvField>> = {};
      for (const [k, v] of Object.entries(environment)) p[k as keyof Environment] = v === null ? { value: null, source: "unknown" } : manualField(v);
      r.environment = mergeEnvironment(r.environment, p);
    }
    if (language) r.language = language;
    await this.save(r);
    return r;
  }

  async setEnvironmentAuto(tenantId: string, id: string, env: Partial<Environment>): Promise<Report> {
    const r = await this.get(tenantId, id);
    r.environment = mergeEnvironment(r.environment, env);
    await this.save(r);
    return r;
  }

  async addAttachment(tenantId: string, id: string, file: { fileName: string; mimeType: string; bytes: Uint8Array; redactedFrom?: string | null; kind?: Attachment["kind"] }): Promise<{ report: Report; attachment: Attachment; stripped: string[] }> {
    const r = await this.get(tenantId, id);
    if (r.attachments.length >= MAX_ATTACHMENTS_PER_REPORT) throw new ValidationError("too many attachments");
    const check = validateUpload(file.fileName, file.mimeType, file.bytes);
    if (!check.ok) throw new ValidationError(check.reason ?? "invalid upload");
    let bytes = file.bytes;
    let exifStripped = false;
    let removed: string[] = [];
    if (check.mimeType!.startsWith("image/")) {
      const s = stripImageMetadata(bytes);
      if (s.supported) {
        bytes = s.bytes;
        exifStripped = true;
        removed = s.removed;
      }
    }
    const blobId = `blob_${randomUUID()}`;
    const meta: BlobMeta = { id: blobId, tenantId, reportId: id, mimeType: check.mimeType!, sizeBytes: bytes.length, sha256: await sha256Hex(bytes), createdAt: new Date().toISOString() };
    await this.cfg.storage.putBlob(meta, bytes);
    const attachment: Attachment = {
      id: `att_${randomUUID()}`,
      kind: file.kind ?? check.kind!,
      fileName: file.fileName.replace(/[\\/]/g, "_").slice(0, 120),
      mimeType: check.mimeType!,
      sizeBytes: bytes.length,
      sha256: meta.sha256,
      redacted: !!file.redactedFrom,
      redactedFrom: file.redactedFrom ?? null,
      exifStripped,
      // Originals are excluded from packages by default; redacted copies are included.
      included: !!file.redactedFrom || !check.mimeType!.startsWith("image/"),
      storageRef: blobId,
      createdAt: meta.createdAt,
    };
    if (file.redactedFrom) {
      const orig = r.attachments.find((a) => a.id === file.redactedFrom);
      if (orig) orig.included = false;
    }
    r.attachments.push(attachment);
    await this.save(r);
    this.cfg.logger.info("attachment.added", { tenantId, reportId: id, kind: attachment.kind, sizeBytes: bytes.length, exifStripped });
    return { report: r, attachment, stripped: removed };
  }

  async getAttachmentBytes(tenantId: string, reportId: string, attachmentId: string): Promise<{ attachment: Attachment; bytes: Uint8Array }> {
    const r = await this.get(tenantId, reportId); // throws if deleted
    const a = r.attachments.find((x) => x.id === attachmentId);
    if (!a || !a.storageRef) throw new NotFoundError("attachment");
    const b = await this.cfg.storage.getBlob(tenantId, a.storageRef);
    if (!b) throw new NotFoundError("attachment");
    return { attachment: a, bytes: b.bytes };
  }

  async setAttachmentIncluded(tenantId: string, reportId: string, attachmentId: string, included: boolean): Promise<Report> {
    const r = await this.get(tenantId, reportId);
    const a = r.attachments.find((x) => x.id === attachmentId);
    if (!a) throw new NotFoundError("attachment");
    a.included = included;
    await this.save(r);
    return r;
  }

  async deleteAttachment(tenantId: string, reportId: string, attachmentId: string): Promise<Report> {
    const r = await this.get(tenantId, reportId);
    const a = r.attachments.find((x) => x.id === attachmentId);
    if (!a) throw new NotFoundError("attachment");
    if (a.storageRef) await this.cfg.storage.deleteBlob(tenantId, a.storageRef);
    r.attachments = r.attachments.filter((x) => x.id !== attachmentId);
    await this.save(r);
    return r;
  }

  /** AI screenshot analysis (only when the user asks). Returns candidates; nothing is written as fact. */
  async analyzeScreenshot(tenantId: string, reportId: string, attachmentId: string) {
    const r = await this.get(tenantId, reportId);
    const { attachment, bytes } = await this.getAttachmentBytes(tenantId, reportId, attachmentId);
    const out = await analyzeScreenshot(this.ai, { bytes, mimeType: attachment.mimeType }, { language: r.language });
    r.analysis = out.analysis;
    if (!r.errorText && out.errorTextCandidate) this.applyErrorText(r, out.errorTextCandidate);
    await this.save(r);
    return { report: r, ...out };
  }

  async confirmInference(tenantId: string, reportId: string, field: string, confirmed: boolean): Promise<Report> {
    const r = await this.get(tenantId, reportId);
    if (!r.analysis) throw new ValidationError("no analysis");
    for (const i of r.analysis.inferred) {
      if (i.field !== field) continue;
      i.confirmed = confirmed;
      if (confirmed) {
        if (field === "product") r.product = i.value as ProductId;
        else if (field in r.environment) (r.environment as unknown as Record<string, EnvField>)[field] = { value: i.value, source: "manual" };
      }
    }
    await this.save(r);
    return r;
  }

  async buildRepro(tenantId: string, reportId: string, description?: string) {
    const r = await this.get(tenantId, reportId);
    if (description !== undefined) r.description = description;
    const res = await buildRepro(this.ai, { description: r.description, errorText: r.errorText, product: r.product, language: r.language });
    await this.save(r);
    return { report: r, repro: res };
  }

  scan(text: string): { findings: Omit<Finding, "match">[]; redacted: string } {
    const f = scanText(text);
    const red = redactText(text, f);
    return { findings: f.map(({ match: _m, ...rest }) => rest), redacted: red.redacted };
  }

  /** Redact text fields of the report in place, recording a summary (never the originals). */
  async redactReport(tenantId: string, reportId: string, decisions: Parameters<typeof redactText>[2] = {}): Promise<{ report: Report; findingsCount: number }> {
    const r = await this.get(tenantId, reportId);
    const fields: (keyof ReportContent)[] = ["summary", "description", "errorText", "expected", "actual", "additionalNotes"];
    const counts: Record<string, number> = {};
    const kept = new Set<string>();
    let total = 0;
    for (const f of fields) {
      const text = r[f] as string;
      const found = scanText(text);
      total += found.length;
      const red = redactText(text, found, decisions);
      (r as unknown as Record<string, unknown>)[f] = red.redacted;
      for (const [k, v] of Object.entries(red.summary.counts)) counts[k] = (counts[k] ?? 0) + v;
      red.summary.keptCategories.forEach((k) => kept.add(k));
    }
    r.steps = r.steps.map((s) => {
      const red = redactText(s, scanText(s), decisions);
      for (const [k, v] of Object.entries(red.summary.counts)) counts[k] = (counts[k] ?? 0) + v;
      return red.redacted;
    });
    r.redaction = { counts, keptCategories: [...kept], scannerVersion: "1.0.0", note: "Automatic detection is not exhaustive; user reviewed before export." };
    await this.save(r);
    return { report: r, findingsCount: total };
  }

  quality(r: Report, previewed: boolean) {
    const unresolved = this.remainingFindings(r);
    return checkReportQuality(r, { previewed, secretScanDone: !!r.redaction, unresolvedFindings: unresolved.length });
  }

  private remainingFindings(r: Report): Finding[] {
    const kept = new Set(r.redaction?.keptCategories ?? []);
    const text = [r.summary, r.description, r.errorText, r.expected, r.actual, r.additionalNotes, ...r.steps].join("\n");
    return scanText(text).filter((f) => !kept.has(f.category));
  }

  async markReady(tenantId: string, reportId: string): Promise<Report> {
    const r = await this.get(tenantId, reportId);
    const q = this.quality(r, true);
    const blocking = q.missing.filter((m) => m !== "preview");
    if (blocking.length) throw new ValidationError(`missing: ${blocking.join(", ")}`);
    const next = snapshotRevision(transition(r, "ready"), "ready");
    next.reportedAt ??= new Date().toISOString();
    await this.save(next);
    return next;
  }

  render(r: Report, format: ReportFormat, lang: "ja" | "en") {
    return generateReport(r, format, lang);
  }

  channelsFor(r: Report) {
    return this.registry.forReport(r).map((a) => a.info());
  }

  async preparePreview(tenantId: string, reportId: string, adapterId: string, lang: "ja" | "en", identity: string) {
    const r = await this.get(tenantId, reportId);
    const adapter = this.registry.get(adapterId);
    if (!adapter || !adapter.supports(r)) throw new ValidationError("channel not available for this report");
    if (adapter.capability() === "UNAVAILABLE") throw new ValidationError("channel unavailable");
    const leaks = this.remainingFindings(r);
    const preview = prepareSubmission(r, adapter, lang, { identity });
    this.previews.set(preview.confirmationToken, { preview, adapterId, reportId, tenantId, exp: Date.now() + 15 * 60_000 });
    return { preview, unresolvedFindings: leaks.map((f) => ({ category: f.category, severity: f.severity, hint: f.hint })), channel: adapter.info() };
  }

  async submit(tenantId: string, reportId: string, confirmationToken: string, idempotencyKey: string) {
    const entry = this.previews.get(confirmationToken);
    if (!entry || entry.tenantId !== tenantId || entry.reportId !== reportId || entry.exp < Date.now()) throw new ValidationError("confirmation token invalid or expired; preview again");
    const r = await this.get(tenantId, reportId);
    if (r.status === "draft") throw new ValidationError("report must be marked ready before sending");
    const adapter = this.registry.get(entry.adapterId)!;
    const res = await executeSubmission(r, adapter, entry.preview, { confirmationToken, idempotencyKey, store: this.idemStore(tenantId) });
    // A DIRECT 'unknown' outcome keeps the token so the user can retry with the same idempotency key.
    if (res.submission.status !== "unknown") this.previews.delete(confirmationToken);
    await this.save(res.report);
    this.cfg.logger.info("report.submission", { tenantId, reportId, adapterId: adapter.id, capability: res.submission.capability, status: res.submission.status });
    return res;
  }

  async markUserSubmitted(tenantId: string, reportId: string, submissionId: string, ticketId: string | null) {
    const r = await this.get(tenantId, reportId);
    const next = markUserSubmitted(r, submissionId, ticketId);
    await this.save(next);
    return next;
  }

  async close(tenantId: string, reportId: string) {
    const r = await this.get(tenantId, reportId);
    const next = transition(r, "closed");
    await this.save(next);
    return next;
  }

  async exportPackage(tenantId: string, reportId: string, opts: { includeOriginals?: boolean } = {}): Promise<{ zip: Uint8Array; fileName: string }> {
    const r = await this.get(tenantId, reportId);
    const guard = this.remainingFindings(r);
    const files = [];
    for (const a of r.attachments) {
      if (!a.included && !(opts.includeOriginals && !a.redactedFrom)) continue;
      if (!a.storageRef) continue;
      const b = await this.cfg.storage.getBlob(tenantId, a.storageRef);
      if (!b) continue;
      files.push({ attachmentId: a.id, fileName: a.fileName, bytes: b.bytes, redacted: a.redacted });
    }
    const pkg = await buildPackage(r, files, { guardFindings: guard });
    return { zip: zipPackage(pkg), fileName: `errorrelay_${r.id}.zip` };
  }

  async importPackage(tenantId: string, zip: Uint8Array): Promise<Report> {
    let imp: ReturnType<typeof importPackage>;
    try {
      imp = importPackage(zip);
    } catch (e) {
      throw new ValidationError(`invalid package: ${(e as Error).message}`);
    }
    const r: Report = { ...imp.report, tenantId, id: `rep_${randomUUID()}`, localOnly: false, attachments: [], submissions: [], status: imp.report.status === "closed" ? "closed" : "draft" };
    for (const a of imp.report.attachments) {
      const file = imp.files[`redacted/${a.fileName}`] ?? imp.files[`attachments/${a.fileName}`];
      if (!file) continue;
      const check = validateUpload(a.fileName, a.mimeType, file);
      if (!check.ok) continue;
      const blobId = `blob_${randomUUID()}`;
      await this.cfg.storage.putBlob({ id: blobId, tenantId, reportId: r.id, mimeType: a.mimeType, sizeBytes: file.length, sha256: await sha256Hex(file), createdAt: new Date().toISOString() }, file);
      r.attachments.push({ ...a, id: `att_${randomUUID()}`, storageRef: blobId, redactedFrom: null });
    }
    await this.save(r);
    return r;
  }

  async followup(tenantId: string, reportId: string, input: { question: string; additions: Record<string, string>; ticketId?: string | null }) {
    const r = await this.get(tenantId, reportId);
    const res = createFollowup(r, { ...input, language: r.language });
    await this.save(res.report);
    return res;
  }

  /** Delete report and all blobs. Backups are the operator's responsibility (see OPERATIONS.md). */
  async delete(tenantId: string, reportId: string): Promise<void> {
    const r = await this.cfg.storage.getReport(tenantId, reportId);
    if (!r) throw new NotFoundError();
    for (const b of await this.cfg.storage.listBlobs(tenantId, reportId)) await this.cfg.storage.deleteBlob(tenantId, b.id);
    await this.cfg.storage.deleteReport(tenantId, reportId);
    this.cfg.logger.info("report.deleted", { tenantId, reportId });
  }

  /** Retention sweep: hard-delete reports older than retentionDays (by updatedAt). Returns deleted ids. */
  async runRetention(now = new Date()): Promise<{ tenantId: string; reportId: string }[]> {
    const days = this.cfg.retentionDays ?? 30;
    if (days <= 0) return [];
    const cutoff = now.getTime() - days * 86400_000;
    const deleted: { tenantId: string; reportId: string }[] = [];
    for (const t of await this.cfg.storage.allTenants()) {
      for (const r of await this.cfg.storage.listReports(t)) {
        if (new Date(r.updatedAt).getTime() < cutoff) {
          await this.delete(t, r.id);
          deleted.push({ tenantId: t, reportId: r.id });
        }
      }
    }
    return deleted;
  }

  async knownIssues(r: Report) {
    const query = [r.summary, r.actual, r.errorText.slice(0, 200)].filter(Boolean).join(" ");
    const [status, gh] = await Promise.all([
      this.status.incidentsNear(r.occurredAt?.iso ?? null),
      r.product.startsWith("codex") ? searchGitHubIssues(query, { fetchImpl: this.cfg.fetchImpl }) : Promise.resolve([]),
    ]);
    return { status, github: gh.filter((g) => similarity(query, g.title) > 0.15).slice(0, 5), note: KNOWN_ISSUE_NOTE };
  }

  codexDoctorRedact(raw: string) {
    return redactDoctorOutput(raw);
  }

  apiError(raw: string, headers: Record<string, string> = {}) {
    const info = parseApiError(raw, headers);
    return { info, reproduction: { curl: minimalReproduction(info, "curl"), python: minimalReproduction(info, "python"), node: minimalReproduction(info, "node") } };
  }

  submissionsOf(r: Report): Submission[] {
    return r.submissions;
  }
}
