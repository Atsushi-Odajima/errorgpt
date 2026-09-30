import { promises as fs } from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { Report, Submission } from "@errorrelay/core";

export interface BlobMeta {
  id: string;
  tenantId: string;
  reportId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface Storage {
  getReport(tenantId: string, id: string): Promise<Report | null>;
  putReport(report: Report): Promise<void>;
  listReports(tenantId: string): Promise<Report[]>;
  deleteReport(tenantId: string, id: string): Promise<void>;
  putBlob(meta: BlobMeta, bytes: Uint8Array): Promise<void>;
  getBlob(tenantId: string, id: string): Promise<{ meta: BlobMeta; bytes: Uint8Array } | null>;
  deleteBlob(tenantId: string, id: string): Promise<void>;
  listBlobs(tenantId: string, reportId: string): Promise<BlobMeta[]>;
  getIdempotency(tenantId: string, key: string): Promise<Submission | undefined>;
  setIdempotency(tenantId: string, key: string, s: Submission): Promise<void>;
  allTenants(): Promise<string[]>;
}

/** In-memory storage for tests and "no-save mode". */
export class MemoryStorage implements Storage {
  reports = new Map<string, Report>();
  blobs = new Map<string, { meta: BlobMeta; bytes: Uint8Array }>();
  idem = new Map<string, Submission>();
  private k(t: string, id: string) {
    return `${t}/${id}`;
  }
  async getReport(t: string, id: string) {
    const r = this.reports.get(this.k(t, id));
    return r && r.tenantId === t ? structuredClone(r) : null;
  }
  async putReport(r: Report) {
    this.reports.set(this.k(r.tenantId, r.id), structuredClone(r));
  }
  async listReports(t: string) {
    return [...this.reports.values()].filter((r) => r.tenantId === t).map((r) => structuredClone(r));
  }
  async deleteReport(t: string, id: string) {
    this.reports.delete(this.k(t, id));
  }
  async putBlob(meta: BlobMeta, bytes: Uint8Array) {
    this.blobs.set(this.k(meta.tenantId, meta.id), { meta, bytes: new Uint8Array(bytes) });
  }
  async getBlob(t: string, id: string) {
    const b = this.blobs.get(this.k(t, id));
    return b && b.meta.tenantId === t ? b : null;
  }
  async deleteBlob(t: string, id: string) {
    this.blobs.delete(this.k(t, id));
  }
  async listBlobs(t: string, reportId: string) {
    return [...this.blobs.values()].filter((b) => b.meta.tenantId === t && b.meta.reportId === reportId).map((b) => b.meta);
  }
  async getIdempotency(t: string, key: string) {
    return this.idem.get(this.k(t, key));
  }
  async setIdempotency(t: string, key: string, s: Submission) {
    this.idem.set(this.k(t, key), s);
  }
  async allTenants() {
    return [...new Set([...this.reports.values()].map((r) => r.tenantId))];
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
function assertId(id: string, what: string) {
  if (!SAFE_ID.test(id)) throw new Error(`invalid ${what}`);
}

/**
 * File-based storage: data/<tenant>/reports/<id>.json, data/<tenant>/blobs/<id>.{meta.json,bin}
 * Blobs are encrypted at rest with AES-256-GCM when a key is provided (ERRORRELAY_BLOB_KEY, 32 bytes hex/base64).
 * Suitable for single-node deployments; swap for S3/Postgres via the Storage interface for scale.
 */
export class FileStorage implements Storage {
  constructor(private root: string, private blobKey: Buffer | null = null) {}

  static keyFromString(s: string | undefined): Buffer | null {
    if (!s) return null;
    const buf = /^[a-f0-9]{64}$/i.test(s) ? Buffer.from(s, "hex") : Buffer.from(s, "base64");
    if (buf.length !== 32) throw new Error("ERRORRELAY_BLOB_KEY must be 32 bytes (hex or base64)");
    return buf;
  }

  private tdir(t: string) {
    assertId(t, "tenant id");
    return path.join(this.root, "tenants", t);
  }
  private async writeAtomic(file: string, data: Uint8Array | string) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }
  async getReport(t: string, id: string) {
    assertId(id, "report id");
    const file = path.join(this.tdir(t), "reports", `${id}.json`);
    try {
      const raw = await fs.readFile(file, "utf8");
      const r = JSON.parse(raw) as Report;
      return r.tenantId === t ? r : null;
    } catch {
      return null;
    }
  }
  async putReport(r: Report) {
    assertId(r.id, "report id");
    await this.writeAtomic(path.join(this.tdir(r.tenantId), "reports", `${r.id}.json`), JSON.stringify(r));
  }
  async listReports(t: string) {
    const dir = path.join(this.tdir(t), "reports");
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: Report[] = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const r = await this.getReport(t, n.slice(0, -5));
      if (r) out.push(r);
    }
    return out;
  }
  async deleteReport(t: string, id: string) {
    assertId(id, "report id");
    await fs.rm(path.join(this.tdir(t), "reports", `${id}.json`), { force: true });
  }
  private encrypt(bytes: Uint8Array): Buffer {
    if (!this.blobKey) return Buffer.concat([Buffer.from([0]), Buffer.from(bytes)]);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.blobKey, iv);
    const enc = Buffer.concat([c.update(bytes), c.final()]);
    return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), enc]);
  }
  private decrypt(buf: Buffer): Uint8Array {
    if (buf[0] === 0) return new Uint8Array(buf.subarray(1));
    if (!this.blobKey) throw new Error("blob is encrypted but no key configured");
    const iv = buf.subarray(1, 13);
    const tag = buf.subarray(13, 29);
    const d = createDecipheriv("aes-256-gcm", this.blobKey, iv);
    d.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([d.update(buf.subarray(29)), d.final()]));
  }
  async putBlob(meta: BlobMeta, bytes: Uint8Array) {
    assertId(meta.id, "blob id");
    const dir = path.join(this.tdir(meta.tenantId), "blobs");
    await this.writeAtomic(path.join(dir, `${meta.id}.bin`), this.encrypt(bytes));
    await this.writeAtomic(path.join(dir, `${meta.id}.meta.json`), JSON.stringify(meta));
  }
  async getBlob(t: string, id: string) {
    assertId(id, "blob id");
    const dir = path.join(this.tdir(t), "blobs");
    try {
      const meta = JSON.parse(await fs.readFile(path.join(dir, `${id}.meta.json`), "utf8")) as BlobMeta;
      if (meta.tenantId !== t) return null;
      const bytes = this.decrypt(await fs.readFile(path.join(dir, `${id}.bin`)));
      return { meta, bytes };
    } catch {
      return null;
    }
  }
  async deleteBlob(t: string, id: string) {
    assertId(id, "blob id");
    const dir = path.join(this.tdir(t), "blobs");
    await fs.rm(path.join(dir, `${id}.bin`), { force: true });
    await fs.rm(path.join(dir, `${id}.meta.json`), { force: true });
  }
  async listBlobs(t: string, reportId: string) {
    const dir = path.join(this.tdir(t), "blobs");
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: BlobMeta[] = [];
    for (const n of names) {
      if (!n.endsWith(".meta.json")) continue;
      const meta = JSON.parse(await fs.readFile(path.join(dir, n), "utf8")) as BlobMeta;
      if (meta.reportId === reportId && meta.tenantId === t) out.push(meta);
    }
    return out;
  }
  private idemFile(t: string, key: string) {
    const h = createHash("sha256").update(key).digest("hex");
    return path.join(this.tdir(t), "idempotency", `${h}.json`);
  }
  async getIdempotency(t: string, key: string) {
    try {
      return JSON.parse(await fs.readFile(this.idemFile(t, key), "utf8")) as Submission;
    } catch {
      return undefined;
    }
  }
  async setIdempotency(t: string, key: string, s: Submission) {
    await this.writeAtomic(this.idemFile(t, key), JSON.stringify(s));
  }
  async allTenants() {
    try {
      return await fs.readdir(path.join(this.root, "tenants"));
    } catch {
      return [];
    }
  }
}
