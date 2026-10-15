import { expect, test } from "@playwright/test";

test("desktop FAQ exposes all questions through vertical scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/faq/bg", { waitUntil: "domcontentloaded" });
  const cards = page.locator(".faq__card");
  await expect(cards).toHaveCount(15);
  await expect(page.locator(".faq__row")).toHaveCount(3);
  await expect(page.locator(".faq__card--open")).toHaveCount(0);
  await expect(cards.nth(1).getByRole("button")).toHaveText("Колко струва?");
  await expect(cards.nth(13).getByRole("button")).toHaveText("Гарантирано ли е първо място в Google?");

  const layout = await page.locator(".faq__questions").evaluate((section) => ({
    overflow: section.scrollWidth - section.clientWidth,
    firstRowTop: section.querySelector(".faq__row")?.getBoundingClientRect().top ?? Infinity,
    heights: Array.from(section.querySelectorAll(".faq__card"), (card) => card.getBoundingClientRect().height),
    marginTop: parseFloat(getComputedStyle(section).marginTop),
    marginBottom: parseFloat(getComputedStyle(section).marginBottom),
    gap: parseFloat(getComputedStyle(section.querySelector(".faq__row")!).gap),
    rows: Array.from(section.querySelectorAll(".faq__row"), (row) =>
      Array.from(row.querySelectorAll<HTMLElement>(".faq__card"), (card) => card.offsetTop)),
  }));
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.firstRowTop).toBeLessThan(800);
  expect(layout.marginTop).toBeGreaterThan(120);
  expect(layout.marginBottom).toBe(layout.marginTop);
  expect(layout.gap).toBeGreaterThan(16);
  expect(layout.heights[0]).toBeLessThanOrEqual(370);
  expect(Math.max(...layout.heights) - Math.min(...layout.heights)).toBeLessThanOrEqual(1);
  expect(layout.rows).toHaveLength(3);
  for (const row of layout.rows) {
    expect(row).toHaveLength(5);
    expect(new Set(row).size).toBe(1);
  }

  await cards.nth(14).scrollIntoViewIfNeeded();
  await expect(page.locator(".faq__card--open")).toHaveCount(0);
  await cards.nth(14).getByRole("button").click();
  await expect(cards.nth(14)).toHaveClass(/faq__card--open/);
  await expect(page.locator(".faq__card--open")).toHaveCount(1);
  await page.waitForTimeout(950);
  const openedLayout = await page.locator(".faq__questions").evaluate((section) => {
    const cards = Array.from(section.querySelectorAll(".faq__card"));
    const open = section.querySelector(".faq__card--open")!;
    return {
      heights: cards.map((card) => card.getBoundingClientRect().height),
      answerBottom: open.querySelector(".faq__answer")!.getBoundingClientRect().bottom,
      cardBottom: open.getBoundingClientRect().bottom,
      padding: [getComputedStyle(open).paddingTop, getComputedStyle(open).paddingRight, getComputedStyle(open).paddingBottom, getComputedStyle(open).paddingLeft],
      contentLeft: [open.querySelector(".faq__number")!, open.querySelector(".faq__question-text")!, open.querySelector(".faq__answer")!].map((element) => element.getBoundingClientRect().left),
      answerRight: open.querySelector(".faq__answer")!.getBoundingClientRect().right,
      contentRight: open.getBoundingClientRect().right - parseFloat(getComputedStyle(open).paddingRight),
      openWidth: open.getBoundingClientRect().width,
      closedWidth: cards[0].getBoundingClientRect().width,
    };
  });
  expect(Math.max(...openedLayout.heights.slice(0, 10)) - Math.min(...openedLayout.heights.slice(0, 10))).toBeLessThanOrEqual(1);
  expect(Math.max(...openedLayout.heights.slice(10)) - Math.min(...openedLayout.heights.slice(10))).toBeLessThanOrEqual(1);
  expect(openedLayout.heights[14]).toBeGreaterThan(layout.heights[14]);
  expect(openedLayout.answerBottom).toBeLessThan(openedLayout.cardBottom);
  expect(new Set(openedLayout.padding).size).toBe(1);
  expect(Math.max(...openedLayout.contentLeft) - Math.min(...openedLayout.contentLeft)).toBeLessThanOrEqual(1);
  expect(openedLayout.answerRight).toBeLessThanOrEqual(openedLayout.contentRight + 1);
  expect(openedLayout.openWidth).toBeGreaterThan(380);
  expect(openedLayout.closedWidth).toBeGreaterThan(190);

  await cards.nth(10).getByRole("button").click();
  await expect(cards.nth(10)).toHaveClass(/faq__card--open/);
  await page.waitForTimeout(950);
  const longestAnswerFits = await cards.nth(10).evaluate((card) =>
    card.querySelector(".faq__answer")!.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom);
  expect(longestAnswerFits).toBe(true);
});

test("desktop hover opens a single FAQ card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/faq/bg", { waitUntil: "domcontentloaded" });
  const card = page.locator(".faq__card").first();
  await card.scrollIntoViewIfNeeded();
  await expect(page.locator(".faq__card--open")).toHaveCount(0);
  await page.waitForTimeout(850);
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 10);
  await page.mouse.move(box!.x + box!.width / 2 + 8, box!.y + 12);
  await expect(card).toHaveClass(/faq__card--open/);
  await expect(page.locator(".faq__card--open")).toHaveCount(1);
});

test("FAQ card surfaces settle correctly and print without the artwork", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/faq/bg", { waitUntil: "domcontentloaded" });
  const cards = page.locator(".faq__card");
  const firstSurface = cards.first().locator(".faq__card-surface");
  const secondSurface = cards.nth(1).locator(".faq__card-surface");
  await cards.first().scrollIntoViewIfNeeded();
  await expect(firstSurface).toHaveCSS("opacity", "0");

  await cards.first().getByRole("button").click();
  await expect(firstSurface).toHaveCSS("opacity", "1");
  await expect(cards.first().getByRole("button")).toHaveCSS("color", "rgb(13, 41, 48)");

  await cards.nth(1).getByRole("button").click();
  await expect(firstSurface).toHaveCSS("opacity", "0");
  await expect(secondSurface).toHaveCSS("opacity", "1");
  await expect(cards.first().getByRole("button")).toHaveCSS("color", "rgb(255, 255, 255)");

  await page.emulateMedia({ media: "print" });
  await expect(secondSurface).toBeHidden();
  await expect(cards.nth(1)).toHaveCSS("color", "rgb(0, 0, 0)");

  await page.emulateMedia({ media: "screen", forcedColors: "active" });
  await expect(secondSurface).toBeHidden();
  await expect(cards.nth(1)).toHaveCSS("color", "rgb(0, 0, 0)");
});

test("FAQ cards animate also when the OS asks for reduced motion (site-wide decision)", async ({ page }) => {
  // The user's own Windows has "Animation effects" off; the cards must still open smoothly, not jump.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/faq/bg", { waitUntil: "domcontentloaded" });
  const card = page.locator(".faq__card").first();
  await card.scrollIntoViewIfNeeded();
  const widths = await card.getByRole("button").evaluate((button) => new Promise<number[]>((resolve) => {
    const article = button.closest<HTMLElement>(".faq__card")!;
    const samples: number[] = [];
    const start = performance.now();
    (button as HTMLButtonElement).click();
    const tick = () => {
      samples.push(article.getBoundingClientRect().width);
      if (performance.now() - start < 1200) requestAnimationFrame(tick); else resolve(samples);
    };
    requestAnimationFrame(tick);
  }));
  const first = widths[0], last = widths[widths.length - 1];
  const intermediate = widths.filter((width) => width > first + 10 && width < last - 10);
  expect(last).toBeGreaterThan(first + 100);
  expect(intermediate.length).toBeGreaterThan(5);
});

test("mobile FAQ shows questions and keeps only the last tapped answer open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/faq/bg", { waitUntil: "domcontentloaded" });
  const cards = page.locator(".faq__card");
  await expect(cards).toHaveCount(15);
  await expect(page.locator(".faq__card--open")).toHaveCount(0);
  await expect(cards.first().locator(".faq__number")).toBeHidden();
  await expect(cards.first().locator(".faq__answer-shell")).toBeHidden();
  const leadGap = await page.locator(".faq__questions").evaluate((section) =>
    section.getBoundingClientRect().top - document.querySelector(".faq__lead")!.getBoundingClientRect().bottom);
  expect(leadGap).toBeGreaterThan(30);
  expect(leadGap).toBeLessThan(65);

  await cards.nth(1).getByRole("button").click();
  await expect(cards.nth(1)).toHaveClass(/faq__card--open/);
  await cards.nth(4).scrollIntoViewIfNeeded();
  const before = await cards.nth(4).getByRole("button").evaluate((button) => button.getBoundingClientRect().top);
  await cards.nth(4).getByRole("button").click();
  await expect(cards.nth(1)).not.toHaveClass(/faq__card--open/);
  await expect(cards.nth(4)).toHaveClass(/faq__card--open/);
  await expect(page.locator(".faq__card--open")).toHaveCount(1);
  await expect(cards.nth(1).locator(".faq__card-surface")).toHaveCSS("opacity", "0");
  await expect(cards.nth(1).getByRole("button")).toHaveCSS("color", "rgb(255, 255, 255)");
  const after = await cards.nth(4).getByRole("button").evaluate((button) => button.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThan(6);
  await cards.nth(4).getByRole("button").click();
  await expect(cards.nth(4)).toHaveClass(/faq__card--open/);
});

test("FAQ answers remain readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/faq/bg", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".faq__card")).toHaveCount(15);
  await expect(page.locator(".faq__answer-shell").first()).toBeVisible();
  await expect(page.locator(".faq .service-typewriter__motion-char").first()).toBeVisible();
  await expect(page.locator(".faq__lead")).toBeVisible();
  await context.close();
});

