"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { animate, motion, useInView } from "motion/react";
import type { Locale } from "@/lib/routing";

type Props = {
  text: string;
  locale: Locale;
  className: string;
  startOnPaint?: boolean;
  assistiveText?: boolean;
  play?: boolean;
  totalDuration?: number;
  mode?: "css" | "motion";
};

export default function ServiceTypewriter(props: Props) {
  return props.mode === "motion" ? <MotionTypewriter {...props} /> : <CssTypewriter {...props} />;
}

function MotionTypewriter({ text, locale, className, play, totalDuration = 3.75 }: Props) {
  const characters = useMemo(() => typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text), ({ segment }) => segment)
    : Array.from(text), [locale, text]);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (!play) return;
    const controls = animate(0, characters.length, {
      duration: totalDuration,
      ease: "linear",
      onUpdate: (value) => setVisibleCount(Math.min(characters.length, Math.floor(value))),
      onComplete: () => setVisibleCount(characters.length),
    });
    return () => controls.stop();
  }, [play, characters.length, totalDuration]);

  const cursorIndex = Math.max(0, visibleCount - 1);
  return <span className={`${className} service-typewriter service-typewriter--motion`} data-motion-typewriter>
    <span className="sr-only">{text}</span>
    <span className="service-typewriter__visual" aria-hidden="true">
      {characters.map((character, index) => <span key={index} className="service-typewriter__motion-char" data-visible={index < visibleCount ? "" : undefined}>
        {character}
        {play && index === cursorIndex && visibleCount < characters.length && <motion.span className="service-typewriter__motion-cursor" data-at-start={visibleCount === 0 ? "" : undefined} animate={{ opacity: [1, 1, 0] }} transition={{ duration: .75, ease: "linear", repeat: Infinity }} />}
      </span>)}
    </span>
  </span>;
}

function CssTypewriter({ text, locale, className, startOnPaint = false, assistiveText = true, play, totalDuration }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const gated = play !== undefined;
  const inView = useInView(ref, { once: true, amount: gated ? 0.4 : 0.6 });
  const characters = useMemo(() => typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text), ({ segment }) => segment)
    : Array.from(text), [locale, text]);
  const step = totalDuration === undefined ? Math.min(0.11, 1.8 / characters.length) : totalDuration / characters.length;
  const style = { "--type-step": `${step}s`, ...(gated ? { "--type-start": "0s" } : {}) } as CSSProperties;

  useEffect(() => {
    if (startOnPaint || gated) return;
    const element = ref.current;
    if (element && element.getBoundingClientRect().top >= window.innerHeight) {
      element.dataset.typewriterReady = "";
    }
  }, [startOnPaint, gated]);

  useEffect(() => {
    const element = ref.current;
    if (!gated && inView && element?.hasAttribute("data-typewriter-ready")) {
      element.dataset.typewriterActive = "";
    }
  }, [inView, gated]);

  return <span ref={ref} className={`${className} service-typewriter${startOnPaint ? " service-typewriter--hero" : ""}`} style={style} data-typewriter-ready={gated ? "" : undefined} data-typewriter-active={gated && play && inView ? "" : undefined} onAnimationEnd={(event) => {
    if (event.animationName === "service-typewriter-cursor" && (event.target as HTMLElement).matches(".service-typewriter__char:last-child")) {
      event.currentTarget.dataset.typewriterDone = "";
    }
  }}>
    {assistiveText && <span className="sr-only">{text}</span>}
    <span className="service-typewriter__visual" aria-hidden="true">
      {characters.map((character, index) => <span key={index} className="service-typewriter__char" style={{ "--type-index": index } as CSSProperties}>{character}</span>)}
    </span>
  </span>;
}
