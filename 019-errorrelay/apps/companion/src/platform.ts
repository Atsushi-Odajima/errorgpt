import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const run = (cmd: string, args: string[], timeoutMs = 20000) =>
  new Promise<{ stdout: string; stderr: string; code: number }>((res) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      res({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code: err ? Number((err as NodeJS.ErrnoException & { code?: number | string }).code) || 1 : 0 });
    });
  });

/** Read an image from the OS clipboard. Only runs when the user explicitly asks. Returns PNG bytes or null. */
export async function readClipboardImage(): Promise<{ bytes: Uint8Array; method: string } | null> {
  const tmp = path.join(os.tmpdir(), `errorrelay-clip-${process.pid}-${Date.now()}.png`);
  try {
    if (process.platform === "darwin") {
      // pngpaste (Homebrew) if present, else AppleScript.
      const p = await run("pngpaste", [tmp]);
      if (p.code === 0) return { bytes: await fs.readFile(tmp), method: "pngpaste" };
      const script = `set f to POSIX file "${tmp}"\ntry\nset d to the clipboard as «class PNGf»\nset fh to open for access f with write permission\nwrite d to fh\nclose access fh\non error\nreturn "none"\nend try`;
      const r = await run("osascript", ["-e", script]);
      if (r.code === 0 && !r.stdout.includes("none")) return { bytes: await fs.readFile(tmp), method: "osascript" };
      return null;
    }
    if (process.platform === "win32") {
      const ps = `$img=Get-Clipboard -Format Image; if($img -eq $null){exit 3}; $img.Save('${tmp.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png)`;
      const r = await run("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ${ps}`]);
      if (r.code === 0) return { bytes: await fs.readFile(tmp), method: "powershell" };
      return null;
    }
    // Linux: Wayland then X11.
    for (const [cmd, args] of [["wl-paste", ["--type", "image/png"]], ["xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]]] as const) {
      const r = await new Promise<Buffer | null>((res) => {
        execFile(cmd, [...args], { encoding: "buffer", maxBuffer: 50 * 1024 * 1024, timeout: 10000 }, (err, stdout) => res(err ? null : (stdout as Buffer)));
      });
      if (r && r.length > 8) return { bytes: new Uint8Array(r), method: cmd };
    }
    return null;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a read-only diagnostic command. Only the allowlisted commands can be executed. */
export async function runDiagnostic(id: "codex_version" | "codex_doctor"): Promise<CmdResult> {
  const cmd = id === "codex_version" ? ["codex", ["--version"]] : ["codex", ["doctor", "--json"]];
  const r = await run(cmd[0] as string, cmd[1] as string[], 60000);
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
}

export function localEnvironment() {
  return { platform: process.platform, arch: process.arch, release: os.release(), nodeVersion: process.version, type: os.type() };
}
