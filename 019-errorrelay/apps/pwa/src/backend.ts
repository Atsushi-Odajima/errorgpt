/**
 * Two backends:
 *  - LocalBackend: everything runs in the browser using @errorrelay/core; reports live in IndexedDB (localOnly=true).
 *    No server, no AI, "no-save mode" friendly (data can be wiped from Settings).
 *  - ServerBackend: talks to @errorrelay/server (AI analysis, shared history, MCP).
 * Drafts created locally are marked localOnly and shown distinctly from server-saved reports.
 */
import {
  createReport, validateReport, transition, checkReportQuality, generateReport, buildPackage, zipPackage, importPackage, scanText, redactText,
  stripImageMetadata, sha256Hex, buildReproFromText, prepareSubmission, executeSubmission, MemoryIdempotencyStore, markUserSubmitted, createFollowup,
  AdapterRegistry, parseManualTimestamp, nowTimestamp, mergeEnvironment, manualField, captureBrowserEnvironment, snapshotRevision, analyzeErrorText,
  type Report, type Attachment, type ReportFormat, type ChannelInfo, type SubmissionPreview, type Finding, type Environment, type EnvField, type ProductId,
} from "@errorrelay/core";

export type Lang = "ja" | "en";

export interface UpdatePatch {
  summary?: string; product?: ProductId; description?: string; steps?: string[]; expected?: string; actual?: string; errorText?: string;
  frequency?: Report["frequency"]; retried?: boolean | null; troubleshootingTried?: string[]; additionalNotes?: string; language?: Lang;
  occurredAt?: "now" | null | { text: string; timezone: string }; environment?: Partial<Record<keyof Environment, string | null>>; timezone?: string;
}

export interface Backend {
  readonly kind: "local" | "server";
  list(): Promise<Report[]>;
  get(id: string): Promise<Report>;
  create(input: { language: Lang; errorText?: string; summary?: string; product?: ProductId }): Promise<Report>;
  update(id: string, patch: UpdatePatch): Promise<Report>;
  addAttachment(id: string, file: { fileName: string; mimeType: string; bytes: Uint8Array; redactedFrom?: string | null }): Promise<{ report: Report; attachment: Attachment; stripped: string[] }>;
  attachmentBytes(id: string, attachmentId: string): Promise<Uint8Array>;
  analyze(id: string, attachmentId: string): Promise<{ report: Report; manualFallback: boolean; errorTextCandidate: string; note: string }>;
  repro(id: string, description: string): Promise<{ steps: string[]; expected: string; actual: string; questions: string[] }>;
  scan(text: string): Promise<{ findings: Omit<Finding, "match">[]; redacted: string }>;
  redact(id: string, keep: string[]): Promise<{ report: Report; findingsCount: number }>;
  quality(id: string, previewed: boolean): Promise<ReturnType<typeof checkReportQuality>>;
  ready(id: string): Promise<Report>;
  render(id: string, format: ReportFormat, lang: Lang): Promise<string>;
  channels(id: string): Promise<ChannelInfo[]>;
  preview(id: string, adapterId: string, lang: Lang): Promise<{ preview: SubmissionPreview; unresolvedFindings: { category: string; severity: string; hint: string }[]; channel: ChannelInfo }>;
  submit(id: string, confirmationToken: string, idempotencyKey: string): Promise<{ report: Report; message: { ja: string; en: string }; submissionId: string }>;
  markSent(id: string, submissionId: string, ticketId: string | null): Promise<Report>;
  exportZip(id: string): Promise<Uint8Array>;
  importZip(zip: Uint8Array): Promise<Report>;
  followup(id: string, question: string, additions: Record<string, string>, ticketId: string | null): Promise<Report>;
  delete(id: string): Promise<void>;
  wipeAll(): Promise<void>;
  aiAvailable(): Promise<boolean>;
}

/* ---------------- IndexedDB helpers ---------------- */
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open("errorrelay", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("reports")) db.createObjectStore("reports", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idb<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((res, rej) => {
    const tx = db.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  });
}

export class LocalBackend implements Backend {
  readonly kind = "local" as const;
  private registry = new AdapterRegistry();
  private previews = new Map<string, { preview: SubmissionPreview; adapterId: string }>();
  private idem = new MemoryIdempotencyStore();

  private async save(r: Report): Promise<Report> {
    r.updatedAt = new Date().toISOString();
    const v = validateReport(r);
    if (!v.ok) throw new Error(v.errors.join("; "));
    await idb("reports", "readwrite", (s) => s.put(r));
    return r;
  }
  async list() {
    const all = await idb<Report[]>("reports", "readonly", (s) => s.getAll());
    return all.filter((r) => !r.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id: string) {
    const r = await idb<Report | undefined>("reports", "readonly", (s) => s.get(id));
    if (!r) throw new Error("report not found");
    return r;
  }
  async create(input: { language: Lang; errorText?: string; summary?: string; product?: ProductId }) {
    const r = createReport({ tenantId: "local", language: input.language, localOnly: true, summary: input.summary, product: input.product });
    if (input.errorText) applyErrorText(r, input.errorText);
    return this.save(r);
  }
  async update(id: string, patch: UpdatePatch) {
    const r = await this.get(id);
    const { occurredAt, environment, timezone, ...content } = patch;
    if (patch.errorText !== undefined) applyErrorText(r, patch.errorText);
    for (const [k, v] of Object.entries(content)) if (v !== undefined && k !== "errorText") (r as unknown as Record<string, unknown>)[k] = v;
    if (occurredAt === "now") r.occurredAt = nowTimestamp(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    else if (occurredAt === null) r.occurredAt = null;
    else if (occurredAt) {
      const ts = parseManualTimestamp(occurredAt.text, occurredAt.timezone);
      if (!ts) throw new Error("invalid time");
      r.occurredAt = ts;
    }
    if (environment) {
      const p: Partial<Record<keyof Environment, EnvField>> = {};
      for (const [k, v] of Object.entries(environment)) p[k as keyof Environment] = v === null || v === "" ? { value: null, source: "unknown" } : manualField(v);
      r.environment = mergeEnvironment(r.environment, p);
    }
    return this.save(r);
  }
  async addAttachment(id: string, file: { fileName: string; mimeType: string; bytes: Uint8Array; redactedFrom?: string | null }) {
    const r = await this.get(id);
    let bytes = file.bytes;
    let stripped: string[] = [];
    let exifStripped = false;
    if (file.mimeType.startsWith("image/")) {
      const s = stripImageMetadata(bytes);
      if (s.supported) {
        bytes = s.bytes;
        stripped = s.removed;
        exifStripped = true;
      }
    }
    const blobId = `blob_${crypto.randomUUID()}`;
    await idb("blobs", "readwrite", (s) => s.put({ id: blobId, reportId: id, bytes }));
    const attachment: Attachment = {
      id: `att_${crypto.randomUUID()}`, kind: file.mimeType.startsWith("image/") ? "screenshot" : "log", fileName: file.fileName.replace(/[\\/]/g, "_"), mimeType: file.mimeType, sizeBytes: bytes.length,
      sha256: await sha256Hex(bytes), redacted: !!file.redactedFrom, redactedFrom: file.redactedFrom ?? null, exifStripped, included: !!file.redactedFrom || !file.mimeType.startsWith("image/"), storageRef: blobId, createdAt: new Date().toISOString(),
    };
    if (file.redactedFrom) {
      const o = r.attachments.find((a) => a.id === file.redactedFrom);
      if (o) o.included = false;
    }
    r.attachments.push(attachment);
    if (!r.capturedAt) r.capturedAt = null;
    await this.save(r);
    return { report: r, attachment, stripped };
  }
  async attachmentBytes(id: string, attachmentId: string) {
    const r = await this.get(id);
    const a = r.attachments.find((x) => x.id === attachmentId);
    if (!a?.storageRef) throw new Error("attachment not found");
    const b = await idb<{ bytes: Uint8Array } | undefined>("blobs", "readonly", (s) => s.get(a.storageRef!));
    if (!b) throw new Error("attachment not found");
    return b.bytes;
  }
  async analyze(id: string) {
    const r = await this.get(id);
    r.analysis = { observed: [], inferred: [], visibleText: [], provider: null, analyzedAt: null };
    await this.save(r);
    return { report: r, manualFallback: true, errorTextCandidate: "", note: "AI analysis is only available in server mode. Type the error text manually." };
  }
  async repro(id: string, description: string) {
    const r = await this.get(id);
    r.description = description;
    await this.save(r);
    return buildReproFromText(description, r.product, r.language);
  }
  async scan(text: string) {
    const f = scanText(text);
    return { findings: f.map(({ match: _m, ...rest }) => rest), redacted: redactText(text, f).redacted };
  }
  async redact(id: string, keep: string[]) {
    const r = await this.get(id);
    const decisions = Object.fromEntries(keep.map((k) => [k, "keep" as const]));
    const counts: Record<string, number> = {};
    let total = 0;
    const fields = ["summary", "description", "errorText", "expected", "actual", "additionalNotes"] as const;
    for (const f of fields) {
      const found = scanText(r[f]);
      total += found.length;
      const red = redactText(r[f], found, decisions as never);
      r[f] = red.redacted;
      for (const [k, v] of Object.entries(red.summary.counts)) counts[k] = (counts[k] ?? 0) + v;
    }
    r.steps = r.steps.map((s) => redactText(s, scanText(s), decisions as never).redacted);
    r.redaction = { counts, keptCategories: keep, scannerVersion: "1.0.0", note: "Automatic detection is not exhaustive; user reviewed before export." };
    await this.save(r);
    return { report: r, findingsCount: total };
  }
  private remaining(r: Report): Finding[] {
    const kept = new Set(r.redaction?.keptCategories ?? []);
    return scanText([r.summary, r.description, r.errorText, r.expected, r.actual, r.additionalNotes, ...r.steps].join("\n")).filter((f) => !kept.has(f.category));
  }
  async quality(id: string, previewed: boolean) {
    const r = await this.get(id);
    return checkReportQuality(r, { previewed, secretScanDone: !!r.redaction, unresolvedFindings: this.remaining(r).length });
  }
  async ready(id: string) {
    const r = await this.get(id);
    const q = checkReportQuality(r, { previewed: true, secretScanDone: !!r.redaction, unresolvedFindings: this.remaining(r).length });
    const blocking = q.missing.filter((m) => m !== "preview");
    if (blocking.length) throw new Error(`missing: ${blocking.join(", ")}`);
    if (r.status === "ready") return r;
    const next = snapshotRevision(transition(r, "ready"), "ready");
    next.reportedAt ??= new Date().toISOString();
    return this.save(next);
  }
  async render(id: string, format: ReportFormat, lang: Lang) {
    return generateReport(await this.get(id), format, lang);
  }
  async channels(id: string) {
    return this.registry.forReport(await this.get(id)).map((a) => a.info());
  }
  async preview(id: string, adapterId: string, lang: Lang) {
    const r = await this.get(id);
    const adapter = this.registry.get(adapterId);
    if (!adapter) throw new Error("channel not found");
    const preview = prepareSubmission(r, adapter, lang, { identity: "none (local)" });
    this.previews.set(preview.confirmationToken, { preview, adapterId });
    return { preview, unresolvedFindings: this.remaining(r).map((f) => ({ category: f.category, severity: f.severity, hint: f.hint })), channel: adapter.info() };
  }
  async submit(id: string, confirmationToken: string, idempotencyKey: string) {
    const e = this.previews.get(confirmationToken);
    if (!e) throw new Error("preview expired; open the preview again");
    const r = await this.get(id);
    const res = await executeSubmission(r, this.registry.get(e.adapterId)!, e.preview, { confirmationToken, idempotencyKey, store: this.idem });
    await this.save(res.report);
    return { report: res.report, message: res.message, submissionId: res.submission.id };
  }
  async markSent(id: string, submissionId: string, ticketId: string | null) {
    return this.save(markUserSubmitted(await this.get(id), submissionId, ticketId));
  }
  async exportZip(id: string) {
    const r = await this.get(id);
    const files = [];
    for (const a of r.attachments) {
      if (!a.included || !a.storageRef) continue;
      files.push({ attachmentId: a.id, fileName: a.fileName, bytes: await this.attachmentBytes(id, a.id), redacted: a.redacted });
    }
    return zipPackage(await buildPackage(r, files, { guardFindings: this.remaining(r) }));
  }
  async importZip(zip: Uint8Array) {
    const imp = importPackage(zip);
    const r: Report = { ...imp.report, id: `rep_${crypto.randomUUID()}`, tenantId: "local", localOnly: true, attachments: [], submissions: [], status: "draft" };
    await this.save(r);
    for (const a of imp.report.attachments) {
      const bytes = imp.files[`redacted/${a.fileName}`] ?? imp.files[`attachments/${a.fileName}`];
      if (bytes) await this.addAttachment(r.id, { fileName: a.fileName, mimeType: a.mimeType, bytes, redactedFrom: a.redacted ? "imported" : null });
    }
    return this.get(r.id);
  }
  async followup(id: string, question: string, additions: Record<string, string>, ticketId: string | null) {
    const r = await this.get(id);
    return this.save(createFollowup(r, { question, additions, ticketId, language: r.language }).report);
  }
  async delete(id: string) {
    const r = await this.get(id);
    for (const a of r.attachments) if (a.storageRef) await idb("blobs", "readwrite", (s) => s.delete(a.storageRef!));
    await idb("reports", "readwrite", (s) => s.delete(id));
  }
  async wipeAll() {
    await idb("reports", "readwrite", (s) => s.clear());
    await idb("blobs", "readwrite", (s) => s.clear());
  }
  async aiAvailable() {
    return false;
  }
}

function applyErrorText(r: Report, errorText: string) {
  r.errorText = errorText;
  const a = analyzeErrorText(errorText);
  if (r.product === "unknown" && a.productGuess && a.productGuess.confidence !== "low") r.product = a.productGuess.product;
  r.httpStatus ??= a.httpStatus;
  r.errorCode ??= a.errorCode;
  r.requestId ??= a.requestId;
  r.conversationId ??= a.conversationId;
  if (!r.summary && a.cleanedMessage) r.summary = a.cleanedMessage.slice(0, 120);
}

/* ---------------- Server backend ---------------- */
export class ServerBackend implements Backend {
  readonly kind = "server" as const;
  constructor(private base: string, private token: string) {}
  private async req<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const res = await fetch(`${this.base.replace(/\/$/, "")}${path}`, { method, headers: { authorization: `Bearer ${this.token}`, "x-errorrelay-client": "1", ...(body ? { "content-type": "application/json" } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      const j = ct.includes("json") ? await res.json() : { error: await res.text() };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
    if (ct.includes("json")) return (await res.json()) as T;
    if (ct.includes("zip") || ct.includes("octet") || ct.includes("image")) return new Uint8Array(await res.arrayBuffer()) as T;
    return (await res.text()) as T;
  }
  async list() {
    const { reports } = await this.req<{ reports: { id: string }[] }>("GET", "/api/reports");
    return Promise.all(reports.map((r) => this.get(r.id)));
  }
  async get(id: string) {
    return (await this.req<{ report: Report }>("GET", `/api/reports/${id}`)).report;
  }
  async create(input: { language: Lang; errorText?: string; summary?: string; product?: ProductId }) {
    return (await this.req<{ report: Report }>("POST", "/api/reports", input)).report;
  }
  async update(id: string, patch: UpdatePatch) {
    return (await this.req<{ report: Report }>("PATCH", `/api/reports/${id}`, patch)).report;
  }
  async addAttachment(id: string, file: { fileName: string; mimeType: string; bytes: Uint8Array; redactedFrom?: string | null }) {
    const fd = new FormData();
    fd.append("file", new File([file.bytes as BlobPart], file.fileName, { type: file.mimeType }));
    if (file.redactedFrom) fd.append("redactedFrom", file.redactedFrom);
    return this.req<{ report: Report; attachment: Attachment; stripped: string[] }>("POST", `/api/reports/${id}/attachments`, undefined, fd);
  }
  async attachmentBytes(id: string, attachmentId: string) {
    const { url } = await this.req<{ url: string }>("GET", `/api/reports/${id}/attachments/${attachmentId}/url`);
    const res = await fetch(`${this.base.replace(/\/$/, "")}${url}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async analyze(id: string, attachmentId: string) {
    return this.req<{ report: Report; manualFallback: boolean; errorTextCandidate: string; note: string }>("POST", `/api/reports/${id}/analyze`, { attachmentId, consent: true });
  }
  async repro(id: string, description: string) {
    return (await this.req<{ repro: { steps: string[]; expected: string; actual: string; questions: string[] } }>("POST", `/api/reports/${id}/repro`, { description })).repro;
  }
  async scan(text: string) {
    return this.req<{ findings: Omit<Finding, "match">[]; redacted: string }>("POST", "/api/tools/scan", { text });
  }
  async redact(id: string, keep: string[]) {
    return this.req<{ report: Report; findingsCount: number }>("POST", `/api/reports/${id}/redact`, { decisions: Object.fromEntries(keep.map((k) => [k, "keep"])) });
  }
  async quality(id: string, previewed: boolean) {
    return this.req<ReturnType<typeof checkReportQuality>>("GET", `/api/reports/${id}/quality?previewed=${previewed ? 1 : 0}`);
  }
  async ready(id: string) {
    return (await this.req<{ report: Report }>("POST", `/api/reports/${id}/ready`)).report;
  }
  async render(id: string, format: ReportFormat, lang: Lang) {
    return this.req<string>("GET", `/api/reports/${id}/render?format=${format}&lang=${lang}`);
  }
  async channels(id: string) {
    return (await this.req<{ channels: ChannelInfo[] }>("GET", `/api/reports/${id}/channels`)).channels;
  }
  async preview(id: string, adapterId: string, lang: Lang) {
    return this.req<{ preview: SubmissionPreview; unresolvedFindings: { category: string; severity: string; hint: string }[]; channel: ChannelInfo }>("POST", `/api/reports/${id}/preview`, { adapterId, lang });
  }
  async submit(id: string, confirmationToken: string, idempotencyKey: string) {
    const r = await this.req<{ report: Report; message: { ja: string; en: string }; submission: { id: string } }>("POST", `/api/reports/${id}/submit`, { confirmationToken, idempotencyKey });
    return { report: r.report, message: r.message, submissionId: r.submission.id };
  }
  async markSent(id: string, submissionId: string, ticketId: string | null) {
    return (await this.req<{ report: Report }>("POST", `/api/reports/${id}/mark-sent`, { submissionId, ticketId })).report;
  }
  async exportZip(id: string) {
    return this.req<Uint8Array>("GET", `/api/reports/${id}/export`);
  }
  async importZip(zip: Uint8Array) {
    const fd = new FormData();
    fd.append("file", new File([zip as BlobPart], "package.zip", { type: "application/zip" }));
    return (await this.req<{ report: Report }>("POST", "/api/reports/import", undefined, fd)).report;
  }
  async followup(id: string, question: string, additions: Record<string, string>, ticketId: string | null) {
    return (await this.req<{ report: Report }>("POST", `/api/reports/${id}/followups`, { question, additions, ticketId })).report;
  }
  async delete(id: string) {
    await this.req("DELETE", `/api/reports/${id}`);
  }
  async wipeAll() {
    for (const r of await this.list()) await this.delete(r.id);
  }
  async aiAvailable() {
    try {
      const h = await fetch(`${this.base.replace(/\/$/, "")}/api/health`).then((r) => r.json());
      return !!h.ai;
    } catch {
      return false;
    }
  }
}

export function browserEnvironment(): Environment {
  const nav = navigator as Navigator & { standalone?: boolean; connection?: { effectiveType?: string } };
  return captureBrowserEnvironment({ userAgent: nav.userAgent, language: nav.language, onLine: nav.onLine, innerWidth: innerWidth, innerHeight: innerHeight, standalone: matchMedia("(display-mode: standalone)").matches || !!nav.standalone, connectionType: nav.connection?.effectiveType });
}
