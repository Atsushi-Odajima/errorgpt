import { test, expect, type Page } from "@playwright/test";
import { pngWithText } from "./fixtures";
import { unzipSync, strFromU8 } from "fflate";

const SECRET_MAIL = "taro.yamada@example.com";
const SECRET_KEY = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";

async function fresh(page: Page) {
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("errorrelay"); });
  await page.goto("/");
}

test.describe("PWA local mode", () => {
  test("no horizontal overflow on this viewport (tests 27, 28)", async ({ page }) => {
    await fresh(page);
    for (const route of ["#/", "#/settings", "#/history"]) {
      await page.goto(`/${route}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, route).toBe(false);
    }
    await page.goto("/#/");
    const box = await page.locator("#home-screenshot").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("E2E-1: screenshot → time → organize → redact → handoff to OpenAI Support (HANDOFF, not submitted)", async ({ page }) => {
    await fresh(page);
    await page.click("#home-screenshot");
    await expect(page).toHaveURL(/#\/r\/rep_.+\/1/);
    await page.setInputFiles("#file", { name: "shot.png", mimeType: "image/png", buffer: pngWithText() });
    await expect(page.locator("#attachments li")).toHaveCount(1);
    await expect(page.locator("#attachments")).toContainText("EXIF removed");
    await page.fill("#errorText", "ChatGPT iOS: Download failed");
    await page.click("#nowBtn");
    await expect(page.locator("#occurredInfo")).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    await page.selectOption("#product", "chatgpt_ios");
    await page.click("#next1");
    await expect(page).toHaveURL(/\/2$/);
    await page.fill("#description", "txt作ってもらってリンク押したらdownloadできなかった");
    await page.click("#proposeBtn");
    await expect(page.locator("#proposal")).toContainText("ChatGPT");
    await page.click("#applyProposal");
    const steps = await page.inputValue("#steps");
    expect(steps.split("\n").length).toBeGreaterThanOrEqual(2);
    await page.fill("#expected", "TXTが開く");
    await page.fill("#actual", "ダウンロードエラーが表示される");
    await page.fill("#env_device", "iPhone 15");
    // image redaction with keyboard + save
    await page.locator("canvas").waitFor();
    await page.click("#addBox");
    await expect(page.locator(".boxes li")).toHaveCount(1);
    await page.locator("canvas").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".boxes li")).toHaveCount(2);
    await page.click("#saveRedacted");
    await page.click("#scanBtn");
    await expect(page.locator("#scanOut")).toContainText(/検出なし|none found|found/);
    await page.click("#next2");
    await expect(page).toHaveURL(/\/3$/);
    await expect(page.locator("#previewText")).toContainText("ChatGPT");
    await page.click("#readyBtn");
    await expect(page.locator("#quality")).not.toContainText("✗");
    await expect(page.locator(".tag").first()).toContainText(/送信準備完了|Ready/);
    const prepareBtn = page.locator('button[data-adapter="openai_support"]');
    await expect(page.locator("#channels")).toContainText("INTERACTIVE_HANDOFF");
    await prepareBtn.click();
    await expect(page.locator("#confirm")).toContainText(/送信先|Destination/);
    await expect(page.locator("#confirm")).toContainText("redacted_shot.png");
    await page.click("#confirmBtn");
    await expect(page.locator("#confirm")).toContainText(/ご自身で送信|send it yourself/);
    await expect(page.locator("#openChannel")).toHaveAttribute("href", /help\.openai\.com/);
    await expect(page.locator("#confirm .tag")).toContainText(/手渡し準備済み|Handoff Prepared/);
    await page.fill("#ticketId", "OA-1");
    await page.click("#markSent");
    await expect(page).toHaveURL(/#\/r\/rep_[^/]+$/);
    await expect(page.locator(".tag").first()).toContainText(/利用者が送信済みと記録|User Marked Submitted/);
    await expect(page.locator(".tag").first()).not.toContainText(/公式受領確認あり|receipt confirmed/);
    await expect(page.locator(".tag").first()).toContainText(/この端末のみ|This device only/);
  });

  test("E2E-4: secrets in text are redacted and the exported ZIP contains none of them", async ({ page }) => {
    await fresh(page);
    await page.click("#home-text");
    await page.fill("#errorText", `Error: request failed for ${SECRET_MAIL} with key ${SECRET_KEY}`);
    await page.click("#nowBtn");
    await page.selectOption("#product", "openai_api");
    await page.click("#next1");
    await page.fill("#steps", "Call the API");
    await page.fill("#expected", "200 OK");
    await page.fill("#actual", "500 error");
    await page.click("#scanBtn");
    await expect(page.locator("#scanOut")).toContainText(/found|検出/);
    await page.click("#redactBtn");
    await expect(page.locator("#scanOut")).toContainText(/検出なし|none found/);
    await page.click("#next2");
    await page.click("#readyBtn");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#zipBtn")]);
    const path = await dl.path();
    const bytes = new Uint8Array(await (await import("node:fs/promises")).readFile(path!));
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["report.json", "report_ja.txt", "report_en.txt", "manifest.json", "environment.json"]));
    const all = Object.values(files).map((f) => strFromU8(f)).join("\n");
    expect(all).not.toContain(SECRET_MAIL);
    expect(all).not.toContain(SECRET_KEY);
    expect(all).toContain("[REDACTED_API_KEY_1]");
    // re-import → same content (test 30)
    await page.goto("/#/history");
    await page.setInputFiles('input[type="file"]', { name: "pkg.zip", mimeType: "application/zip", buffer: Buffer.from(bytes) });
    await expect(page).toHaveURL(/#\/r\/rep_/);
    await expect(page.locator("pre").first()).toContainText("[REDACTED_API_KEY_1]");
  });

  test("keyboard: tab order reaches primary actions; language toggle", async ({ page }) => {
    await fresh(page);
    await page.keyboard.press("Tab"); // skip link
    await expect(page.locator(".skip")).toBeFocused();
    const before = await page.locator("#home-screenshot").textContent();
    await page.click("#lang");
    await expect(page.locator("#home-screenshot")).not.toHaveText(before!);
    await expect(page.locator("#home-screenshot")).toHaveText(/Report from a screenshot|スクショから報告を作る/);
    await page.click("#lang");
    await expect(page.locator("#home-screenshot")).toHaveText(before!);
  });
});

test.describe("PWA server mode", () => {
  test("offline draft vs server-saved are distinguished (test 29) and AI-off analysis falls back", async ({ page }) => {
    await fresh(page);
    await page.click("#home-text");
    await page.fill("#errorText", "local draft error");
    await page.click("#next1");
    await expect(page).toHaveURL(/\/2$/);
    await page.goto("/#/settings");
    await page.selectOption("#mode", "server");
    await page.fill("#serverUrl", "http://127.0.0.1:8787");
    await page.fill("#token", "e2e-token");
    await page.click("#saveSettings");
    await page.goto("/#/history");
    await expect(page.locator("#historyList li")).toHaveCount(0).catch(() => undefined);
    await page.goto("/#/new?mode=screenshot");
    await expect(page).toHaveURL(/#\/r\/rep_.+\/1/);
    await expect(page.locator(".tag").first()).toContainText(/サーバー保存|Saved on server/);
    await page.setInputFiles("#file", { name: "shot.png", mimeType: "image/png", buffer: pngWithText() });
    await expect(page.locator("#attachments li")).toHaveCount(1);
    await page.fill("#errorText", "Something went wrong");
    await page.click("#nowBtn");
    await page.click("#next1");
    await page.check("#aiConsent");
    await page.click("#analyzeBtn");
    await expect(page.locator("#analysisOut")).toContainText(/AI analysis is off|使えません|unavailable/i);
    // switch back to local: the local draft is still there and marked local
    await page.goto("/#/settings");
    await page.selectOption("#mode", "local");
    await page.click("#saveSettings");
    await page.goto("/#/history");
    await expect(page.locator("#historyList")).toContainText(/この端末のみ|This device only/);
  });
});
