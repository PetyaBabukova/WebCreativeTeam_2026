"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { IBM_Plex_Mono, Sofia_Sans_Extra_Condensed } from "next/font/google";
import { appConfig, parseCookieChoice } from "@/lib/config";
import type { AboutScene } from "./AboutScene";
import "./AboutPage.css";

// The counter font is scoped to About and not preloaded on the other routes that share SitePage.
const counterFont = IBM_Plex_Mono({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-about-counter" });
// The narrow cut of the site font lets the one-line wordmark stand much taller at the same width.
const logoFont = Sofia_Sans_Extra_Condensed({ weight: "1000", subsets: ["latin"], display: "swap", preload: false, variable: "--font-about-logo" });

type AboutCopy = {
  title: string; titlePrefix: string; titleBrand: string; introLabel: string; scrollCue: string; loading: string; loaded: string;
  backgroundPause: string; backgroundPlay: string; introLead: string[]; introTail: string[]; messageLeads: string[]; messages: string[];
  // Coloured phrases per text block, in strip order (intro lead, intro tail, messages); no text colours the whole block.
  accents: Accent[][];
};
// tone names an about-word--<tone> colour class: orange or green.
type Accent = { text?: string; tone: string };
type BootWindow = Window & { __aboutBootDeadline?: number; __aboutBootTimer?: number };
type IntroPhase = "preloading" | "wipe" | "live" | "static";
// One block of the horizontal strip: where it rests on screen, at which strip offset, and how fast it travels.
type StripItem = { element: HTMLElement; rest: number; restOffset: number; speed: number; width: number; intro: boolean; message: number };

// The wordmark is stretched upwards, but never taller than this share of the viewport.
// Owner request, 25 November 2026: 20% lower than the first stretched version (1.5x, 38%).
const logoStretch = { max: 1.2, viewportShare: .304 };
const backgroundScrollIdleMilliseconds = 200;
// Stage 2 hero exit, as shares of the hero's sticky travel: letters fall left to right, the cue leaves first,
// and the particle cloud has become a column by the collapse end. The intro block surfaces while the letters fall.
const heroExit = { letterDelay: .02, letterDuration: .35, cueEnd: .15, collapseEnd: .7, introStart: .55, introLength: .35 };
// Stage 3 strip: scroll needed per pixel of horizontal travel (in viewport heights per viewport width),
// the lag of the lower block of a pair, the faster upper/left blocks, and the wheel-only smoothing.
// inset: the extra share of the screen width between the strip blocks and the screen edges on wide screens.
const strip = { inset: .06, scrollPerWidth: 1.1, pairLag: .15, leadSpeed: 1.15, enterLength: .5, exitStart: .25, exitLength: .4, smoothingMilliseconds: 150, wheelWindowMilliseconds: 200 };
// A slow font never holds the scene back: past this wait the wordmark falls back and the cloud keeps dots only.
const fontWaitMilliseconds = 1500;
const settleWithin = (promises: Promise<unknown>[]) => Promise.race([Promise.allSettled(promises), new Promise((resolve) => setTimeout(resolve, fontWaitMilliseconds))]);
const introTiming = { counterTick: 160, finishMilliseconds: 400, wipeMilliseconds: 900, minStep: 6, maxStep: 20 };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const step = clamp(value); return step * step * (3 - 2 * step); };
const digits = (value: number) => String(Math.round(value)).padStart(3, "0").split("").map(Number);

// Splits text into word spans with real spaces between them. Each word carries its reading-order share (--w),
// from which CSS derives the word-by-word surfacing; the text stays one readable, searchable run.
// glue: the part continues the previous one without a space ("lead" + ", rest").
type WordPart = { text: string; className?: string; line?: boolean; glue?: boolean };
// accents: whole words inside a coloured phrase take its tone; a phrase that is not in the text is ignored.
function Words({ parts, accents = [] }: { parts: WordPart[]; accents?: Accent[] }) {
  const tokens = parts.map((part) => part.text.split(" ").filter(Boolean));
  const flat = tokens.flat();
  const total = Math.max(1, flat.length - 1);
  const joined = flat.join(" ");
  const tones: (Accent["tone"] | undefined)[] = [];
  let start = 0;
  for (const word of flat) {
    const accent = accents.find((item) => {
      if (!item.text) return true;
      const at = joined.indexOf(item.text);
      return at >= 0 && start >= at && start < at + item.text.length;
    });
    tones.push(accent?.tone);
    start += word.length + 1;
  }
  let index = 0;
  const nodes: ReactNode[] = [];
  parts.forEach((part, partIndex) => {
    const words = tokens[partIndex].map((word, wordIndex) => {
      const tone = tones[index];
      const style = { "--w": (index++ / total).toFixed(3) } as CSSProperties;
      return <span className={tone ? `about-word about-word--${tone}` : "about-word"} style={style} key={wordIndex}>{word}{wordIndex < tokens[partIndex].length - 1 ? " " : ""}</span>;
    });
    const group = <span className={part.className} key={partIndex}>{words}</span>;
    nodes.push(part.line ? <span className="about-intro__line" key={partIndex}>{group}</span> : group);
    if (partIndex < parts.length - 1 && !parts[partIndex + 1].glue) nodes.push(" ");
  });
  return <>{nodes}</>;
}

export default function AboutPage({ copy }: { copy: AboutCopy }) {
  const heroRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLParagraphElement>(null);
  const preloaderRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // The wordmark comes from the brand name: "WebCreativeTeam" -> WEB / CREATIVE / TEAM.
  const words = copy.titleBrand.match(/[A-Z][a-z]*/g) ?? [copy.titleBrand];

  useLayoutEffect(() => {
    const hero = heroRef.current;
    const canvas = canvasRef.current;
    const logo = logoRef.current;
    const preloader = preloaderRef.current;
    const status = statusRef.current;
    const content = contentRef.current;
    const background = backgroundRef.current;
    const scene = sceneRef.current;
    const pauseButton = pauseRef.current;
    const title = titleRef.current;
    const root = hero?.closest<HTMLElement>(".site-page--about");
    const header = root?.querySelector<HTMLElement>(".site-header");
    const footer = root?.querySelector<HTMLElement>(".site-footer");
    const stage = hero?.querySelector<HTMLElement>(".about-hero__stage");
    const stripStage = content?.querySelector<HTMLElement>(".about-strip__stage");
    if (!hero || !canvas || !logo || !preloader || !status || !content || !background || !scene || !pauseButton || !title || !root || !header || !footer || !stage || !stripStage) return;
    const counterStrips = Array.from(preloader.querySelectorAll<HTMLElement>(".about-counter__strip"));
    const letters = Array.from(logo.querySelectorAll<HTMLElement>(".about-hero__letter"));
    const blocks = Array.from(content.querySelectorAll<HTMLElement>(".about-strip__item"));
    const messages = Array.from(content.querySelectorAll<HTMLElement>(".about-message"));

    const boot = window as BootWindow;
    const initialDeadline = boot.__aboutBootDeadline ?? performance.now() + appConfig.aboutIntro.deadlineMilliseconds;
    const eligible = window.scrollY < 2 && !location.hash;
    if (boot.__aboutBootTimer !== undefined) clearTimeout(boot.__aboutBootTimer);
    boot.__aboutBootTimer = undefined;
    boot.__aboutBootDeadline = undefined;

    let alive = true;
    let phase: IntroPhase | null = null;
    let preparing = false;
    let ready = false;
    let shown = 0;
    let real = 0;
    let counterStarted = 0;
    let counterTimer = 0;
    let deadlineTimer = 0;
    let wipeTimer = 0;
    let particles: AboutScene | null = null;
    const backgroundContext = background.getContext("2d");
    let sceneRaf = 0;
    let sceneElapsed = 0;
    let lastSceneFrame = 0;
    let lastScenePaint = 0;
    let sceneWidth = 0;
    let sceneHeight = 0;
    let sceneRatio = 0;
    let sceneRunning = false;
    let sceneFooterVisible = false;
    // The owner chose one motion design for every visitor; the OS reduced-motion
    // setting is deliberately not read. Moving layers keep a manual pause.
    let sceneUserPaused = false;
    let scrolling = false;
    let scrollIdleTimer = 0;
    // Shared geometry, measured on layout changes only; every frame reads it with the displayed scroll.
    let heroTop = 0;
    let heroTravel = 0;
    let stripScroll = 0;
    let stripLength = 0;
    let viewportWidth = 1;
    let items: StripItem[] = [];
    let stripActive = false;
    // The displayed scroll follows the real one, smoothed only right after wheel input.
    let shownScroll = scrollY;
    let lastWheel = -Infinity;
    let motionRaf = 0;
    let lastMotionFrame = 0;
    // Text is readable on screen (intro surfacing or strip moving): the particles then turn only while scrolling.
    let textOnScreen = false;
    let sceneGone = false;
    const compactQuery = matchMedia("(height <= 23rem)");
    const mobileQuery = matchMedia("(width <= 47.5rem)");
    const singleQuery = matchMedia("(width < 37.5rem), (orientation: landscape) and (height <= 34rem)");
    const mobileViewport = () => mobileQuery.matches;
    const letterProgress: string[] = [];

    const heroProgress = (at: number) => heroTravel < 2 ? 0 : clamp((at - heroTop) / heroTravel);

    function updateHeroExit(progress: number) {
      // Without the particle column the letters are the only thing on stage, so they fall over the whole travel.
      const duration = particles ? heroExit.letterDuration : 1 - heroExit.letterDelay * (letters.length - 1);
      letters.forEach((letter, index) => {
        const value = clamp((progress - heroExit.letterDelay * index) / duration).toFixed(3);
        if (letterProgress[index] !== value) { letterProgress[index] = value; letter.style.setProperty("--about-letter", value); }
      });
      const exited = progress > heroExit.cueEnd;
      // CSS keeps a focused cue visible, so keyboard focus never sits on a hidden link.
      if (exited !== hero!.hasAttribute("data-about-exited")) hero!.toggleAttribute("data-about-exited", exited);
      particles?.setCollapse(smooth(progress / heroExit.collapseEnd));
    }

    // Measures the strip; any failure leaves the readable vertical flow in place.
    function measureStrip() {
      const shouldRun = !compactQuery.matches;
      try {
        heroTop = hero!.getBoundingClientRect().top + scrollY;
        heroTravel = Math.max(0, hero!.offsetHeight - stage!.clientHeight);
        if (!shouldRun) throw new Error("No strip on very short screens");
        content!.setAttribute("data-about-strip", "");
        viewportWidth = document.documentElement.clientWidth || 1;
        const width = viewportWidth;
        const single = singleQuery.matches;
        const gutter = parseFloat(getComputedStyle(content!).getPropertyValue("--gutter")) || 16;
        const edge = gutter + (single ? 0 : width * strip.inset);
        let offset = 0;
        items = blocks.map((element) => {
          const kind = element.dataset.stripKind!;
          const blockWidth = element.offsetWidth;
          const message = Number(element.dataset.message ?? -1);
          if (kind === "intro-lead") return { element, rest: edge, restOffset: 0, speed: strip.leadSpeed, width: blockWidth, intro: true, message };
          if (kind === "intro-tail") return { element, rest: single ? gutter : width - edge - blockWidth, restOffset: 0, speed: 1, width: blockWidth, intro: true, message };
          if (single) { offset = (message + 1) * width; return { element, rest: gutter, restOffset: offset, speed: 1, width: blockWidth, intro: false, message }; }
          const pair = Math.floor(message / 2) + 1;
          const lower = message % 2 === 1;
          offset = pair * width + (lower ? width * strip.pairLag : 0);
          return { element, rest: lower ? width * (.9 - strip.inset) - blockWidth : width * (.1 + strip.inset), restOffset: offset, speed: lower ? 1 : strip.leadSpeed, width: blockWidth, intro: false, message };
        });
        // Narrow screens stack the intro corners at the bottom: the lead sits right above the tail.
        const lead = blocks.find((block) => block.dataset.stripKind === "intro-lead");
        const tail = blocks.find((block) => block.dataset.stripKind === "intro-tail");
        if (lead && tail) lead.style.top = single ? `${tail.offsetTop - lead.offsetHeight - 16}px` : "";
        stripLength = Math.max(...items.map((item) => item.restOffset)) + width * .1;
        stripScroll = stripLength * strip.scrollPerWidth * innerHeight / width;
        content!.style.setProperty("--about-hero-height", `${hero!.offsetHeight}px`);
        content!.style.setProperty("--about-strip-height", `${heroTravel + stripScroll + stripStage!.clientHeight}px`);
        content!.toggleAttribute("data-about-single", single);
        stripActive = true;
      } catch {
        stripActive = false;
        items = [];
        content!.removeAttribute("data-about-strip");
      }
    }

    function updateStrip(at: number) {
      if (!stripActive) return;
      const progress = heroTravel + stripScroll > 0 ? clamp((at - heroTop - heroTravel) / Math.max(1, stripScroll)) : 0;
      const offset = progress * stripLength;
      const width = viewportWidth;
      const introIn = clamp((heroProgress(at) - heroExit.introStart) / heroExit.introLength);
      for (const item of items) {
        const x = item.rest - (offset - item.restOffset) * item.speed;
        const entering = item.intro ? introIn : clamp((width - x) / (width * strip.enterLength));
        const leaving = clamp((width * strip.exitStart - (x + item.width)) / (width * strip.exitLength));
        item.element.style.setProperty("--about-x", `${x.toFixed(1)}px`);
        item.element.style.setProperty("--about-in", entering.toFixed(3));
        item.element.style.setProperty("--about-out", leaving.toFixed(3));
        item.element.style.setProperty("--about-pointer", entering > .5 && leaving < .5 ? "auto" : "none");
      }
    }

    function render(at: number) {
      const progress = heroProgress(at);
      scene!.style.setProperty("--about-glow-opacity", String(.2 + .8 * clamp((progress - .85) / .15)));
      updateHeroExit(progress);
      try {
        updateStrip(at);
      } catch {
        // A runtime failure in the strip restores the readable vertical flow.
        stripActive = false;
        items = [];
        content!.removeAttribute("data-about-strip");
      }
      const text = stripActive && progress >= heroExit.introStart;
      // Without the strip the scene ends with the hero; with it, half a screen after the strip.
      const gone = at > heroTop + (stripActive ? heroTravel + stripScroll + innerHeight * .5 : hero!.offsetHeight);
      if (text !== textOnScreen || gone !== sceneGone) {
        textOnScreen = text;
        if (gone !== sceneGone) { sceneGone = gone; root!.toggleAttribute("data-about-scene-gone", gone); }
        syncMotion();
      }
    }

    // One loop for all scroll-linked motion; it runs only while the displayed scroll catches up.
    function motionFrame(now: number) {
      motionRaf = 0;
      if (!alive || document.hidden) return;
      const target = scrollY;
      const delta = lastMotionFrame ? Math.min(50, now - lastMotionFrame) : 16;
      lastMotionFrame = now;
      const smoothing = now - lastWheel < strip.wheelWindowMilliseconds && Math.abs(target - shownScroll) < innerHeight / 2;
      shownScroll = smoothing ? shownScroll + (target - shownScroll) * (1 - Math.exp(-delta / strip.smoothingMilliseconds)) : target;
      if (Math.abs(target - shownScroll) < .5) shownScroll = target;
      render(shownScroll);
      if (shownScroll !== target) motionRaf = requestAnimationFrame(motionFrame);
      else lastMotionFrame = 0;
    }
    const scheduleMotion = () => { if (!motionRaf) motionRaf = requestAnimationFrame(motionFrame); };
    // Jumps (hash, focus, resize, keyboard, back/forward) land at once.
    const snapMotion = () => { lastWheel = -Infinity; shownScroll = scrollY; render(shownScroll); };

    function setPhase(next: IntroPhase) {
      phase = next;
      root!.setAttribute("data-about-intro", next);
      document.documentElement.removeAttribute("data-about-boot");
      syncMotion();
    }

    function renderCounter(value: number) {
      digits(value).forEach((digit, index) => counterStrips[index]?.style.setProperty("--digit", String(digit)));
      preloader!.style.setProperty("--about-progress", String(clamp(value / 100)));
    }

    function drawScene() {
      if (!backgroundContext || !sceneWidth || !sceneHeight) return;
      backgroundContext.clearRect(0, 0, sceneWidth, sceneHeight);
      const count = sceneWidth < 768 ? 45 : 80;
      backgroundContext.globalAlpha = .55;
      for (let color = 0; color < 2; color++) {
        backgroundContext.beginPath();
        for (let index = color; index < count; index += 2) {
          const seedX = ((index * 73.371) % 100) / 100;
          const seedY = ((index * 41.137) % 100) / 100;
          const x = (seedX * sceneWidth + Math.sin(index * 1.7 + sceneElapsed * .00045) * sceneWidth * .025 + sceneWidth) % sceneWidth;
          const y = (seedY * sceneHeight + sceneElapsed * .006 * (index % 3 + 1)) % sceneHeight;
          const radius = 1 + index % 3;
          backgroundContext.moveTo(x + radius, y);
          backgroundContext.arc(x, y, radius, 0, Math.PI * 2);
        }
        backgroundContext.fillStyle = color === 0 ? "#ff660047" : "#68d58a36";
        backgroundContext.fill();
      }
      backgroundContext.globalAlpha = 1;
    }

    function tickScene(now: number) {
      if (!sceneRunning) return;
      if (lastSceneFrame) sceneElapsed += Math.min(50, now - lastSceneFrame);
      lastSceneFrame = now;
      if (!lastScenePaint || now - lastScenePaint >= 33) { drawScene(); lastScenePaint = now; }
      sceneRaf = requestAnimationFrame(tickScene);
    }

    // One pause state drives both moving layers: the background dots and the particles.
    function syncMotion() {
      const paused = sceneUserPaused || document.hidden || sceneFooterVisible || !!document.querySelector("dialog[open]") || !!header?.querySelector(".site-menu[open]");
      // Behind the readable strip the column turns only while the visitor scrolls.
      particles?.setPaused(paused || sceneGone || phase !== "live" || (textOnScreen && !scrolling));
      // The background dots drift only while the visitor scrolls; the hero particles are the only endless motion.
      const shouldRun = !!backgroundContext && !paused && scrolling;
      if (shouldRun === sceneRunning) return;
      sceneRunning = shouldRun;
      lastSceneFrame = 0;
      lastScenePaint = 0;
      cancelAnimationFrame(sceneRaf);
      if (sceneRunning) sceneRaf = requestAnimationFrame(tickScene);
      else drawScene();
    }

    function updatePauseControl() {
      if (!pauseButton) return;
      pauseButton.setAttribute("aria-label", sceneUserPaused ? copy.backgroundPlay : copy.backgroundPause);
      pauseButton.querySelector("span")!.textContent = sceneUserPaused ? "▶" : "Ⅱ";
    }

    const onPauseClick = () => { sceneUserPaused = !sceneUserPaused; updatePauseControl(); syncMotion(); };

    function resizeBackground() {
      if (!background || !backgroundContext) return;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      const width = background.clientWidth;
      const height = background.clientHeight;
      if (width === sceneWidth && height === sceneHeight && ratio === sceneRatio) return;
      sceneWidth = width;
      sceneHeight = height;
      sceneRatio = ratio;
      background.width = Math.round(width * ratio);
      background.height = Math.round(height * ratio);
      backgroundContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawScene();
    }

    // Size the wordmark so its widest line fills the container. Stacked words share one size.
    function fitLogo() {
      if (!logo) return;
      logo.style.removeProperty("--about-logo-size");
      const base = parseFloat(getComputedStyle(logo).fontSize);
      const spans = Array.from(logo.children) as HTMLElement[];
      const stacked = getComputedStyle(spans[0]).display === "block";
      const widths = spans.map((span) => span.getBoundingClientRect().width);
      const used = stacked ? Math.max(...widths) : widths.reduce((sum, width) => sum + width, 0);
      const available = logo.clientWidth;
      if (used > 0 && available > 0) logo.style.setProperty("--about-logo-size", `${(base * available / used * .995).toFixed(2)}px`);
      // Height cap: stretch up to the share of the viewport, or shrink the type when even unstretched it is taller.
      const height = logo.offsetHeight;
      const cap = innerHeight * logoStretch.viewportShare;
      if (height > cap) logo.style.setProperty("--about-logo-size", `${(parseFloat(getComputedStyle(logo).fontSize) * cap / height).toFixed(2)}px`);
      const stretch = height > 0 ? Math.max(1, Math.min(logoStretch.max, cap / height)) : 1;
      logo.style.setProperty("--about-logo-stretch", stretch.toFixed(3));
    }

    function relayout() {
      fitLogo();
      measureStrip();
      snapMotion();
    }

    root.setAttribute("data-about-layout", "");
    resizeBackground();
    relayout();
    void document.fonts.ready.then(() => { if (alive) relayout(); });
    // The keyboard pause stays available for the particles even without the 2D background.
    pauseButton.hidden = false;
    updatePauseControl();
    pauseButton.addEventListener("click", onPauseClick);
    syncMotion();
    const onScrollMotion = () => {
      scrolling = true;
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = window.setTimeout(() => { scrolling = false; syncMotion(); }, backgroundScrollIdleMilliseconds);
      syncMotion();
      scheduleMotion();
    };
    window.addEventListener("scroll", onScrollMotion, { passive: true });
    const onWheel = () => { lastWheel = performance.now(); };
    // Any other input that scrolls (keys, touch, pointer on the scrollbar) is shown at once.
    const onDirectInput = () => { lastWheel = -Infinity; };
    window.addEventListener("wheel", onWheel, { passive: true });
    for (const type of ["keydown", "touchstart", "pointerdown"]) window.addEventListener(type, onDirectInput, { passive: true });

    function stopIntroTimers() {
      clearInterval(counterTimer);
      clearTimeout(deadlineTimer);
      clearTimeout(wipeTimer);
    }

    // Static hero: wordmark and cue without particles. Used for late hydration, errors, skip and early scroll.
    function settleStatic() {
      if (phase === "static" || phase === "live") return;
      const wasPreloading = phase === "preloading" || phase === "wipe";
      stopIntroTimers();
      preparing = false;
      particles?.dispose();
      particles = null;
      setPhase("static");
      if (wasPreloading) announceLoaded();
    }

    // Replaces the "Loading" announcement once, then clears the live region.
    function announceLoaded() {
      status!.textContent = copy.loaded;
      window.setTimeout(() => { if (alive) status!.textContent = ""; }, 1500);
    }

    // At the shared deadline the counter finishes quickly; a ready scene still gets its reveal.
    function finishCounterThenStatic() {
      stopIntroTimers();
      const from = shown;
      const begin = performance.now();
      const step = () => {
        if (!alive || phase !== "preloading") return;
        const t = clamp((performance.now() - begin) / introTiming.finishMilliseconds);
        renderCounter(from + (100 - from) * t);
        if (t < 1) requestAnimationFrame(step); else if (ready && particles) reveal(); else settleStatic();
      };
      requestAnimationFrame(step);
    }

    function reveal() {
      stopIntroTimers();
      setPhase("wipe");
      wipeTimer = window.setTimeout(() => {
        if (!alive || phase !== "wipe") return;
        setPhase("live");
        particles?.start();
        syncMotion();
        announceLoaded();
      }, introTiming.wipeMilliseconds);
    }

    // The counter never runs faster than the minimum duration and never ahead of real preparation.
    function tickCounter() {
      if (!alive || phase !== "preloading") return;
      const timeShare = (performance.now() - counterStarted) / appConfig.aboutIntro.counterMinimumMilliseconds;
      const target = Math.min(real, clamp(timeShare)) * 100;
      if (target > shown) {
        shown = Math.min(target, shown + introTiming.minStep + Math.random() * (introTiming.maxStep - introTiming.minStep));
        if (target >= 100 && shown > 94) shown = 100;
        renderCounter(shown);
      }
      if (shown >= 100 && ready) reveal();
    }

    async function prepare(deadline: number) {
      try {
        // A missing font must not block the scene: the wordmark falls back and the cloud keeps its dots.
        await settleWithin([document.fonts.load(`1000 1em ${getComputedStyle(logo!).fontFamily}`), document.fonts.ready]);
        if (!alive || phase !== "preloading") return;
        real = .3;
        const { createAboutScene, glyphs } = await import("./AboutScene");
        if (!alive || phase !== "preloading") return;
        real = .5;
        const letterFont = getComputedStyle(document.body).fontFamily;
        const symbolFont = getComputedStyle(preloader!.querySelector(".about-counter")!).fontFamily;
        await settleWithin([document.fonts.load(`800 48px ${letterFont}`, glyphs.letters), document.fonts.load(`400 48px ${symbolFont}`, glyphs.symbols)]);
        const glyphFonts = document.fonts.check(`800 48px ${letterFont}`, glyphs.letters) && document.fonts.check(`400 48px ${symbolFont}`, glyphs.symbols) ? { letters: letterFont, symbols: symbolFont } : null;
        if (!alive || phase !== "preloading") return;
        real = .7;
        if (performance.now() >= deadline) return;
        particles = createAboutScene({ canvas: canvas!, compact: mobileViewport(), glyphFonts, onContextLost: () => {
          if (phase !== "live") { settleStatic(); return; }
          particles?.dispose();
          particles = null;
          setPhase("static");
        } });
        // Scene creation is synchronous GPU work; a result past the deadline is discarded.
        if (!alive || phase !== "preloading" || performance.now() >= deadline) { particles.dispose(); particles = null; return; }
        render(shownScroll);
        real = 1;
        ready = true;
      } catch {
        if (alive && phase === "preloading") finishCounterThenStatic();
      }
    }

    function start(deadline: number) {
      if (preparing || phase) return;
      if (!eligible || window.scrollY >= 2 || performance.now() >= deadline) { settleStatic(); return; }
      preparing = true;
      setPhase("preloading");
      status!.textContent = copy.loading;
      shown = 0;
      real = .1;
      renderCounter(0);
      counterStarted = performance.now();
      counterTimer = window.setInterval(tickCounter, introTiming.counterTick);
      deadlineTimer = window.setTimeout(finishCounterThenStatic, Math.max(0, deadline - performance.now()));
      void prepare(deadline);
    }

    // Scroll position where a target is fully readable: the intro block at the end of the hero exit,
    // a message at its resting place in the strip.
    function targetScroll(id: string) {
      if (!stripActive) return null;
      if (id === "about-title" || id === "main") return heroTop + heroTravel;
      const message = messages.findIndex((element) => element.id === id);
      const item = items.find((entry) => entry.message === message);
      if (message < 0 || !item) return null;
      return heroTop + heroTravel + item.restOffset / Math.max(1, stripLength) * stripScroll;
    }
    function goTo(id: string, focus: boolean) {
      const top = targetScroll(id);
      if (top === null) return false;
      scrollTo({ top, behavior: "auto" });
      snapMotion();
      if (focus) document.getElementById(id === "main" ? "about-title" : id)?.focus({ preventScroll: true });
      return true;
    }

    const onScroll = () => { if (phase === "preloading" && window.scrollY > 2) settleStatic(); };
    const globalSkip = document.querySelector<HTMLAnchorElement>(".skip-link");
    const cue = hero.querySelector<HTMLAnchorElement>(".about-hero__cue")!;
    // The skip link and the cue land where the intro heading is fully visible, and focus it.
    const onSkip = (event: MouseEvent) => {
      settleStatic();
      if (!stripActive) { requestAnimationFrame(() => title.focus({ preventScroll: true })); return; }
      event.preventDefault();
      goTo("main", true);
    };
    const onCue = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !stripActive) return;
      event.preventDefault();
      history.replaceState(history.state, "", "#about-title");
      goTo("about-title", true);
    };
    // Focus that lands on a message (screen reader, keyboard, script) brings it into view at once.
    const onFocusIn = (event: FocusEvent) => {
      const message = (event.target as HTMLElement).closest?.(".about-message");
      if (message && stripActive) goTo(message.id, false);
    };
    const onMenuToggle = () => syncMotion();
    let fragmentUserInput = false;
    const onFragmentInput = () => { fragmentUserInput = true; };
    function alignFragment() {
      const id = location.hash.slice(1);
      if (!id || !alive) return;
      goTo(id, true);
    }
    const onHashChange = () => { fragmentUserInput = false; requestAnimationFrame(alignFragment); };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && phase !== "live") settleStatic();
      else if (!phase && parseCookieChoice(document.cookie) !== null) start(performance.now() + appConfig.aboutIntro.deadlineMilliseconds);
      if (!fragmentUserInput) requestAnimationFrame(alignFragment);
      snapMotion();
    };
    const onVisibility = () => {
      if (!document.hidden && !phase && parseCookieChoice(document.cookie) !== null) start(performance.now() + appConfig.aboutIntro.deadlineMilliseconds);
      if (!document.hidden) snapMotion();
      syncMotion();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    globalSkip?.addEventListener("click", onSkip);
    cue.addEventListener("click", onCue);
    content.addEventListener("focusin", onFocusIn);
    header.addEventListener("toggle", onMenuToggle, true);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("hashchange", onHashChange);
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(type, onFragmentInput, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    const modalObserver = new MutationObserver(syncMotion);
    modalObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    const footerObserver = new IntersectionObserver(([entry]) => {
      sceneFooterVisible = entry.isIntersecting;
      if (sceneFooterVisible && document.activeElement === pauseButton) footer.focus({ preventScroll: true });
      pauseButton.hidden = sceneFooterVisible;
      syncMotion();
    });
    footerObserver.observe(footer);
    const observer = new ResizeObserver(() => relayout());
    observer.observe(logo);
    blocks.forEach((block) => observer.observe(block));
    const onResize = () => { resizeBackground(); relayout(); };
    window.addEventListener("resize", onResize);

    const onChoice = () => start(performance.now() + appConfig.aboutIntro.deadlineMilliseconds);
    window.addEventListener(appConfig.cookieChoice.eventName, onChoice);
    if (!eligible) settleStatic();
    else if (parseCookieChoice(document.cookie) !== null) start(initialDeadline);
    else document.documentElement.removeAttribute("data-about-boot");

    if (location.hash) {
      requestAnimationFrame(alignFragment);
      void document.fonts.ready.then(() => requestAnimationFrame(() => {
        if (!fragmentUserInput) alignFragment();
      }));
    }

    return () => {
      alive = false;
      stopIntroTimers();
      particles?.dispose();
      particles = null;
      cancelAnimationFrame(motionRaf);
      sceneRunning = false;
      cancelAnimationFrame(sceneRaf);
      document.documentElement.removeAttribute("data-about-boot");
      root.removeAttribute("data-about-intro");
      root.removeAttribute("data-about-layout");
      root.removeAttribute("data-about-scene-gone");
      content.removeAttribute("data-about-strip");
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScrollMotion);
      window.removeEventListener("wheel", onWheel);
      for (const type of ["keydown", "touchstart", "pointerdown"]) window.removeEventListener(type, onDirectInput);
      clearTimeout(scrollIdleTimer);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("hashchange", onHashChange);
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(type, onFragmentInput);
      document.removeEventListener("visibilitychange", onVisibility);
      modalObserver.disconnect();
      footerObserver.disconnect();
      pauseButton.removeEventListener("click", onPauseClick);
      header.removeEventListener("toggle", onMenuToggle, true);
      globalSkip?.removeEventListener("click", onSkip);
      cue.removeEventListener("click", onCue);
      content.removeEventListener("focusin", onFocusIn);
      window.removeEventListener(appConfig.cookieChoice.eventName, onChoice);
    };
  }, [copy.backgroundPause, copy.backgroundPlay, copy.loaded, copy.loading]);

  return <>
    <div className="about-scene" ref={sceneRef} aria-hidden="true"><canvas ref={backgroundRef} /></div>
    <canvas className="about-particles" ref={canvasRef} aria-hidden="true" />
    <section className={`about-hero ${counterFont.variable} ${logoFont.variable}`} ref={heroRef} aria-label={copy.introLabel}>
      <div className="about-hero__stage">
        <div className="container about-hero__logo-row">
          {/* A decorative duplicate of the brand in the h1; hidden so letters are never read one by one. */}
          <p className="about-hero__logo" ref={logoRef} aria-hidden="true">
            {words.map((word, index) => <span className={`about-hero__word about-hero__word--${index + 1}`} key={word}>{[...word].map((letter, position) => <span className="about-hero__letter" key={position}>{letter}</span>)}</span>)}
          </p>
        </div>
        <a id="about-scroll-link" className="about-hero__cue" href="#about-title">{copy.scrollCue}</a>
      </div>
      <div className="about-preloader" ref={preloaderRef} aria-hidden="true">
        <div className="about-preloader__bar"><span /></div>
        <div className="about-counter">
          {[2, 10, 10].map((size, column) => <span className="about-counter__digit" key={column}>
            <span className="about-counter__strip">{Array.from({ length: size }, (_, digit) => <span key={digit}>{digit}</span>)}</span>
          </span>)}
        </div>
        <svg className="about-preloader__wipe" width="100%" height="100%">
          <defs><mask id="about-wipe-mask"><rect width="100%" height="100%" fill="#fff" /><path className="about-preloader__letter" d="M0 0H22L31 62 43 0H57L69 62 78 0H100L82 100H61L50 46 39 100H18Z" fill="#000" /></mask></defs>
          <rect width="100%" height="100%" fill="#000" mask="url(#about-wipe-mask)" />
        </svg>
      </div>
      <p className="sr-only" ref={statusRef} aria-live="polite" />
    </section>
    <main id="main" className="about-content" tabIndex={-1} ref={contentRef}>
      <div className="about-strip__stage">
        <div className="about-strip__item about-intro about-intro--lead" data-strip-kind="intro-lead">
          <h1 id="about-title" tabIndex={-1} ref={titleRef}>
            <Words parts={copy.introLead.map((text, index) => ({ text, line: true, className: index === copy.introLead.length - 1 ? "about-intro__italic" : undefined }))} accents={copy.accents[0]} />
          </h1>
        </div>
        <p className="about-strip__item about-intro about-intro--tail" data-strip-kind="intro-tail">
          <Words parts={copy.introTail.map((text) => ({ text, line: true, className: "about-intro__italic" }))} accents={copy.accents[1]} />
        </p>
        {copy.messages.map((message, index) => {
          const leadWords = copy.messageLeads[index] && message.startsWith(copy.messageLeads[index]) ? copy.messageLeads[index] : "";
          return <section className={`about-strip__item about-message about-message--${index % 2 ? "lower" : "upper"}`} id={`about-message-${index + 1}`} tabIndex={-1} data-strip-kind="message" data-message={index} key={index}>
            <p><Words parts={[{ text: leadWords, className: "about-message__lead" }, { text: message.slice(leadWords.length), glue: !/^\s/.test(message.slice(leadWords.length)) }].filter((part) => part.text.trim())} accents={copy.accents[index + 2]} /></p>
          </section>;
        })}
      </div>
      <button className="about-scene__toggle" ref={pauseRef} type="button" aria-label={copy.backgroundPause} hidden><span aria-hidden="true">Ⅱ</span></button>
    </main>
  </>;
}
