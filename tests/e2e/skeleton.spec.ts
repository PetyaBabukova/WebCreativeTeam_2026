import { expect, test } from "@playwright/test";
import { appConfig, testOrigin } from "../../lib/config";
import { locales, pageUrl, serviceSlugs, serviceUrl } from "../../lib/routing";

async function orbAngle(page: import("@playwright/test").Page) {
  return page.locator(".hero-orb__spin").evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
  });
}

function angleDifference(first: number, second: number) {
  return Math.abs(((second - first + 540) % 360) - 180);
}

test("SSR serves both locales without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const locale of locales) {
    const response = await page.goto(new URL(pageUrl("home", locale), testOrigin).href);
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".hero__headline-line--0")).toHaveCSS("opacity", "1");
    await expect(page.locator(".hero__lede")).toHaveCSS("opacity", "1");
    await expect(page.locator(".intro__title")).toHaveCSS("opacity", "1");
    await expect(page.locator(".intro__cards li")).toHaveCount(3);
    await expect(page.locator("#services h2")).toHaveText(locale === "bg" ? "Нашите услуги" : "Our Services");
    await expect(page.locator(".services__card")).toHaveCount(5);
  }
  await context.close();
});

test("navigation links to all five service pages in both languages", async ({ page }) => {
  for (const locale of locales) {
    await page.goto(pageUrl("home", locale));
    await page.locator(".site-menu > summary").click();
    await page.locator(".site-menu__services summary").click();
    const links = page.locator(".site-menu__submenu a");
    await expect(links).toHaveCount(serviceSlugs.length);
    for (const [index, slug] of serviceSlugs.entries()) {
      await expect(links.nth(index)).toHaveAttribute("href", serviceUrl(slug, locale));
    }
    const selectedLabel = await links.nth(2).innerText();
    await links.nth(2).click();
    await expect(page).toHaveURL(new RegExp(serviceUrl("digital-marketing", locale) + "$"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(selectedLabel);
  }
});

test("Blog is third in the menu and its language switch keeps the page", async ({ page }) => {
  for (const locale of locales) {
    await page.goto(pageUrl("home", locale));
    await page.locator(".site-menu > summary").click();
    const links = page.locator(".site-menu__panel > nav:first-child > a, .site-menu__panel > nav:first-child > .site-menu__services > a");
    await expect(links).toHaveCount(6);
    await expect(links.nth(2)).toHaveAttribute("href", pageUrl("blog", locale));
    await links.nth(2).click();
    await expect(page).toHaveURL(new RegExp(pageUrl("blog", locale) + "$"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale === "bg" ? "Блог" : "Blog");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(pageUrl("blog", locale) + "$"));
    for (const language of locales) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute("href", new RegExp(pageUrl("blog", language) + "$"));
    }
    await page.locator(".site-menu > summary").click();
    await expect(page.locator(`.site-menu__languages a[lang="${locale === "bg" ? "en" : "bg"}"]`)).toHaveAttribute("href", pageUrl("blog", locale === "bg" ? "en" : "bg"));
  }
});

test("FAQs follows Blog and keeps the locale", async ({ page }) => {
  for (const locale of locales) {
    await page.goto(pageUrl("home", locale));
    await page.locator(".site-menu > summary").click();
    const links = page.locator(".site-menu__panel > nav:first-child > a, .site-menu__panel > nav:first-child > .site-menu__services > a");
    await expect(links.nth(3)).toHaveAttribute("href", pageUrl("faq", locale));
    await expect(links.nth(4)).toHaveAttribute("href", pageUrl("about", locale));
    await links.nth(3).click();
    await expect(page).toHaveURL(new RegExp(pageUrl("faq", locale) + "$"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale === "bg" ? "Въпроси" : "FAQs");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(pageUrl("faq", locale) + "$"));
    for (const language of locales) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute("href", new RegExp(pageUrl("faq", language) + "$"));
    }
    await page.locator(".site-menu > summary").click();
    await expect(page.locator(`.site-menu__languages a[lang="${locale === "bg" ? "en" : "bg"}"]`)).toHaveAttribute("href", pageUrl("faq", locale === "bg" ? "en" : "bg"));
  }
});

test("bare URLs use the current locale until another locale is chosen", async ({ page }) => {
  const firstVisit = await page.context().request.get(new URL("/", testOrigin).href, { maxRedirects: 0 });
  expect(firstVisit.status()).toBe(307);
  expect(firstVisit.headers().location).toBe(pageUrl("home", "bg"));
  await page.goto(pageUrl("home", "en"));
  await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === appConfig.localeCookie.name)?.value).toBe("en");
  const redirect = await page.context().request.get(new URL("/faq?from=email", testOrigin).href, { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers().location).toBe(`${pageUrl("faq", "en")}?from=email`);
  expect(redirect.headers()["cache-control"]).toBe("private, no-store");
  await page.goto("/faq");
  expect(new URL(page.url()).pathname).toBe(pageUrl("faq", "en"));
  await page.goto("/");
  expect(new URL(page.url()).pathname).toBe(pageUrl("home", "en"));
  await page.locator(".site-menu > summary").click();
  await page.locator('.site-menu__languages a[lang="bg"]').click();
  expect(new URL(page.url()).pathname).toBe(pageUrl("home", "bg"));
  await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === appConfig.localeCookie.name)?.value).toBe("bg");
  await page.goBack();
  expect(new URL(page.url()).pathname).toBe(pageUrl("home", "en"));
  await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === appConfig.localeCookie.name)?.value).toBe("en");
  await page.goto("/faq");
  expect(new URL(page.url()).pathname).toBe(pageUrl("faq", "en"));
});

test("service submenu opens on mouse hover and closes when the pointer leaves", async ({ page }) => {
  await page.goto(pageUrl("home", "bg"));
  await page.locator(".site-menu > summary").click();
  const services = page.locator(".site-menu__services");
  await services.locator(":scope > a").hover();
  await expect(services.locator(":scope > details")).toHaveAttribute("open", "");
  await services.locator(".site-menu__submenu a").first().hover();
  await expect(services.locator(":scope > details")).toHaveAttribute("open", "");
  await page.locator('.site-menu__panel > nav a[href="/about/bg"]').hover();
  await expect(services.locator(":scope > details")).not.toHaveAttribute("open", "");
});

test("mobile service submenu is already open when the menu opens", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(pageUrl("home", "bg"));
  await page.locator(".site-menu > summary").tap();
  const services = page.locator(".site-menu__services");
  await expect(services.locator(":scope > details")).toHaveAttribute("open", "");
  await expect(services.locator(".site-menu__submenu a")).toHaveCount(serviceSlugs.length);
  await context.close();
});

test("all service placeholders respond without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const locale of locales) {
    for (const slug of serviceSlugs) {
      const response = await page.goto(serviceUrl(slug, locale));
      expect(response?.status(), serviceUrl(slug, locale)).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(serviceUrl(slug, locale) + "$"));
      for (const language of locales) {
        await expect(page.locator(`link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute("href", new RegExp(serviceUrl(slug, language) + "$"));
      }
    }
  }
  await context.close();
});

test("unknown service and incomplete language URLs return 404", async ({ request }) => {
  for (const path of ["/services/unknown/bg", "/services/ai-automation/fr", "/services/ai-automation"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("service navigation works without JavaScript and Escape closes menu layers", async ({ browser, page }) => {
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noJs.newPage();
  await staticPage.goto(pageUrl("home", "bg"));
  await staticPage.locator(".site-menu > summary").click();
  await staticPage.locator(".site-menu__services summary").click();
  await staticPage.locator(".site-menu__submenu a").first().click();
  await expect(staticPage).toHaveURL(new RegExp(serviceUrl("ai-automation", "bg") + "$"));
  await noJs.close();

  await page.goto(pageUrl("home", "bg"));
  await page.locator(".site-menu > summary").click();
  await page.locator(".site-menu__services summary").click();
  await page.locator(".site-menu__services summary").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".site-menu__services details")).not.toHaveAttribute("open", "");
  await expect(page.locator(".site-menu")).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.locator(".site-menu")).not.toHaveAttribute("open", "");
});

test("About links to service pages and language switch keeps the service", async ({ page }) => {
  await page.goto(pageUrl("about", "en"));
  await page.locator(".site-menu > summary").click();
  await page.locator(".site-menu__services summary").click();
  await page.locator(".site-menu__submenu a").last().click();
  await expect(page).toHaveURL(new RegExp(serviceUrl("web-solutions", "en") + "$"));
  await page.locator(".site-menu > summary").click();
  await expect(page.locator('.site-menu__languages a[lang="bg"]')).toHaveAttribute("href", serviceUrl("web-solutions", "bg"));
  await page.locator('.site-menu__languages a[lang="bg"]').click();
  await expect(page).toHaveURL(new RegExp(serviceUrl("web-solutions", "bg") + "$"));
});

test("hero uses the mobile image and keeps the background static", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl("home", "bg"));
  const source = await page.locator(".hero__background").evaluate((image: HTMLImageElement) => image.currentSrc);
  expect(source).toContain("background-mobile");
  await expect(page.locator(".hero__stage")).toHaveCSS("position", "fixed");
  await expect(page.locator(".hero-orb")).toHaveCount(1);
  const mobileOrder = await page.evaluate(() => {
    const heading = document.querySelector(".hero h1")!.getBoundingClientRect();
    const orb = document.querySelector(".hero-orb")!.getBoundingClientRect();
    const lede = document.querySelector(".hero__lede")!.getBoundingClientRect();
    const arrow = document.querySelector(".hero__arrow")!.getBoundingClientRect();
    return orb.top >= heading.bottom && lede.top >= orb.bottom && arrow.top >= lede.top;
  });
  expect(mobileOrder).toBe(true);
  await expect(page.locator("#services")).toHaveCount(1);
  await expect(page.locator("#projects, #contact")).toHaveCount(0);
  await expect(page.locator(".hero__actions")).toHaveCount(0);
});

test("intro enters over the same fixed background with Motion in both locales", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1672, height: 940 });
  for (const locale of locales) {
    await page.goto(pageUrl("home", locale));
    const intro = page.locator(".intro");
    const title = page.locator(".intro__title");
    const cards = page.locator(".intro__card");
    const stage = page.locator(".hero__stage");
    await expect(page.locator(".site-home picture")).toHaveCount(1);
    await expect(cards).toHaveCount(3);
    await expect(title).toContainText(locale === "bg" ? "Да имаш значение — е" : "Making an impact is");
    await expect(cards.nth(2)).toContainText(locale === "bg" ? "РАЗВИТИЕ" : "MOMENTUM");
    await expect(title).toHaveCSS("opacity", "0");
    const stageBefore = await stage.boundingBox();
    await intro.scrollIntoViewIfNeeded();
    await expect(title).toHaveCSS("opacity", "1", { timeout: 5000 });
    await expect(cards.last()).toHaveCSS("opacity", "1", { timeout: 5000 });
    const stageAfter = await stage.boundingBox();
    expect(stageAfter?.y).toBeCloseTo(stageBefore!.y, 0);
    const introPaintsAboveStage = await title.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return Boolean(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest(".intro"));
    });
    expect(introPaintsAboveStage).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footerPaintsAboveStage = await page.locator(".site-footer").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return Boolean(document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, innerHeight - box.top - 1))?.closest(".site-footer"));
    });
    expect(footerPaintsAboveStage).toBe(true);
  }
});

test("intro cards remain readable without horizontal overflow", async ({ page }) => {
  for (const width of [320, 390, 761, 1024, 1150, 1200, 1280, 1672]) {
    await page.setViewportSize({ width, height: 940 });
    for (const locale of locales) {
      await page.goto(pageUrl("home", locale));
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        titles: [...document.querySelectorAll<HTMLElement>(".intro__card-title")].map((title) => title.scrollWidth - title.clientWidth),
        columns: getComputedStyle(document.querySelector(".intro__cards")!).gridTemplateColumns.split(" ").length,
      }));
      expect(layout.overflow, `${locale} at ${width}px horizontal overflow`).toBe(false);
      expect(Math.max(...layout.titles), `${locale} at ${width}px card title overflow`).toBeLessThanOrEqual(1);
      expect(layout.columns, `${locale} at ${width}px card columns`).toBe(width < 1200 ? 1 : 3);
    }
  }
});

test("intro stays visible on a restored deep link", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${pageUrl("home", "bg")}#intro`);
  await expect(page.locator(".intro__title")).toHaveCSS("opacity", "1");
  await page.reload();
  await expect(page.locator(".intro__title")).toHaveCSS("opacity", "1");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("services title and shared arrow yield to the first card and return on reverse scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto(pageUrl("home", "bg"));
  const section = page.locator("#services");
  const title = section.locator("h2");
  const stage = section.locator(".services__heading-stage");
  const arrow = section.locator(".services__arrow");
  await page.locator(".services__card").first().evaluate((card) => window.scrollBy(0, card.getBoundingClientRect().top - innerHeight));
  const clearOfHeader = await page.evaluate(() => document.querySelector(".services__heading-inner h2")!.getBoundingClientRect().top >= document.querySelector(".site-header__actions")!.getBoundingClientRect().bottom);
  expect(clearOfHeader).toBe(true);
  await expect(stage).toHaveCSS("opacity", "1");
  const arrowAngle = () => arrow.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
  });
  await expect.poll(arrowAngle).toBe(45);
  await page.locator(".services__card").first().evaluate((card) => window.scrollBy(0, card.getBoundingClientRect().top - innerHeight * .25));
  await expect(stage).toHaveCSS("opacity", "0");
  await expect.poll(arrowAngle).toBe(-45);
  await page.locator(".services__card").first().evaluate((card) => window.scrollBy(0, card.getBoundingClientRect().top - innerHeight));
  await expect(stage).toHaveCSS("opacity", "1");
  await expect.poll(arrowAngle).toBe(45);
  await expect(title).toHaveText("Нашите услуги");
});

test("services follows intro more closely and shows the revised card copy", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto(pageUrl("home", "bg"));
  await page.evaluate(() => document.fonts.ready);
  const gap = await page.evaluate(() => {
    const introBottom = Math.max(...[...document.querySelectorAll(".intro__card")].map((card) => card.getBoundingClientRect().bottom));
    return document.querySelector(".services__heading-inner h2")!.getBoundingClientRect().top - introBottom;
  });
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThan(360);
  const card = page.locator(".services__card").first();
  await expect(card.locator(".services__eyebrow")).toHaveText("Спри да губиш време");
  await expect(card.locator(".services__feature")).toContainText(["Бизнес процеси", "AI асистенти", "AI интеграции"]);
  await expect(card.locator(".services__learn-more")).toHaveText("Автоматизирай");
});

test("services artwork stays above readable text on narrow screens", async ({ page }) => {
  for (const locale of locales) {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(pageUrl("home", locale));
    const card = page.locator(".services__card").first();
    const layout = await card.evaluate((element) => {
      const image = element.querySelector(".services__image")!.getBoundingClientRect();
      const content = element.querySelector(".services__card-content")!.getBoundingClientRect();
      return { imageBottom: image.bottom, contentTop: content.top, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(layout.contentTop).toBeGreaterThanOrEqual(layout.imageBottom - 1);
    expect(layout.overflow).toBe(false);
    await expect(card.locator(".services__feature")).toHaveCount(3);
    await expect(card.locator(".services__feature svg")).toHaveCount(6);
  }
});

test("scroll arrow is centered beneath the description and orb with visible space", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 600, height: 900 }, { width: 1536, height: 730 }, { width: 2560, height: 1300 }]) {
    await page.setViewportSize(viewport);
    for (const locale of locales) {
      await page.goto(pageUrl("home", locale));
      await expect(page.locator(".hero__lede")).toHaveCSS("opacity", "1", { timeout: 5000 });
      const layout = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const center = (rect: DOMRect) => rect.left + rect.width / 2;
        const arrow = box(".hero__arrow");
        const description = box(".hero__description");
        const orb = box(".hero-orb");
        const polygon = box(".hero__arrow polygon");
        return {
          arrowCenter: center(arrow), descriptionCenter: center(description), orbCenter: center(orb),
          orbToTextGap: description.top - orb.bottom,
          textToArrowGap: polygon.top - description.bottom,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      const label = `${locale} at ${viewport.width}x${viewport.height}`;
      expect(Math.abs(layout.arrowCenter - layout.descriptionCenter), label).toBeLessThanOrEqual(2);
      expect(Math.abs(layout.arrowCenter - layout.orbCenter), label).toBeLessThanOrEqual(2);
      expect(layout.orbToTextGap, label).toBeGreaterThanOrEqual(40);
      expect(Math.abs(layout.orbToTextGap - layout.textToArrowGap), label).toBeLessThanOrEqual(5);
      expect(layout.horizontalOverflow, label).toBe(false);
    }
  }
});

test("the scroll arrow turns from pointing left to pointing down while scrolling, and back", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 730 });
  await page.goto(pageUrl("home", "bg"));
  const arrowAppearance = await page.locator(".hero__arrow").evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-primary)";
    document.body.append(probe);
    const expectedColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      fill: getComputedStyle(element.querySelector("polygon")!).fill,
      expectedColor,
      viewBox: element.getAttribute("viewBox"),
      polygonCount: element.querySelectorAll("polygon").length,
    };
  });
  expect(arrowAppearance.fill).toBe(arrowAppearance.expectedColor);
  expect(arrowAppearance.viewBox).toBe("0 0 774.96 774.68");
  expect(arrowAppearance.polygonCount).toBe(1);
  await page.evaluate(() => { const spacer = document.createElement("div"); spacer.style.height = "200vh"; document.body.append(spacer); });
  const arrowAngle = () => page.locator(".hero__arrow").evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
  });
  // The SVG is drawn pointing down-left: 45deg points left, -45deg points down.
  expect(await arrowAngle()).toBe(45);
  await page.evaluate(() => window.scrollTo(0, innerHeight * .2));
  await expect.poll(arrowAngle).toBe(0);
  await page.evaluate(() => window.scrollTo(0, innerHeight));
  await expect.poll(arrowAngle).toBe(-45);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(arrowAngle).toBe(45);
});

test("paused orb responds more strongly to hover and relaxes when resumed", async ({ page }) => {
  await page.goto(pageUrl("home", "en"));
  await expect(page.locator(".hero-orb__entrance")).toHaveCSS("opacity", "1", { timeout: 4000 });
  await expect.poll(() => orbAngle(page)).toBeGreaterThan(2);
  const entrance = page.locator(".hero-orb__entrance");
  const bounds = await entrance.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * .7, bounds!.y + bounds!.height * .35);
  const tiltStrength = () => page.locator(".hero-orb__tilt").evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.abs(matrix.m13) + Math.abs(matrix.m23);
  });
  await expect.poll(tiltStrength).toBeGreaterThan(.08);
  const rotatingTilt = await tiltStrength();
  const control = page.getByRole("button", { name: "Pause logo rotation" });
  await control.focus();
  await control.press("Enter");
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await expect.poll(tiltStrength).toBeGreaterThan(rotatingTilt * 1.7);
  await page.mouse.move(0, 0);
  await expect.poll(tiltStrength).toBeLessThan(.01);
  await page.mouse.move(bounds!.x + bounds!.width * .7, bounds!.y + bounds!.height * .35);
  await expect.poll(tiltStrength).toBeGreaterThan(rotatingTilt * 1.7);
  await control.press("Space");
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await expect.poll(tiltStrength).toBeLessThan(rotatingTilt * 1.2);
});

test("footer routes, legal dialogs and incomplete integrations remain honest", async ({ page }) => {
  for (const locale of locales) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pageUrl("contacts", locale));
    const footer = page.locator(".site-footer");
    const navigation = footer.getByRole("navigation", { name: locale === "bg" ? "Навигация във футъра" : "Footer navigation" });
    await expect(navigation.getByRole("link")).toHaveCount(10);
    await expect(navigation.getByRole("link", { name: locale === "bg" ? "Контакти" : "Contact" })).toHaveAttribute("href", pageUrl("contacts", locale));
    await expect(footer.locator(".site-footer__social-icons a")).toHaveCount(0);
    await expect(footer.locator(".site-footer__email-row button")).toBeDisabled();
    const privacy = footer.locator(".site-footer__bottom-links button").first();
    await privacy.focus();
    await privacy.press("Enter");
    const dialog = footer.getByRole("dialog", { name: locale === "bg" ? "Политиката за поверителност" : "Privacy Policy" });
    await expect(dialog).toBeVisible();
    await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(privacy).toBeFocused();
    for (const width of [390, 768, 900, 1100, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const grid = await footer.locator(".site-footer__grid").boundingBox();
      const social = await footer.locator(".site-footer__social").boundingBox();
      expect(grid && social && social.x + social.width <= grid.x + grid.width + 1).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(page.getByRole("link", { name: appConfig.contactEmail })).toHaveAttribute("href", `mailto:${appConfig.contactEmail}`);
  }
});

test("header CTA sits left of the menu and links to the contact page", async ({ page }) => {
  for (const locale of locales) {
    for (const width of [1536, 390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(pageUrl("home", locale));
      const cta = page.locator(".site-header__cta");
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute("href", pageUrl("contacts", locale));
      const appearance = await cta.evaluate((element) => {
        const style = getComputedStyle(element);
        const probe = document.createElement("span");
        probe.style.color = "var(--color-primary)";
        document.body.append(probe);
        const expectedColor = getComputedStyle(probe).color;
        probe.remove();
        return {
          background: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          borderWidth: style.borderWidth,
          borderStyle: style.borderStyle,
          color: style.color,
          expectedColor,
          radius: parseFloat(style.borderTopLeftRadius) / parseFloat(style.fontSize),
          paddingBlock: parseFloat(style.paddingTop) / parseFloat(style.fontSize),
          paddingInline: parseFloat(style.paddingLeft) / parseFloat(style.fontSize),
          height: element.getBoundingClientRect().height,
        };
      });
      expect(appearance.background).toBe("rgba(0, 0, 0, 0)");
      expect(appearance.backgroundImage).toBe("none");
      expect(appearance.borderWidth).toBe("1px");
      expect(appearance.borderStyle).toBe("solid");
      expect(appearance.color).toBe(appearance.borderColor);
      expect(appearance.color).toBe(appearance.expectedColor);
      await expect(page.locator(".hero__arrow polygon")).toHaveCSS("fill", appearance.expectedColor);
      expect(appearance.radius).toBeCloseTo(.6, 1);
      expect(appearance.paddingBlock).toBeCloseTo(.4, 1);
      expect(appearance.paddingInline).toBeCloseTo(1, 1);
      expect(appearance.height).toBeGreaterThanOrEqual(44);
      const menuColor = await page.locator(".site-menu > summary").evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, borderColor: style.borderColor };
      });
      expect(menuColor.color).toBe(appearance.expectedColor);
      expect(menuColor.borderColor).toBe(appearance.expectedColor);
      const hoverColor = await cta.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-lime)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      await cta.hover();
      await expect(cta).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(cta).toHaveCSS("color", hoverColor);
      await expect(cta).toHaveCSS("border-color", hoverColor);
      const summary = page.locator(".site-menu > summary");
      await summary.hover();
      await expect(summary).toHaveCSS("color", hoverColor);
      await expect(summary).toHaveCSS("border-color", hoverColor);
      await expect(page.locator(".site-menu__bars span").first()).toHaveCSS("background-color", hoverColor);
      await page.mouse.move(width / 2, 450);
      await expect(cta).toHaveCSS("color", appearance.expectedColor);
      await expect(summary).toHaveCSS("color", appearance.expectedColor);
      const layout = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const header = document.querySelector(".site-header__inner")!;
        return { brandRight: box(".site-header__brand").right, ctaLeft: box(".site-header__cta").left, ctaRight: box(".site-header__cta").right, menuLeft: box(".site-menu").left, overflow: header.scrollWidth > header.clientWidth };
      });
      expect(layout.ctaRight, `${locale} at ${width}px`).toBeLessThanOrEqual(layout.menuLeft);
      expect(layout.brandRight, `${locale} at ${width}px`).toBeLessThanOrEqual(layout.ctaLeft);
      expect(layout.overflow, `${locale} at ${width}px`).toBe(false);
    }
    await page.setViewportSize({ width: 359, height: 800 });
    await page.goto(pageUrl("home", locale));
    await expect(page.locator(".site-header__cta")).toBeHidden();
  }
});

test("orange menu icon turns into an X when opened with the keyboard", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(pageUrl("home", "bg"));
  const menu = page.locator(".site-menu");
  const summary = menu.locator(":scope > summary");
  const strokes = menu.locator(".site-menu__bars span");
  await expect(strokes).toHaveCount(2);
  const menuColors = await summary.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-primary)";
    document.body.append(probe);
    const expectedColor = getComputedStyle(probe).color;
    probe.remove();
    return { color: getComputedStyle(element).color, borderColor: getComputedStyle(element).borderColor, expectedColor };
  });
  expect(menuColors.color).toBe(menuColors.expectedColor);
  expect(menuColors.borderColor).toBe(menuColors.expectedColor);
  await expect(strokes.first()).toHaveCSS("transition-duration", "0.3s");
  await expect(summary).toHaveCSS("padding-top", "0px");
  await expect(summary).toHaveCSS("padding-left", "0px");
  await summary.focus();
  await summary.press("Enter");
  await expect(menu).toHaveAttribute("open", "");
  const strokeTransforms = () => strokes.evaluateAll((elements) => elements.map((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { angle: Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI), verticalOffset: Math.round(matrix.f) };
  }));
  await expect.poll(strokeTransforms).toEqual([{ angle: 45, verticalOffset: 2 }, { angle: -45, verticalOffset: -2 }]);
  await summary.press("Space");
  await expect(menu).not.toHaveAttribute("open");
  await expect.poll(strokeTransforms).toEqual([{ angle: 0, verticalOffset: 0 }, { angle: 0, verticalOffset: 0 }]);
});

test("touch input does not leave the controls in the green hover state", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(pageUrl("home", "bg"));
  const orange = await page.locator(".hero__arrow polygon").evaluate((element) => getComputedStyle(element).fill);
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
  const summary = page.locator(".site-menu > summary");
  await summary.tap();
  await expect(page.locator(".site-menu")).toHaveAttribute("open", "");
  await expect(summary).toHaveCSS("color", orange);
  await expect(page.locator(".site-header__cta")).toHaveCSS("color", orange);
  await context.close();
});

test("header CTA and menu stay visible while the logo scrolls away", async ({ page }) => {
  for (const width of [390, 1536]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(pageUrl("home", "bg"));
    const actions = page.locator(".site-header__actions");
    const cta = page.locator(".site-header__cta");
    const summary = page.locator(".site-menu > summary");
    await expect(actions).toHaveCSS("position", "fixed");
    const initialTop = (await actions.boundingBox())!.y;
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "200vh";
      document.body.append(spacer);
      window.scrollTo(0, innerHeight);
    });
    await expect.poll(async () => (await actions.boundingBox())!.y).toBeCloseTo(initialTop, 0);
    await expect(cta).toBeInViewport();
    await expect(summary).toBeInViewport();
    await expect(page.locator(".site-header__brand")).not.toBeInViewport();
    await summary.click();
    await expect(page.locator(".site-menu")).toHaveAttribute("open", "");
    await expect(page.locator(".site-menu__panel")).toBeVisible();
  }
});

test("Motion completes the hero entrance after mount", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(pageUrl("home", "en"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const motionState = await page.evaluate(() => {
    const headline = document.querySelector<HTMLElement>(".hero__headline-line--0")!;
    const lede = document.querySelector<HTMLElement>(".hero__lede")!;
    const orb = document.querySelector<HTMLElement>(".hero-orb__entrance")!;
    const headlineStyle = getComputedStyle(headline);
    const ledeStyle = getComputedStyle(lede);
    const orbStyle = getComputedStyle(orb);
    return {
      headlineAnimation: headlineStyle.animationName,
      ledeAnimation: ledeStyle.animationName,
      headlineOpacity: headlineStyle.opacity,
      ledeOpacity: ledeStyle.opacity,
      orbOpacity: orbStyle.opacity,
    };
  });
  expect(motionState.headlineAnimation).toBe("none");
  expect(motionState.ledeAnimation).toBe("none");
  expect(motionState.headlineOpacity).toBe("1");
  expect(motionState.ledeOpacity).toBe("1");
  expect(motionState.orbOpacity).toBe("1");
  const firstRotation = await page.locator(".hero-orb__spin").evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(1000);
  const secondRotation = await page.locator(".hero-orb__spin").evaluate((element) => getComputedStyle(element).transform);
  expect(secondRotation).not.toBe(firstRotation);
});

test("Motion exposes an observable hero transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(pageUrl("home", "en"), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const opacity = Number(getComputedStyle(document.querySelector(".hero-orb__entrance")!).opacity);
    return opacity > 0 && opacity < 1;
  }, { timeout: 4000 });
});

test("system reduced motion still shows the entrance and continuous rotation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(pageUrl("home", "bg"), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const entrance = document.querySelector<HTMLElement>(".hero-orb__entrance")!;
    const opacity = Number(getComputedStyle(entrance).opacity);
    return opacity > 0 && opacity < 1 && getComputedStyle(entrance).transform !== "none";
  }, { timeout: 4000 });
  await expect(page.locator(".hero-orb__entrance")).toHaveCSS("opacity", "1", { timeout: 4000 });
  await page.waitForFunction(() => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".hero-orb__spin")!).transform);
    return Math.abs(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) > 5;
  }, { timeout: 4000 });
  const before = await orbAngle(page);
  await page.waitForTimeout(1000);
  expect(angleDifference(before, await orbAngle(page))).toBeGreaterThan(8);
});

test("keyboard pause freezes the orb at its current angle and resumes it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(pageUrl("home", "bg"));
  const control = page.getByRole("button", { name: "Пауза на въртенето" });
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(2400);
  const beforePause = await orbAngle(page);
  await control.focus();
  await control.press("Enter");
  await expect(control).toHaveAttribute("aria-pressed", "true");
  const paused = await orbAngle(page);
  await page.waitForTimeout(500);
  expect(angleDifference(paused, await orbAngle(page))).toBeLessThan(1);
  expect(angleDifference(beforePause, paused)).toBeLessThan(10);
  await control.press("Space");
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1000);
  expect(angleDifference(paused, await orbAngle(page))).toBeGreaterThan(8);
  await page.goto(pageUrl("home", "en"));
  await expect(page.getByRole("button", { name: "Pause logo rotation" })).toHaveAttribute("aria-pressed", "false");
});

test("the orb retains its angle outside the viewport", async ({ page }) => {
  await page.goto(pageUrl("home", "en"));
  await page.waitForTimeout(4000);
  const beforeExit = await orbAngle(page);
  expect(angleDifference(0, beforeExit)).toBeGreaterThan(20);
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "200vh";
    document.body.append(spacer);
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect(page.locator(".hero-orb")).not.toBeInViewport();
  await page.waitForTimeout(200);
  const offscreen = await orbAngle(page);
  await page.waitForTimeout(500);
  expect(angleDifference(offscreen, await orbAngle(page))).toBeLessThan(1);
  await page.locator(".hero-orb").scrollIntoViewIfNeeded();
  await expect(page.locator(".hero-orb")).toBeInViewport();
  const resumed = await orbAngle(page);
  expect(angleDifference(offscreen, resumed)).toBeLessThan(20);
  await page.waitForTimeout(1000);
  expect(angleDifference(resumed, await orbAngle(page))).toBeGreaterThan(8);
});

test("headline and CTAs remain within the hero on common viewports", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    for (const locale of locales) {
      await page.goto(pageUrl("home", locale));
      const withinHero = await page.evaluate(() => {
        const hero = document.querySelector(".hero")!.getBoundingClientRect();
        const heading = document.querySelector(".hero h1")!.getBoundingClientRect();
        const lede = document.querySelector(".hero__lede")!.getBoundingClientRect();
        return heading.left >= hero.left && heading.right <= hero.right && lede.left >= hero.left && lede.right <= hero.right && lede.bottom <= hero.bottom;
      });
      expect(withinHero, `${locale} at ${viewport.width}px`).toBe(true);
    }
  }
});

test("desktop first scene is fully visible without scrolling and the headline clears the right column", async ({ page }) => {
  // 1536x730 is the user's laptop (1920x1080 at 125% scaling, minus browser chrome); 2560x1300 their external monitor.
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1536, height: 730 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1300 }]) {
    await page.setViewportSize(viewport);
    for (const locale of locales) {
      await page.goto(pageUrl("home", locale));
      await expect(page.locator(".hero__lede")).toHaveCSS("opacity", "1", { timeout: 5000 });
      const layout = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const headlineRight = Math.max(...[...document.querySelectorAll(".hero__headline-line")].map((line) => {
          const range = document.createRange(); range.selectNodeContents(line);
          return range.getBoundingClientRect().right;
        }));
        const headlineSize = parseFloat(getComputedStyle(document.querySelector(".hero h1")!).fontSize);
        return { headlineRight, headlineSize, heading: box(".hero h1").bottom, orb: box(".hero-orb"), lede: box(".hero__lede"), arrow: box(".hero__arrow"), viewportHeight: innerHeight };
      });
      const label = `${locale} at ${viewport.width}x${viewport.height}`;
      for (const bottom of [layout.heading, layout.orb.bottom, layout.lede.bottom, layout.arrow.bottom]) expect(bottom, label).toBeLessThanOrEqual(layout.viewportHeight);
      const columnGap = Math.min(layout.orb.left, layout.lede.left) - layout.headlineRight;
      expect(columnGap, label).toBeGreaterThan(0);
      // The right column follows the headline at a gap proportional to its size, not pinned to the far edge.
      expect(columnGap / layout.headlineSize, label).toBeLessThanOrEqual(1.35);
      expect(layout.lede.top - layout.orb.bottom, label).toBeGreaterThanOrEqual(40);
    }
  }
});

test("API boundaries remain available", async ({ request }) => {
  const health = await request.get(appConfig.paths.health);
  expect(health.status()).toBe(200);
  expect(health.headers()["cache-control"]).toBe("no-store");
  const api = await request.get(`${appConfig.paths.api}/missing`);
  expect(api.status()).toBe(404);
  expect(await api.json()).toEqual({ error: "Not found" });
});

test("mobile headline fills the content width without overflowing", async ({ page }) => {
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const locale of ["bg", "en"] as const) {
      await page.goto(pageUrl("home", locale));
      await expect(page.locator(".hero__lede")).toHaveCSS("opacity", "1", { timeout: 5000 });
      const { container, longest } = await page.evaluate(() => {
        const h1 = document.querySelector<HTMLElement>(".hero h1")!;
        const widths = [...h1.querySelectorAll<HTMLElement>(".hero__headline-line")].map((line) => {
          const range = document.createRange(); range.selectNodeContents(line);
          return range.getBoundingClientRect().width;
        });
        return { container: h1.getBoundingClientRect().width, longest: Math.max(...widths) };
      });
      expect(longest, `${locale} @ ${width}px overflows`).toBeLessThanOrEqual(container + 1);
      expect(longest / container, `${locale} @ ${width}px does not fill the width`).toBeGreaterThan(.95);
    }
  }
});
