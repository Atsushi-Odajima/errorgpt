import { describe, it, expect } from "vitest";
import { scanText, redactText, containsAnyOriginal, redactJsonValue, stripImageMetadata, detectImageType, redactDoctorOutput, redactApiBody, createReport, buildPackage, zipPackage, importPackage, SecretLeakError, isSafeZipPath, UnsafeZipEntryError, parseManualTimestamp } from "../src/index.js";
import { zipSync, strToU8, strFromU8 } from "fflate";

const SECRET_TEXT = `Contact me at taro.yamada@example.com or 090-1234-5678.
API key: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd
Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789
token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U
ghp_abcdefghijklmnopqrstuvwxyz0123456789
path /Users/taroyamada/Projects/app/main.py
card 4111 1111 1111 1111
OTP: 123456
password: hunter2!!`;

describe("privacy scanner & redaction (tests 4, 5, 24, 25)", () => {
  it("detects the major categories", () => {
    const f = scanText(SECRET_TEXT);
    const cats = new Set(f.map((x) => x.category));
    for (const c of ["email", "phone", "api_key", "jwt", "access_token", "file_path_username", "credit_card", "otp", "password"]) expect(cats, c).toContain(c);
  });
  it("redacted output contains none of the original secrets and no partial masks", () => {
    const f = scanText(SECRET_TEXT);
    const r = redactText(SECRET_TEXT, f);
    expect(containsAnyOriginal(r.redacted, f)).toEqual([]);
    expect(r.redacted).toContain("[REDACTED_API_KEY_1]");
    expect(r.redacted).not.toContain("sk-proj");
    expect(r.redacted).not.toContain("example.com");
    expect(r.redacted).not.toContain("4111");
    expect(JSON.stringify(r.summary)).not.toContain("hunter2");
  });
  it("user can keep a category", () => {
    const f = scanText("mail me: a@b.co");
    const r = redactText("mail me: a@b.co", f, { email: "keep" });
    expect(r.redacted).toContain("a@b.co");
    expect(r.summary.keptCategories).toEqual(["email"]);
  });
  it("redacts headers by key in JSON", () => {
    const { value } = redactJsonValue({ headers: { Authorization: "Bearer abc", "x-request-id": "req_1234567890" }, body: "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ" });
    expect(value.headers.Authorization).toBe("[REDACTED]");
    expect(value.headers["x-request-id"]).toBe("req_1234567890");
    expect(value.body).toMatch(/REDACTED_API_KEY/);
  });
  it("redacts codex doctor output (test 24)", () => {
    const doctor = JSON.stringify({ version: "0.154.0", home: "/Users/taro", cwd: "/Users/taro/proj", auth: { token: "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ" }, logs: ["error at /home/taro/x.log", "email taro@example.com"] });
    const r = redactDoctorOutput(doctor);
    expect(r.redactedJson).not.toContain("taro");
    expect(r.redactedJson).not.toContain("sk-ABC");
    expect(r.redactedJson).toContain("0.154.0");
    expect(r.droppedKeys).toContain("home");
  });
  it("redacts API key patterns in API bodies (test 25)", () => {
    const { redacted, findingsCount } = redactApiBody('{"api_key":"sk-svcacct-abcdefghijklmnopqrstuvwxyz1234","x":"AKIAABCDEFGHIJKLMNOP"}');
    expect(redacted).not.toContain("sk-svcacct");
    expect(redacted).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(findingsCount).toBeGreaterThanOrEqual(2);
  });
});

function minimalJpegWithExif(): Uint8Array {
  const soi = [0xff, 0xd8];
  const exifPayload = [...new TextEncoder().encode("Exif\0\0IIxx2026:09:30 10:20:00")];
  const app1 = [0xff, 0xe1, (exifPayload.length + 2) >> 8, (exifPayload.length + 2) & 0xff, ...exifPayload];
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
  const sos = [0xff, 0xda, 0x00, 0x02, 0x01, 0x02, 0x03, 0xff, 0xd9];
  return Uint8Array.from([...soi, ...app0, ...app1, ...sos]);
}
function minimalPngWithText(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  return Uint8Array.from([...sig, ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]), ...chunk("tEXt", [...new TextEncoder().encode("Author\0Taro")]), ...chunk("IDAT", [1, 2, 3]), ...chunk("IEND", [])]);
}

describe("EXIF / metadata stripping (test 6)", () => {
  it("removes APP1 from JPEG and keeps image data", () => {
    const j = minimalJpegWithExif();
    expect(detectImageType(j)).toBe("jpeg");
    const r = stripImageMetadata(j);
    expect(r.removed).toContain("APP1");
    const s = new TextDecoder("latin1").decode(r.bytes);
    expect(s).not.toContain("2026:09:30");
    expect(r.bytes[r.bytes.length - 1]).toBe(0xd9);
  });
  it("removes tEXt from PNG", () => {
    const p = minimalPngWithText();
    const r = stripImageMetadata(p);
    expect(r.removed).toEqual(["tEXt"]);
    expect(new TextDecoder("latin1").decode(r.bytes)).not.toContain("Taro");
    expect(new TextDecoder("latin1").decode(r.bytes)).toContain("IDAT");
  });
  it("unsupported formats are reported as unsupported, not silently passed as stripped", () => {
    const r = stripImageMetadata(Uint8Array.from([1, 2, 3]));
    expect(r.supported).toBe(false);
  });
});

describe("package export/import (tests 5, 18, 30)", () => {
  it("refuses to export when a secret would leak, and roundtrips otherwise", async () => {
    const r = createReport({ tenantId: "t1", summary: "leak test", errorText: SECRET_TEXT });
    const f = scanText(SECRET_TEXT);
    await expect(buildPackage(r, [], { guardFindings: f })).rejects.toBeInstanceOf(SecretLeakError);
    r.errorText = redactText(SECRET_TEXT, f).redacted;
    r.occurredAt = parseManualTimestamp("2026-09-30 10:20", "Asia/Tokyo");
    const pkg = await buildPackage(r, [{ attachmentId: "a1", fileName: "../../etc/passwd shot.png", bytes: Uint8Array.from([1, 2, 3]), redacted: true }], { guardFindings: f });
    expect(Object.keys(pkg.files)).toContain("redacted/passwd_shot.png");
    const all = Object.entries(pkg.files).map(([k, v]) => k + strFromU8(v)).join("");
    expect(containsAnyOriginal(all, f)).toEqual([]);
    expect(JSON.stringify(pkg.manifest)).not.toContain("sk-proj");
    expect(pkg.manifest.attachments[0]!.sha256).toHaveLength(64);
    const zip = zipPackage(pkg);
    const imported = importPackage(zip);
    expect(imported.report.id).toBe(r.id);
    expect(imported.report.summary).toBe("leak test");
    expect(imported.report.errorText).toBe(r.errorText);
    expect(imported.report.occurredAt?.iso).toBe(r.occurredAt?.iso);
    expect(strFromU8(imported.files["report_ja.txt"]!)).toContain("leak test");
  });
  it("rejects zip slip entries", () => {
    expect(isSafeZipPath("../x")).toBe(false);
    expect(isSafeZipPath("/etc/passwd")).toBe(false);
    expect(isSafeZipPath("C:\\x")).toBe(false);
    expect(isSafeZipPath("a/../b")).toBe(false);
    expect(isSafeZipPath("redacted/a.png")).toBe(true);
    const evil = zipSync({ "../../evil.txt": strToU8("x"), "manifest.json": strToU8("{}"), "report.json": strToU8("{}") });
    expect(() => importPackage(evil)).toThrow(UnsafeZipEntryError);
  });
});
