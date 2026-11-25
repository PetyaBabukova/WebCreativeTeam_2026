"use client";

import { useLayoutEffect, useRef } from "react";
import { MotionConfig, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { appConfig, parseCookieChoice } from "@/lib/config";
import { ScrollArrow } from "./HeroOrb";
import "./AboutPage.css";

type AboutCopy = { title: string; titlePrefix: string; titleBrand: string; introLabel: string; scrollCue: string; backgroundPause: string; backgroundPlay: string; messages: string[] };
type BootWindow = Window & { __aboutBootDeadline?: number; __aboutBootTimer?: number };
type Dot = { x: number; y: number; startX: number; startY: number; color: number; propeller: boolean; size: number };

const palette = ["#ffffff", "#fff4db", "#ffe8b8", "#ffd688", "#ffbd65", "#ff9a42", "#ff7c24", "#ff6600", "#f8b351", "#e3dc73", "#d3df79", "#bee17a", "#a3db64", "#8cda6e", "#79d87d", "#68d58a", "#55c995", "#42b899", "#37a986", "#3b9b71", "#4b8e5c", "#59b300", "#6bbd35", "#82c64c", "#a5d66c", "#c4e48f", "#e5efba", "#f5f8dc"];
const timeline = { counter: 2000, swirl: 2600, word: 3900, propeller: 4600, wordFadeStart: 3500, wordFadeEnd: 4300, propellerFadeStart: 4400, propellerFadeEnd: 5000, end: 5300 };
const messageTiming = { start: .35, enter: .55, holdDesktop: .6, holdMobile: .75, exit: .55 };
const rgb = palette.map((hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)));
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => 1 - Math.pow(1 - clamp(value), 3);
const smooth = (value: number) => { const step = clamp(value); return step * step * (3 - 2 * step); };

function closestColor(r: number, g: number, b: number) {
  let best = 0;
  let distance = Infinity;
  rgb.forEach(([red, green, blue], index) => {
    const next = (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;
    if (next < distance) { distance = next; best = index; }
  });
  return best;
}

function createDots(image: HTMLImageElement, count: number): Dot[] {
  const source = document.createElement("canvas");
  source.width = 1024;
  source.height = Math.round(1024 * image.naturalHeight / image.naturalWidth);
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D unavailable");
  context.drawImage(image, 0, 0, source.width, source.height);
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  const candidates: Dot[] = [];
  // The SVG's left quarter contains the propeller. The same source supplies
  // both the particle colors and the finished, exact logo image.
  for (let y = 2; y < source.height; y += 4) for (let x = 2; x < source.width; x += 4) {
    const offset = (y * source.width + x) * 4;
    if (pixels[offset + 3] < 210) continue;
    candidates.push({ x: x / source.width, y: y / source.height, startX: 0, startY: 0, color: closestColor(pixels[offset], pixels[offset + 1], pixels[offset + 2]), propeller: x < source.width * .27, size: 1 });
  }
  if (candidates.length < 100) throw new Error("Logo pixels unavailable");
  let seed = 2026;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let index = candidates.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
  }
  return candidates.slice(0, count).map((dot) => ({ ...dot, startX: random(), startY: random(), size: .7 + random() * 1.6 }));
}

function makeSprites(): HTMLCanvasElement[] {
  return palette.map((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    const gradient = context.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, color);
    gradient.addColorStop(.35, color);
    gradient.addColorStop(1, `${color}00`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 16, 16);
    return canvas;
  });
}

export default function AboutPage({ copy }: { copy: AboutCopy }) {
  const introRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLOutputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const updateFlightRef = useRef<() => void>(() => {});
  const scrollProgressRef = useRef(0);
  const { scrollYProgress } = useScroll({ target: introRef, offset: ["start start", "end end"] });
  const arrowRotate = useTransform(scrollYProgress, (progress) => 45 - 90 * clamp(progress));

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    scrollProgressRef.current = clamp(progress);
    updateFlightRef.current();
  });

  useLayoutEffect(() => {
    const intro = introRef.current;
    const canvas = canvasRef.current;
    const anchor = anchorRef.current;
    const stage = intro?.querySelector<HTMLElement>(".about-intro__stage");
    const flight = flightRef.current;
    const wordLogo = flight?.querySelector<HTMLElement>(".about-intro__flight-word");
    const propellerLogo = flight?.querySelector<HTMLElement>(".about-intro__flight-propeller");
    const scrollLink = intro?.querySelector<HTMLAnchorElement>(".about-scroll");
    const content = contentRef.current;
    const background = backgroundRef.current;
    const scene = sceneRef.current;
    const pauseButton = pauseRef.current;
    const counter = counterRef.current;
    const title = titleRef.current;
    const contentInner = content?.querySelector<HTMLElement>(".about-content__inner");
    const root = intro?.closest<HTMLElement>(".site-page--about");
    const header = root?.querySelector<HTMLElement>(".site-header");
    const headerLogo = header?.querySelector<HTMLImageElement>(".site-header__brand img");
    const footer = root?.querySelector<HTMLElement>(".site-footer");
    if (!intro || !canvas || !anchor || !stage || !flight || !wordLogo || !propellerLogo || !scrollLink || !content || !contentInner || !background || !scene || !pauseButton || !counter || !title || !root || !header || !headerLogo || !footer) return;
    const stageElement = stage;
    const wordImage = wordLogo;
    const propellerImage = propellerLogo;
    const staticLogo = anchor.querySelector<HTMLImageElement>(".about-intro__static-logo");
    if (staticLogo?.complete && !staticLogo.naturalWidth) intro.setAttribute("data-logo-failed", "");

    const boot = window as BootWindow;
    const fromServer = boot.__aboutBootDeadline !== undefined;
    const initialDeadline = fromServer ? boot.__aboutBootDeadline! : performance.now() + 3000;
    const eligible = window.scrollY < 2 && !location.hash;
    if (boot.__aboutBootTimer !== undefined) clearTimeout(boot.__aboutBootTimer);
    boot.__aboutBootTimer = undefined;
    boot.__aboutBootDeadline = undefined;
    document.documentElement.removeAttribute("data-about-boot");

    let alive = true;
    let ready = false;
    let dismissed = false;
    let preparing = false;
    let raf = 0;
    let fallbackTimer = 0;
    let dots: Dot[] = [];
    let sprites: HTMLCanvasElement[] = [];
    let started = 0;
    let settleStart = 0;
    let detailStep = 1;
    let slowFrames = 0;
    let lastFrame = 0;
    let hiddenAt = 0;
    let lastFlightBox = "";
    const context = canvas.getContext("2d");
    const backgroundContext = background.getContext("2d");
    const messages = Array.from(content.querySelectorAll<HTMLElement>(".about-message"));
    const messageBodies = messages.map((message) => message.querySelector<HTMLElement>(".about-message__body")!);
    let backgroundRaf = 0;
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
    // setting is deliberately not read. The background keeps a manual pause.
    let sceneUserPaused = false;
    let pendingTarget = -1;
    let pendingPosition = 0;
    let pendingTimer = 0;
    const targets = [title, ...messages, footer];
    const compactQuery = matchMedia("(height <= 23rem)");
    const mobileQuery = matchMedia("(width <= 47.5rem)");
    const landscapeQuery = matchMedia("(orientation: landscape) and (height <= 34rem)");
    const compactViewport = () => compactQuery.matches;
    const mobileViewport = () => mobileQuery.matches;
    const messageStart = () => landscapeQuery.matches ? .3 : messageTiming.start;
    const motionViewport = () => stageElement.clientHeight || innerHeight || 1;
    const messageAnchor = (viewport: number) => {
      const stickyTop = parseFloat(getComputedStyle(title).top);
      return Math.max(viewport * messageStart(), (Number.isFinite(stickyTop) ? stickyTop : header.clientHeight) + title.offsetHeight + 24);
    };
    const flightDistance = () => Math.max(0, intro.offsetHeight - innerHeight);
    const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const measureTargets = (measuredAnchor?: number) => {
      const maximum = maxScroll();
      const travel = flightDistance();
      const headerHeight = header.clientHeight;
      const viewport = motionViewport();
      const titleFlowTop = contentInner.getBoundingClientRect().top + scrollY + parseFloat(getComputedStyle(contentInner).paddingTop);
      const compact = compactViewport();
      const anchorTop = measuredAnchor ?? messageAnchor(viewport);
      const hold = mobileViewport() ? messageTiming.holdMobile : messageTiming.holdDesktop;
      return targets.map((target, index) => {
        const top = target.getBoundingClientRect().top + scrollY;
        if (index === 0) return Math.min(maximum, Math.max(travel, titleFlowTop - headerHeight - 16));
        if (index === targets.length - 1) return Math.min(maximum, top - headerHeight);
        if (compact) return Math.min(maximum, top - headerHeight - 16);
        return Math.min(maximum, top + viewport * (messageTiming.enter + hold / 2) - anchorTop);
      });
    };
    const cancelCueFocus = (event?: Event) => {
      const onCue = event?.target instanceof Node && scrollLink?.contains(event.target);
      if (onCue && (event.type === "pointerdown" || event.type === "touchstart" || event instanceof KeyboardEvent && event.key === "Enter")) return;
      clearTimeout(pendingTimer);
      pendingTarget = -1;
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(type, cancelCueFocus);
    };

    function drawScene() {
      if (!backgroundContext || !sceneWidth || !sceneHeight) return;
      backgroundContext.clearRect(0, 0, sceneWidth, sceneHeight);
      const full = intro?.dataset.aboutPhase === "logo" || !root?.hasAttribute("data-about-active");
      const count = sceneWidth < 768 ? full ? 100 : 45 : full ? 180 : 80;
      backgroundContext.globalAlpha = full ? 1 : .55;
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

    function syncSceneMotion() {
      const paused = sceneUserPaused || document.hidden || sceneFooterVisible || !!document.querySelector("dialog[open]") || !!header?.querySelector(".site-menu[open]");
      const shouldRun = !!backgroundContext && !paused;
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

    const onPauseClick = () => { sceneUserPaused = !sceneUserPaused; updatePauseControl(); syncSceneMotion(); };

    function updateArrow(viewport: number, footerTop: number, positions: number[]) {
      if (!scrollLink || !footer || !header) return;
      const footerEntering = footerTop <= viewport;
      if (footerEntering && (pendingTarget === targets.length - 1 || document.activeElement === scrollLink)) footer.focus({ preventScroll: true });
      const visibility = footerEntering ? "hidden" : "";
      if (scrollLink.style.visibility !== visibility) scrollLink.style.visibility = visibility;
      const tabIndex = footerEntering ? -1 : 0;
      if (scrollLink.tabIndex !== tabIndex) scrollLink.tabIndex = tabIndex;
      if (footerEntering) { cancelCueFocus(); return; }
      if (pendingTarget >= 0) {
        if (Math.abs(scrollY - pendingPosition) <= Math.max(3, viewport * .01)) {
          targets[pendingTarget].focus({ preventScroll: true });
          cancelCueFocus();
        }
      }
      const next = pendingTarget >= 0 ? Math.min(pendingTarget + 1, targets.length - 1)
        : positions.findIndex((position) => position > scrollY + 4);
      const nextIndex = next < 0 ? targets.length - 1 : next;
      const href = `#${targets[nextIndex].id}`;
      if (scrollLink.getAttribute("href") !== href) scrollLink.setAttribute("href", href);
    }

    function updateContent() {
      if (!content || !intro || !title || !footer || !scene || document.hidden) return;
      const viewport = innerHeight || 1;
      const motionHeight = motionViewport();
      const rect = content.getBoundingClientRect();
      const boxes = messages.map((message) => message.getBoundingClientRect());
      const anchorTop = messageAnchor(motionHeight);
      const positions = measureTargets(anchorTop);
      const footerTop = footer.getBoundingClientRect().top;
      const progress = clamp((viewport - rect.top) / Math.max(1, rect.height + viewport));
      const viewportWidth = document.documentElement.clientWidth;
      const enter = motionHeight * messageTiming.enter;
      const hold = motionHeight * (mobileViewport() ? messageTiming.holdMobile : messageTiming.holdDesktop);
      const exit = motionHeight * messageTiming.exit;
      const geometries = messageBodies.map((body, index) => ({
        baseLeft: boxes[index].left + parseFloat(getComputedStyle(messages[index]).paddingInlineStart),
        width: body.offsetWidth,
      }));
      content.style.setProperty("--about-message-top", `${anchorTop.toFixed(1)}px`);
      scene.style.setProperty("--about-glow-left", `${22 + progress * 18}%`);
      scene.style.setProperty("--about-glow-right", `${76 - progress * 12}%`);
      const enhanced = root?.hasAttribute("data-about-enhanced") ?? false;
      const travel = flightDistance();
      const reveal = !enhanced || root?.hasAttribute("data-about-dismissed") || document.activeElement === title ? 1 : ease((scrollY - travel * .26) / Math.max(1, travel * .24));
      content.style.setProperty("--about-title-x", `${((1 - reveal) * Math.min(innerWidth * .16, 180)).toFixed(1)}px`);
      content.style.setProperty("--about-title-opacity", String(reveal));
      content.style.setProperty("--about-title-clip", `${((1 - reveal) * 100).toFixed(1)}%`);
      scene.style.setProperty("--about-glow-opacity", String(enhanced ? .2 + .8 * clamp((scrollY - travel * .85) / Math.max(1, travel * .15)) : .65));
      messages.forEach((message, index) => {
        const box = boxes[index];
        const passed = anchorTop - box.top;
        const entering = clamp(passed / enter);
        const leaving = clamp((passed - enter - hold) / exit);
        const { baseLeft, width } = geometries[index];
        const fromRight = Math.max(0, viewportWidth - baseLeft + 16);
        const toLeft = Math.max(0, baseLeft + width + 16);
        const horizontal = fromRight * (1 - smooth(entering)) - toLeft * smooth(leaving);
        const opacity = passed <= 0 ? 0 : passed >= enter + hold + exit ? 0
          : Math.min(smooth(entering / .15), 1 - smooth((leaving - .85) / .15));
        message.style.setProperty("--about-message-left", `${baseLeft.toFixed(1)}px`);
        message.style.setProperty("--about-message-x", `${horizontal.toFixed(1)}px`);
        message.style.setProperty("--about-message-opacity", String(clamp(opacity)));
        message.style.setProperty("--about-message-pointer", opacity > .05 ? "auto" : "none");
      });
      updateArrow(viewport, footerTop, positions);
    }

    function refreshMessageHeights() {
      const heights = messageBodies.map((body) => body.offsetHeight);
      messages.forEach((message, index) => message.style.setProperty("--about-message-body-height", `${heights[index]}px`));
    }

    function scheduleContent() {
      if (backgroundRaf) return;
      backgroundRaf = requestAnimationFrame(() => { backgroundRaf = 0; updateContent(); });
    }

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
    content.setAttribute("data-about-motion", "");
    root.setAttribute("data-about-layout", "");
    refreshMessageHeights();
    updateContent();
    resizeBackground();
    if (backgroundContext) {
      pauseButton.hidden = false;
      updatePauseControl();
      pauseButton.addEventListener("click", onPauseClick);
      syncSceneMotion();
    }
    window.addEventListener("scroll", scheduleContent, { passive: true });

    function release() {
      cancelAnimationFrame(raf);
      clearTimeout(fallbackTimer);
      if (root) { root.removeAttribute("data-about-active"); root.removeAttribute("data-about-ready"); root.style.removeProperty("--about-header-opacity"); }
      if (root?.hasAttribute("data-about-enhanced")) root.setAttribute("data-about-dismissed", "");
      intro?.removeAttribute("data-about-phase");
      document.documentElement.removeAttribute("data-about-boot");
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      if (flight) {
        for (const property of ["transform", "opacity", "left", "top", "width", "height"]) flight.style.removeProperty(property);
      }
      wordImage.style.opacity = "0";
      propellerImage.style.opacity = "0";
      updateFlightRef.current = () => {};
    }

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      release();
      scheduleContent();
    }

    function applyFlight() {
      if (dismissed || !anchor || !headerLogo || !flight || !root) return;
      const start = anchor.getBoundingClientRect();
      const end = headerLogo.getBoundingClientRect();
      const progress = ease(scrollProgressRef.current);
      const flightBox = `${start.left},${start.top},${start.width},${start.height}`;
      if (flightBox !== lastFlightBox) {
        flight.style.left = `${start.left}px`;
        flight.style.top = `${start.top}px`;
        flight.style.width = `${start.width}px`;
        flight.style.height = `${start.height}px`;
        lastFlightBox = flightBox;
      }
      const scale = 1 + (end.width / start.width - 1) * progress;
      const settling = settleStart ? 3 * (1 - ease((performance.now() - settleStart) / 350)) : 0;
      flight.style.transform = `translate3d(${(end.left - start.left) * progress}px, ${(end.top - start.top) * progress}px, 0) scale(${scale}) rotate(${(settling * (1 - progress) - 3 * (1 - progress) * progress).toFixed(2)}deg)`;
      flight.style.opacity = String(clamp((1 - progress) / .06));
      root.style.setProperty("--about-header-opacity", String(clamp((progress - .94) / .06)));
    }
    updateFlightRef.current = applyFlight;

    function resizeCanvas() {
      if (!context || !canvas || dismissed || !preparing || ready) return;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(stageElement.clientWidth * ratio);
      canvas.height = Math.round(stageElement.clientHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      applyFlight();
    }

    function settle(frame: number) {
      if (!alive || dismissed || document.hidden) return;
      applyFlight();
      if (frame - settleStart < 350) raf = requestAnimationFrame(settle);
    }

    function draw(now: number) {
      if (!alive || dismissed || !context || !canvas || !anchor || !intro || !counter || !root) return;
      if (document.hidden) return;
      const elapsed = now - started;
      const width = stageElement.clientWidth;
      const height = stageElement.clientHeight;
      context.clearRect(0, 0, width, height);
      if (lastFrame && now - lastFrame > 34) slowFrames++;
      if (slowFrames > 12) detailStep = Math.max(detailStep, Math.ceil(dots.length / 400));
      lastFrame = now;
      if (scrollProgressRef.current > .02 && elapsed < timeline.end) {
        intro.dataset.aboutPhase = "logo";
        ready = true;
        wordImage.style.opacity = "1";
        propellerImage.style.opacity = "1";
        root.setAttribute("data-about-ready", "");
        applyFlight();
        return;
      }
      if (elapsed < timeline.counter) {
        intro.dataset.aboutPhase = "counter";
        counter.textContent = `${String(Math.floor(clamp(elapsed / timeline.counter) * 100)).padStart(3, "0")}%`;
      } else {
        counter.textContent = "100%";
        intro.dataset.aboutPhase = elapsed < timeline.swirl ? "swirl" : elapsed < timeline.word ? "word" : elapsed < timeline.propeller ? "propeller" : "logo";
        const form = ease((elapsed - timeline.swirl) / (timeline.word - timeline.swirl));
        const wordOpacity = clamp((elapsed - timeline.wordFadeStart) / (timeline.wordFadeEnd - timeline.wordFadeStart));
        const propellerOpacity = clamp((elapsed - timeline.propellerFadeStart) / (timeline.propellerFadeEnd - timeline.propellerFadeStart));
        wordImage.style.opacity = String(wordOpacity);
        propellerImage.style.opacity = String(propellerOpacity);
        if (wordOpacity > 0) { root.setAttribute("data-about-ready", ""); applyFlight(); }
        const logo = anchor.getBoundingClientRect();
        const centerX = width / 2;
        const centerY = height / 2;
        for (let index = 0; index < dots.length; index += detailStep) {
          const dot = dots[index];
          const localForm = dot.propeller ? ease((elapsed - timeline.word) / (timeline.propeller - timeline.word)) : form;
          const angle = dot.startX * Math.PI * 2 + elapsed * .0015;
          const radius = (50 + dot.startY * Math.max(width, height) * .7) * (1 - localForm);
          const spiralX = centerX + Math.cos(angle) * radius;
          const spiralY = centerY + Math.sin(angle) * radius * .7;
          const targetX = logo.left + dot.x * logo.width;
          const targetY = logo.top + dot.y * logo.height;
          const x = spiralX + (targetX - spiralX) * localForm;
          const y = spiralY + (targetY - spiralY) * localForm;
          const size = (1 + dot.size * 1.25) * (1 + (1 - localForm) * .8);
          const fade = dot.propeller ? propellerOpacity : wordOpacity;
          context.globalAlpha = clamp((elapsed - timeline.counter) / 250) * (1 - fade);
          context.drawImage(sprites[dot.color], x - size, y - size, size * 2, size * 2);
        }
        context.globalAlpha = 1;
      }
      if (elapsed >= timeline.end) {
        ready = true;
        root.setAttribute("data-about-ready", "");
        wordImage.style.opacity = "1";
        propellerImage.style.opacity = "1";
        settleStart = now;
        applyFlight();
        context.clearRect(0, 0, width, height);
        canvas.width = 0;
        canvas.height = 0;
        raf = requestAnimationFrame(settle);
        return;
      }
      raf = requestAnimationFrame(draw);
    }

    const onSkip = () => {
      dismiss();
      requestAnimationFrame(() => title.focus({ preventScroll: true }));
    };
    const onScrollLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const previousTarget = pendingTarget;
      cancelCueFocus();
      const positions = measureTargets();
      const next = positions.findIndex((position) => position > scrollY + 4);
      pendingTarget = previousTarget >= 0 ? Math.min(previousTarget + 1, targets.length - 1) : next < 0 ? targets.length - 1 : next;
      const destination = targets[pendingTarget];
      pendingPosition = positions[pendingTarget];
      pendingTimer = window.setTimeout(cancelCueFocus, 3000);
      history.replaceState(history.state, "", `#${destination.id}`);
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(type, cancelCueFocus);
      window.scrollTo({ top: pendingPosition, behavior: "smooth" });
      scheduleContent();
    };
    const onHeaderFocus = () => dismiss();
    const onMenuToggle = (event: Event) => { if ((event.target as HTMLDetailsElement).open) dismiss(); syncSceneMotion(); };
    let fragmentUserInput = false;
    const onFragmentInput = () => { fragmentUserInput = true; };
    function alignMessageFragment() {
      const index = messages.findIndex((message) => location.hash === `#${message.id}`);
      if (index < 0 || !alive) return;
      scrollTo({ top: measureTargets()[index + 1], behavior: "auto" });
      scheduleContent();
    }
    const onHashChange = () => { fragmentUserInput = false; requestAnimationFrame(alignMessageFragment); };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && window.scrollY > 1) dismiss();
      else if (!preparing && parseCookieChoice(document.cookie) !== null) start(performance.now() + 3000);
      if (!fragmentUserInput) requestAnimationFrame(alignMessageFragment);
      scheduleContent();
    };
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = performance.now();
        cancelAnimationFrame(raf);
      } else if (hiddenAt) {
        const pausedFor = performance.now() - hiddenAt;
        if (started && !ready) {
          started += pausedFor;
          lastFrame = 0;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(draw);
        } else if (ready && settleStart) {
          settleStart += pausedFor;
          cancelAnimationFrame(raf);
          if (performance.now() - settleStart < 350) raf = requestAnimationFrame(settle);
          else applyFlight();
        }
        hiddenAt = 0;
      }
      if (!document.hidden && !preparing && parseCookieChoice(document.cookie) !== null) start(performance.now() + 3000);
      syncSceneMotion();
    };
    const globalSkip = document.querySelector<HTMLAnchorElement>(".skip-link");
    scrollLink.addEventListener("click", onScrollLink);
    globalSkip?.addEventListener("click", onSkip);
    header.addEventListener("focusin", onHeaderFocus);
    header.addEventListener("toggle", onMenuToggle, true);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("hashchange", onHashChange);
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(type, onFragmentInput, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    const modalObserver = new MutationObserver(syncSceneMotion);
    modalObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    const footerObserver = new IntersectionObserver(([entry]) => {
      sceneFooterVisible = entry.isIntersecting;
      if (sceneFooterVisible && document.activeElement === pauseButton) footer.focus({ preventScroll: true });
      pauseButton.hidden = sceneFooterVisible || !backgroundContext;
      syncSceneMotion();
    });
    footerObserver.observe(footer);
    const observer = new ResizeObserver(() => { resizeCanvas(); applyFlight(); refreshMessageHeights(); scheduleContent(); });
    observer.observe(anchor);
    observer.observe(headerLogo);
    messageBodies.forEach((body) => observer.observe(body));
    const onResize = () => { resizeCanvas(); resizeBackground(); refreshMessageHeights(); scheduleContent(); };
    window.addEventListener("resize", onResize);

    function start(deadline: number) {
      if (preparing || dismissed) return;
      if (!eligible || window.scrollY >= 2 || !context || performance.now() >= deadline) { dismiss(); return; }
      preparing = true;
      root!.setAttribute("data-about-active", "");
      intro!.dataset.aboutPhase = "preparing";
      resizeCanvas();
      fallbackTimer = window.setTimeout(dismiss, Math.max(0, deadline - performance.now()));
      const image = new Image();
      image.src = appConfig.brandLogoPath;
      image.decode().then(() => {
        if (!alive || dismissed || performance.now() >= deadline) { dismiss(); return; }
        try {
          dots = createDots(image, stageElement.clientWidth < 768 ? 800 : 3000);
          sprites = makeSprites();
          if (!dots.length) throw new Error("No particles");
          if (performance.now() >= deadline) { dismiss(); return; }
          root!.setAttribute("data-about-enhanced", "");
          scheduleContent();
          resizeCanvas();
          clearTimeout(fallbackTimer);
          started = performance.now();
          if (document.hidden) hiddenAt = started;
          raf = requestAnimationFrame(draw);
        } catch { dismiss(); }
      }).catch(() => dismiss());
    }

    const onChoice = () => start(performance.now() + 3000);
    window.addEventListener(appConfig.cookieChoice.eventName, onChoice);
    if (!eligible || !context) {
      dismiss();
    } else if (parseCookieChoice(document.cookie) !== null) {
      start(initialDeadline);
    }

    if (messages.some((message) => location.hash === `#${message.id}`)) {
      requestAnimationFrame(alignMessageFragment);
      void document.fonts.ready.then(() => requestAnimationFrame(() => {
        if (!fragmentUserInput) alignMessageFragment();
      }));
    }

    return () => {
      alive = false;
      dismiss();
      cancelAnimationFrame(backgroundRaf);
      sceneRunning = false;
      cancelAnimationFrame(sceneRaf);
      cancelCueFocus();
      content.removeAttribute("data-about-motion");
      root.removeAttribute("data-about-layout");
      root.removeAttribute("data-about-enhanced");
      root.removeAttribute("data-about-dismissed");
      scrollLink.style.removeProperty("visibility");
      scrollLink.removeAttribute("tabindex");
      window.removeEventListener("scroll", scheduleContent);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("hashchange", onHashChange);
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(type, onFragmentInput);
      document.removeEventListener("visibilitychange", onVisibility);
      modalObserver.disconnect();
      footerObserver.disconnect();
      pauseButton.removeEventListener("click", onPauseClick);
      header.removeEventListener("focusin", onHeaderFocus);
      header.removeEventListener("toggle", onMenuToggle, true);
      scrollLink.removeEventListener("click", onScrollLink);
      globalSkip?.removeEventListener("click", onSkip);
      window.removeEventListener(appConfig.cookieChoice.eventName, onChoice);
    };
  }, []);

  return <MotionConfig reducedMotion="never">
    <div className="about-scene" ref={sceneRef} aria-hidden="true"><canvas ref={backgroundRef} /></div>
    <section className="about-intro" ref={introRef} aria-label={copy.introLabel}>
      <div className="about-intro__stage">
        <canvas className="about-intro__canvas" ref={canvasRef} aria-hidden="true" />
        <output className="about-intro__counter" ref={counterRef} aria-hidden="true">000%</output>
        <div className="about-intro__logo-anchor" ref={anchorRef} aria-hidden="true">
          {/* The local SVG is already a compact vector; image optimization cannot improve it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="about-intro__static-logo" src={appConfig.brandLogoPath} alt="" fetchPriority="high" onError={() => introRef.current?.setAttribute("data-logo-failed", "")} />
          <span className="about-intro__logo-fallback">WebCreativeTeam</span>
        </div>
      </div>
      <a id="about-scroll-link" className="about-scroll" href="#about-title" aria-label={copy.scrollCue}>
        <ScrollArrow className="about-scroll__arrow" rotate={arrowRotate} />
      </a>
    </section>
    <div className="about-intro__flight-logo" ref={flightRef} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="about-intro__flight-word" src={appConfig.brandLogoPath} alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="about-intro__flight-propeller" src={appConfig.brandLogoPath} alt="" />
    </div>
    <main id="main" className="about-content" tabIndex={-1} ref={contentRef}>
      <div className="container about-content__inner">
        <h1 id="about-title" tabIndex={-1} ref={titleRef}><span className="about-title__reveal"><span className="about-title__prefix">{copy.titlePrefix}</span>{" "}<span className="about-title__brand">{copy.titleBrand}</span></span></h1>
        <button className="about-scene__toggle" ref={pauseRef} type="button" aria-label={copy.backgroundPause} hidden><span aria-hidden="true">Ⅱ</span></button>
        {copy.messages.map((message, index) => <section className="about-message" id={`about-message-${index + 1}`} tabIndex={-1} key={index}>
          <div className="about-message__body">
            <p>{message}</p>
          </div>
        </section>)}
      </div>
    </main>
  </MotionConfig>;
}
