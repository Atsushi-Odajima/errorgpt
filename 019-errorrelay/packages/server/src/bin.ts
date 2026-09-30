import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadRuntimeConfig, buildService, buildApp } from "./config.js";
import { mountMcp } from "./mcp.js";

const rc = await loadRuntimeConfig();
const service = buildService(rc);
const app = buildApp(rc, service);
await mountMcp(app, service, rc.auth);
if (rc.pwaDir) {
  app.use("/*", serveStatic({ root: rc.pwaDir }));
  app.get("*", serveStatic({ root: rc.pwaDir, path: "index.html" }));
}
// Retention sweep hourly.
setInterval(() => service.runRetention().catch(() => undefined), 3600_000).unref();
serve({ fetch: app.fetch, port: rc.port }, (info) => {
  console.log(JSON.stringify({ msg: "errorrelay server listening", port: info.port, ai: rc.ai.enabled, dataDir: rc.dataDir ?? "(no-save mode)", channels: rc.channels.configVersion }));
});
