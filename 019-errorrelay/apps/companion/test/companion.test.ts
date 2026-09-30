import { describe, it, expect, afterAll } from "vitest";
import { startCompanion } from "../src/server.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const started = await startCompanion({ port: 0, origin: "http://127.0.0.1:4173" });
const port = (started.server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
afterAll(() => started.server.close());

describe("desktop companion", () => {
  it("requires token and origin", async () => {
    expect((await fetch(`${base}/env`)).status).toBe(401);
    expect((await fetch(`${base}/env`, { headers: { authorization: `Bearer ${started.token}`, origin: "https://evil.example" } })).status).toBe(403);
    const ok = await fetch(`${base}/env`, { headers: { authorization: `Bearer ${started.token}` } });
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.environment.os.source).toBe("auto");
    expect(JSON.stringify(j)).not.toContain(os.userInfo().username);
  });
  it("imports a log file only from home/tmp, redacted", async () => {
    const f = path.join(os.tmpdir(), `er-log-${Date.now()}.log`);
    await fs.writeFile(f, "error at /Users/taro/app.log key sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234 mail taro@example.com");
    const r = await fetch(`${base}/file`, { method: "POST", headers: { authorization: `Bearer ${started.token}`, "content-type": "application/json" }, body: JSON.stringify({ path: f }) });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.text).not.toContain("sk-ABC");
    expect(j.text).not.toContain("taro@example.com");
    expect(j.findingsCount).toBeGreaterThanOrEqual(3);
    const bad = await fetch(`${base}/file`, { method: "POST", headers: { authorization: `Bearer ${started.token}`, "content-type": "application/json" }, body: JSON.stringify({ path: "/etc/passwd" }) });
    expect(bad.status).toBe(403);
    await fs.rm(f);
  });
  it("codex diagnostics degrade gracefully when codex is not installed", async () => {
    const r = await fetch(`${base}/codex/doctor`, { method: "POST", headers: { authorization: `Bearer ${started.token}` } });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(typeof j.ok).toBe("boolean");
    if (!j.ok) expect(j.note).toMatch(/unavailable|not installed/);
  });
});
