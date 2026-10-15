"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { MotionConfig, motion, useInView, useReducedMotion } from "motion/react";
import faqBackgroundDesktop from "@/assets/faq/background-desktop.webp";
import faqBackgroundMobile from "@/assets/faq/background-mobile.webp";
import faqCardBackground from "@/assets/faq/card-background.webp";
import { messages } from "@/lib/messages";
import { pageUrl, portfolioUrl, sectionUrl, type Locale } from "@/lib/routing";
import { headlineReveal } from "./HeroOrb";
import ServiceTypewriter from "./ServiceTypewriter";
import "./FaqPage.css";

type FaqCopy = typeof messages.bg.faq;
type FaqItem = FaqCopy["questions"][number];

function RelatedIcon({ index }: { index: number }) {
  if (index === 0) return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h17a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-7l-5 4v-4H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z" /><path d="M22 13h4a3 3 0 0 1 3 3v9l-4-3h-2" /></svg>;
  if (index === 1) return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3h12l5 5v21H8z" /><path d="M20 3v6h5M12 14h9M12 19h9M12 24h6" /></svg>;
  return <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><rect x="5" y="19" width="5" height="9" rx="1" /><rect x="14" y="12" width="5" height="16" rx="1" /><rect x="23" y="5" width="5" height="23" rx="1" /></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}

function QuestionText({ question }: { question: string }): ReactNode {
  const brand = "WebCreativeTeam";
  const at = question.indexOf(brand);
  if (at < 0) return question;
  return <>{question.slice(0, at)}<span>Web<wbr />Creative<wbr />Team</span>{question.slice(at + brand.length)}</>;
}

function FaqCard({
  item, index, locale, active, wide, hydrated, reducedMotion, onSelect, register,
}: {
  item: FaqItem;
  index: number;
  locale: Locale;
  active: boolean;
  wide: boolean;
  hydrated: boolean;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
  register: (index: number, element: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const inView = useInView(ref, { once: true, amount: .12 });
  const [forcedVisible, setForcedVisible] = useState(false);
  const visible = inView || forcedVisible || reducedMotion;
  const instant = forcedVisible || reducedMotion;
  const answerId = `faq-answer-${locale}-${index}`;

  return <motion.article
    ref={(element) => { ref.current = element; register(index, element); }}
    data-faq-index={index}
    className={`faq__card${active ? " faq__card--open" : ""}`}
    initial={{ opacity: 0, y: "2.5rem" }}
    animate={{ opacity: visible ? 1 : 0, y: visible ? "0rem" : "2.5rem", flexGrow: wide && active ? 2.25 : 1 }}
    transition={{
      opacity: { duration: instant ? 0 : .65, delay: visible && wide && !instant ? (index % 5) * .045 : 0 },
      y: { duration: instant ? 0 : .65, delay: visible && wide && !instant ? (index % 5) * .045 : 0 },
      flexGrow: { duration: reducedMotion ? 0 : .62, ease: [.25, 1, .5, 1] },
    }}
    onFocusCapture={() => setForcedVisible(true)}
    onClick={() => onSelect(index)}
  >
    <span className="faq__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
    <h2 className="faq__question-heading">
      <button type="button" className="faq__question-button" aria-controls={answerId} aria-expanded={active}>
        <span className="faq__question-text"><QuestionText question={item.question} /></span>
      </button>
    </h2>
    <motion.div
      key={wide ? "wide" : "narrow"}
      id={answerId}
      className={`faq__answer-shell${active ? " faq__answer-shell--open" : ""}`}
      initial={false}
      animate={hydrated ? { height: active ? "auto" : 0, opacity: active ? 1 : 0, ...(wide ? { marginTop: active ? "1.3rem" : "0rem" } : {}) } : { opacity: active ? 1 : 0 }}
      transition={{
        height: { duration: reducedMotion || (!wide && !active) ? 0 : wide ? .62 : .42, ease: [.25, 1, .5, 1] },
        marginTop: { duration: reducedMotion ? 0 : .62, ease: [.25, 1, .5, 1] },
        opacity: { duration: reducedMotion || !active ? 0 : .28, delay: active && wide ? .65 : active ? .08 : 0 },
      }}
    >
      <p className="faq__answer">{item.answer}</p>
    </motion.div>
  </motion.article>;
}

export default function FaqPage({ locale, copy }: { locale: Locale; copy: FaqCopy }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [wide, setWide] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [leadReady, setLeadReady] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const lastPointer = useRef({ x: Number.NaN, y: Number.NaN });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockUntil = useRef(0);
  const lastScrollAt = useRef(0);
  const pendingAnchor = useRef<{ index: number; top: number } | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") { setHydrated(true); return; }
    const query = window.matchMedia("(width > 68rem)");
    const update = () => setWide(query.matches);
    update();
    setHydrated(true);
    query.addEventListener("change", update);
    const markScroll = () => { lastScrollAt.current = Date.now(); };
    window.addEventListener("scroll", markScroll, { passive: true });
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("scroll", markScroll);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setLeadReady(true), 2300);
    return () => clearTimeout(timer);
  }, []);

  useLayoutEffect(() => {
    const pending = pendingAnchor.current;
    if (!pending || wide) return;
    pendingAnchor.current = null;
    const card = cardRefs.current[pending.index];
    if (!card) return;
    const delta = card.getBoundingClientRect().top - pending.top;
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
  }, [activeIndex, wide]);

  function selectCard(index: number) {
    if (activeIndex === index) return;
    if (!wide && activeIndex !== null) {
      const card = cardRefs.current[index];
      if (card) pendingAnchor.current = { index, top: card.getBoundingClientRect().top };
    }
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    lockUntil.current = Date.now() + (reducedMotion ? 0 : 650);
    setActiveIndex(index);
  }

  function onCardsPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!wide || event.pointerType !== "mouse" || typeof window.matchMedia !== "function" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const { clientX: x, clientY: y } = event;
    if (Number.isNaN(lastPointer.current.x)) { lastPointer.current = { x, y }; return; }
    const moved = Math.hypot(x - lastPointer.current.x, y - lastPointer.current.y);
    lastPointer.current = { x, y };
    if (moved < 3 || Date.now() - lastScrollAt.current < 180 || Date.now() < lockUntil.current) return;
    const target = event.target;
    const card = target instanceof Element ? target.closest<HTMLElement>("[data-faq-index]") : null;
    if (!card || !event.currentTarget.contains(card)) return;
    const index = Number(card.dataset.faqIndex);
    if (index === activeIndex) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      if (Date.now() - lastScrollAt.current < 180 || Date.now() < lockUntil.current) return;
      const underPointer = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-faq-index]");
      if (underPointer === card) selectCard(index);
    }, 95);
  }

  const relatedHrefs = [pageUrl("contacts", locale), sectionUrl("services", locale, "faq"), portfolioUrl(locale)];
  const pageStyle = { "--faq-card-art": `url(${faqCardBackground.src})` } as CSSProperties;
  const groups = Array.from({ length: Math.ceil(copy.questions.length / 5) }, (_, index) => copy.questions.slice(index * 5, index * 5 + 5));

  return <MotionConfig reducedMotion="user">
    <main id="main" className="faq" tabIndex={-1} style={pageStyle}>
      <div className="faq__stage" aria-hidden="true"><picture><source media="(width <= 47.5rem)" srcSet={faqBackgroundMobile.src} type="image/webp" /><img src={faqBackgroundDesktop.src} alt="" fetchPriority="high" /></picture><span className="faq__shade" /></div>
      <div className="faq__content container">
        <MotionConfig reducedMotion="never">
          <section className="faq__hero" aria-labelledby="faq-title">
            <div className="faq__hero-copy">
              <div className="section-eyebrow--rule"><p>{copy.eyebrow}</p></div>
              <h1 id="faq-title" className="faq__title">{copy.headline.map((line, index) => <span className="faq__title-mask" key={line}><motion.span className={`faq__title-line faq__title-line--${index}`} {...headlineReveal(index, 1.15)} onAnimationComplete={index === copy.headline.length - 1 ? () => setLeadReady(true) : undefined}>{line}</motion.span>{index < copy.headline.length - 1 ? " " : null}</span>)}</h1>
              <p className="faq__lead"><ServiceTypewriter text={copy.lead} locale={locale} className="faq__lead-text" mode="motion" play={leadReady} totalDuration={3.75} /></p>
            </div>
          </section>
        </MotionConfig>
        <section className="faq__questions" aria-label={copy.eyebrow}>
          <div className="faq__rows" onPointerMove={onCardsPointerMove} onPointerLeave={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); lastPointer.current = { x: Number.NaN, y: Number.NaN }; }}>
            {groups.map((group, groupIndex) => <div className="faq__row" key={groupIndex}>
              {group.map((item, itemIndex) => {
                const index = groupIndex * 5 + itemIndex;
                return <FaqCard key={item.question} item={item} index={index} locale={locale} active={activeIndex === index} wide={wide} hydrated={hydrated} reducedMotion={reducedMotion} onSelect={selectCard} register={(cardIndex, element) => { cardRefs.current[cardIndex] = element; }} />;
              })}
            </div>)}
          </div>
        </section>
        <nav className="faq__related" aria-label={copy.relatedLabel}>
          {copy.related.map((item, index) => <Link key={item.title} className="faq__related-card" href={relatedHrefs[index]}><span className="faq__related-icon"><RelatedIcon index={index} /></span><span className="faq__related-copy"><strong>{item.title}</strong><small>{item.description}</small></span><span className="faq__related-arrow"><ArrowIcon /></span></Link>)}
        </nav>
      </div>
      <noscript><style>{`.faq__title-line,.faq__card{opacity:1!important;transform:none!important;flex-grow:1!important}.faq__rows,.faq__row{display:block!important}.faq__card{width:100%!important;min-height:0!important;margin-bottom:1rem!important}.faq__question-text,.faq__answer,.faq__answer-shell{width:auto!important;max-width:none!important}.faq .faq__answer-shell:not(.faq__answer-shell--open){height:auto!important;overflow:visible!important;visibility:visible!important;opacity:1!important}.faq__answer{display:block!important}.faq .service-typewriter__motion-char{visibility:visible!important;opacity:1!important}.faq .service-typewriter__motion-cursor{display:none!important}`}</style></noscript>
    </main>
  </MotionConfig>;
}
