"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { MotionConfig, motion, useMotionValue, useScroll, useTransform } from "motion/react";
import aiAutomationImage from "@/assets/services/ai-automation.webp";
import seoGeoImage from "@/assets/services/seo-and-geo.webp";
import digitalMarketingImage from "@/assets/services/digital-marketing.webp";
import brandingImage from "@/assets/services/branding.webp";
import webDesignImage from "@/assets/services/web-design.webp";
import { serviceSlugs } from "@/lib/routing";
import { ScrollArrow } from "./HeroOrb";

type Service = {
  eyebrow: string;
  title: string;
  highlight: string;
  features: string[];
  description: string;
  learnMore: string;
};
type ServicesCopy = { heading: string; items: Service[] };
type IconKind = "gear" | "robot" | "network" | "search" | "database" | "target" | "chart" | "people" | "logo" | "layers" | "screen" | "refresh";

const serviceVisuals = [
  { id: "ai", image: aiAutomationImage, icons: ["gear", "robot", "network"] as IconKind[] },
  { id: "seo-geo", image: seoGeoImage, icons: ["search", "database", "network"] as IconKind[] },
  { id: "digital-marketing", image: digitalMarketingImage, icons: ["target", "chart", "people"] as IconKind[] },
  { id: "branding", image: brandingImage, icons: ["logo", "layers", "screen"] as IconKind[] },
  { id: "web-design", image: webDesignImage, icons: ["screen", "refresh", "gear"] as IconKind[] },
];

const rootFontSize = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const isCompactViewport = () => window.matchMedia?.("(width <= 47.5rem)").matches ?? window.innerWidth <= 47.5 * rootFontSize();

function FeatureIcon({ kind }: { kind: IconKind }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...common}>
    {kind === "gear" ? <><circle cx="16" cy="16" r="5" /><path d="M13 2h6l.8 3.4 2.9 1.2 3-1.9 4.2 4.2-1.9 3 1.2 2.9L32 15v2l-3.8.8-1.2 2.9 1.9 3-4.2 4.2-3-1.9-2.9 1.2L18 31h-4l-.8-3.8-2.9-1.2-3 1.9-4.2-4.2 1.9-3-1.2-2.9L0 17v-2l3.8-.8L5 11.3l-1.9-3 4.2-4.2 3 1.9 2.9-1.2L14 2Z" /></>
      : kind === "robot" ? <><path d="M16 2v4m-8 6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V12Zm-3 3v7m22-7v7M12 27v3m8-3v3" /><circle cx="13" cy="17" r="1" /><circle cx="19" cy="17" r="1" /><path d="M13 22h6" /></>
        : kind === "network" ? <><circle cx="16" cy="5" r="3" /><circle cx="5" cy="25" r="3" /><circle cx="27" cy="25" r="3" /><circle cx="16" cy="19" r="3" /><path d="m16 8 0 8M13.5 21 7 24m11.5-3 6.5 3" /></>
          : kind === "search" ? <><circle cx="13.5" cy="13.5" r="8.5" /><path d="m20 20 9 9" /></>
            : kind === "database" ? <><ellipse cx="16" cy="7" rx="11" ry="4" /><path d="M5 7v18c0 2.2 4.9 4 11 4s11-1.8 11-4V7M5 16c0 2.2 4.9 4 11 4s11-1.8 11-4" /></>
              : kind === "target" ? <><circle cx="15" cy="17" r="11" /><circle cx="15" cy="17" r="6" /><circle cx="15" cy="17" r="1.5" /><path d="m15 17 12-12m-5 0h5v5" /></>
                : kind === "chart" ? <><path d="M3 27h26M6 23v-6h4v6m2 0V12h4v11m2 0V8h4v15m2 0V4h4v19" /><path d="m5 14 6-5 5 2 9-7" /></>
                  : kind === "people" ? <><circle cx="16" cy="9" r="4" /><circle cx="5" cy="12" r="3" /><circle cx="27" cy="12" r="3" /><path d="M9 26v-3a7 7 0 0 1 14 0v3H9ZM1 26v-4a5 5 0 0 1 6-5m24 9v-4a5 5 0 0 0-6-5" /></>
                    : kind === "logo" ? <><circle cx="16" cy="6" r="3" /><circle cx="5" cy="25" r="3" /><circle cx="27" cy="25" r="3" /><path d="M16 9v6M5 22v-5l11-4 11 4v5" /></>
                      : kind === "layers" ? <><path d="m16 3 13 7-13 7L3 10l13-7Zm-13 13 13 7 13-7M3 22l13 7 13-7" /></>
                        : kind === "refresh" ? <><path d="M27 12a11 11 0 0 0-19-5L5 10m0-7v7h7M5 20a11 11 0 0 0 19 5l3-3m0 7v-7h-7" /></>
                          : <><rect x="3" y="4" width="26" height="19" rx="2" /><path d="M12 29h8m-4-6v6" /></>}
  </svg>;
}

function SmallArrow() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M3 12h17m-7-7 7 7-7 7" /></svg>;
}

function ServiceCard({ item, index, stack, cardRefs, firstCardRef }: {
  item: Service;
  index: number;
  stack: "flow" | "sticky";
  cardRefs: React.RefObject<(HTMLElement | null)[]>;
  firstCardRef: React.RefObject<HTMLElement | null>;
}) {
  const visual = serviceVisuals[index];
  const opacity = useMotionValue(1);
  const scale = useMotionValue(1);

  useLayoutEffect(() => {
    const card = cardRefs.current[index];
    const next = cardRefs.current[index + 1];
    if (!card) return;
    let height = 0;
    let nextHeight = 0;
    let stickyTop = 0;
    let viewportHeight = 0;
    let finalScale = 1;
    const update = () => {
      if (stack !== "sticky" || !next) {
        opacity.set(1);
        scale.set(1);
        return;
      }
      const nextRect = next.getBoundingClientRect();
      const nextTop = nextRect.top + (nextRect.height - next.offsetHeight) / 2;
      const fadeEnd = Math.max(0, stickyTop + height - nextHeight);
      const fadeDistance = Math.max(120, viewportHeight * .25);
      const scaleStart = viewportHeight * .9;
      const scaleProgress = Math.max(0, Math.min(1, (scaleStart - nextTop) / Math.max(1, scaleStart - fadeEnd)));
      opacity.set(Math.max(0, Math.min(1, (nextTop - fadeEnd) / fadeDistance)));
      scale.set(1 - (1 - finalScale) * scaleProgress);
    };
    const measure = () => {
      height = card.offsetHeight;
      nextHeight = next?.offsetHeight ?? 0;
      card.style.setProperty("--service-card-height", `${height / rootFontSize()}rem`);
      stickyTop = parseFloat(getComputedStyle(card).top) || 0;
      viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      finalScale = isCompactViewport() ? .83 : .80;
      update();
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(card);
    if (next) observer?.observe(next);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [cardRefs, index, opacity, scale, stack]);

  if (!visual) throw new Error(`Missing visual for service ${index}`);
  return <motion.article
    className="services__card"
    aria-labelledby={`service-title-${index}`}
    data-service-art={visual.id}
    style={{ opacity, scale, zIndex: index + 1 }}
    ref={(node) => { cardRefs.current[index] = node; if (index === 0) firstCardRef.current = node; }}
  >
    <div className="services__image">
      <Image src={visual.image} alt="" fill sizes="(max-width: 48rem) 94vw, (max-width: 56.25rem) 90vw, (max-width: 128rem) 84vw, 108rem" />
    </div>
    <div className="services__card-content">
      <p className="services__eyebrow">{item.eyebrow}</p>
      <h3 id={`service-title-${index}`} className="services__card-title"><span>{item.title}</span>{" "}<span>{item.highlight}</span></h3>
      <ul className="services__features" aria-label={item.eyebrow}>
        {item.features.map((feature, featureIndex) => <li className="services__feature button--outline" key={feature} data-feature-icon={visual.icons[featureIndex]}>
          <FeatureIcon kind={visual.icons[featureIndex]} />
          <span>{feature}</span>
          <SmallArrow />
        </li>)}
      </ul>
      <p className="services__description">{item.description}</p>
      <span className="services__learn-more button--outline">{item.learnMore}<SmallArrow /></span>
    </div>
  </motion.article>;
}

export default function ServicesSection({ copy }: { copy: ServicesCopy }) {
  if (copy.items.length !== serviceVisuals.length || copy.items.length !== serviceSlugs.length) {
    throw new Error(`Expected ${serviceSlugs.length} services, received ${copy.items.length}`);
  }
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const firstCardRef = useRef<HTMLElement>(null);
  const [stack, setStack] = useState<"flow" | "sticky">("flow");
  const { scrollYProgress } = useScroll({ target: firstCardRef, offset: ["start end", "start 25%"] });
  const titleOpacity = useTransform(scrollYProgress, [0, .45, 1], [1, 1, 0]);
  const titleScale = useTransform(scrollYProgress, [0, .15, 1], [1, 1, .8]);
  const arrowScale = useTransform(scrollYProgress, [0, .15, 1], [1, 1, .75]);
  const arrowRotate = useTransform(scrollYProgress, [0, 1], [45, -45]);

  useLayoutEffect(() => {
    const update = () => {
      const heading = document.querySelector(".services__heading-stage");
      const stickyTop = heading ? parseFloat(getComputedStyle(heading).top) || 0 : 0;
      const available = (window.visualViewport?.height ?? window.innerHeight) - stickyTop;
      const tallestCard = Math.max(0, ...cardRefs.current.map((card) => card?.offsetHeight ?? 0));
      const rem = rootFontSize();
      setStack((current) => {
        const minimumSpace = (current === "sticky" ? 18.75 : 20.25) * rem;
        const heightReserve = current === "sticky" ? 0 : 1.5 * rem;
        const desktopCardNeedsFlow = !isCompactViewport() && tallestCard > available - heightReserve;
        return available < minimumSpace || desktopCardNeedsFlow ? "flow" : "sticky";
      });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    cardRefs.current.forEach((card) => { if (card) observer?.observe(card); });
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return <MotionConfig reducedMotion="never">
    <section id="services" className="services" aria-labelledby="services-title">
      <motion.div className="services__heading-stage" style={{ opacity: titleOpacity }}>
        <div className="container services__heading-inner">
          <motion.h2 id="services-title" style={{ scale: stack === "sticky" ? titleScale : 1, transformOrigin: "left center" }}>{copy.heading}</motion.h2>
          <motion.div className="services__arrow-wrap" style={{ scale: stack === "sticky" ? arrowScale : 1, transformOrigin: "right center" }}>
            <ScrollArrow className="services__arrow" rotate={arrowRotate} />
          </motion.div>
        </div>
      </motion.div>
      <div className="container services__cards" data-stack={stack}>
        {copy.items.map((item, index) => <ServiceCard key={serviceSlugs[index]} item={item} index={index} stack={stack} cardRefs={cardRefs} firstCardRef={firstCardRef} />)}
      </div>
    </section>
  </MotionConfig>;
}
