import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, ReportService, MemoryStorage, createLogger, MCP_TOOL_NAMES } from "@errorrelay/server";
import { NullProvider } from "@errorrelay/core";

async function connect() {
  const service = new ReportService({ storage: new MemoryStorage(), logger: createLogger(() => undefined), ai: new NullProvider() });
  const server = createMcpServer(service, { tenantId: "t1", identity: "mcp-user", scopes: ["read", "write", "submit"] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const txt = (res.content as { type: string; text: string }[])[0]!.text;
    try {
      return JSON.parse(txt);
    } catch {
      return txt;
    }
  };
  return { client, call, service };
}

describe("MCP plugin tools", () => {
  it("exposes all tools with explicit annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...MCP_TOOL_NAMES].sort());
    for (const t of tools) {
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe("boolean");
      expect(typeof t.annotations?.destructiveHint, t.name).toBe("boolean");
      expect(typeof t.annotations?.openWorldHint, t.name).toBe("boolean");
    }
    const submit = tools.find((t) => t.name === "submit_report")!;
    expect(submit.description).toMatch(/DIRECT/);
    expect(submit.annotations?.readOnlyHint).toBe(false);
  });

  it("conversation flow: create → env → repro → redact → channel → prepare → submit records handoff, not submitted (13, 14, 15)", async () => {
    const { call } = await connect();
    const created = await call("create_error_report", { language: "ja", error_text: "ChatGPT iOSでTXTのダウンロードに失敗。key sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", occurred_at: "2026-09-30 10:20", timezone: "Asia/Tokyo" });
    const id = created.report.id;
    expect(created.report.product).toBe("chatgpt_ios");
    expect(created.report.occurredAt).toContain("2026-09-30 10:20");
    await call("add_environment_info", { report_id: id, environment: { appVersion: "1.2025.300" } });
    const repro = await call("add_reproduction_step", { report_id: id, description: "txt作ってもらってリンク押したらdownloadできなかった", steps: ["ChatGPT iOSで会話を開く。", "TXT生成を依頼。", "TXT添付をタップ。"], expected: "TXTが開く", actual: "ダウンロードエラー" });
    expect(repro.proposal.needsConfirmation).toBe(true);
    const red = await call("redact_report", { report_id: id });
    expect(red.counts.api_key).toBeGreaterThanOrEqual(1);
    const pv = await call("preview_report", { report_id: id, format: "short", language: "ja" });
    expect(pv.text).not.toContain("sk-ABC");
    expect(pv.quality.missing).toEqual(expect.not.arrayContaining(["steps"]));
    await call("add_environment_info", { report_id: id, environment: {} , product: "chatgpt_ios" });
    const ch = await call("find_official_report_channel", { report_id: id });
    expect(ch.channels.map((c: { capability: string }) => c.capability)).not.toContain("DIRECT");
    // summary missing? create set summary from error text → fine. Prepare:
    const prep = await call("prepare_submission_package", { report_id: id, adapter_id: "openai_support", language: "ja" });
    expect(prep.capability).toBe("INTERACTIVE_HANDOFF");
    expect(prep.confirmation_token).toMatch(/^confirm_/);
    expect(prep.identity).toBe("mcp-user");
    const sub = await call("submit_report", { report_id: id, confirmation_token: prep.confirmation_token, user_confirmed: true });
    expect(sub.status).toBe("handoff_prepared");
    expect(sub.submission.capability).toBe("INTERACTIVE_HANDOFF");
    expect(sub.message.ja).toContain("ご自身で送信");
    const got = await call("get_report", { report_id: id });
    expect(got.status).toBe("handoff_prepared");
    const list = await call("list_my_reports", {});
    expect(list.length).toBe(1);
    const exp = await call("export_report", { report_id: id, format: "detailed", language: "en" });
    expect(exp).toContain("# ");
  });

  it("AI off: analyze returns manual fallback and never errors", async () => {
    const { call, service } = await connect();
    const created = await call("create_error_report", { language: "en", summary: "x" });
    const r = await service.addAttachment("t1", created.report.id, { fileName: "a.png", mimeType: "image/png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]) });
    const an = await call("analyze_error_screenshot", { report_id: created.report.id, attachment_id: r.attachment.id, user_consented_to_ai: true });
    expect(an.manualFallback).toBe(true);
  });
});
