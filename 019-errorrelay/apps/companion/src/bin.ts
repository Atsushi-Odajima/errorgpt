#!/usr/bin/env node
import { startCompanion } from "./server.js";
import { readClipboardImage, runDiagnostic, localEnvironment } from "./platform.js";
import { redactDoctorOutput, parseCodexVersion } from "@errorrelay/core";
import { promises as fs } from "node:fs";

const [cmd = "help", ...rest] = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1]! : def;
};

switch (cmd) {
  case "serve": {
    const { token, url } = await startCompanion({ port: Number(arg("port", "8790")), origin: arg("origin", "http://127.0.0.1:4173"), token: process.env.ERRORRELAY_COMPANION_TOKEN });
    console.log(`ErrorRelay Companion listening at ${url}`);
    console.log(`Paste this token into the PWA settings (Companion token): ${token}`);
    console.log("Allowed origin:", arg("origin", "http://127.0.0.1:4173"));
    console.log("Endpoints run only when you click a button in the PWA. Ctrl+C to stop.");
    break;
  }
  case "env":
    console.log(JSON.stringify(localEnvironment(), null, 2));
    break;
  case "codex-version": {
    const r = await runDiagnostic("codex_version");
    console.log(r.ok ? parseCodexVersion(r.stdout) ?? r.stdout.trim() : `codex not available: ${r.stderr.trim()}`);
    break;
  }
  case "codex-doctor": {
    const r = await runDiagnostic("codex_doctor");
    if (!r.ok && !r.stdout.trim()) {
      console.error("codex doctor unavailable:", r.stderr.trim());
      process.exit(1);
    }
    const red = redactDoctorOutput(r.stdout);
    const out = arg("out", "");
    if (out) {
      await fs.writeFile(out, red.redactedJson);
      console.log(`Redacted doctor report written to ${out} (${red.findings.length} redactions, dropped keys: ${red.droppedKeys.join(",") || "-"})`);
    } else console.log(red.redactedJson);
    break;
  }
  case "clipboard": {
    const img = await readClipboardImage();
    if (!img) {
      console.error("No image in clipboard");
      process.exit(1);
    }
    const out = arg("out", "clipboard.png");
    await fs.writeFile(out, img.bytes);
    console.log(`Saved ${out} (${img.bytes.length} bytes via ${img.method})`);
    break;
  }
  default:
    console.log(`ErrorRelay Desktop Companion
  errorrelay-companion serve [--port 8790] [--origin http://127.0.0.1:4173]   start local helper for the PWA
  errorrelay-companion env                                                     print OS environment
  errorrelay-companion codex-version                                           print Codex CLI version
  errorrelay-companion codex-doctor [--out file.json]                          run 'codex doctor --json' and redact
  errorrelay-companion clipboard [--out clipboard.png]                         save clipboard image to a file`);
}
