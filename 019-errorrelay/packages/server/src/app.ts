import { Hono } from "hono";
import type { Context, Next } from "hono";
import { z } from "zod";
import { ProductIdSchema, FrequencySchema, RootCauseLevelSchema, detectImageType } from "@errorrelay/core";
import { ReportService, NotFoundError, ValidationError } from "./service.js";
import { authenticate, type AuthConfig, type Principal } from "./auth.js";
import { RateLimiter } from "./rateLimit.js";
import { signBlobUrl, verifyBlobSignature } from "./signedUrl.js";
import { MAX_ATTACHMENT_BYTES } from "./mime.js";

export interface AppConfig {
  service: ReportService;
  auth: AuthConfig;
  signingSecret: string;
  signedUrlTtlSeconds?: number;
  rateLimitPerMinute?: number;
  /** Extra allowed origins for CORS (PWA dev server). Same-origin needs nothing. */
  corsOrigins?: string[];
}

type Env = { Variables: { principal: Principal } };

const UpdateSchema = z.object({
  summary: z.string().max(300).optional(),
  product: ProductIdSchema.optional(),
  productOther: z.string().max(100).nullable().optional(),
  description: z.string().max(20000).optional(),
  steps: z.array(z.string().max(1000)).max(50).optional(),
  expected: z.string().max(2000).optional(),
  actual: z.string().max(2000).optional(),
  errorText: z.string().max(50000).optional(),
  errorCode: z.string().max(100).nullable().optional(),
  httpStatus: z.number().int().nullable().optional(),
  requestId: z.string().max(200).nullable().optional(),
  conversationId: z.string().max(200).nullable().optional(),
  endpoint: z.string().max(200).nullable().optional(),
  frequency: FrequencySchema.optional(),
  retried: z.boolean().nullable().optional(),
  troubleshootingTried: z.array(z.string().max(300)).max(30).optional(),
  additionalNotes: z.string().max(5000).optional(),
  rootCause: z.object({ level: RootCauseLevelSchema, note: z.string().max(1000) }).optional(),
  occurredAt: z.union([z.literal("now"), z.null(), z.object({ text: z.string(), timezone: z.string() })]).optional(),
  capturedAt: z.union([z.null(), z.object({ text: z.string(), timezone: z.string() })]).optional(),
  environment: z.record(z.string().max(500).nullable()).optional(),
  language: z.enum(["ja", "en"]).optional(),
  timezone: z.string().max(64).optional(),
});

export function createApp(cfg: AppConfig) {
  const app = new Hono<Env>();
  const limiter = new RateLimiter(cfg.rateLimitPerMinute ?? 120, 60_000);
  const ttl = cfg.signedUrlTtlSeconds ?? 300;
  const svc = cfg.service;

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    if (c.req.path.startsWith("/api/")) c.header("Content-Security-Policy", "default-src 'none'");
    const origin = c.req.header("origin");
    if (origin && cfg.corsOrigins?.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Headers", "authorization, content-type, x-errorrelay-client, idempotency-key");
      c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      c.header("Vary", "Origin");
    }
  });
  app.options("/api/*", (c) => c.body(null, 204));

  app.get("/api/health", (c) => c.json({ ok: true, ai: svc.ai.enabled, channelsConfig: svc.registry.config.configVersion }));

  // Signed blob download: no bearer needed but signature + tenant + expiry required; deleted reports are refused.
  app.get("/api/blobs/:id", async (c) => {
    const id = c.req.param("id");
    const exp = Number(c.req.query("exp"));
    const sig = c.req.query("sig") ?? "";
    const t = c.req.query("t") ?? "";
    if (!verifyBlobSignature(cfg.signingSecret, t, id, exp, sig)) return c.json({ error: "invalid or expired signature" }, 403);
    const b = await svc.storage.getBlob(t, id);
    if (!b) return c.json({ error: "not found" }, 404);
    const report = await svc.storage.getReport(t, b.meta.reportId);
    if (!report || report.deletedAt) return c.json({ error: "not found" }, 404);
    return new Response(b.bytes as BodyInit, { headers: { "content-type": b.meta.mimeType, "content-disposition": "attachment", "x-content-type-options": "nosniff", "cache-control": "no-store" } });
  });

  const requireAuth = async (c: Context<Env>, next: Next) => {
    const p = authenticate(cfg.auth, c.req.header("authorization"));
    if (!p) return c.json({ error: "unauthorized" }, 401);
    if (!limiter.allow(p.tenantId)) return c.json({ error: "rate limited" }, 429);
    // CSRF: state-changing calls must carry the custom header (cookies are never used, but belt and braces).
    if (c.req.method !== "GET" && c.req.header("x-errorrelay-client") !== "1") return c.json({ error: "missing X-ErrorRelay-Client header" }, 403);
    c.set("principal", p);
    await next();
  };
  app.use("/api/reports/*", requireAuth);
  app.use("/api/reports", requireAuth);
  app.use("/api/tools/*", requireAuth);

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ValidationError || err instanceof z.ZodError) return c.json({ error: err.message }, 400);
    if (err.name === "InvalidTransitionError" || err.name === "ConfirmationRequiredError") return c.json({ error: err.message }, 409);
    console.error(JSON.stringify({ level: "error", msg: err.message, name: err.name }));
    return c.json({ error: "internal error" }, 500);
  });

  const parse = async <T>(c: Context<Env>, schema: z.ZodType<T>): Promise<T> => schema.parse(await c.req.json().catch(() => ({})));
  const tenant = (c: Context<Env>) => c.get("principal").tenantId;

  app.get("/api/reports", async (c) => c.json({ reports: (await svc.list(tenant(c))).map(summary) }));
  app.post("/api/reports", async (c) => {
    const body = await parse(c, z.object({ language: z.enum(["ja", "en"]).optional(), product: ProductIdSchema.optional(), summary: z.string().max(300).optional(), description: z.string().max(20000).optional(), errorText: z.string().max(50000).optional() }));
    return c.json({ report: await svc.create(tenant(c), body) }, 201);
  });
  app.get("/api/reports/:id", async (c) => c.json({ report: await svc.get(tenant(c), c.req.param("id")) }));
  app.patch("/api/reports/:id", async (c) => c.json({ report: await svc.update(tenant(c), c.req.param("id"), await parse(c, UpdateSchema)) }));
  app.delete("/api/reports/:id", async (c) => {
    await svc.delete(tenant(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/api/reports/:id/attachments", async (c) => {
    const len = Number(c.req.header("content-length") ?? "0");
    if (len > MAX_ATTACHMENT_BYTES + 4096) return c.json({ error: "file too large" }, 413);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "file field required" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const redactedFrom = (form.get("redactedFrom") as string | null) || null;
    const res = await svc.addAttachment(tenant(c), c.req.param("id"), { fileName: file.name, mimeType: file.type || (detectImageType(bytes) === "png" ? "image/png" : "application/octet-stream"), bytes, redactedFrom });
    return c.json({ attachment: res.attachment, stripped: res.stripped, report: res.report }, 201);
  });
  app.get("/api/reports/:id/attachments/:att/url", async (c) => {
    const { attachment } = await svc.getAttachmentBytes(tenant(c), c.req.param("id"), c.req.param("att"));
    return c.json({ url: signBlobUrl(cfg.signingSecret, tenant(c), attachment.storageRef!, ttl), expiresInSeconds: ttl });
  });
  app.patch("/api/reports/:id/attachments/:att", async (c) => {
    const body = await parse(c, z.object({ included: z.boolean() }));
    return c.json({ report: await svc.setAttachmentIncluded(tenant(c), c.req.param("id"), c.req.param("att"), body.included) });
  });
  app.delete("/api/reports/:id/attachments/:att", async (c) => c.json({ report: await svc.deleteAttachment(tenant(c), c.req.param("id"), c.req.param("att")) }));

  app.post("/api/reports/:id/analyze", async (c) => {
    const body = await parse(c, z.object({ attachmentId: z.string(), consent: z.literal(true) }));
    const res = await svc.analyzeScreenshot(tenant(c), c.req.param("id"), body.attachmentId);
    return c.json({ report: res.report, manualFallback: res.manualFallback, errorTextCandidate: res.errorTextCandidate, note: res.note });
  });
  app.post("/api/reports/:id/inferences/:field", async (c) => {
    const body = await parse(c, z.object({ confirmed: z.boolean() }));
    return c.json({ report: await svc.confirmInference(tenant(c), c.req.param("id"), c.req.param("field"), body.confirmed) });
  });
  app.post("/api/reports/:id/repro", async (c) => {
    const body = await parse(c, z.object({ description: z.string().max(20000).optional() }));
    return c.json(await svc.buildRepro(tenant(c), c.req.param("id"), body.description));
  });
  app.post("/api/reports/:id/redact", async (c) => {
    const body = await parse(c, z.object({ decisions: z.record(z.enum(["redact", "keep"])).optional() }));
    return c.json(await svc.redactReport(tenant(c), c.req.param("id"), (body.decisions ?? {}) as never));
  });
  app.get("/api/reports/:id/quality", async (c) => c.json(svc.quality(await svc.get(tenant(c), c.req.param("id")), c.req.query("previewed") === "1")));
  app.post("/api/reports/:id/ready", async (c) => c.json({ report: await svc.markReady(tenant(c), c.req.param("id")) }));
  app.get("/api/reports/:id/render", async (c) => {
    const format = z.enum(["short", "detailed", "developer", "json", "diagnostic"]).parse(c.req.query("format") ?? "short");
    const lang = z.enum(["ja", "en"]).parse(c.req.query("lang") ?? "ja");
    return c.text(svc.render(await svc.get(tenant(c), c.req.param("id")), format, lang));
  });
  app.get("/api/reports/:id/channels", async (c) => c.json({ channels: svc.channelsFor(await svc.get(tenant(c), c.req.param("id"))) }));
  app.post("/api/reports/:id/preview", async (c) => {
    const body = await parse(c, z.object({ adapterId: z.string(), lang: z.enum(["ja", "en"]).default("ja") }));
    return c.json(await svc.preparePreview(tenant(c), c.req.param("id"), body.adapterId, body.lang ?? "ja", c.get("principal").identity));
  });
  app.post("/api/reports/:id/submit", async (c) => {
    const body = await parse(c, z.object({ confirmationToken: z.string().min(1), idempotencyKey: z.string().min(8).max(200) }));
    const res = await svc.submit(tenant(c), c.req.param("id"), body.confirmationToken, body.idempotencyKey);
    return c.json({ report: res.report, submission: res.submission, message: res.message });
  });
  app.post("/api/reports/:id/mark-sent", async (c) => {
    const body = await parse(c, z.object({ submissionId: z.string(), ticketId: z.string().max(200).nullable().default(null) }));
    return c.json({ report: await svc.markUserSubmitted(tenant(c), c.req.param("id"), body.submissionId, body.ticketId ?? null) });
  });
  app.post("/api/reports/:id/close", async (c) => c.json({ report: await svc.close(tenant(c), c.req.param("id")) }));
  app.get("/api/reports/:id/export", async (c) => {
    const { zip, fileName } = await svc.exportPackage(tenant(c), c.req.param("id"));
    return new Response(zip as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${fileName}"` } });
  });
  app.post("/api/reports/import", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "file field required" }, 400);
    return c.json({ report: await svc.importPackage(tenant(c), new Uint8Array(await file.arrayBuffer())) }, 201);
  });
  app.post("/api/reports/:id/followups", async (c) => {
    const body = await parse(c, z.object({ question: z.string().max(5000), additions: z.record(z.string().max(2000)).default({}), ticketId: z.string().max(200).nullable().optional() }));
    return c.json(await svc.followup(tenant(c), c.req.param("id"), { question: body.question, additions: body.additions ?? {}, ticketId: body.ticketId ?? null }));
  });
  app.get("/api/reports/:id/known-issues", async (c) => c.json(await svc.knownIssues(await svc.get(tenant(c), c.req.param("id")))));

  app.post("/api/tools/scan", async (c) => c.json(svc.scan((await parse(c, z.object({ text: z.string().max(200000) }))).text)));
  app.post("/api/tools/codex-doctor-redact", async (c) => c.json(svc.codexDoctorRedact((await parse(c, z.object({ raw: z.string().max(2_000_000) }))).raw)));
  app.post("/api/tools/api-error", async (c) => {
    const body = await parse(c, z.object({ raw: z.string().max(200000), headers: z.record(z.string()).default({}) }));
    return c.json(svc.apiError(body.raw, body.headers));
  });
  app.get("/api/tools/channels", (c) => c.json({ config: svc.registry.config }));

  return app;
}

function summary(r: { id: string; summary: string; product: string; status: string; createdAt: string; updatedAt: string; occurredAt: { display: string } | null; attachments: unknown[]; submissions: unknown[] }) {
  return { id: r.id, summary: r.summary, product: r.product, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, occurredAt: r.occurredAt?.display ?? null, attachments: r.attachments.length, submissions: r.submissions.length };
}
