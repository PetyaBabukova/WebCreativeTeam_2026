import { expect, test } from "@playwright/test";

test("desktop FAQ exposes all questions through vertical scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/faq/bg", { waitUntil: "domcontentloaded" });
  const cards = page.locator(".faq__card");
  const lastCard = cards.filter({ has: page.getByRole("button", { name: "Защо да изберем WebCreativeTeam?" }) });
  await expect(cards).toHaveCount(13);
  await expect(page.locator(".faq__row")).toHaveCount(3);
  await expect(page.locator(".faq__row").nth(2).locator(".faq__card")).toHaveCount(3);
  await expect(page.locator(".faq__card--open")).toHaveCount(0);
  await expect(cards.nth(1).getByRole("button")).toHaveText("Колко струва?");
  await expect(cards.nth(11).getByRole("button")).toHaveText("Гарантирано ли е първо място в Google?");

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
  // FAQ uses the same content band as every other page: the rows line up with the header's .container content edges.
  const band = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".site-header .container")!;
    const style = getComputedStyle(header);
    const box = header.getBoundingClientRect();
    const row = document.querySelector(".faq__row")!.getBoundingClientRect();
    return { left: row.left - (box.left + parseFloat(style.paddingLeft)), right: (box.right - parseFloat(style.paddingRight)) - row.right };
  });
  expect(Math.abs(band.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(band.right)).toBeLessThanOrEqual(1);
  expect(layout.firstRowTop).toBeLessThan(800);
  expect(layout.marginTop).toBeGreaterThan(120);
  expect(layout.marginBottom).toBe(layout.marginTop);
  expect(layout.gap).toBeGreaterThan(16);
  expect(layout.heights[0]).toBeLessThanOrEqual(370);
  expect(Math.max(...layout.heights) - Math.min(...layout.heights)).toBeLessThanOrEqual(1);
  expect(layout.rows).toHaveLength(3);
  for (const [index, row] of layout.rows.entries()) {
    expect(row).toHaveLength(index === 2 ? 3 : 5);
    expect(new Set(row).size).toBe(1);
  }

  await lastCard.scrollIntoViewIfNeeded();
  await expect(page.locator(".faq__card--open")).toHaveCount(0);
  await lastCard.getByRole("button").click();
  await expect(lastCard).toHaveClass(/faq__card--open/);
  await expect(page.locator(".faq__card--open")).toHaveCount(1);
  await expect(lastCard.locator(".faq__answer")).toHaveCount(3);
  await page.waitForTimeout(950);
  const openedLayout = await page.locator(".faq__questions").evaluate((section) => {
    const cards = Array.from(section.querySelectorAll(".faq__card"));
    const open = section.querySelector(".faq__card--open")!;
    return {
      heights: cards.map((card) => card.getBoundingClientRect().height),
      answerBottom: Array.from(open.querySelectorAll(".faq__answer")).at(-1)!.getBoundingClientRect().bottom,
      cardBottom: open.getBoundingClientRect().bottom,
      padding: [getComputedStyle(open).paddingTop, getComputedStyle(open).paddingRight, getComputedStyle(open).paddingBottom, getComputedStyle(open).paddingLeft],
      contentLeft: [open.querySelector(".faq__number")!, open.querySelector(".faq__question-text")!, open.querySelector(".faq__answer")!].map((element) => element.getBoundingClientRect().left),
      answerRight: open.querySelector(".faq__answer")!.getBoundingClientRect().right,
      contentRight: open.getBoundingClientRect().right - parseFloat(getComputedStyle(open).paddingRight),
      openWidth: open.getBoundingClientRect().width,
      closedWidth: cards[10].getBoundingClientRect().width, // a closed card in the same three-card row
    };
  });
  expect(Math.max(...openedLayout.heights.slice(0, 10)) - Math.min(...openedLayout.heights.slice(0, 10))).toBeLessThanOrEqual(1);
  expect(Math.max(...openedLayout.heights.slice(10)) - Math.min(...openedLayout.heights.slice(10))).toBeLessThanOrEqual(1);
  expect(openedLayout.heights[12]).toBeGreaterThan(layout.heights[12]);
  expect(openedLayout.answerBottom).toBeLessThan(openedLayout.cardBottom);
  expect(new Set(openedLayout.padding).size).toBe(1);
  expect(Math.max(...openedLayout.contentLeft) - Math.min(...openedLayout.contentLeft)).toBeLessThanOrEqual(1);
  expect(openedLayout.answerRight).toBeLessThanOrEqual(openedLayout.contentRight + 1);
  // The open card is about twice as wide as a closed one (2:1 design), within the site-wide content band.
  expect(openedLayout.openWidth / openedLayout.closedWidth).toBeGreaterThan(1.8);

  await cards.first().getByRole("button").click();
  await expect(page.locator(".faq__card--open")).toHaveCount(1);
  await expect(cards.first()).toHaveClass(/faq__card--open/);
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

test("the three cards in the last desktop row align and expand like five-card rows", async ({ page }) => {
  const geometry = async (rowIndex: number) => page.locator(".faq__row").nth(rowIndex).locator(".faq__card").evaluateAll((cards) =>
    cards.slice(0, 3).map((card) => {
      const box = card.getBoundingClientRect();
      return { left: box.left, width: box.width };
    }));
  const matches = (actual: Awaited<ReturnType<typeof geometry>>, expected: Awaited<ReturnType<typeof geometry>>) => {
    for (let index = 0; index < 3; index++) {
      expect(Math.abs(actual[index].left - expected[index].left)).toBeLessThanOrEqual(1);
      expect(Math.abs(actual[index].width - expected[index].width)).toBeLessThanOrEqual(1);
    }
  };

  for (const width of [1100, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/faq/bg", { waitUntil: "domcontentloaded" });
    matches(await geometry(2), await geometry(0));

    const firstRowCard = page.locator(".faq__row").first().locator(".faq__card").first();
    await firstRowCard.getByRole("button").evaluate((button) => (button as HTMLButtonElement).click());
    await expect(firstRowCard).toHaveCSS("flex-grow", "2.25");
    const expandedFirstRow = await geometry(0);

    const lastRowCard = page.locator(".faq__row").nth(2).locator(".faq__card").first();
    await lastRowCard.getByRole("button").evaluate((button) => (button as HTMLButtonElement).click());
    await expect(lastRowCard).toHaveCSS("flex-grow", "2.25");
    matches(await geometry(2), expandedFirstRow);
  }

  await page.setViewportSize({ width: 1088, height: 900 });
  await page.goto("/faq/bg", { waitUntil: "domcontentloaded" });
  expect(await page.locator(".faq__row").nth(2).evaluate((row) => getComputedStyle(row, "::after").content)).toBe("none");
});

test("all FAQ questions fit the narrow desktop cards in both languages", async ({ page }) => {
  for (const locale of ["bg", "en"]) {
    for (const width of [1100, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/faq/${locale}`, { waitUntil: "domcontentloaded" });
      const overflow = await page.locator(".faq__question-text").evaluateAll((questions) =>
        questions.map((question) => question.scrollWidth - question.clientWidth));
      expect(Math.max(...overflow), `${locale} at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("the combined solutions phrase is an accessible link in both languages", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const [locale, question, phrase] of [
    ["bg", "Мога ли да заявя само една услуга?", "комбинирани решения"],
    ["en", "Can I request just one service?", "combined solutions"],
  ] as const) {
    await page.goto(`/faq/${locale}`, { waitUntil: "domcontentloaded" });
    const card = page.locator(".faq__card").filter({ has: page.getByRole("button", { name: question }) });
    const button = card.getByRole("button", { name: question });
    const link = card.getByRole("link", { name: phrase });
    await card.scrollIntoViewIfNeeded();
    await expect(link).toBeHidden();
    await button.click();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/servicess/offers");
    await expect(link).toHaveCSS("text-decoration-line", "underline");
    await button.focus();
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    if (locale === "bg") {
      await page.waitForTimeout(1100);
      const other = await page.locator(".faq__card").nth(5).boundingBox();
      expect(other).not.toBeNull();
      await page.mouse.move(other!.x + other!.width / 2, other!.y + 10);
      await page.mouse.move(other!.x + other!.width / 2 + 8, other!.y + 12);
      await page.waitForTimeout(160);
      await expect(card).toHaveClass(/faq__card--open/);
    }
  }
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
  await expect(cards).toHaveCount(13);
  await expect(page.locator(".faq__card--open")).toHaveCount(0);
  await expect(cards.first().locator(".faq__number")).toBeHidden();
  await expect(cards.first().locator(".faq__answer-shell")).toBeHidden();
  const leadGap = await page.locator(".faq__questions").evaluate((section) =>
    section.getBoundingClientRect().top - document.querySelector(".faq__lead")!.getBoundingClientRect().bottom);
  expect(leadGap).toBeGreaterThan(30);
  expect(leadGap).toBeLessThan(65);

  await cards.nth(1).getByRole("button").click();
  await expect(cards.nth(1)).toHaveClass(/faq__card--open/);
  // Let the first card finish opening; otherwise its own expansion still pushes card 05 down while it is measured.
  await expect(cards.nth(1).locator(".faq__answer-shell")).toHaveCSS("opacity", "1");
  // Centre the question: near the fixed header Playwright would scroll the page itself before clicking,
  // which is a harness move, not the layout shift this test guards against.
  await cards.nth(4).evaluate((card) => card.scrollIntoView({ block: "center" }));
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
  await expect(page.locator(".faq__card")).toHaveCount(13);
  await expect(page.locator(".faq__answer-shell").first()).toBeVisible();
  await expect(page.locator(".faq .service-typewriter__motion-char").first()).toBeVisible();
  await expect(page.locator(".faq__lead")).toBeVisible();
  await context.close();

  const desktop = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto("/faq/bg", { waitUntil: "domcontentloaded" });
  await expect(desktopPage.locator(".faq__answer-shell").last()).toBeVisible();
  const lastRow = desktopPage.locator(".faq__row").last();
  expect(await lastRow.evaluate((row) => ({ display: getComputedStyle(row).display, spacerHeight: getComputedStyle(row, "::after").height }))).toEqual({ display: "block", spacerHeight: "0px" });
  await desktop.close();
});

