import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { OpenAICompatibleProvider, NullProvider, validateChannelsConfig, DEFAULT_CHANNELS, type AIProvider, type ChannelsConfig } from "@errorrelay/core";
import { FileStorage, MemoryStorage, type Storage } from "./storage.js";
import { parseTokenEnv, type AuthConfig } from "./auth.js";
import { createLogger } from "./logger.js";
import { ReportService } from "./service.js";
import { createApp } from "./app.js";

export interface RuntimeConfig {
  port: number;
  dataDir: string | null;
  auth: AuthConfig;
  signingSecret: string;
  ai: AIProvider;
  channels: ChannelsConfig;
  retentionDays: number;
  statusFeedUrl: string | null;
  corsOrigins: string[];
  pwaDir: string | null;
}

export async function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): Promise<RuntimeConfig> {
  const aiEnabled = env.ERRORRELAY_AI_ENABLED === "1" || env.ERRORRELAY_AI_ENABLED === "true";
  const ai: AIProvider = aiEnabled
    ? new OpenAICompatibleProvider({ enabled: true, baseUrl: env.ERRORRELAY_AI_BASE_URL ?? "https://api.openai.com/v1", apiKey: env.ERRORRELAY_AI_API_KEY ?? "", model: env.ERRORRELAY_AI_MODEL ?? "gpt-5" })
    : new NullProvider();
  let channels = DEFAULT_CHANNELS;
  if (env.ERRORRELAY_CHANNELS_FILE) {
    const raw = JSON.parse(await fs.readFile(env.ERRORRELAY_CHANNELS_FILE, "utf8")) as ChannelsConfig;
    const v = validateChannelsConfig(raw);
    if (!v.ok) throw new Error(`channels config invalid: ${v.errors.join("; ")}`);
    channels = raw;
  }
  const auth = parseTokenEnv(env.ERRORRELAY_TOKENS);
  if (auth.tokens.size === 0) {
    if (env.NODE_ENV === "production") throw new Error("ERRORRELAY_TOKENS must be set in production");
    // Dev convenience: a single local token printed at startup.
    const dev = env.ERRORRELAY_DEV_TOKEN ?? "dev-token";
    Object.assign(auth, parseTokenEnv(`${dev}:local:local-user`));
  }
  const signingSecret = env.ERRORRELAY_SIGNING_SECRET ?? (env.NODE_ENV === "production" ? "" : randomBytes(32).toString("hex"));
  if (!signingSecret) throw new Error("ERRORRELAY_SIGNING_SECRET must be set in production");
  return {
    port: Number(env.PORT ?? 8787),
    dataDir: env.ERRORRELAY_NO_SAVE === "1" ? null : path.resolve(env.ERRORRELAY_DATA_DIR ?? ".errorrelay-data"),
    auth,
    signingSecret,
    ai,
    channels,
    retentionDays: Number(env.ERRORRELAY_RETENTION_DAYS ?? 30),
    statusFeedUrl: env.ERRORRELAY_STATUS_FEED_URL || null,
    corsOrigins: (env.ERRORRELAY_CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    pwaDir: env.ERRORRELAY_PWA_DIR ?? null,
  };
}

export function buildService(rc: RuntimeConfig, storage?: Storage): ReportService {
  const st = storage ?? (rc.dataDir ? new FileStorage(rc.dataDir, FileStorage.keyFromString(process.env.ERRORRELAY_BLOB_KEY)) : new MemoryStorage());
  return new ReportService({ storage: st, ai: rc.ai, channels: rc.channels, logger: createLogger(), retentionDays: rc.retentionDays, statusFeedUrl: rc.statusFeedUrl });
}

export function buildApp(rc: RuntimeConfig, service: ReportService) {
  return createApp({ service, auth: rc.auth, signingSecret: rc.signingSecret, corsOrigins: rc.corsOrigins });
}
