import { expect, test } from "@playwright/test";
import { appConfig, testOrigin } from "../../lib/config";
import { locales, pageUrl } from "../../lib/routing";

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
  }
  await context.close();
});

test("hero uses the mobile image and keeps the background static", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl("home", "bg"));
  const source = await page.locator(".hero__background").evaluate((image: HTMLImageElement) => image.currentSrc);
  expect(source).toContain("Hero_Background_Mobile_1440x2560");
  await expect(page.locator(".hero__stage")).toHaveCSS("position", "absolute");
  await expect(page.locator(".hero-orb")).toHaveCount(1);
  const mobileOrder = await page.evaluate(() => {
    const heading = document.querySelector(".hero h1")!.getBoundingClientRect();
    const orb = document.querySelector(".hero-orb")!.getBoundingClientRect();
    const lede = document.querySelector(".hero__lede")!.getBoundingClientRect();
    const actions = Array.from(document.querySelectorAll(".hero__actions .button")).map((button) => button.getBoundingClientRect());
    return orb.top >= heading.bottom && lede.top >= orb.bottom && actions[1].top >= actions[0].bottom;
  });
  expect(mobileOrder).toBe(true);
  await expect(page.locator("#services, #projects, #contact")).toHaveCount(0);
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
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
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
        return { headlineRight, heading: box(".hero h1").bottom, orb: box(".hero-orb"), lede: box(".hero__lede"), viewportHeight: innerHeight };
      });
      const label = `${locale} at ${viewport.width}x${viewport.height}`;
      for (const bottom of [layout.heading, layout.orb.bottom, layout.lede.bottom]) expect(bottom, label).toBeLessThanOrEqual(layout.viewportHeight);
      expect(layout.headlineRight, label).toBeLessThan(Math.min(layout.orb.left, layout.lede.left));
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
