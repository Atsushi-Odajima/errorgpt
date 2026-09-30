import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(__dirname, "../..");
export default defineConfig({
  testDir: __dirname,
  timeout: 60_000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(root, "playwright-report") }]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "iphone", use: { ...devices["iPhone 14"], browserName: "chromium" } },
    { name: "android", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  webServer: [
    { command: "npm run preview -w apps/pwa", url: "http://127.0.0.1:4173", cwd: root, reuseExistingServer: true, timeout: 60_000 },
    { command: "node packages/server/dist/bin.js", url: "http://127.0.0.1:8787/api/health", cwd: root, reuseExistingServer: true, timeout: 60_000, env: { PORT: "8787", ERRORRELAY_TOKENS: "e2e-token:e2e:e2e-user", ERRORRELAY_NO_SAVE: "1", ERRORRELAY_CORS_ORIGINS: "http://127.0.0.1:4173", ERRORRELAY_SIGNING_SECRET: "e2e-secret" } },
  ],
});
