import { expect, test } from "@playwright/test";
import { pageUrl } from "@/lib/routing";

const about = pageUrl("about", "bg");

test("About animation runs with either motion preference and hands the logo to the header", async ({ browser }) => {
  test.setTimeout(60_000);
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
  // Without Canvas there is no background or particle logo, but the messages still slide.
  await expect(page.locator(".about-content")).toHaveAttribute("data-about-motion", "");
  const body = page.locator("#about-message-1 .about-message__body");
  await expect(body).toHaveCSS("position", "fixed");
  const frames: { x: number; opacity: number }[] = [];
  for (const at of [.12, .2, .4]) {
    await page.locator("#about-message-1").evaluate((section, phase) => {
      scrollTo(0, section.getBoundingClientRect().top + scrollY + (section as HTMLElement).offsetHeight * phase - innerHeight * .35);
    }, at);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    frames.push(await body.evaluate((node) => ({ x: new DOMMatrix(getComputedStyle(node).transform).m41, opacity: Number(getComputedStyle(node).opacity) })));
  }
  expect(new Set(frames.map((frame) => Math.round(frame.x))).size).toBeGreaterThan(1);
  expect(Math.max(...frames.map((frame) => frame.opacity))).toBe(1);
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

test("the arrow stays fixed through About content and remains accessible without a caption", async ({ page }) => {
  await page.goto(about, { waitUntil: "domcontentloaded" });
  const cue = page.locator(".about-scroll");
  await expect(cue).toBeVisible();
  await expect(cue).toHaveAccessibleName("Към следващия раздел");
  await expect(page.locator(".about-scroll__caption")).toHaveCount(0);
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
  const firstBox = await cue.boundingBox();
  const first = await page.locator(".about-scroll__arrow").evaluate((node) => getComputedStyle(node).transform);
  await page.evaluate(() => scrollTo(0, innerHeight * .6));
  await expect.poll(() => page.locator(".about-scroll__arrow").evaluate((node) => getComputedStyle(node).transform)).not.toBe(first);
  const middleBox = await cue.boundingBox();
  expect(Math.abs(middleBox!.x - firstBox!.x)).toBeLessThan(2);
  expect(Math.abs(middleBox!.y - firstBox!.y)).toBeLessThan(2);
  await page.locator(".about-message").first().scrollIntoViewIfNeeded();
  const contentBox = await cue.boundingBox();
  expect(Math.abs(contentBox!.y - firstBox!.y)).toBeLessThan(2);
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(() => page.locator(".about-scroll__arrow").evaluate((node) => getComputedStyle(node).transform)).toBe(first);
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(cue).toBeHidden();
});

test("text scenes move horizontally and the background can be paused", async ({ page }) => {
  await page.goto(about);
  await page.evaluate(() => document.querySelector(".about-message")?.scrollIntoView({ block: "center" }));
  const message = page.locator(".about-message").first();
  await expect(message).toBeInViewport();
  const initial = await message.evaluate((node) => getComputedStyle(node.querySelector(".about-message__body")!).transform);
  await page.evaluate(() => scrollBy(0, innerHeight * .7));
  await expect.poll(() => message.evaluate((node) => getComputedStyle(node.querySelector(".about-message__body")!).transform)).not.toBe(initial);
  const before = await page.locator(".about-scene canvas").evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(250);
  const after = await page.locator(".about-scene canvas").evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  expect(after).not.toBe(before);
  const toggle = page.locator(".about-scene__toggle");
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("Пусни фона");
  const paused = await page.locator(".about-scene canvas").evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(250);
  expect(await page.locator(".about-scene canvas").evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(paused);
});

test("message blocks cross the screen horizontally with a narrow text column and orange rule", async ({ page }) => {
  for (const { width, height } of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize({ width, height });
    await page.goto(about);
    await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
    const section = page.locator("#about-message-1");
    const sample = async (phase: number) => {
      await section.evaluate((node, passed) => {
        const anchor = parseFloat(getComputedStyle(document.querySelector(".about-content")!).getPropertyValue("--about-message-top"));
        scrollTo(0, node.getBoundingClientRect().top + scrollY + passed * innerHeight - anchor);
      }, phase);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      return section.locator(".about-message__body").evaluate((body) => {
        const box = body.getBoundingClientRect();
        const style = getComputedStyle(body);
        const paragraph = body.querySelector("p")!.getBoundingClientRect();
        return { left: box.left, right: box.right, paragraphRight: paragraph.right, top: box.top, position: style.position, opacity: Number(style.opacity), ruleWidth: style.borderInlineStartWidth, ruleColor: style.borderInlineStartColor, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
      });
    };
    const beginning = await sample(0);
    const entering = await sample(.275);
    const resting = await sample(.55 + (width <= 760 ? .375 : .3));
    const leaving = await sample(.55 + (width <= 760 ? .75 : .6) + .275);
    const end = await sample(.55 + (width <= 760 ? .75 : .6) + .55);
    expect(beginning.left, `${width}px entry`).toBeGreaterThanOrEqual(width);
    expect(end.right, `${width}px exit`).toBeLessThanOrEqual(0);
    expect(resting.opacity).toBe(1);
    expect(entering.opacity).toBeGreaterThan(.95);
    expect(leaving.opacity).toBeGreaterThan(.95);
    expect(resting.ruleWidth).toBe("2px");
    expect(resting.ruleColor).toBe("rgb(255, 102, 0)");
    expect(resting.right).toBeLessThanOrEqual(width);
    expect(resting.paragraphRight).toBeLessThanOrEqual(width);
    for (const frame of [beginning, entering, resting, leaving, end]) {
      expect(frame.position).toBe("fixed");
      expect(Math.abs(frame.top - resting.top), `${width}px vertical drift`).toBeLessThanOrEqual(1);
      expect(frame.scrollWidth).toBe(frame.clientWidth);
    }
    await expect(page.locator(".about-message__index")).toHaveCount(0);
    const textWidth = await section.locator("p").evaluate((node) => node.getBoundingClientRect().width);
    expect(textWidth).toBeLessThan(width * .75);
  }
});

test("text stays at one screen height while the mouse wheel moves it right to left", async ({ page }) => {
  for (const [{ width, height }, reducedMotion] of [
    [{ width: 1440, height: 900 }, "no-preference"],
    [{ width: 390, height: 844 }, "no-preference"],
    [{ width: 1536, height: 730 }, "reduce"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion });
    await page.goto(about);
    await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
    await page.locator("#about-message-1").evaluate((section) => {
      const anchor = parseFloat(getComputedStyle(document.querySelector(".about-content")!).getPropertyValue("--about-message-top"));
      scrollTo(0, section.getBoundingClientRect().top + scrollY - anchor - 80);
    });
    const frames: { top: number; left: number; opacity: number }[] = [];
    for (let step = 0; step < 18; step++) {
      await page.mouse.wheel(0, 85);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      // Stacked sticky texts were the reduced-motion defect: never show two messages at once.
      expect(await page.locator(".about-message__body").evaluateAll((bodies) => bodies.filter((body) => {
        const box = body.getBoundingClientRect();
        return Number(getComputedStyle(body).opacity) > .05 && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight;
      }).length), `${reducedMotion} step ${step}`).toBeLessThanOrEqual(1);
      frames.push(await page.locator("#about-message-1 .about-message__body").evaluate((body) => {
        const box = body.getBoundingClientRect();
        return { top: box.top, left: box.left, opacity: Number(getComputedStyle(body).opacity) };
      }));
    }
    const visible = frames.filter((frame) => frame.opacity > .05);
    expect(visible.length).toBeGreaterThan(5);
    expect(Math.max(...visible.map((frame) => frame.top)) - Math.min(...visible.map((frame) => frame.top))).toBeLessThanOrEqual(1);
    expect(visible.every((frame) => frame.top >= 0 && frame.top < height)).toBe(true);
    for (let index = 1; index < visible.length; index++) {
      expect(visible[index].left).toBeLessThanOrEqual(visible[index - 1].left + .5);
    }
    expect(visible.at(-1)!.left).toBeLessThan(visible[0].left - width * .25);
  }
});

test("a direct message fragment lands on readable text", async ({ page }) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.goto("about:blank");
    await page.goto(`${about}#about-message-2`);
    const section = page.locator("#about-message-2");
    await expect(section.locator(".about-message__body")).toHaveCSS("opacity", "1");
    await expect(section.locator("p")).toBeInViewport();
    await expect(page.locator(".about-scroll")).toHaveCSS("position", "fixed");
    await expect(page).toHaveURL(/#about-message-2$/);
    await page.locator(".about-scroll").click();
    await expect(page.locator("#about-message-3")).toBeFocused();
  }
});

test("changing the message fragment positions readable text", async ({ page }) => {
  await page.goto(`${about}#about-title`);
  await page.evaluate(() => { location.hash = "#about-message-2"; });
  await expect(page.locator("#about-message-2 .about-message__body")).toHaveCSS("opacity", "1");
  await expect(page.locator("#about-message-2 p")).toBeInViewport();
});

test("a dismissed intro keeps the arrow fixed and the heading revealed", async ({ page }) => {
  await page.goto(about);
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
  await page.evaluate(() => scrollTo(0, 3));
  await page.locator(".site-menu > summary").focus();
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-dismissed", "");
  await expect(page.locator(".about-scroll")).toHaveCSS("position", "fixed");
  await expect(page.locator(".about-title__reveal")).toHaveCSS("opacity", "1");
  await page.locator(".about-scroll").click();
  await expect(page.locator("#about-title")).toBeFocused();
});

test("print shows every message without scroll transforms", async ({ page }) => {
  await page.goto(about);
  await page.emulateMedia({ media: "print" });
  for (const body of await page.locator(".about-message__body").all()) {
    await expect(body).toHaveCSS("opacity", "1");
    await expect(body).toHaveCSS("transform", "none");
    await expect(body).toHaveCSS("position", "static");
  }
  await expect(page.locator(".about-title__reveal")).toHaveCSS("opacity", "1");
});

test("the pause control does not cover long text on narrow phones", async ({ page }) => {
  for (const { width, height, url } of [
    { width: 320, height: 500, url: about },
    { width: 320, height: 700, url: pageUrl("about", "en") },
    { width: 390, height: 844, url: pageUrl("about", "en") },
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${url}#about-message-4`);
    await expect(page.locator("#about-message-4 .about-message__body")).toHaveCSS("opacity", "1");
    const text = await page.locator("#about-message-4 p").boundingBox();
    const toggle = await page.locator(".about-scene__toggle").boundingBox();
    const overlap = text!.x < toggle!.x + toggle!.width && text!.x + text!.width > toggle!.x
      && text!.y < toggle!.y + toggle!.height && text!.y + text!.height > toggle!.y;
    expect(overlap, `${width}x${height} text and pause control`).toBe(false);
  }
});

test("the title stays in the upper right without covering messages", async ({ page }) => {
  for (const { width, height } of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize({ width, height });
    await page.goto(about);
    await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
    for (const index of [1, 4]) {
      await page.locator(`#about-message-${index}`).evaluate((section) => {
        scrollTo(0, section.getBoundingClientRect().top + scrollY + innerHeight * .5);
      });
      const geometry = await page.evaluate((messageIndex) => {
        const heading = document.querySelector("#about-title")!.getBoundingClientRect();
        const header = document.querySelector(".site-header")!.getBoundingClientRect();
        const message = document.querySelector(`#about-message-${messageIndex} p`)!.getBoundingClientRect();
        return { titleTop: heading.top, titleRight: heading.right, titleBottom: heading.bottom, headerBottom: header.bottom, messageTop: message.top };
      }, index);
      expect(geometry.titleTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
      expect(geometry.titleRight).toBeGreaterThan(width * .65);
      expect(geometry.titleBottom + 16).toBeLessThan(geometry.messageTop);
    }
  }
});

test("reduced motion keeps the moving background, its pause control and the arrow colors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(about);
  const toggle = page.locator(".about-scene__toggle");
  // The toggle is unhidden only after the canvas is sized, so this snapshot is not the default 300x150 buffer.
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName("Пауза на фона");
  const canvas = page.locator(".about-scene canvas");
  const initial = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(initial);
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("Пусни фона");
  const paused = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(250);
  expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(paused);
  await expect(page.locator(".about-scroll__arrow")).toHaveCSS("animation-name", /about-arrow-colors/);
});

test("message motion is identical with and without reduced motion", async ({ browser }) => {
  const samples: string[][] = [];
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
    const page = await context.newPage();
    await page.goto(`${about}#about-title`);
    await expect(page.locator(".about-content")).toHaveAttribute("data-about-motion", "");
    const sample: string[] = [];
    for (const [index, phase] of [[1, .1], [2, .55], [3, .9]] as const) {
      await page.locator(`#about-message-${index}`).evaluate((section, at) => {
        scrollTo(0, section.getBoundingClientRect().top + scrollY + (section as HTMLElement).offsetHeight * at - innerHeight);
      }, phase);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      sample.push(...await page.locator(".about-message__body").evaluateAll((bodies) => bodies.map((body) => {
        const style = getComputedStyle(body);
        return `${style.position} ${style.transform} ${Number(style.opacity).toFixed(2)}`;
      })));
    }
    samples.push(sample);
    await context.close();
  }
  expect(samples[1]).toEqual(samples[0]);
  expect(samples[0].some((value) => value.startsWith("fixed matrix"))).toBe(true);
});

test("very short screens keep every message in document flow with either motion preference", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 340 });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.goto("about:blank");
    await page.goto(`${about}#about-message-2`);
    const body = page.locator("#about-message-2 .about-message__body");
    await expect(body).toHaveCSS("position", "static");
    await expect(body).toHaveCSS("opacity", "1");
    await expect(body).toHaveCSS("transform", "none");
    await expect(body.locator("p")).toBeInViewport();
  }
});

test("the menu pauses the background and footer removes its control", async ({ page }) => {
  await page.goto(about);
  const canvas = page.locator(".about-scene canvas");
  const toggle = page.locator(".about-scene__toggle");
  await page.locator(".site-menu > summary").click();
  await expect(toggle).toBeHidden();
  const paused = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(250);
  expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(paused);
  await page.locator(".site-menu > summary").click();
  await expect(toggle).toBeVisible();
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(paused);
  await toggle.focus();
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(toggle).toBeHidden();
  await expect(page.locator("#about-footer")).toBeFocused();
});

test("the first arrow click finishes the logo flight and keeps the title visible", async ({ page }) => {
  await page.goto(about);
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
  await page.locator(".about-scroll").click();
  await expect(page.locator("#about-title")).toBeFocused();
  await expect(page.locator(".site-header__brand img")).toHaveCSS("opacity", "1");
  await expect(page.locator("#about-title")).toBeInViewport();
  await expect(page.locator("#about-title .about-title__reveal")).toHaveCSS("opacity", "1");
});

test("the logo and heading overlap without an empty transition frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(about);
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
  await expect(page.locator(".about-intro")).toHaveAttribute("data-about-phase", "logo", { timeout: 9000 });
  for (let step = 0; step <= 12; step++) {
    await page.evaluate((y) => scrollTo(0, y), step * 45);
    await page.waitForTimeout(30);
    const visible = await page.evaluate(() => {
      const logo = document.querySelector<HTMLElement>(".about-intro__flight-logo")!;
      const heading = document.querySelector<HTMLElement>("#about-title span")!;
      const inViewport = (box: DOMRect) => box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
      return (inViewport(logo.getBoundingClientRect()) && Number(getComputedStyle(logo).opacity) > .05)
        || (inViewport(heading.getBoundingClientRect()) && Number(getComputedStyle(heading).opacity) > .1);
    });
    expect(visible, `scroll step ${step}`).toBe(true);
  }
});

test("the arrow advances through readable scenes and yields to the footer", async ({ page }) => {
  await page.goto(about);
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
  const arrow = page.locator(".about-scroll");
  await arrow.click();
  await expect(page.locator("#about-title")).toBeFocused();
  await arrow.click();
  await expect(page.locator("#about-message-1")).toBeFocused();
  await expect(page.locator("#about-message-1 .about-message__body")).toHaveCSS("opacity", "1");
  await arrow.click();
  await arrow.click();
  await expect(page.locator("#about-message-3")).toBeFocused();
  await arrow.click();
  await expect(page.locator("#about-message-4")).toBeFocused();
  await arrow.click();
  await expect(page.locator("#about-footer")).toBeFocused();
  await expect(arrow).toBeHidden();
});

test("mobile About text stays within the viewport and the arrow remains clickable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(about);
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
  await page.evaluate(() => scrollTo(0, innerHeight * .35));
  const arrowHit = await page.locator(".about-scroll").evaluate((link) => {
    const box = link.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(".about-scroll") === link;
  });
  expect(arrowHit).toBe(true);
  await page.locator(".about-scroll").click();
  await expect(page.locator("#about-title")).toBeFocused();
  for (const id of ["about-title", "about-message-1", "about-message-2", "about-message-3", "about-message-4"]) {
    if (id !== "about-title") {
      await page.locator(".about-scroll").click();
      await expect(page.locator(`#${id}`)).toBeFocused();
      await expect(page.locator(`#${id} .about-message__body`)).toHaveCSS("opacity", "1");
    }
    const box = await page.locator(id === "about-title" ? "#about-title .about-title__reveal" : `#${id} p`).boundingBox();
    expect(box!.x, id).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, id).toBeLessThanOrEqual(390);
  }
});

test("dismissing the intro after scrolling keeps the heading unobstructed", async ({ page }) => {
  await page.goto(about);
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
  await page.evaluate(() => scrollTo(0, innerHeight * .3));
  await page.locator(".site-menu > summary").focus();
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-dismissed", "");
  await page.evaluate(() => scrollTo(0, innerHeight * .55));
  const visible = await page.locator("#about-title").evaluate((heading) => {
    const box = heading.getBoundingClientRect();
    const headerBottom = document.querySelector(".site-header")!.getBoundingClientRect().bottom;
    return box.top >= headerBottom && box.bottom <= innerHeight
      && getComputedStyle(heading.querySelector(".about-title__reveal")!).opacity === "1";
  });
  expect(visible).toBe(true);
  await expect(page.locator(".about-intro__static-logo")).toHaveCSS("opacity", "0");
});

test("keyboard and repeated touch input can advance the arrow", async ({ page }) => {
  await page.goto(about);
  await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
  const arrow = page.locator(".about-scroll");
  await arrow.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#about-title")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(arrow).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#about-message-1")).toBeFocused();
  await arrow.click();
  await arrow.dispatchEvent("touchstart");
  await arrow.click();
  await expect(page.locator("#about-message-3")).toBeFocused();
});

test("long copy fits narrow, landscape and English layouts", async ({ page }) => {
  test.setTimeout(90_000);
  for (const { width, height, url } of [
    { width: 320, height: 700, url: about },
    { width: 844, height: 390, url: about },
    { width: 740, height: 380, url: about },
    { width: 844, height: 390, url: pageUrl("about", "en") },
    { width: 740, height: 380, url: pageUrl("about", "en") },
    { width: 390, height: 844, url: pageUrl("about", "en") },
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(url);
    await expect(page.locator(".site-page--about")).toHaveAttribute("data-about-enhanced", "", { timeout: 5000 });
    await page.locator(".about-scroll").click();
    for (let index = 1; index <= 4; index++) {
      const section = page.locator(`#about-message-${index}`);
      await page.locator(".about-scroll").click();
      await expect(section).toBeFocused();
      await expect(section.locator(".about-message__body")).toHaveCSS("opacity", "1");
      const box = await section.locator("p").boundingBox();
      expect(box!.x, `${width}x${height}, message ${index}`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${width}x${height}, message ${index}`).toBeLessThanOrEqual(width);
      // Only the bottom controls that share columns with the text can cover it.
      const controlsTop = await page.evaluate(({ left, right }) => Math.min(Infinity, ...[".about-scene__toggle", ".about-scroll"]
        .map((selector) => document.querySelector(selector)!.getBoundingClientRect())
        .filter((rect, i) => rect.height > 0 && rect.left < right && rect.right > left
          && getComputedStyle(document.querySelector([".about-scene__toggle", ".about-scroll"][i])!).visibility !== "hidden")
        .map((rect) => rect.top)), { left: box!.x, right: box!.x + box!.width });
      expect(box!.y + box!.height, `${width}x${height}, message ${index} above the controls`).toBeLessThanOrEqual(controlsTop);
    }
  }
});
