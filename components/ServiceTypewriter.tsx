"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useInView } from "motion/react";
import type { Locale } from "@/lib/routing";

type Props = {
  text: string;
  locale: Locale;
  className: string;
  startOnPaint?: boolean;
  assistiveText?: boolean;
};

export default function ServiceTypewriter({ text, locale, className, startOnPaint = false, assistiveText = true }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const characters = useMemo(() => typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text), ({ segment }) => segment)
    : Array.from(text), [locale, text]);
  const step = Math.min(0.11, 1.8 / characters.length);
  const style = { "--type-step": `${step}s` } as CSSProperties;

  useEffect(() => {
    if (startOnPaint) return;
    const element = ref.current;
    if (element && element.getBoundingClientRect().top >= window.innerHeight) {
      element.dataset.typewriterReady = "";
    }
  }, [startOnPaint]);

  useEffect(() => {
    const element = ref.current;
    if (inView && element?.hasAttribute("data-typewriter-ready")) {
      element.dataset.typewriterActive = "";
    }
  }, [inView]);

  return <span ref={ref} className={`${className} service-typewriter${startOnPaint ? " service-typewriter--hero" : ""}`} style={style}>
    {assistiveText && <span className="sr-only">{text}</span>}
    <span className="service-typewriter__visual" aria-hidden="true">
      {characters.map((character, index) => <span key={index} className="service-typewriter__char" style={{ "--type-index": index } as CSSProperties}>{character}</span>)}
    </span>
  </span>;
}
