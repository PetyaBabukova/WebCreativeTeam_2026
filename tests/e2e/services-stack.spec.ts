import { expect, test } from "@playwright/test";
import { pageUrl } from "../../lib/routing";

test("SEO & GEO card uses the supplied artwork and translated copy", async ({ page }) => {
  for (const locale of ["bg", "en"] as const) {
    await page.goto(pageUrl("home", locale));
    const cards = page.locator(".services__card");
    await expect(cards).toHaveCount(4);
    const seo = cards.nth(1);
    await expect(seo).toHaveAttribute("data-service-art", "seo-geo");
    await expect(seo.locator("h3")).toContainText("SEO & GEO");
    await expect(seo.locator(".services__card-title span").last()).toHaveText(locale === "bg" ? "влияние" : "impact");
    await expect(seo.locator(".services__card-title span").last()).toHaveCSS("text-transform", "none");
    await expect(seo.locator(".services__feature")).toContainText(locale === "bg"
      ? ["SEO оптимизация", "Technical SEO", "AI Search & GEO"]
      : ["SEO Optimisation", "Technical SEO", "AI Search & GEO"]);
    await expect(seo.locator(".services__learn-more")).toContainText(locale === "bg" ? "Подобри видимостта" : "Improve your visibility");
    await expect(seo.locator(".services__image img")).toHaveAttribute("src", /seo-and-geo/);
    await expect(cards.locator("a, button")).toHaveCount(0);
  }
});

test("digital marketing card uses the supplied artwork and copy in both languages", async ({ page }) => {
  for (const locale of ["bg", "en"] as const) {
    await page.goto(pageUrl("home", locale));
    const card = page.locator('.services__card[data-service-art="digital-marketing"]');
    await expect(card.locator(".services__eyebrow")).toHaveText(locale === "bg" ? "НАПРАВИ ШУМ СЪС СМИСЪЛ" : "MAKE NOISE WITH PURPOSE");
    await expect(card.locator(".services__card-title span").first()).toHaveText(locale === "bg" ? "ДИГИТАЛЕН МАРКЕТИНГ" : "DIGITAL MARKETING");
    await expect(card.locator(".services__card-title span").last()).toHaveText(locale === "bg" ? "импулс" : "momentum");
    await expect(card.locator(".services__feature")).toContainText(locale === "bg"
      ? ["Стратегия", "Performance", "Социални медии"]
      : ["Strategy", "Performance", "Social Media"]);
    await expect(card.locator(".services__description")).toContainText(locale === "bg" ? "устойчиво развитие" : "sustainable growth");
    await expect(card.locator(".services__learn-more")).toContainText(locale === "bg" ? "Дай импулс" : "Build momentum");
    await expect(card.locator(".services__image img")).toHaveAttribute("src", /digital-marketing/);
  }
});

test("branding card uses the supplied artwork and copy in both languages", async ({ page }) => {
  for (const locale of ["bg", "en"] as const) {
    await page.goto(pageUrl("home", locale));
    const card = page.locator('.services__card[data-service-art="branding"]');
    await expect(card.locator(".services__eyebrow")).toHaveText(locale === "bg" ? "НЕ ИЗГЛЕЖДАЙ КАТО ВСИЧКИ" : "DON’T LOOK LIKE EVERYONE ELSE");
    await expect(card.locator(".services__card-title span").first()).toHaveText(locale === "bg" ? "Брандинг" : "Branding");
    await expect(card.locator(".services__card-title span").last()).toHaveText(locale === "bg" ? "с характер" : "with character");
    await expect(card.locator(".services__feature")).toContainText(locale === "bg"
      ? ["Лого", "Идентичност", "Дигитален бранд"]
      : ["Logo", "Identity", "Digital Brand"]);
    await expect(card.locator(".services__description")).toContainText(locale === "bg" ? "дигиталния свят" : "digital world");
    await expect(card.locator(".services__learn-more")).toContainText(locale === "bg" ? "Изгради бранд" : "Build your brand");
    await expect(card.locator(".services__image img")).toHaveAttribute("src", /branding/);
  }
});

test("fourth service covers the third without revealing earlier cards", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto(pageUrl("home", "bg"));
  const cards = page.locator(".services__card");
  const fourthTop = await cards.nth(3).evaluate((card) => card.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((top) => window.scrollTo(0, top - 20), fourthTop);
  await expect.poll(() => cards.nth(2).evaluate((card) => Number(getComputedStyle(card).opacity))).toBeLessThan(.1);
  for (const index of [0, 1]) {
    expect(await cards.nth(index).evaluate((card) => Number(getComputedStyle(card).opacity))).toBeLessThan(.1);
  }
  await expect.poll(() => cards.nth(2).evaluate((card) => new DOMMatrixReadOnly(getComputedStyle(card).transform).a)).toBeLessThanOrEqual(.81);
  await page.evaluate((top) => window.scrollTo(0, top - innerHeight), fourthTop);
  await expect.poll(() => cards.nth(2).evaluate((card) => Number(getComputedStyle(card).opacity))).toBe(1);
});

test("third service covers the second without revealing the first", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto(pageUrl("home", "bg"));
  const cards = page.locator(".services__card");
  await expect(page.locator(".services__cards")).toHaveAttribute("data-stack", "sticky");
  await cards.nth(2).evaluate((card) => window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 20));
  const opacity = (index: number) => cards.nth(index).evaluate((card) => Number(getComputedStyle(card).opacity));
  await expect.poll(() => opacity(1)).toBeLessThan(.1);
  expect(await opacity(0)).toBeLessThan(.1);
  await expect.poll(() => cards.nth(1).evaluate((card) => new DOMMatrixReadOnly(getComputedStyle(card).transform).a)).toBeLessThanOrEqual(.81);
  await cards.nth(2).evaluate((card) => window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - innerHeight));
  await expect.poll(() => opacity(1)).toBe(1);
});

test("marketing and branding text fit narrow mobile cards", async ({ page }) => {
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 844 });
    for (const locale of ["bg", "en"] as const) {
      await page.goto(pageUrl("home", locale));
      await page.evaluate(() => document.fonts.ready);
      for (const art of ["digital-marketing", "branding"]) {
        const clipped = await page.locator(`.services__card[data-service-art="${art}"]`).evaluate((card) => {
          const elements = card.querySelectorAll<HTMLElement>(".services__card-title span, .services__feature span, .services__eyebrow");
          return [...elements].filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent);
        });
        expect(clipped, `${art}, ${locale} at ${width}px`).toEqual([]);
      }
    }
  }
});

test("service cards fit laptop viewports with side space", async ({ page }) => {
  for (const [width, height] of [[1366, 768], [1280, 720], [900, 600]]) {
    await page.setViewportSize({ width, height });
    await page.goto(pageUrl("home", "bg"));
    await page.evaluate(() => document.fonts.ready);
    const cards = page.locator(".services__card");
    const positions = await cards.evaluateAll((elements) => elements.map((card) => card.getBoundingClientRect().top + scrollY));
    for (const [index, position] of positions.entries()) {
      await page.evaluate((top) => window.scrollTo(0, top - 120), position);
      const bounds = await cards.nth(index).evaluate((card) => {
        const rect = card.getBoundingClientRect();
        const cta = card.querySelector(".services__learn-more")!.getBoundingClientRect();
        return { left: rect.left, bottom: rect.bottom, ctaBottom: cta.bottom };
      });
      expect(bounds.left, `${width}×${height}, card ${index + 1}`).toBeGreaterThanOrEqual(width * .055);
      expect(bounds.bottom, `${width}×${height}, card ${index + 1}`).toBeLessThanOrEqual(height - 15);
      expect(bounds.ctaBottom).toBeLessThan(bounds.bottom);
    }
  }
});

test("second service covers the first and reveals it on reverse scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto(pageUrl("home", "bg"));
  const cards = page.locator(".services__card");
  await expect(page.locator(".services__cards")).toHaveAttribute("data-stack", "sticky");
  const secondTop = await cards.nth(1).evaluate((card) => card.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((top) => window.scrollTo(0, top - innerHeight), secondTop);
  await expect(cards.first()).toHaveCSS("opacity", "1");
  await page.evaluate((top) => window.scrollTo(0, top - 20), secondTop);
  await expect.poll(() => cards.first().evaluate((card) => Number(getComputedStyle(card).opacity))).toBeLessThan(.1);
  const cardScale = () => cards.first().evaluate((card) => new DOMMatrixReadOnly(getComputedStyle(card).transform).a);
  await expect.poll(cardScale).toBeGreaterThanOrEqual(.79);
  await expect.poll(cardScale).toBeLessThanOrEqual(.81);
  const cover = await cards.evaluateAll(([first, second]) => {
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    return { firstBottom: a.bottom, secondTop: b.top, secondZ: getComputedStyle(second).zIndex, firstZ: getComputedStyle(first).zIndex };
  });
  expect(cover.secondTop).toBeLessThan(cover.firstBottom);
  expect(Number(cover.secondZ)).toBeGreaterThan(Number(cover.firstZ));
  await page.evaluate((top) => window.scrollTo(0, top - innerHeight), secondTop);
  await expect.poll(() => cards.first().evaluate((card) => Number(getComputedStyle(card).opacity))).toBe(1);
  await expect.poll(cardScale).toBe(1);
});

test("mobile card keeps artwork above copy and short landscape uses flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl("home", "bg"));
  const seo = page.locator(".services__card").nth(1);
  await expect(page.locator(".services__cards")).toHaveAttribute("data-stack", "sticky");
  const mobile = await seo.evaluate((card) => ({
    imageBottom: card.querySelector(".services__image")!.getBoundingClientRect().bottom,
    textTop: card.querySelector(".services__card-content")!.getBoundingClientRect().top,
    eyebrowTop: card.querySelector(".services__eyebrow")!.getBoundingClientRect().top,
    eyebrowBottom: card.querySelector(".services__eyebrow")!.getBoundingClientRect().bottom,
    imageTop: card.querySelector(".services__image")!.getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(mobile.textTop).toBeGreaterThanOrEqual(mobile.imageBottom - 1);
  expect(mobile.eyebrowTop).toBeGreaterThan(mobile.imageTop);
  expect(mobile.eyebrowBottom).toBeLessThan(mobile.imageBottom);
  expect(mobile.overflow).toBe(false);
  await seo.evaluate((card) => window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 5));
  const mobileScale = () => page.locator(".services__card").first().evaluate((card) => new DOMMatrixReadOnly(getComputedStyle(card).transform).a);
  await expect.poll(mobileScale).toBeLessThanOrEqual(.84);
  expect(await mobileScale()).toBeGreaterThanOrEqual(.82);
  const overlap = await page.evaluate(() => {
    const a = document.querySelector(".services__card:nth-child(2) .services__eyebrow")!.getBoundingClientRect();
    const b = document.querySelector(".site-header__cta")!.getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  expect(overlap).toBe(false);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".services__cards")).toHaveAttribute("data-stack", "flow");
  await expect(page.locator(".services__card").first()).toHaveCSS("opacity", "1");
  await expect(page.locator(".services__card").first()).toHaveCSS("transform", "none");
});

test("services heading and arrow shrink as the first card approaches", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl("home", "bg"));
  const first = page.locator(".services__card").first();
  await first.evaluate((card) => window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - innerHeight * .55));
  const result = () => page.evaluate(() => ({
    headingScale: new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".services__heading-inner h2")!).transform).a,
    arrowScale: new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".services__arrow-wrap")!).transform).a,
    headingOpacity: Number(getComputedStyle(document.querySelector(".services__heading-stage")!).opacity),
  }));
  await expect.poll(async () => (await result()).headingScale).toBeLessThan(.95);
  expect((await result()).arrowScale).toBeLessThan(.95);
  expect((await result()).headingOpacity).toBeGreaterThanOrEqual(.5);
});

test("mobile spacing and service hover follow the shared design", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl("home", "bg"));
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return {
      gap: box(".services__heading-inner h2").top - box(".intro__card:last-child").bottom,
      sectionArrow: box(".services__arrow-wrap").width,
      featureArrow: box(".services__feature svg:last-child").width,
      ctaArrow: box(".services__learn-more svg").width,
    };
  });
  expect(layout.gap).toBeGreaterThanOrEqual(140);
  expect(layout.gap).toBeLessThanOrEqual(165);
  expect(layout.sectionArrow).toBeLessThanOrEqual(64);
  expect(layout.featureArrow).toBeLessThanOrEqual(18);
  expect(layout.ctaArrow).toBeLessThanOrEqual(20);
  const feature = page.locator(".services__feature").first();
  const lime = await feature.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-lime)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await feature.hover();
  await expect(feature).toHaveCSS("color", lime);
  await expect(feature).toHaveCSS("border-color", lime);
});

test("service cards remain readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(pageUrl("home", "bg"));
  await expect(page.locator(".services__card")).toHaveCount(4);
  await expect(page.locator(".services__cards")).toHaveAttribute("data-stack", "flow");
  await expect(page.locator(".services__card").first()).toHaveCSS("opacity", "1");
  await expect(page.locator(".services__card").first()).toHaveCSS("transform", "none");
  await context.close();
});

test("touch input does not keep service labels in the hover color", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(pageUrl("home", "bg"));
  const feature = page.locator(".services__feature").first();
  const original = await feature.evaluate((element) => getComputedStyle(element).color);
  await feature.tap();
  await expect(feature).toHaveCSS("color", original);
  await context.close();
});
