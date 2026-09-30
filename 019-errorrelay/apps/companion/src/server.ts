/**
 * Local companion HTTP server. Binds to 127.0.0.1 only, requires a bearer token, and only responds
 * to the configured PWA origin. Every endpoint is triggered by an explicit user action in the PWA.
 * No background capture, no screen recording, no key logging.
 */
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { captureNodeEnvironment, redactDoctorOutput, parseCodexVersion, scanText, redactText, detectImageType } from "@errorrelay/core";
import { readClipboardImage, runDiagnostic, localEnvironment } from "./platform.js";

export interface CompanionOptions {
  port: number;
  origin: string;
  token?: string;
}

const MAX_FILE = 10 * 1024 * 1024;
const EXEC_EXT = /\.(exe|dll|msi|bat|cmd|ps1|sh|scr|com|jar|apk|dmg|pkg|deb|rpm|js|vbs)$/i;

export function startCompanion(opts: CompanionOptions): Promise<{ server: http.Server; token: string; url: string }> {
  const token = opts.token ?? randomBytes(24).toString("base64url");
  const tokenBuf = Buffer.from(token);
  const server = http.createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": opts.origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET,POST,OPTIONS", vary: "Origin", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "OPTIONS") return send(204, {});
    if (req.headers.origin && req.headers.origin !== opts.origin) return send(403, { error: "origin not allowed" });
    const auth = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? "");
    const given = Buffer.from(auth?.[1] ?? "");
    if (req.url !== "/health" && (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf))) return send(401, { error: "unauthorized" });
    const readBody = async () => {
      const chunks: Buffer[] = [];
      let n = 0;
      for await (const c of req) {
        n += (c as Buffer).length;
        if (n > 1024 * 1024) throw new Error("body too large");
        chunks.push(c as Buffer);
      }
      return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
    };
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/health") return send(200, { ok: true, version: "0.1.0", platform: process.platform });
      if (url.pathname === "/env" && req.method === "GET") {
        const e = localEnvironment();
        return send(200, { environment: captureNodeEnvironment({ platform: e.platform, arch: e.arch, release: e.release, nodeVersion: e.nodeVersion }), note: "OS-level values only; app versions must be supplied by the app itself or the user." });
      }
      if (url.pathname === "/clipboard-image" && req.method === "POST") {
        const img = await readClipboardImage();
        if (!img) return send(404, { error: "no image in clipboard" });
        const type = detectImageType(img.bytes);
        return send(200, { mimeType: type === "unknown" ? "image/png" : `image/${type}`, base64: Buffer.from(img.bytes).toString("base64"), method: img.method });
      }
      if (url.pathname === "/codex/version" && req.method === "POST") {
        const r = await runDiagnostic("codex_version");
        return send(200, { ok: r.ok, version: parseCodexVersion(r.stdout), raw: redactText(r.stdout.slice(0, 500)).redacted, error: r.ok ? null : redactText(r.stderr.slice(0, 500)).redacted });
      }
      if (url.pathname === "/codex/doctor" && req.method === "POST") {
        const r = await runDiagnostic("codex_doctor");
        if (!r.ok && !r.stdout.trim()) return send(200, { ok: false, error: redactText(r.stderr.slice(0, 1000)).redacted, note: "codex doctor is unavailable in this version or codex is not installed. Report this in the notes and use codex --version instead." });
        const red = redactDoctorOutput(r.stdout);
        // Only the redacted output is ever returned to the PWA.
        return send(200, { ok: true, redactedJson: red.redactedJson, findingsCount: red.findings.length, droppedKeys: red.droppedKeys, preview: true });
      }
      if (url.pathname === "/file" && req.method === "POST") {
        const body = await readBody();
        const p = String(body.path ?? "");
        if (!p || !path.isAbsolute(p)) return send(400, { error: "absolute path required" });
        const resolved = path.resolve(p);
        if (!resolved.startsWith(os.homedir()) && !resolved.startsWith(os.tmpdir())) return send(403, { error: "only files under the home directory can be imported" });
        if (EXEC_EXT.test(resolved)) return send(400, { error: "executable files are not accepted" });
        const st = await fs.stat(resolved);
        if (!st.isFile() || st.size > MAX_FILE) return send(400, { error: "not a regular file or too large" });
        const bytes = await fs.readFile(resolved);
        const isImage = detectImageType(bytes) !== "unknown";
        if (isImage) return send(200, { fileName: path.basename(resolved), mimeType: `image/${detectImageType(bytes) === "jpeg" ? "jpeg" : detectImageType(bytes)}`, base64: bytes.toString("base64"), findingsCount: 0 });
        const text = bytes.toString("utf8");
        const f = scanText(text);
        const red = redactText(text, f);
        return send(200, { fileName: path.basename(resolved), mimeType: "text/plain", text: red.redacted, findingsCount: f.length, categories: [...new Set(f.map((x) => x.category))], note: "Text files are returned already redacted; the original is not modified." });
      }
      send(404, { error: "not found" });
    } catch (e) {
      send(500, { error: (e as Error).message });
    }
  });
  return new Promise((resolve) => {
    server.listen(opts.port, "127.0.0.1", () => resolve({ server, token, url: `http://127.0.0.1:${opts.port}` }));
  });
}
