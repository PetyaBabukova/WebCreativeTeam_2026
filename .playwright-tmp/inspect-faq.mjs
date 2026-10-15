import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:3000/faq/bg", { waitUntil: "domcontentloaded" });
const card = page.locator(".faq__card").first();
await card.scrollIntoViewIfNeeded();
await page.waitForTimeout(900);
await card.screenshot({ path: ".playwright-tmp/faq-closed.png" });
await card.getByRole("button").click();
for (const [name, delay] of [["start", 0], ["early", 120], ["middle", 160], ["late", 300], ["open", 450]]) {
  await page.waitForTimeout(delay);
  await card.screenshot({ path: `.playwright-tmp/faq-${name}.png` });
  const state = await card.evaluate((node) => ({
    surface: getComputedStyle(node.querySelector(".faq__card-surface")).opacity,
    color: getComputedStyle(node).color,
    answer: getComputedStyle(node.querySelector(".faq__answer-shell")).opacity,
  }));
  console.log(name, state);
}
await page.locator(".faq__related").scrollIntoViewIfNeeded();
await page.locator(".faq__related").screenshot({ path: ".playwright-tmp/faq-buttons-desktop.png" });
await page.setViewportSize({ width: 390, height: 844 });
await page.locator(".faq__related").scrollIntoViewIfNeeded();
await page.locator(".faq__related").screenshot({ path: ".playwright-tmp/faq-buttons-mobile.png" });
await browser.close();
