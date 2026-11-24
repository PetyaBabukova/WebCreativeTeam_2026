import { expect, test } from "@playwright/test";
import { pageUrl } from "@/lib/routing";

const about = pageUrl("about", "bg");

test("About animation runs with either motion preference and hands the logo to the header", async ({ browser }) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const phases: string[] = [];
      const times: Record<string, number> = {};
      Object.assign(window, { __aboutPhases: phases, __aboutPhaseTimes: times });
      new MutationObserver((records) => records.forEach((record) => {
        if (record.type === "attributes" && record.target instanceof HTMLElement) {
          const phase = record.target.getAttribute("data-about-phase");
          if (phase && phases.at(-1) !== phase) { phases.push(phase); times[phase] ??= performance.now(); }
        }
      })).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-about-phase"] });
    });
    await page.goto(about);
    await expect(page.locator(".about-intro")).toHaveAttribute("data-about-phase", "logo", { timeout: 9000 });
    const phases = await page.evaluate(() => (window as Window & { __aboutPhases?: string[] }).__aboutPhases ?? []);
    const order = ["counter", "swirl", "word", "propeller", "logo"];
    expect(order.map((phase) => phases.indexOf(phase))).toEqual([...order.map((phase) => phases.indexOf(phase))].sort((a, b) => a - b));
    expect(order.every((phase) => phases.includes(phase))).toBe(true);
    const times = await page.evaluate(() => (window as Window & { __aboutPhaseTimes?: Record<string, number> }).__aboutPhaseTimes ?? {});
    expect(times.logo - times.counter).toBeGreaterThanOrEqual(4000);
    expect(times.logo - times.counter).toBeLessThanOrEqual(5300);

    await page.evaluate(() => scrollTo(0, innerHeight * .6));
    await expect.poll(() => page.locator(".site-header__brand img").evaluate((image) => getComputedStyle(image).opacity)).toBe("1");
    const distances = await page.evaluate(() => {
      const real = document.querySelector(".site-header__brand img")!.getBoundingClientRect();
      const flying = document.querySelector(".about-intro__flight-logo")!.getBoundingClientRect();
      return [Math.abs(real.x - flying.x), Math.abs(real.y - flying.y), Math.abs(real.width - flying.width), Math.abs(real.height - flying.height)];
    });
    expect(Math.max(...distances)).toBeLessThanOrEqual(2);
    await context.close();
  }
});

test("the scroll cue keeps the flight and focuses the heading; the global skip dismisses it", async ({ page }) => {
  await page.goto(about);
  await page.locator(".about-scroll").click();
  await expect(page.locator("#about-title")).toBeFocused();
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-active", "");
  await expect(page.locator(".site-header__brand img")).toHaveCSS("opacity", "1");

  await page.reload();
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#about-title")).toBeFocused();
  await expect(page.locator(".site-page--about")).not.toHaveAttribute("data-about-active");
});

test("a missing Canvas keeps the static logo and content usable", async ({ page }) => {
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await page.goto(about);
  await expect(page.locator(".site-page--about")).not.toHaveAttribute("data-about-active");
  await expect(page.locator(".about-intro__static-logo")).toHaveCSS("opacity", "1");
  await expect(page.locator(".site-header__brand img")).toHaveCSS("opacity", "1");
  await expect(page.locator("#about-title")).toBeAttached();
});

test("a failed logo request leaves a readable brand fallback", async ({ page }) => {
  await page.route("**/logo_2026_DARK_HORIZONTAL.svg", (route) => route.abort());
  await page.goto(about);
  await expect(page.locator(".site-page--about")).not.toHaveAttribute("data-about-active");
  await expect(page.locator(".about-intro__logo-fallback")).toBeVisible();
  await expect(page.locator("#about-title")).toBeAttached();
});

test("a first visitor still sees the brand fallback if the logo fails before consent", async ({ page, context }) => {
  await context.clearCookies();
  await page.route("**/logo_2026_DARK_HORIZONTAL.svg", (route) => route.abort());
  await page.goto(about);
  await expect(page.locator(".cookie-modal")).toHaveAttribute("open", "");
  await expect(page.locator(".about-intro__logo-fallback")).toBeVisible();
});

test("a deep link opens the content without starting the intro", async ({ page }) => {
  await page.goto(`${about}#about-title`);
  await expect(page.locator(".site-page--about")).not.toHaveAttribute("data-about-active");
  await expect(page.locator(".site-header__brand img")).toHaveCSS("opacity", "1");
  await expect(page.locator("#about-title")).toBeInViewport();
});

test("the static About page and anchors work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(about);
  await expect(page.locator(".about-intro__static-logo")).toHaveCSS("opacity", "1");
  await expect(page.locator(".site-header__brand img")).toHaveCSS("opacity", "1");
  await page.locator(".about-scroll").click();
  await expect(page).toHaveURL(/#about-title$/);
  await expect(page.locator("#about-title")).toBeFocused();
  await expect(page.locator("#about-title")).toBeInViewport();
  await context.close();
});

test("early scroll and header focus leave a usable logo at mobile and tablet widths", async ({ page }) => {
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(about);
    await expect(page.locator(".about-intro")).toHaveAttribute("data-about-phase", "counter", { timeout: 5000 });
    await page.evaluate(() => scrollTo(0, innerHeight * .3));
    await expect(page.locator(".about-intro")).toHaveAttribute("data-about-phase", "logo");
    await page.evaluate(() => scrollTo(0, innerHeight * .6));
    await expect.poll(() => page.locator(".site-header__brand img").evaluate((image) => getComputedStyle(image).opacity)).toBe("1");
    const maxDistance = await page.evaluate(() => {
      const real = document.querySelector(".site-header__brand img")!.getBoundingClientRect();
      const flying = document.querySelector(".about-intro__flight-logo")!.getBoundingClientRect();
      return Math.max(Math.abs(real.x - flying.x), Math.abs(real.y - flying.y), Math.abs(real.width - flying.width), Math.abs(real.height - flying.height));
    });
    expect(maxDistance).toBeLessThanOrEqual(2);
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator(".site-menu > summary").focus();
    await expect(page.locator(".site-page--about")).not.toHaveAttribute("data-about-active");
    await expect(page.locator(".about-intro__flight-logo")).toHaveCSS("opacity", "0");
  }
});

test("client navigation starts About and leaving it restores the next page header", async ({ page }) => {
  await page.goto(pageUrl("home", "bg"));
  await page.locator(".site-menu > summary").click();
  await page.locator(`.site-menu a[href="${about}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${about}$`));
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-active");
  await page.locator(".site-header__brand").click();
  await expect(page).toHaveURL(new RegExp(`${pageUrl("home", "bg")}$`));
  await expect(page.locator(".site-header__brand img")).toHaveCSS("opacity", "1");
});

test("the first-visit consent dialog lets the intro begin after the choice", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(about, { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-about-boot"))).toBe(false);
  await expect(page.locator(".cookie-modal")).toHaveAttribute("open", "");
  await page.waitForTimeout(4000);
  await expect(page.locator(".site-page--about")).not.toHaveAttribute("data-about-active");
  await expect(page.locator(".about-intro__counter")).toHaveCSS("display", "none");
  await page.locator("#cookie-modal-controls button").last().click();
  await expect(page.locator(".about-intro")).toHaveAttribute("data-about-phase", "counter", { timeout: 4000 });
  await expect(page.locator(".about-intro")).toHaveAttribute("data-about-phase", "logo", { timeout: 8000 });
  await expect(page.locator(".about-scroll")).toBeFocused();
});

test("the arrow and caption are usable from the first frame and turn with scroll", async ({ page }) => {
  await page.goto(about, { waitUntil: "domcontentloaded" });
  const cue = page.locator(".about-scroll");
  await expect(cue).toBeVisible();
  await expect(cue).toHaveAccessibleName("Скролни надолу");
  const first = await page.locator(".about-scroll__arrow").evaluate((node) => getComputedStyle(node).transform);
  await page.evaluate(() => scrollTo(0, innerHeight * .6));
  await expect.poll(() => page.locator(".about-scroll__arrow").evaluate((node) => getComputedStyle(node).transform)).not.toBe(first);
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(() => page.locator(".about-scroll__arrow").evaluate((node) => getComputedStyle(node).transform)).toBe(first);
});

test("text scenes move horizontally with scroll and the background stays still when scroll stops", async ({ page }) => {
  await page.goto(about);
  await page.evaluate(() => document.querySelector(".about-message")?.scrollIntoView({ block: "center" }));
  const message = page.locator(".about-message").first();
  await expect(message).toBeInViewport();
  const initial = await message.evaluate((node) => getComputedStyle(node.querySelector("p")!).transform);
  await page.evaluate(() => scrollBy(0, innerHeight * .7));
  await expect.poll(() => message.evaluate((node) => getComputedStyle(node.querySelector("p")!).transform)).not.toBe(initial);
  const before = await page.locator(".about-content__scene canvas").evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(250);
  const after = await page.locator(".about-content__scene canvas").evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  expect(after).toBe(before);
});
