import { test } from "@playwright/test";
import { pngWithText } from "./fixtures";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/screenshots");

test("capture screenshots for docs", async ({ page }, info) => {
  const name = info.project.name;
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("errorrelay"); });
  await page.goto("/");
  await page.screenshot({ path: path.join(dir, `${name}-home.png`), fullPage: true });
  await page.click("#home-screenshot");
  await page.setInputFiles("#file", { name: "shot.png", mimeType: "image/png", buffer: pngWithText() });
  await page.fill("#errorText", "ChatGPT iOS: Download failed");
  await page.click("#nowBtn");
  await page.selectOption("#product", "chatgpt_ios");
  await page.screenshot({ path: path.join(dir, `${name}-step1.png`), fullPage: true });
  await page.click("#next1");
  await page.fill("#description", "txt作ってもらってリンク押したらdownloadできなかった");
  await page.click("#proposeBtn");
  await page.click("#applyProposal");
  await page.fill("#expected", "TXTが開く");
  await page.fill("#actual", "ダウンロードエラーが表示される");
  await page.locator("canvas").waitFor();
  await page.click("#addBox");
  await page.click("#scanBtn");
  await page.screenshot({ path: path.join(dir, `${name}-step2.png`), fullPage: true });
  await page.click("#next2");
  await page.click("#readyBtn");
  await page.locator('button[data-adapter="openai_support"]').click();
  await page.locator("#confirmBtn").waitFor();
  await page.screenshot({ path: path.join(dir, `${name}-step3-confirm.png`), fullPage: true });
});
