import { detectImageType } from "@errorrelay/core";

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_REPORT = 20;

const ALLOWED: Record<string, { ext: string[]; kind: "screenshot" | "image" | "log" | "har" | "doctor" | "text" }> = {
  "image/png": { ext: ["png"], kind: "screenshot" },
  "image/jpeg": { ext: ["jpg", "jpeg"], kind: "screenshot" },
  "image/webp": { ext: ["webp"], kind: "screenshot" },
  "image/gif": { ext: ["gif"], kind: "image" },
  "text/plain": { ext: ["txt", "log"], kind: "log" },
  "application/json": { ext: ["json", "har"], kind: "text" },
  "text/markdown": { ext: ["md"], kind: "text" },
};

const EXEC_MAGIC: number[][] = [
  [0x4d, 0x5a], // MZ (PE)
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64
  [0xce, 0xfa, 0xed, 0xfe], // Mach-O 32
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O fat / Java class
  [0x50, 0x4b, 0x03, 0x04], // ZIP (jar/apk/docx) — rejected for uploads; packages are imported through a dedicated endpoint
];
const EXEC_EXT = /\.(exe|dll|msi|bat|cmd|ps1|sh|scr|com|pif|jar|apk|app|dmg|pkg|deb|rpm|js|vbs|wsf|hta|elf|bin)$/i;

export interface MimeCheck {
  ok: boolean;
  reason?: string;
  kind?: "screenshot" | "image" | "log" | "har" | "doctor" | "text";
  mimeType?: string;
}

export function validateUpload(fileName: string, declaredMime: string, bytes: Uint8Array): MimeCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty file" };
  if (bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "file too large" };
  if (EXEC_EXT.test(fileName)) return { ok: false, reason: "executable or script files are not accepted" };
  for (const magic of EXEC_MAGIC) if (magic.every((b, i) => bytes[i] === b)) return { ok: false, reason: "binary executable/archive content is not accepted" };
  const mime = declaredMime.split(";")[0]!.trim().toLowerCase();
  const rule = ALLOWED[mime];
  if (!rule) return { ok: false, reason: `unsupported type ${mime}` };
  if (mime.startsWith("image/")) {
    const detected = detectImageType(bytes);
    const expected = mime === "image/jpeg" ? "jpeg" : mime.slice(6);
    if (detected !== expected) return { ok: false, reason: "image content does not match declared type" };
  }
  let kind = rule.kind;
  if (/\.har$/i.test(fileName)) kind = "har";
  if (/doctor/i.test(fileName) && mime === "application/json") kind = "doctor";
  return { ok: true, kind, mimeType: mime };
}
