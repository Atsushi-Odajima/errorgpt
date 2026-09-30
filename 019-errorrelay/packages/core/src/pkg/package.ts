import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { Report } from "../schema/report.js";
import { validateReport } from "../schema/validate.js";
import { generateDetailed, generateJson } from "../generate/report.js";
import { containsAnyOriginal, type Finding } from "../privacy/index.js";

export const PACKAGE_SCHEMA_VERSION = "1.0.0";

export interface PackageFileInput {
  /** Path relative to package root, e.g. attachments/redacted/shot_001.png */
  attachmentId: string;
  fileName: string;
  bytes: Uint8Array;
  redacted: boolean;
}

export interface Manifest {
  schemaVersion: string;
  packageSchemaVersion: string;
  reportId: string;
  createdAt: string;
  product: string;
  files: { path: string; sha256: string; bytes: number }[];
  attachments: { id: string; path: string; sha256: string; redacted: boolean }[];
}

export interface BuiltPackage {
  files: Record<string, Uint8Array>;
  manifest: Manifest;
}

export interface BuildOptions {
  /** Findings from the redaction pass; the builder refuses to emit any file that still contains an original secret. */
  guardFindings?: Finding[];
  now?: Date;
  environmentJson?: Record<string, unknown>;
}

export class SecretLeakError extends Error {
  constructor(public path: string, public categories: string[]) {
    super(`Refusing to export ${path}: contains unredacted ${categories.join(", ")}`);
    this.name = "SecretLeakError";
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const d = await subtle.digest("SHA-256", bytes as BufferSource);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return SAFE_NAME.test(cleaned) && cleaned.length ? cleaned.slice(0, 120) : "file";
}

/** Build the ErrorRelay package layout in memory. Only redacted attachments are included by default. */
export async function buildPackage(report: Report, attachments: PackageFileInput[], opts: BuildOptions = {}): Promise<BuiltPackage> {
  const now = (opts.now ?? new Date()).toISOString();
  const files: Record<string, Uint8Array> = {};
  const guard = opts.guardFindings ?? [];
  const addText = (path: string, text: string) => {
    const leaks = containsAnyOriginal(text, guard);
    if (leaks.length) throw new SecretLeakError(path, [...new Set(leaks.map((l) => l.category))]);
    files[path] = strToU8(text);
  };
  addText("report.json", generateJson(report));
  addText("report_ja.txt", generateDetailed(report, "ja"));
  addText("report_en.txt", generateDetailed(report, "en"));
  addText("environment.json", JSON.stringify(opts.environmentJson ?? report.environment, null, 2));
  const manifestAttachments: Manifest["attachments"] = [];
  const seen = new Set<string>();
  for (const a of attachments) {
    let name = sanitizeFileName(a.fileName);
    while (seen.has(name)) name = `dup_${name}`;
    seen.add(name);
    const path = `${a.redacted ? "redacted" : "attachments"}/${name}`;
    files[path] = a.bytes;
    manifestAttachments.push({ id: a.attachmentId, path, sha256: await sha256Hex(a.bytes), redacted: a.redacted });
  }
  const manifest: Manifest = {
    schemaVersion: report.schemaVersion,
    packageSchemaVersion: PACKAGE_SCHEMA_VERSION,
    reportId: report.id,
    createdAt: now,
    product: report.product,
    files: [],
    attachments: manifestAttachments,
  };
  for (const [path, bytes] of Object.entries(files)) manifest.files.push({ path, sha256: await sha256Hex(bytes), bytes: bytes.length });
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return { files, manifest };
}

export function zipPackage(pkg: BuiltPackage): Uint8Array {
  return zipSync(pkg.files, { level: 6 });
}

export class UnsafeZipEntryError extends Error {
  constructor(public entry: string) {
    super(`Unsafe zip entry rejected: ${entry}`);
    this.name = "UnsafeZipEntryError";
  }
}

/** Reject absolute paths, drive letters, "..", backslashes and control characters (Zip Slip). */
export function isSafeZipPath(p: string): boolean {
  if (!p || p.length > 512) return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  if (p.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(p)) return false;
  const parts = p.split("/");
  if (parts.some((s) => s === ".." || s === "" || s === ".")) return false;
  return true;
}

export interface ImportedPackage {
  report: Report;
  manifest: Manifest;
  files: Record<string, Uint8Array>;
  warnings: string[];
}

export function importPackage(zipBytes: Uint8Array, opts: { maxEntries?: number; maxBytes?: number } = {}): ImportedPackage {
  const maxEntries = opts.maxEntries ?? 200;
  const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  let count = 0;
  unzipSync(zipBytes, {
    filter: (f) => {
      if (!isSafeZipPath(f.name)) throw new UnsafeZipEntryError(f.name);
      count++;
      if (count > maxEntries) throw new Error("Too many entries in package");
      total += f.originalSize;
      if (total > maxBytes) throw new Error("Package too large");
      return true;
    },
  });
  // Second pass to actually extract (filter above already validated names).
  const extracted = unzipSync(zipBytes);
  for (const [name, bytes] of Object.entries(extracted)) {
    if (!isSafeZipPath(name)) throw new UnsafeZipEntryError(name);
    files[name] = bytes;
  }
  const warnings: string[] = [];
  const manifestRaw = files["manifest.json"];
  const reportRaw = files["report.json"];
  if (!manifestRaw || !reportRaw) throw new Error("Package is missing manifest.json or report.json");
  const manifest = JSON.parse(strFromU8(manifestRaw)) as Manifest;
  const reportObj = JSON.parse(strFromU8(reportRaw)) as Record<string, unknown>;
  if (!("tenantId" in reportObj)) reportObj.tenantId = "imported";
  if (Array.isArray(reportObj.attachments)) {
    for (const a of reportObj.attachments as Record<string, unknown>[]) if (!("storageRef" in a)) a.storageRef = null;
  }
  const v = validateReport(reportObj);
  if (!v.ok || !v.report) throw new Error(`Invalid report.json: ${v.errors.join("; ")}`);
  if (manifest.reportId !== v.report.id) warnings.push("manifest reportId does not match report.json");
  return { report: v.report, manifest, files, warnings };
}
