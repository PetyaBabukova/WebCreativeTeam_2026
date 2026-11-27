"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import Image from "next/image";
import { appConfig } from "@/lib/config";
import type { TeamScene } from "./AboutTeamScene";

// The About team section. Every member is rendered as a photo card, which stays the version without JavaScript,
// without WebGL, on very short screens, after an error and in print. With scripting on, CSS shows a sticky stage
// over a tall scroll range from the first paint (before hydration too): the scroll position alone decides which
// member shows, as a point cloud. The button, arrow keys and swipes only scroll the page to a member.

export type TeamCopy = {
  heading: string; next: string; first: string; position: string; portraitAlt: string;
  // Display order; id names the prepared images. A new member needs only images and an entry here.
  members: { id: string; name: string; role: string; bio: string }[];
};
// auto: server markup; CSS picks the stage when scripting is on, the cards otherwise. cards: the photo list.
// preparing: the scroll stage without photos while the scene loads. live: the scene runs.
type Mode = "auto" | "cards" | "preparing" | "live";

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
const pad = (value: number) => String(value).padStart(2, "0");
const clamp = (value: number) => Math.min(1, Math.max(0, value));
// The scene is prepared one screen before the section arrives; a horizontal swipe needs this many pixels.
const prepareMargin = "100% 0px";
const swipe = { minPixels: 50, dominance: 1.5 };
// Glyph fonts for the rain never hold the scene back longer than this.
const fontWaitMilliseconds = 1500;
// Matches the CSS that shows the stage: scripting on and a screen taller than 23rem.
const compactScreen = "(height <= 23rem)";
const scriptingQuery = "(scripting: enabled)";
// A member shows while the scroll position is within this distance of it; between two members the earlier
// choice stays (0.4..0.6), so stopping on a boundary does not flicker.
const memberReach = .4;
// A member reached by scrolling is announced once the scroll has rested this long.
const announceDelayMilliseconds = 400;
// A button or key target older than this no longer counts as the base for the next press.
const pendingMilliseconds = 1500;

// Scroll position within the section as 0..1 (start of the first member to the last member).
export function teamProgress(scrollTop: number, sectionTop: number, sectionHeight: number, viewportHeight: number) {
  const travel = sectionHeight - viewportHeight;
  return travel > 0 ? clamp((scrollTop - sectionTop) / travel) : 0;
}

// The member for a position 0..count-1, keeping the current one inside the dead band between two members.
export function memberAt(position: number, current: number, count: number) {
  const nearest = Math.min(count - 1, Math.max(0, Math.round(position)));
  if (Math.abs(position - nearest) < memberReach) return nearest;
  const neighbours = [Math.floor(position), Math.ceil(position)];
  return neighbours.includes(current) ? current : nearest;
}

export default function AboutTeam({ copy }: { copy: TeamCopy }) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const counterRef = useRef<HTMLParagraphElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TeamScene | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const indexRef = useRef(0);
  // The member a button, key or swipe is scrolling to, already announced.
  const pendingRef = useRef<{ index: number; at: number } | null>(null);
  const [mode, setMode] = useState<Mode>("auto");
  const [index, setIndex] = useState(0);
  // Members whose point cloud has appeared, and members whose cloud failed (their photo stands in).
  const [clouds, setClouds] = useState<number[]>([]);
  const [fallbacks, setFallbacks] = useState<number[]>([]);
  const [announcement, setAnnouncement] = useState("");
  // A released scene hands its WebGL context back for good, so a new scene needs a new canvas.
  const [canvasKey, setCanvasKey] = useState(0);
  const total = copy.members.length;
  const asset = (id: string, kind: "color" | "depth" | "portrait") => `${appConfig.aboutTeam.assetPath}/${id}-${kind}.webp`;
  const describe = (position: number) => {
    const member = copy.members[position];
    return `${member.name}, ${member.role}, ${fill(copy.position, { current: position + 1, total })}`;
  };

  // Settles the server's "auto" before the next paint. A browser without the scripting media feature never showed
  // the stage, so it keeps the cards.
  useLayoutEffect(() => {
    setMode(total && matchMedia(scriptingQuery).matches && !matchMedia(compactScreen).matches ? "preparing" : "cards");
  }, [total]);

  // Creates the scene once the section is near, pauses it off screen and with the page-wide pause.
  useEffect(() => {
    const section = sectionRef.current;
    const counter = counterRef.current;
    const root = section?.closest<HTMLElement>(".site-page--about");
    if (!section || !counter || !root || !total || !matchMedia(scriptingQuery).matches) return;
    const compactQuery = matchMedia(compactScreen);
    let alive = true;
    let creating = false;
    let near = false;
    // After a WebGL failure or a lost context the cards stay for the rest of the visit.
    let failed = false;
    let visible = false;
    const sync = () => sceneRef.current?.setPaused(!visible || document.hidden || root.hasAttribute("data-about-paused"));
    const release = () => {
      if (sceneRef.current) {
        sceneRef.current.dispose();
        sceneRef.current = null;
        if (alive) { setClouds([]); setFallbacks([]); setCanvasKey((key) => key + 1); }
      }
      if (alive) setMode(failed || compactQuery.matches ? "cards" : "preparing");
    };
    const fail = () => { failed = true; release(); };
    const tryCreate = () => { if (near && !creating && !failed && !sceneRef.current && !compactQuery.matches) void create(); };
    async function create() {
      creating = true;
      try {
        const { createTeamScene, resolveGlyphFonts } = await import("./AboutTeamScene");
        if (!alive) return;
        const glyphFonts = await resolveGlyphFonts(getComputedStyle(document.body).fontFamily, getComputedStyle(counter!).fontFamily, fontWaitMilliseconds);
        const canvas = canvasRef.current;
        if (!alive || !canvas) return;
        sceneRef.current = createTeamScene({
          canvas, compact: matchMedia("(width <= 47.5rem)").matches, glyphFonts,
          portraits: copy.members.map((member) => ({ color: asset(member.id, "color"), depth: asset(member.id, "depth") })),
          onContextLost: fail,
        });
        // The screen may have turned very short while the scene was being prepared.
        if (compactQuery.matches) { release(); return; }
        setMode("live");
        sync();
      } catch {
        // No WebGL or a shader failure: the photo cards stay.
        fail();
      } finally {
        creating = false;
      }
    }
    // Turning a phone to a very short landscape returns to the cards; turning it back brings the scene back.
    const onCompact = () => { if (compactQuery.matches) release(); else { if (!failed) setMode("preparing"); tryCreate(); } };
    compactQuery.addEventListener("change", onCompact);
    const nearObserver = new IntersectionObserver(([entry]) => { near = entry.isIntersecting; tryCreate(); }, { rootMargin: prepareMargin });
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    nearObserver.observe(section);
    seen.observe(section);
    const pauseObserver = new MutationObserver(sync);
    pauseObserver.observe(root, { attributes: true, attributeFilter: ["data-about-paused"] });
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      compactQuery.removeEventListener("change", onCompact);
      nearObserver.disconnect();
      seen.disconnect();
      pauseObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // The members' images are fixed for a page view; the scene is created once.
  }, []);

  // The scroll position decides the member. It is read again on scroll, resize, layout changes and history
  // navigation, so a position reached without a scroll event still shows the right member.
  const staged = mode === "preparing" || mode === "live";
  useEffect(() => {
    const section = sectionRef.current;
    const progress = progressRef.current;
    if (!staged || !section || !progress) return;
    let frame = 0;
    let announceTimer = 0;
    // Distance to a button target at the last update; a growing distance means something else moved the scroll
    // (a scrollbar drag, history), which cancels the target.
    let pendingDistance = Infinity;
    let measured: { index: number; at: number } | null = null;
    const update = () => {
      frame = 0;
      const box = section.getBoundingClientRect();
      const position = teamProgress(scrollY, box.top + scrollY, box.height, innerHeight) * (total - 1);
      const target = pendingRef.current;
      // A new target (a second press) starts its own measure.
      if (target !== measured) { measured = target; pendingDistance = Infinity; }
      if (target) {
        const distance = Math.abs(position - target.index);
        if (distance > pendingDistance + .02) pendingRef.current = null;
        pendingDistance = pendingRef.current ? distance : Infinity;
      } else pendingDistance = Infinity;
      // The progress line fills with the scroll: the first segment is full at the first member.
      Array.from(progress.children).forEach((segment, place) => (segment as HTMLElement).style.setProperty("--about-team-fill", String(place ? clamp(position - place + 1) : 1)));
      const next = memberAt(position, indexRef.current, total);
      if (next === indexRef.current) return;
      indexRef.current = next;
      setIndex(next);
      const pending = pendingRef.current;
      window.clearTimeout(announceTimer);
      if (pending && pending.index === next) { pendingRef.current = null; return; }
      announceTimer = window.setTimeout(() => setAnnouncement(describe(indexRef.current)), announceDelayMilliseconds);
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(update); };
    // A visitor who takes over the scroll cancels a button target, so the next press starts from what is shown.
    const dropPending = (event: Event) => {
      if (event instanceof globalThis.KeyboardEvent && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
      pendingRef.current = null;
    };
    update();
    for (const type of ["wheel", "touchstart", "keydown"]) addEventListener(type, dropPending, { passive: true });
    addEventListener("scroll", request, { passive: true });
    addEventListener("resize", request);
    addEventListener("pageshow", request);
    const resizeObserver = new ResizeObserver(request);
    resizeObserver.observe(section);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(announceTimer);
      for (const type of ["wheel", "touchstart", "keydown"]) removeEventListener(type, dropPending);
      removeEventListener("scroll", request);
      removeEventListener("resize", request);
      removeEventListener("pageshow", request);
      resizeObserver.disconnect();
    };
    // The copy is fixed for a page view.
  }, [staged, total]);

  // Shows the current member in the scene; the photo appears only if the member's cloud fails.
  const live = mode === "live";
  useEffect(() => {
    const scene = sceneRef.current;
    if (!live || !scene) return;
    let current = true;
    scene.show(index).then(
      () => { if (current) { setClouds((shown) => shown.includes(index) ? shown : [...shown, index]); setFallbacks((failed) => failed.filter((entry) => entry !== index)); } },
      () => { if (current) { setClouds((shown) => shown.filter((entry) => entry !== index)); setFallbacks((failed) => failed.includes(index) ? failed : [...failed, index]); } },
    );
    return () => { current = false; };
  }, [index, live]);

  // Scrolls to the next or previous member. Past either end it jumps at once, without running through everyone.
  function go(step: 1 | -1) {
    const section = sectionRef.current;
    if (!section) return;
    const pending = pendingRef.current;
    const from = pending && performance.now() - pending.at < pendingMilliseconds ? pending.index : indexRef.current;
    const target = (from + step + total) % total;
    const box = section.getBoundingClientRect();
    const top = box.top + scrollY + (total > 1 ? target / (total - 1) * (box.height - innerHeight) : 0);
    const jump = target !== from + step || matchMedia("(prefers-reduced-motion: reduce)").matches;
    pendingRef.current = target === indexRef.current ? null : { index: target, at: performance.now() };
    setAnnouncement(describe(target));
    scrollTo({ top, behavior: jump ? "instant" : "smooth" });
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!staged || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
  };
  const onPointerDown = (event: PointerEvent) => { if (event.pointerType !== "mouse") swipeStart.current = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = (event: PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || !staged) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= swipe.minPixels && Math.abs(dx) > Math.abs(dy) * swipe.dominance) go(dx < 0 ? 1 : -1);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !sceneRef.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    sceneRef.current.setPointer((event.clientX - box.left) / box.width * 2 - 1, (event.clientY - box.top) / box.height * 2 - 1);
  };
  const onPointerLeave = () => sceneRef.current?.setPointer(0, 0);

  if (!total) return null;
  const last = index === total - 1 && total > 1;
  const nextLabel = last ? fill(copy.first, { name: copy.members[0].name }) : fill(copy.next, { name: copy.members[(index + 1) % total].name });
  return <section id="about-team" className="about-team" ref={sectionRef} aria-labelledby="about-team-title" tabIndex={-1} data-about-team={mode} style={{ "--about-team-steps": total - 1 } as CSSProperties} onKeyDown={onKeyDown}>
    <div className="about-team__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipeStart.current = null; }} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <canvas className="about-team__canvas" ref={canvasRef} key={canvasKey} aria-hidden="true" />
      <h2 id="about-team-title" className="about-team__heading">{copy.heading}</h2>
      <p className="about-team__counter" ref={counterRef} aria-hidden="true">{pad(index + 1)} / {pad(total)}</p>
      <ol className="about-team__members">
        {copy.members.map((member, position) => <li className="about-team__member" data-active={position === index ? "" : undefined} data-past={position < index ? "" : undefined} key={member.id}>
          <figure className="about-team__figure" data-cloud={live && clouds.includes(position) ? "" : undefined} data-fallback={live && fallbacks.includes(position) ? "" : undefined}>
            <Image className="about-team__portrait" src={asset(member.id, "portrait")} alt={fill(copy.portraitAlt, { name: member.name })} fill sizes="(width <= 47.5rem) 80vw, 36vw" />
          </figure>
          <div className="about-team__text">
            <h3 className="about-team__name">{member.name}</h3>
            <p className="about-team__role">{member.role}</p>
            <p className="about-team__bio">{member.bio}</p>
            <span className="sr-only">{fill(copy.position, { current: position + 1, total })}</span>
          </div>
        </li>)}
      </ol>
      <div className="about-team__progress" ref={progressRef} aria-hidden="true">
        {copy.members.map((member, position) => <span data-active={position === index ? "" : undefined} key={member.id} />)}
      </div>
      <button className="about-team__next" type="button" aria-label={nextLabel} hidden={!live} onClick={() => go(1)}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </button>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  </section>;
}
