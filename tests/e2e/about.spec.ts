import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { appConfig } from "@/lib/config";
import { readFileSync } from "node:fs";
import { pageUrl } from "@/lib/routing";

const about = pageUrl("about", "bg");
// The copy is read from the locale files directly: Playwright cannot import JSON through lib/messages.
const aboutCopy = (locale: "bg" | "en") => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).about as { messages: string[]; introLead: string[]; introTail: string[]; accents: { text?: string; tone: string }[][] };
const root = (page: Page) => page.locator(".site-page--about");
const liveTimeout = appConfig.aboutIntro.deadlineMilliseconds + 4000;
// The pause control is hidden until keyboard focus: a 1px clipped box.
const hiddenUntilFocus = async (page: Page) => (await page.locator(".about-scene__toggle").boundingBox())!.width <= 1;

// Records every value of data-about-intro with its time, from the first script on the page.
async function recordPhases(page: Page) {
  await page.addInitScript(() => {
    const phases: [string, number][] = [];
    Object.assign(window, { __aboutPhases: phases });
    new MutationObserver(() => {
      const phase = document.querySelector(".site-page--about")?.getAttribute("data-about-intro");
      if (phase && phases.at(-1)?.[0] !== phase) phases.push([phase, performance.now()]);
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-about-intro"] });
  });
  return () => page.evaluate(() => (window as Window & { __aboutPhases?: [string, number][] }).__aboutPhases ?? []);
}

test("the preloader counts in the lower left, wipes with a W and reveals the particle hero", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const phases = await recordPhases(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "preloading");
  const counter = await page.locator(".about-counter").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, bottom: box.bottom, font: getComputedStyle(node).fontFamily };
  });
  expect(counter.left).toBeLessThanOrEqual(1);
  expect(counter.bottom).toBeGreaterThan(900);
  expect(counter.font).toMatch(/IBM Plex Mono/i);
  const bar = await page.locator(".about-preloader__bar").boundingBox();
  expect(Math.abs(bar!.x + bar!.width / 2 - 720)).toBeLessThanOrEqual(2);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  const recorded = await phases();
  expect(recorded.map(([phase]) => phase)).toEqual(["preloading", "wipe", "live"]);
  expect(recorded[1][1] - recorded[0][1]).toBeGreaterThanOrEqual(appConfig.aboutIntro.counterMinimumMilliseconds - 100);
  await expect(page.locator(".about-preloader")).toBeHidden();
  await expect(page.locator(".about-particles")).toHaveCSS("opacity", "1");
  await expect(page.locator(".about-hero__cue")).toHaveText("Плъзнете и разгледайте");
  await expect(page.locator(".about-hero__cue")).toHaveAttribute("href", "#about-title");
  expect(errors).toEqual([]);
});

test("the wordmark is one tall bold uppercase line in the logo colors that fills the container", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${about}#about-title`);
  await page.evaluate(() => scrollTo(0, 0));
  const logo = page.locator(".about-hero__logo");
  await expect(logo).toHaveAttribute("aria-hidden", "true");
  await expect(logo).toHaveCSS("font-family", /Sofia Sans Extra Condensed/);
  const words = await logo.locator(".about-hero__word").evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    return { text: node.textContent, transform: style.textTransform, weight: style.fontWeight, color: style.color, top: node.getBoundingClientRect().top };
  }));
  expect(words.map((word) => word.text)).toEqual(["Web", "Creative", "Team"]);
  expect(words.every((word) => word.transform === "uppercase" && word.weight === "1000")).toBe(true);
  expect(words.map((word) => word.color)).toEqual(["rgb(239, 127, 26)", "rgb(254, 254, 254)", "rgb(116, 151, 40)"]);
  expect(new Set(words.map((word) => Math.round(word.top))).size).toBe(1);
  await expect.poll(() => logo.evaluate((node) => {
    const used = Array.from(node.children).reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
    return used / node.clientWidth;
  })).toBeGreaterThan(.97);
  // Stretched to 1.2x upwards, below the header and above the cue.
  const painted = await logo.evaluate((node) => ({
    stretch: new DOMMatrix(getComputedStyle(node).transform).d,
    box: node.getBoundingClientRect(),
    headerBottom: document.querySelector(".site-header")!.getBoundingClientRect().bottom,
    cueTop: document.querySelector(".about-hero__cue")!.getBoundingClientRect().top,
  }));
  expect(painted.stretch).toBeCloseTo(1.2, 2);
  expect(painted.box.top).toBeGreaterThan(painted.headerBottom);
  expect(painted.box.bottom).toBeLessThanOrEqual(painted.cueTop);
  expect(painted.box.height).toBeLessThanOrEqual(900 * .304 + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test("narrow phones stack the wordmark in three lines of one size", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(`${about}#about-title`);
    await page.evaluate(() => scrollTo(0, 0));
    const lines = await page.locator(".about-hero__word").evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, right: box.right, size: getComputedStyle(node).fontSize };
    }));
    expect(new Set(lines.map((line) => Math.round(line.top))).size, `${width}px lines`).toBe(3);
    expect(new Set(lines.map((line) => line.size)).size, `${width}px sizes`).toBe(1);
    const painted = await page.locator(".about-hero__logo").evaluate((node) => ({ top: node.getBoundingClientRect().top, headerBottom: document.querySelector(".site-header")!.getBoundingClientRect().bottom }));
    expect(painted.top, `${width}px below the header`).toBeGreaterThan(painted.headerBottom);
    expect(Math.max(...lines.map((line) => line.right))).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});

test("without JavaScript the preloader stays hidden and the static hero links to the content", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(about);
  await expect(page.locator(".about-preloader")).toBeHidden();
  await expect(page.locator(".about-hero__logo")).toBeVisible();
  await page.locator(".about-hero__cue").click();
  await expect(page).toHaveURL(/#about-title$/);
  await expect(page.locator("#about-title")).toBeInViewport();
  await context.close();
});

test("a browser without WebGL keeps the static hero and the moving messages", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type.startsWith("webgl") ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "static", { timeout: liveTimeout });
  await expect(page.locator(".about-preloader")).toBeHidden();
  await expect(page.locator(".about-hero__logo")).toBeVisible();
  await expect(page.locator(".about-particles")).toHaveCSS("opacity", "0");
  await expect(page.locator(".about-content")).toHaveAttribute("data-about-strip", "");
  await expect(page.locator(".about-hero [aria-live]")).not.toHaveText("Зареждане");
});

test("a scene that is not ready by the shared deadline falls back to the static hero", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/_next/static/**/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("WebGLRenderer")) await new Promise((resolve) => setTimeout(resolve, appConfig.aboutIntro.deadlineMilliseconds + 2000));
    await route.fulfill({ response, body });
  });
  const phases = await recordPhases(page);
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "static", { timeout: liveTimeout });
  const recorded = await phases();
  expect(recorded.map(([phase]) => phase)).toEqual(["preloading", "static"]);
  expect(recorded[1][1] - recorded[0][1]).toBeLessThan(appConfig.aboutIntro.deadlineMilliseconds + 1000);
  await expect(page.locator(".about-hero__logo")).toBeVisible();
  await expect(page.locator(".about-particles")).toHaveCSS("opacity", "0");
});

test("a shader that fails to link keeps the static hero instead of a blank scene", async ({ page }) => {
  await page.addInitScript(() => {
    for (const context of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const original = context.prototype.getProgramParameter;
      context.prototype.getProgramParameter = function (this: WebGLRenderingContext, program: WebGLProgram, name: number) {
        return name === this.LINK_STATUS ? false : original.call(this, program, name);
      } as typeof original;
    }
  });
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "static", { timeout: liveTimeout });
  await expect(page.locator(".about-particles")).toHaveCSS("opacity", "0");
  await expect(page.locator(".about-hero [aria-live]")).not.toHaveText("Зареждане");
});

test("late hydration still finishes the preloader at the shared deadline", async ({ page }) => {
  test.setTimeout(60_000);
  // Delay only the About client code so the component mounts close to the boot deadline.
  await page.route("**/_next/static/**/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("about-hero__cue")) await new Promise((resolve) => setTimeout(resolve, appConfig.aboutIntro.deadlineMilliseconds - 1000));
    await route.fulfill({ response, body });
  });
  const phases = await recordPhases(page);
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", /live|static/, { timeout: liveTimeout + 4000 });
  const finished = (await phases()).find(([phase]) => phase !== "preloading");
  expect(finished![1]).toBeLessThan(appConfig.aboutIntro.deadlineMilliseconds + 1000);
});

test("losing the WebGL context returns to the static hero", async ({ page }) => {
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  await page.locator(".about-particles").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2") ?? (canvas as HTMLCanvasElement).getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(root(page)).toHaveAttribute("data-about-intro", "static");
  await expect(page.locator(".about-particles")).toHaveCSS("opacity", "0");
  await expect(page.locator(".about-hero__logo")).toBeVisible();
});

test("scrolling or the skip link during the counter shows the static hero", async ({ page }) => {
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "preloading");
  await page.evaluate(() => scrollTo(0, 40));
  await expect(root(page)).toHaveAttribute("data-about-intro", "static");
  await expect(page.locator(".about-preloader")).toBeHidden();

  await page.evaluate(() => scrollTo(0, 0));
  await page.reload();
  await expect(root(page)).toHaveAttribute("data-about-intro", "preloading");
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(root(page)).toHaveAttribute("data-about-intro", "static");
  await expect(page.locator("#about-title")).toBeFocused();
});

test("the header stays usable above the preloader", async ({ page }) => {
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "preloading");
  const hit = await page.locator(".site-menu > summary").evaluate((summary) => {
    const box = summary.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("summary") === summary;
  });
  expect(hit).toBe(true);
});

test("the first-visit consent dialog lets the preloader begin after the choice", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(about, { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-about-boot"))).toBe(false);
  await expect(page.locator(".cookie-modal")).toHaveAttribute("open", "");
  await expect(page.locator(".about-preloader")).toBeHidden();
  await expect(page.locator(".about-hero__logo")).toBeVisible();
  await page.locator("#cookie-modal-controls button").last().click();
  await expect(root(page)).toHaveAttribute("data-about-intro", "preloading");
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
});

test("client navigation runs the preloader and leaving About releases it", async ({ page }) => {
  await page.goto(pageUrl("home", "bg"));
  await page.locator(".site-menu > summary").click();
  await page.locator(`.site-menu a[href="${about}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${about}$`));
  await expect(root(page)).toHaveAttribute("data-about-intro", "preloading");
  await page.locator(".site-header__brand").click();
  await expect(page).toHaveURL(new RegExp(`${pageUrl("home", "bg")}$`));
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-about-boot"))).toBe(false);
  await expect(page.locator(".about-preloader")).toHaveCount(0);
  await expect(page.locator(".site-header__brand img")).toBeVisible();
});

test("three.js is downloaded only on the About page", async ({ page }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.push(response.text().catch(() => ""));
  });
  const hasThree = async () => (await Promise.all(scripts)).some((body) => body.includes("WebGLRenderer"));
  await page.goto(pageUrl("home", "bg"));
  await page.waitForLoadState("networkidle");
  expect(await hasThree()).toBe(false);
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  expect(await hasThree()).toBe(true);
});

test("the pause control is hidden until keyboard focus and stops the hero particles", async ({ page }) => {
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  const hero = page.locator(".about-particles");
  const toggle = page.locator(".about-scene__toggle");
  expect(await hiddenUntilFocus(page)).toBe(true);
  const moving = await hero.screenshot();
  await expect.poll(async () => (await hero.screenshot()).equals(moving)).toBe(false);
  // Keyboard path: from the scroll cue, Tab reaches the pause control.
  await page.locator(".about-hero__cue").focus();
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  expect((await toggle.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await expect(toggle).toHaveAccessibleName("Пауза на фона");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAccessibleName("Пусни фона");
  await page.waitForTimeout(150);
  const heroPaused = await hero.screenshot();
  await page.waitForTimeout(300);
  expect((await hero.screenshot()).equals(heroPaused)).toBe(true);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await hero.screenshot()).equals(heroPaused)).toBe(false);
  await page.locator("#about-title").focus();
  expect(await hiddenUntilFocus(page)).toBe(true);
});

test("the background dots move only while the visitor scrolls", async ({ page }) => {
  await page.goto(`${about}#about-title`);
  const background = page.locator(".about-scene canvas");
  const snapshot = () => background.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(400);
  const idle = await snapshot();
  await page.waitForTimeout(400);
  expect(await snapshot()).toBe(idle);
  for (let step = 0; step < 6; step++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(60); }
  expect(await snapshot()).not.toBe(idle);
  await page.waitForTimeout(500);
  const settled = await snapshot();
  await page.waitForTimeout(400);
  expect(await snapshot()).toBe(settled);
});

test("slow fonts do not hold the particles back past the shared deadline", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/*.woff2", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, appConfig.aboutIntro.deadlineMilliseconds + 3000));
    await route.continue().catch(() => {});
  });
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
});

test("unavailable glyph fonts leave a dots-only cloud instead of the static hero", async ({ page }) => {
  await page.route("**/*.woff2", (route) => route.abort());
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  await expect(page.locator(".about-hero__logo")).toBeVisible();
});

test("print hides the hero and the preloader", async ({ page }) => {
  await page.goto(`${about}#about-title`);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".about-hero")).toBeHidden();
  await expect(page.locator(".about-preloader")).toBeHidden();
});

test("reduced motion keeps the moving hero particles and the keyboard pause control", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  const hero = page.locator(".about-particles");
  const first = await hero.screenshot();
  await expect.poll(async () => (await hero.screenshot()).equals(first)).toBe(false);
  await page.locator(".about-scene__toggle").focus();
  await expect(page.locator(".about-scene__toggle")).toHaveAccessibleName("Пауза на фона");
});

test("the menu pauses the hero particles and the pause control stays only while something can move", async ({ page }) => {
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  const hero = page.locator(".about-particles");
  const toggle = page.locator(".about-scene__toggle");
  await page.locator(".site-menu > summary").click();
  // Let the menu finish opening so only the particles could change the frame.
  await page.waitForTimeout(1000);
  const paused = await hero.screenshot();
  await page.waitForTimeout(300);
  expect((await hero.screenshot()).equals(paused)).toBe(true);
  await page.locator(".site-menu > summary").click();
  await expect.poll(async () => (await hero.screenshot()).equals(paused)).toBe(false);
  // At the end of the page the team rain is still on screen above the footer, so the pause stays.
  await page.locator(".about-team").scrollIntoViewIfNeeded();
  await expect(page.locator(".about-team")).toHaveAttribute("data-about-team", "live");
  await toggle.focus();
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(page.locator(".about-team")).toBeInViewport();
  await expect(toggle).toHaveJSProperty("hidden", false);
  await expect(toggle).toBeFocused();
  // Without the team section on screen, the footer removes the control and moves focus off it.
  await page.locator(".about-team").evaluate((node) => { (node as HTMLElement).style.display = "none"; });
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(toggle).toBeHidden();
  await expect(page.locator("#about-footer")).toBeFocused();
});

// Scrolls to a share of the hero's sticky travel (0 = top, 1 = end of the exit).
async function scrollHero(page: Page, progress: number) {
  // A fragment load realigns once fonts are ready; let that happen before taking over the scroll.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((share) => {
    const hero = document.querySelector<HTMLElement>(".about-hero")!;
    const stage = hero.querySelector<HTMLElement>(".about-hero__stage")!;
    scrollTo(0, hero.offsetTop + (hero.offsetHeight - stage.clientHeight) * share);
  }, progress);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

// Bright pixels of the hero stage below the header, as rendered: how many, and the width that holds
// the middle 90% of them. Decoded in Node, because the page's CSP rightly refuses data: URLs.
async function cloudShape(page: Page) {
  const clip = await page.evaluate(() => {
    const top = Math.ceil(document.querySelector(".site-header")!.getBoundingClientRect().bottom);
    return { x: 0, y: top, width: innerWidth, height: Math.round(innerHeight * .6) - top };
  });
  const { data, info } = await sharp(await page.screenshot({ clip })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const columns: number[] = [];
  for (let index = 0; index < data.length; index += 3) {
    if (data[index] + data[index + 1] + data[index + 2] >= 180) columns.push((index / 3) % info.width);
  }
  columns.sort((left, right) => left - right);
  const at = (share: number) => columns[Math.floor((columns.length - 1) * share)];
  return { count: columns.length, spread: columns.length ? (at(.95) - at(.05)) / info.width : 0 };
}

test("the wordmark letters fall left to right with the hero scroll and stand up again", async ({ page }) => {
  for (const { width, height, url } of [{ width: 1440, height: 900, url: about }, { width: 390, height: 844, url: pageUrl("about", "en") }, { width: 320, height: 700, url: about }]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${url}#about-title`);
    const letters = page.locator(".about-hero__letter");
    const sample = () => letters.evaluateAll((nodes) => nodes.map((node) => ({ value: Number((node as HTMLElement).style.getPropertyValue("--about-letter") || 0), opacity: Number(getComputedStyle(node).opacity) })));
    await scrollHero(page, 0);
    expect((await sample()).every((letter) => letter.value === 0 && letter.opacity === 1), `${width}px upright`).toBe(true);
    await scrollHero(page, .2);
    const middle = await sample();
    expect(middle[0].value, `${width}px first ahead`).toBeGreaterThan(middle.at(-1)!.value);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await scrollHero(page, 1);
    expect((await sample()).every((letter) => letter.value === 1 && letter.opacity === 0), `${width}px fallen`).toBe(true);
    await scrollHero(page, 0);
    expect((await sample()).every((letter) => letter.value === 0 && letter.opacity === 1), `${width}px restored`).toBe(true);
  }
});

test("the cue leaves early in the exit but stays visible while it has keyboard focus", async ({ page }) => {
  await page.goto(`${about}#about-title`);
  await scrollHero(page, 0);
  const cue = page.locator(".about-hero__cue");
  await scrollHero(page, .3);
  await expect(page.locator(".about-hero")).toHaveAttribute("data-about-exited", "");
  await expect(cue).toHaveCSS("visibility", "hidden");
  await scrollHero(page, 0);
  await cue.focus();
  await scrollHero(page, .3);
  await expect(cue).toBeFocused();
  await expect(cue).toHaveCSS("visibility", "visible");
  await expect(cue).toBeInViewport();
  // Moving focus elsewhere (without scrolling the page) hides the cue again.
  await cue.evaluate((node) => (node as HTMLElement).blur());
  await expect(cue).toHaveCSS("visibility", "hidden");
});

test("without particles the letters fall over the whole exit instead of leaving an empty stage", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type.startsWith("webgl") ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "static", { timeout: liveTimeout });
  await scrollHero(page, .7);
  const last = await page.locator(".about-hero__letter").last().evaluate((node) => Number(getComputedStyle(node).opacity));
  expect(last).toBeGreaterThan(0);
});

test("resizing in the middle of the exit keeps the wordmark fitted and the letters in order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${pageUrl("about", "en")}#about-title`);
  await scrollHero(page, .25);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  await scrollHero(page, .25);
  const state = await page.locator(".about-hero__logo").evaluate((node) => {
    const used = Array.from(node.children).reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
    const values = Array.from(node.querySelectorAll<HTMLElement>(".about-hero__letter")).map((letter) => Number(letter.style.getPropertyValue("--about-letter") || 0));
    return { fill: used / node.clientWidth, first: values[0], last: values.at(-1)! };
  });
  expect(state.fill).toBeGreaterThan(.95);
  expect(state.first).toBeGreaterThan(state.last);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1100);
});

test("the particle cloud narrows into a column, keeps it while the intro arrives and unfolds on the way back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  const open = await cloudShape(page);
  await scrollHero(page, 1);
  await expect(root(page), "the WebGL scene is still live").toHaveAttribute("data-about-intro", "live");
  // The scene draws the new shape on its next frame, so the narrowing is polled.
  await expect.poll(async () => (await cloudShape(page)).spread).toBeLessThan(open.spread * .4);
  await expect.poll(async () => (await cloudShape(page)).count).toBeGreaterThan(50);
  // From the end of the exit until the heading is on screen, the column or the heading is always visible.
  for (let step = 0; step <= 8; step++) {
    await page.evaluate(() => scrollBy(0, innerHeight * .1));
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const heading = await page.locator(".about-strip__item .about-word").evaluateAll((nodes) => nodes.some((node) => {
      const box = node.getBoundingClientRect();
      return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth && Number(getComputedStyle(node).opacity) > .1;
    }));
    if (!heading) expect((await cloudShape(page)).count, `step ${step}`).toBeGreaterThan(50);
  }
  await scrollHero(page, 0);
  await expect.poll(async () => (await cloudShape(page)).spread).toBeGreaterThan(open.spread * .7);
});

test("a paused cloud still follows the scroll with a single frame", async ({ page }) => {
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  await page.locator(".about-hero__cue").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.locator(".about-scene__toggle")).toHaveAccessibleName("Пусни фона");
  const before = await cloudShape(page);
  await scrollHero(page, 1);
  await expect.poll(async () => (await cloudShape(page)).spread).toBeLessThan(before.spread * .4);
  // Let the scroll-only background dots come to rest as well.
  await page.waitForTimeout(400);
  const still = await page.locator(".about-particles").screenshot();
  await page.waitForTimeout(300);
  expect((await page.locator(".about-particles").screenshot()).equals(still)).toBe(true);
});

test("very short screens and pages without JavaScript keep a one-screen hero without the fall", async ({ browser, page }) => {
  await page.setViewportSize({ width: 844, height: 340 });
  await page.goto(`${about}#about-title`);
  expect(await page.locator(".about-hero").evaluate((node) => Math.round(node.getBoundingClientRect().height))).toBe(340);
  await expect(page.locator(".about-hero__letter").first()).toHaveCSS("transform", "none");
  // No travel means no exit: a little scroll must not hide the cue at once.
  await page.evaluate(() => scrollTo(0, 20));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator(".about-hero")).not.toHaveAttribute("data-about-exited");

  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const noScript = await context.newPage();
  await noScript.goto(about);
  expect(await noScript.locator(".about-hero").evaluate((node) => Math.round(node.getBoundingClientRect().height))).toBe(900);
  await context.close();
});

// Visible words: opacity and whether the word box is on screen.
const wordStates = (page: Page, selector: string) => page.locator(`${selector} .about-word`).evaluateAll((nodes) => nodes.map((node) => {
  const box = node.getBoundingClientRect();
  return { opacity: Number(getComputedStyle(node).opacity), inView: box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight };
}));
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test("the intro heading surfaces in the lower corners at the end of the hero exit", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${about}#about-title`);
  await settle(page);
  const heading = page.locator("h1");
  await expect(heading).toHaveCount(1);
  expect((await heading.textContent())!.replace(/\s+/g, " ").trim()).toBe("Агенция за дигитален растеж и силно онлайн присъствие");
  await expect.poll(async () => (await wordStates(page, ".about-intro")).every((word) => word.opacity === 1 && word.inView)).toBe(true);
  const layout = await page.evaluate(() => {
    const lead = document.querySelector(".about-intro--lead")!.getBoundingClientRect();
    const tail = document.querySelector(".about-intro--tail")!.getBoundingClientRect();
    return { leadLeft: lead.left, leadBottom: lead.bottom, tailRight: tail.right, tailBottom: tail.bottom, tailStyle: getComputedStyle(document.querySelector(".about-intro--tail .about-word")!).fontStyle };
  });
  expect(layout.leadLeft).toBeLessThan(200);
  expect(layout.leadBottom).toBeGreaterThan(700);
  expect(layout.tailRight).toBeGreaterThan(1240);
  expect(layout.tailBottom).toBeGreaterThan(700);
  expect(layout.tailStyle).toBe("italic");
  await scrollHero(page, .3);
  expect((await wordStates(page, ".about-intro")).every((word) => word.opacity === 0)).toBe(true);
});

test("the strip carries the paired messages right to left without an empty frame and comes back", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${about}#about-title`);
  await settle(page);
  // The strip ends where the team section reaches the top of the screen.
  const end = await page.locator(".about-team").evaluate((node) => node.getBoundingClientRect().top + scrollY);
  const positions: number[] = [];
  let sawPair = false;
  for (let top = await page.evaluate(() => scrollY); top < end; top += 45) {
    await page.evaluate((y) => scrollTo(0, y), top);
    await settle(page);
    const visible = await page.locator(".about-strip__item .about-word").evaluateAll((nodes) => nodes.some((node) => {
      const box = node.getBoundingClientRect();
      return Number(getComputedStyle(node).opacity) > .5 && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight;
    }));
    // The strip ends where the team section comes in.
    const teamTop = await page.locator(".about-team").evaluate((node) => node.getBoundingClientRect().top);
    if (teamTop > 900) expect(visible, `scroll ${top}`).toBe(true);
    positions.push(await page.locator("#about-message-1").evaluate((node) => node.getBoundingClientRect().left));
    const pair = await page.evaluate(() => [1, 2].every((index) => Array.from(document.querySelectorAll(`#about-message-${index} .about-word`)).every((node) => Number(getComputedStyle(node).opacity) === 1)));
    sawPair ||= pair;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  }
  expect(sawPair).toBe(true);
  for (let index = 1; index < positions.length; index++) expect(positions[index]).toBeLessThanOrEqual(positions[index - 1] + .5);
  // Back to the intro through a fresh fragment (the page was opened at #about-title).
  await page.evaluate(() => { location.hash = "#about-message-1"; });
  await page.evaluate(() => { location.hash = "#about-title"; });
  await expect.poll(async () => (await wordStates(page, ".about-intro")).every((word) => word.opacity === 1)).toBe(true);
});

test("message words surface in reading order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${about}#about-title`);
  await settle(page);
  let checked = false;
  for (let step = 0; step < 40 && !checked; step++) {
    await page.evaluate(() => scrollBy(0, 30));
    await settle(page);
    const words = await wordStates(page, "#about-message-1");
    const first = words[0].opacity;
    const last = words.at(-1)!.opacity;
    if (first > .2 && first < 1) { expect(first).toBeGreaterThan(last); checked = true; }
  }
  expect(checked).toBe(true);
});

test("every message fragment lands on a fully visible, focused message", async ({ page }) => {
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    for (let index = 1; index <= 4; index++) {
      await page.goto("about:blank");
      await page.goto(`${about}#about-message-${index}`);
      await expect(page.locator(`#about-message-${index}`)).toBeFocused();
      await expect.poll(async () => (await wordStates(page, `#about-message-${index}`)).every((word) => word.opacity === 1 && word.inView), `${width}px message ${index}`).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  }
});

test("the cue and the skip link land on the intro heading", async ({ page }) => {
  await page.goto(`${about}#about-title`);
  await page.evaluate(() => { history.replaceState(null, "", location.pathname); scrollTo(0, 0); });
  await settle(page);
  await page.locator(".about-hero__cue").click();
  await expect(page.locator("#about-title")).toBeFocused();
  await expect(page).toHaveURL(/#about-title$/);
  await expect.poll(async () => (await wordStates(page, ".about-intro")).every((word) => word.opacity === 1 && word.inView)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#about-title")).toBeFocused();
  await expect.poll(async () => (await wordStates(page, ".about-intro")).every((word) => word.opacity === 1 && word.inView)).toBe(true);
});

test("phones stack the intro low on the screen and show one message per screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${about}#about-message-2`);
  await expect(page.locator(".about-content")).toHaveAttribute("data-about-single", "");
  await expect.poll(async () => (await wordStates(page, "#about-message-2")).every((word) => word.opacity === 1 && word.inView)).toBe(true);
  expect((await page.locator("#about-message-2").boundingBox())!.y).toBeGreaterThan(844 / 2);
  for (const other of [1, 3]) {
    expect((await wordStates(page, `#about-message-${other}`)).some((word) => word.opacity > .5 && word.inView), `message ${other}`).toBe(false);
  }
  await page.evaluate(() => { location.hash = "#about-title"; });
  await expect.poll(async () => (await wordStates(page, ".about-intro")).every((word) => word.opacity === 1 && word.inView)).toBe(true);
  const [lead, tail] = await page.evaluate(() => [".about-intro--lead", ".about-intro--tail"].map((selector) => document.querySelector(selector)!.getBoundingClientRect()));
  expect(tail.top).toBeGreaterThanOrEqual(lead.bottom);
  expect(lead.top).toBeGreaterThan(844 / 2);
  expect(tail.bottom).toBeLessThanOrEqual(844);
  expect(tail.right).toBeLessThanOrEqual(390);
});

test("wheel scrolling is smoothed while direct scrolling lands at once", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${about}#about-title`);
  await settle(page);
  const x = () => page.locator("#about-message-1").evaluate((node) => (node as HTMLElement).style.getPropertyValue("--about-x"));
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 400);
  const samples: string[] = [];
  for (let frame = 0; frame < 8; frame++) { await page.waitForTimeout(25); samples.push(await x()); }
  expect(new Set(samples).size, "the wheel glides over several frames").toBeGreaterThan(2);
  await page.waitForTimeout(800);
  await page.evaluate(() => scrollBy(0, 400));
  await settle(page);
  const direct = await x();
  await page.waitForTimeout(150);
  expect(await x()).toBe(direct);
});

test("behind the strip the particles turn only while scrolling and fade after it", async ({ page }) => {
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  await page.evaluate(() => { location.hash = "#about-message-2"; });
  await page.waitForTimeout(500);
  const particles = page.locator(".about-particles");
  const idle = await particles.screenshot();
  await page.waitForTimeout(400);
  expect((await particles.screenshot()).equals(idle)).toBe(true);
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(root(page)).toHaveAttribute("data-about-scene-gone", "");
  await expect(particles).toHaveCSS("opacity", "0");
});

test("without JavaScript, on very short screens and in print the content is a readable vertical flow", async ({ browser, page }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const noScript = await context.newPage();
  await noScript.goto(about);
  await expect(noScript.locator(".about-content")).not.toHaveAttribute("data-about-strip");
  expect((await wordStates(noScript, ".about-content")).every((word) => word.opacity === 1)).toBe(true);
  await context.close();

  await page.setViewportSize({ width: 844, height: 340 });
  await page.goto(`${about}#about-message-2`);
  await expect(page.locator(".about-content")).not.toHaveAttribute("data-about-strip");
  expect((await wordStates(page, ".about-content")).every((word) => word.opacity === 1)).toBe(true);
  await expect(page.locator("#about-message-2 p")).toBeInViewport();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${about}#about-title`);
  await page.emulateMedia({ media: "print" });
  expect((await wordStates(page, ".about-content")).every((word) => word.opacity === 1)).toBe(true);
  await expect(page.locator("#about-message-1")).toHaveCSS("position", "static");
});

test("every message keeps its exact text, with spaces, in both languages", async ({ page }) => {
  for (const locale of ["bg", "en"] as const) {
    await page.goto(`${pageUrl("about", locale)}#about-title`);
    const rendered = await page.locator(".about-message p").evaluateAll((nodes) => nodes.map((node) => node.textContent!.replace(/\s+/g, " ").trim()));
    expect(rendered).toEqual(aboutCopy(locale).messages);
    expect((await page.locator("h1").textContent())!.replace(/\s+/g, " ").trim()).toBe(aboutCopy(locale).introLead.join(" "));
  }
});

test("the particles rest behind the readable intro until the visitor scrolls", async ({ page }) => {
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  await page.locator(".about-hero__cue").click();
  await expect(page.locator("#about-title")).toBeFocused();
  await page.waitForTimeout(400);
  const particles = page.locator(".about-particles");
  const idle = await particles.screenshot();
  await page.waitForTimeout(400);
  expect((await particles.screenshot()).equals(idle)).toBe(true);
});

test("on very short screens the particle layer ends with the hero", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 340 });
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", /live|static/, { timeout: liveTimeout });
  await page.locator("#about-message-2").scrollIntoViewIfNeeded();
  await expect(root(page)).toHaveAttribute("data-about-scene-gone", "");
  await expect(page.locator(".about-particles")).toHaveCSS("opacity", "0");
});

test("a runtime failure in the strip restores the readable vertical flow", async ({ page }) => {
  await page.goto(`${about}#about-title`);
  await expect(page.locator(".about-content")).toHaveAttribute("data-about-strip", "");
  await page.evaluate(() => {
    const original = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, name: string, ...rest: [string | null, string?]) {
      if (name === "--about-x") throw new Error("injected strip failure");
      return original.call(this, name, ...rest);
    };
    scrollBy(0, innerHeight * .5);
  });
  await expect(page.locator(".about-content")).not.toHaveAttribute("data-about-strip");
  expect((await wordStates(page, ".about-content")).every((word) => word.opacity === 1)).toBe(true);
});

test("a zoomed English page keeps every message reachable without horizontal scroll", async ({ page }) => {
  // About 200% zoom on a 1440×900 screen.
  await page.setViewportSize({ width: 720, height: 450 });
  for (let index = 1; index <= 4; index++) {
    await page.goto("about:blank");
    await page.goto(`${pageUrl("about", "en")}#about-message-${index}`);
    await expect.poll(async () => (await wordStates(page, `#about-message-${index}`)).every((word) => word.opacity === 1 && word.inView), `message ${index}`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(720);
  }
});

test("accented phrases are coloured exactly as written in both languages, in sentence case", async ({ page }) => {
  for (const locale of ["bg", "en"] as const) {
    const copy = aboutCopy(locale);
    await page.goto(`${pageUrl("about", locale)}#about-title`);
    const blocks = await page.locator(".about-strip__item").evaluateAll((nodes) => nodes.map((node) => ({
      transform: getComputedStyle(node).textTransform,
      tones: Object.fromEntries(["orange", "green"].map((tone) => [tone, [...node.querySelectorAll(`.about-word--${tone}`)].map((word) => word.textContent!.trim()).join(" ")])),
      colours: [...new Set([...node.querySelectorAll("[class*='about-word--']")].map((word) => getComputedStyle(word).color))],
      text: node.textContent!.replace(/\s+/g, " ").trim(),
    })));
    const texts = [copy.introLead.join(" "), copy.introTail.join(" "), ...copy.messages];
    blocks.forEach((block, index) => {
      expect(block.text, `${locale} block ${index}`).toBe(texts[index]);
      expect(block.transform).toBe("none");
      for (const tone of ["orange", "green"]) {
        const expected = copy.accents[index].filter((accent) => accent.tone === tone).map((accent) => accent.text ?? texts[index]).join(" ");
        expect(block.tones[tone], `${locale} block ${index} ${tone}`).toBe(expected);
      }
      for (const colour of block.colours) expect(["rgb(239, 127, 26)", "rgb(116, 151, 40)"]).toContain(colour);
    });
  }
});

// Stage 4: the team section.
const teamUrl = (locale: "bg" | "en" = "bg") => `${pageUrl("about", locale)}#about-team`;
const team = (page: Page) => page.locator(".about-team");
const activeName = (page: Page) => page.locator(".about-team__member[data-active] .about-team__name");
const teamCopy = (locale: "bg" | "en") => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).about.team as { next: string; first: string; position: string; members: { id: string; name: string; role: string }[] };
const activeFigure = (page: Page) => page.locator(".about-team__member[data-active] .about-team__figure");
const announced = (copy: ReturnType<typeof teamCopy>, index: number) => `${copy.members[index].name}, ${copy.members[index].role}, ${copy.position.replace("{current}", String(index + 1)).replace("{total}", String(copy.members.length))}`;
// Scrolls at once to a position in the team section: 0 is the first member, members - 1 the last.
async function scrollTeam(page: Page, position: number) {
  await page.evaluate((target) => {
    const section = document.querySelector<HTMLElement>(".about-team")!;
    const box = section.getBoundingClientRect();
    const count = section.querySelectorAll(".about-team__member").length;
    scrollTo({ top: box.top + scrollY + target / (count - 1) * (box.height - innerHeight), behavior: "instant" });
  }, position);
}
// Which member the scroll position stands at (rounded), read from the page.
const scrollPosition = (page: Page) => page.evaluate(() => {
  const section = document.querySelector<HTMLElement>(".about-team")!;
  const box = section.getBoundingClientRect();
  const count = section.querySelectorAll(".about-team__member").length;
  return Math.round(-box.top / (box.height - innerHeight) * (count - 1) * 100) / 100;
});
async function swipeTeam(page: Page, dx: number, dy: number) {
  await page.locator(".about-team__stage").evaluate((stage, [x, y]) => {
    const box = stage.getBoundingClientRect();
    const from = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    stage.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", ...from }));
    stage.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", clientX: from.clientX + x, clientY: from.clientY + y }));
  }, [dx, dy]);
}
// Mean brightness (0..255) of an element's pixels as they appear on screen.
async function brightness(page: Page, selector: string) {
  const { channels } = await sharp(await page.locator(selector).screenshot()).stats();
  return (channels[0].mean + channels[1].mean + channels[2].mean) / 3;
}

test("scrolling through the team shows the members in turn and back, without flicker on a boundary", async ({ page }) => {
  const copy = teamCopy("bg");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(teamUrl());
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
  // About 0.9 screen of scroll per member after the first screen; the stage stays on screen.
  const height = await team(page).evaluate((node) => node.getBoundingClientRect().height);
  expect(Math.abs(height - 900 * (1 + .9 * (copy.members.length - 1)))).toBeLessThan(2);
  for (let index = 0; index < copy.members.length; index++) {
    await scrollTeam(page, index);
    await expect(activeName(page)).toHaveText(copy.members[index].name);
    await expect(page.locator(".about-team__counter")).toHaveText(`${String(index + 1).padStart(2, "0")} / ${String(copy.members.length).padStart(2, "0")}`);
    await expect(page.locator(".about-team__stage")).toBeInViewport({ ratio: .99 });
  }
  // Only the current member's text is seen; the others stay readable to assistive technology.
  await expect(page.locator(".about-team__member:not([data-active]) .about-team__text").first()).toHaveCSS("opacity", "0");
  await expect(page.getByRole("heading", { level: 3, name: copy.members[0].name })).toBeAttached();
  // Back up, and resting on the boundary keeps the member it came from.
  await scrollTeam(page, 1.5);
  await page.waitForTimeout(300);
  await expect(activeName(page)).toHaveText(copy.members[2].name);
  await scrollTeam(page, 1);
  await expect(activeName(page)).toHaveText(copy.members[1].name);
  await scrollTeam(page, .5);
  await page.waitForTimeout(300);
  await expect(activeName(page)).toHaveText(copy.members[1].name);
  await scrollTeam(page, .3);
  await expect(activeName(page)).toHaveText(copy.members[0].name);
  // The progress line fills with the scroll: half of the second segment at the boundary.
  await scrollTeam(page, .5);
  await expect.poll(async () => Math.abs(Number(await page.locator(".about-team__progress span").nth(1).evaluate((node) => getComputedStyle(node).getPropertyValue("--about-team-fill"))) - .5)).toBeLessThan(.02);
});

test("a fast scroll shows and announces only the member it stops at", async ({ page }) => {
  const copy = teamCopy("bg");
  const last = copy.members.length - 1;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(teamUrl());
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
  await expect(activeFigure(page)).toHaveAttribute("data-cloud", "");
  for (let step = 1; step <= 10; step++) { await scrollTeam(page, last * step / 10); await page.waitForTimeout(20); }
  await expect(activeName(page)).toHaveText(copy.members[last].name);
  await expect(page.locator(".about-team [aria-live]")).toHaveText(announced(copy, last));
  await expect(activeFigure(page)).toHaveAttribute("data-cloud", "");
  // Landing in the middle of the section with one jump picks the member there.
  // (Without a fragment: the page holds a fragment target until the visitor scrolls by hand.)
  await page.goto(about);
  await expect(root(page)).toHaveAttribute("data-about-intro", "live", { timeout: liveTimeout });
  await page.evaluate(() => { const box = document.querySelector(".about-team")!.getBoundingClientRect(); scrollTo({ top: box.top + scrollY + (box.height - innerHeight) / 2 + 10, behavior: "instant" }); });
  await expect(activeName(page)).toHaveText(copy.members[Math.round(last / 2)].name);
});

test("the button, arrow keys and swipes scroll to the next member, and the last one leads back to the first", async ({ page }) => {
  const copy = teamCopy("bg");
  const last = copy.members.length - 1;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(teamUrl());
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
  const next = page.locator(".about-team__next");
  await expect(next).toHaveAccessibleName(copy.next.replace("{name}", copy.members[1].name));
  await next.click();
  // The button announces at once and scrolls; the member follows the scroll.
  await expect(page.locator(".about-team [aria-live]")).toHaveText(announced(copy, 1));
  await expect(activeName(page)).toHaveText(copy.members[1].name);
  await expect.poll(() => scrollPosition(page)).toBe(1);
  await expect(next).toBeFocused();
  // Arrow keys from the button, up to the last member.
  for (let index = 2; index <= last; index++) await page.keyboard.press("ArrowRight");
  await expect(activeName(page)).toHaveText(copy.members[last].name);
  await expect.poll(() => scrollPosition(page)).toBe(last);
  await expect(next).toHaveAccessibleName(copy.first.replace("{name}", copy.members[0].name));
  // Past the last member: straight back to the first, without running through everyone in between.
  const seen = new Set<string>();
  await page.exposeFunction("recordMember", (name: string) => { seen.add(name); });
  await page.evaluate(() => {
    const record = () => { (window as unknown as { recordMember: (name: string) => void }).recordMember(document.querySelector(".about-team__member[data-active] .about-team__name")!.textContent!); requestAnimationFrame(record); };
    record();
  });
  await next.click();
  await expect(activeName(page)).toHaveText(copy.members[0].name);
  await expect.poll(() => scrollPosition(page)).toBe(0);
  for (let index = 1; index < last; index++) expect(seen.has(copy.members[index].name)).toBe(false);
  // A visitor who takes over the scroll cancels the button's target: the next press starts from the member shown.
  // Both with wheel input and without any input event (a scrollbar drag moves the page away from the target).
  for (const wheel of [true, false]) {
    await next.click();
    if (wheel) await page.mouse.wheel(0, -10);
    await page.waitForTimeout(wheel ? 0 : 150);
    await scrollTeam(page, 0);
    await page.waitForTimeout(300);
    await expect(activeName(page)).toHaveText(copy.members[0].name);
    await next.click();
    await expect(activeName(page)).toHaveText(copy.members[1].name);
    await expect.poll(() => scrollPosition(page)).toBe(1);
    await scrollTeam(page, 0);
    await expect(activeName(page)).toHaveText(copy.members[0].name);
  }
  // Left arrow from the first member jumps to the last.
  await page.keyboard.press("ArrowLeft");
  await expect(activeName(page)).toHaveText(copy.members[last].name);
  // A left swipe goes forward; a mostly vertical drag is a scroll, not a swipe.
  await swipeTeam(page, -120, 10);
  await expect(activeName(page)).toHaveText(copy.members[0].name);
  await swipeTeam(page, -60, 140);
  await page.waitForTimeout(400);
  await expect(activeName(page)).toHaveText(copy.members[0].name);
  await swipeTeam(page, -120, 0);
  await expect(activeName(page)).toHaveText(copy.members[1].name);
  await swipeTeam(page, 120, 0);
  await expect(activeName(page)).toHaveText(copy.members[0].name);
});

test("each member's point cloud appears without the photo ever showing, also after quick presses", async ({ page }) => {
  const copy = teamCopy("bg");
  // From the first frame, record whether any team photo is ever painted visibly.
  await page.addInitScript(() => {
    const state = { photoSeen: "", autoCards: false };
    (window as unknown as { teamPhoto: typeof state }).teamPhoto = state;
    const check = () => {
      // Before hydration ("auto") the section must already be the sticky stage, not the card list.
      const section = document.querySelector(".about-team");
      if (section?.getAttribute("data-about-team") === "auto") {
        if (getComputedStyle(section.querySelector(".about-team__stage")!).position !== "sticky") state.autoCards = true;
      }
      for (const image of document.querySelectorAll<HTMLImageElement>(".about-team__portrait")) {
        const figure = image.closest<HTMLElement>(".about-team__figure")!;
        const style = getComputedStyle(figure);
        const box = image.getBoundingClientRect();
        if (image.complete && image.naturalWidth && style.visibility !== "hidden" && Number(style.opacity) > .05 && box.bottom > 0 && box.top < innerHeight && box.width > 0) state.photoSeen ||= image.alt;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(teamUrl());
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
  await expect(activeFigure(page)).toHaveAttribute("data-cloud", "");
  // Rapid presses: the member that ends up active still gets its cloud.
  for (let index = 0; index < copy.members.length + 1; index++) await page.locator(".about-team__next").click();
  await expect(activeName(page)).toHaveText(copy.members[1 % copy.members.length].name);
  await expect(activeFigure(page)).toHaveAttribute("data-cloud", "");
  await page.waitForTimeout(1500);
  expect(await brightness(page, ".about-team__canvas")).toBeGreaterThan(3);
  const record = await page.evaluate(() => (window as unknown as { teamPhoto: { photoSeen: string; autoCards: boolean } }).teamPhoto);
  expect(record.photoSeen).toBe("");
  expect(record.autoCards).toBe(false);
});

test("before the scripts run, the team already is the photo-less scroll stage", async ({ page }) => {
  // The scripts never arrive, so the page stays as the server sent it, with scripting on.
  await page.route(/\/_next\/static\/chunks\/.*\.js(\?|$)/, (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(teamUrl());
  await expect(team(page)).toHaveAttribute("data-about-team", "auto");
  await expect(page.locator(".about-team__stage")).toHaveCSS("position", "sticky");
  await expect(page.locator(".about-team__figure").first()).toHaveCSS("opacity", "0");
  await expect(page.locator(".about-team__next")).toBeHidden();
  await expect(activeName(page)).toHaveText(teamCopy("bg").members[0].name);
});

test("a portrait whose images fail to load keeps its photo", async ({ page }) => {
  await page.route("**/images/about/team/*-color.webp", (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(teamUrl());
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
  await expect(activeFigure(page)).toHaveAttribute("data-fallback", "");
  await expect(activeFigure(page)).not.toHaveAttribute("data-cloud");
  await expect(activeFigure(page)).toHaveCSS("opacity", "1");
  await expect(page.locator(".about-team__member[data-active] .about-team__portrait")).toBeVisible();
  await expect(page.locator(".about-team__member[data-active] .about-team__portrait")).toHaveJSProperty("complete", true);
});

test("the team scene and its images load only when the section comes near", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => { if (/-(color|depth)\.webp/.test(request.url())) requested.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${about}#about-title`);
  await expect(page.locator(".about-content")).toHaveAttribute("data-about-strip", "");
  await page.waitForTimeout(1500);
  expect(requested).toEqual([]);
  await expect(team(page)).toHaveAttribute("data-about-team", "preparing");
  await page.evaluate(() => { location.hash = "#about-team"; });
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
  // Every member's data then loads ahead, so a change does not wait for the network.
  for (const member of teamCopy("bg").members) await expect.poll(() => requested.some((url) => url.includes(`/${member.id}-color.webp`))).toBe(true);
});

test("the rain keeps moving on screen and stops with the page-wide pause", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(teamUrl());
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
  const canvas = page.locator(".about-team__canvas");
  // Past the five seconds the portrait settles in, the rain still moves.
  await page.waitForTimeout(5500);
  const first = await canvas.screenshot();
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(first)).toBe(false);
  // The team sits right above the footer: the keyboard pause must still be there.
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(page.locator(".site-footer")).toBeInViewport();
  await expect(team(page)).toBeInViewport();
  await page.locator(".about-scene__toggle").focus();
  await page.keyboard.press("Enter");
  await expect(root(page)).toHaveAttribute("data-about-paused", "");
  await page.waitForTimeout(200);
  const paused = await canvas.screenshot();
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(paused)).toBe(true);
});

test("without WebGL, without JavaScript, on very short screens and in print the team is a list of photo cards", async ({ page, browser }) => {
  const copy = teamCopy("bg");
  const cards = async (target: Page, state = "cards") => {
    await expect(target.locator(".about-team")).toHaveAttribute("data-about-team", state);
    await expect(target.locator(".about-team__stage")).not.toHaveCSS("position", "sticky");
    for (const member of copy.members) await expect(target.locator(".about-team__name", { hasText: member.name })).toBeVisible();
    await expect(target.locator(".about-team__next")).toBeHidden();
    await expect(target.locator(".about-team__portrait")).toHaveCount(copy.members.length);
  };
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type.startsWith("webgl") ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto(teamUrl());
  await page.waitForTimeout(1000);
  await cards(page);
  for (const image of await page.locator(".about-team__portrait").all()) await expect(image).toHaveJSProperty("complete", true);
  // Nothing moves over the photo cards, so at the footer the pause control goes away.
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(page.locator(".about-scene__toggle")).toHaveJSProperty("hidden", true);

  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const plain = await noScript.newPage();
  await plain.goto(teamUrl());
  // Without JavaScript the server's undecided state stays, and CSS shows the cards.
  await cards(plain, "auto");
  await noScript.close();

  const short = await browser.newPage({ viewport: { width: 844, height: 340 } });
  await short.goto(teamUrl());
  await short.waitForTimeout(1000);
  await cards(short);
  await short.close();

  const printed = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await printed.goto(teamUrl());
  await expect(printed.locator(".about-team")).toHaveAttribute("data-about-team", "live");
  await printed.emulateMedia({ media: "print" });
  for (const member of copy.members) await expect(printed.locator(".about-team__name", { hasText: member.name })).toBeVisible();
  await expect(printed.locator(".about-team__canvas")).toBeHidden();
  await expect(printed.locator(".about-team__next")).toBeHidden();
  await printed.close();
});

test("a lost WebGL context or a failing shader in the team scene falls back to the photo cards", async ({ page, browser }) => {
  await page.goto(teamUrl());
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
  await page.locator(".about-team__canvas").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2") ?? (canvas as HTMLCanvasElement).getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(team(page)).toHaveAttribute("data-about-team", "cards");
  await expect(page.locator(".about-team__name").first()).toBeVisible();

  const failing = await browser.newPage();
  await failing.addInitScript(() => {
    for (const context of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const original = context.prototype.getProgramParameter;
      context.prototype.getProgramParameter = function (this: WebGLRenderingContext, program: WebGLProgram, name: number) {
        return name === this.LINK_STATUS ? false : original.call(this, program, name);
      } as typeof original;
    }
  });
  await failing.goto(teamUrl());
  await failing.waitForTimeout(1500);
  await expect(failing.locator(".about-team")).toHaveAttribute("data-about-team", "cards");
  await failing.close();
});

test("on phones the portrait sits on top and the text, progress and button stay low without horizontal scroll", async ({ page }) => {
  for (const [locale, width, height] of [["bg", 390, 844], ["en", 390, 844], ["en", 320, 568], ["bg", 320, 568]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(teamUrl(locale));
    await expect(team(page)).toHaveAttribute("data-about-team", "live");
    // Every member's text must fit between the counter and the progress line.
    for (let index = 0; index < teamCopy(locale).members.length; index++) {
      await scrollTeam(page, index);
      await expect(activeName(page)).toHaveText(teamCopy(locale).members[index].name);
      const layout = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        return { text: rect(".about-team__member[data-active] .about-team__text"), counter: rect(".about-team__counter"), progress: rect(".about-team__progress"), next: rect(".about-team__next"), width: document.documentElement.scrollWidth };
      });
      expect(layout.width).toBe(width);
      expect(layout.text.top).toBeGreaterThan(Math.max(layout.counter.bottom, height / 2 - 40));
      expect(layout.text.bottom).toBeLessThanOrEqual(layout.progress.top);
      expect(layout.next.bottom).toBeLessThanOrEqual(height);
      expect(layout.next.right).toBeLessThanOrEqual(width);
    }
  }
});

test("a direct team link lands on the section and focuses it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(teamUrl());
  await expect(team(page)).toBeFocused();
  await expect.poll(() => team(page).evaluate((node) => Math.abs(node.getBoundingClientRect().top))).toBeLessThan(1);
});

test("turning a phone to a very short landscape returns the team to cards, and back to the scene", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(teamUrl());
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
  await page.setViewportSize({ width: 844, height: 340 });
  await expect(team(page)).toHaveAttribute("data-about-team", "cards");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".about-team").scrollIntoViewIfNeeded();
  await expect(team(page)).toHaveAttribute("data-about-team", "live");
});
