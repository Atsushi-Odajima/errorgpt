#!/usr/bin/env node
/**
 * stdio MCP launcher for local clients (Codex CLI, desktop MCP hosts).
 * Uses the same service as the HTTP server; data lives in ERRORRELAY_DATA_DIR (or memory with ERRORRELAY_NO_SAVE=1).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadRuntimeConfig, buildService, createMcpServer } from "@errorrelay/server";

const rc = await loadRuntimeConfig();
const svc = buildService(rc);
const principal = { tenantId: process.env.ERRORRELAY_TENANT ?? "local", identity: process.env.ERRORRELAY_IDENTITY ?? "local-user", scopes: ["read", "write", "submit"] as ("read" | "write" | "submit")[] };
const server = createMcpServer(svc, principal);
await server.connect(new StdioServerTransport());
