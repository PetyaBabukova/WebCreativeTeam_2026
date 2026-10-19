"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { MotionConfig, cancelFrame, frame, motion, useInView } from "motion/react";
import faqBackgroundDesktop from "@/assets/faq/background-desktop.webp";
import faqBackgroundMobile from "@/assets/faq/background-mobile.webp";
import faqCardBackground from "@/assets/faq/card-background.webp";
import { messages } from "@/lib/messages";
import { offersUrl, pageUrl, portfolioUrl, sectionUrl, type Locale } from "@/lib/routing";
import { headlineReveal } from "./HeroOrb";
import ServiceTypewriter from "./ServiceTypewriter";
import "./FaqPage.css";

type FaqCopy = typeof messages.bg.faq;
type FaqItem = FaqCopy["questions"][number];
/*
  One tempo for every card movement (user request, 15 October 2026: opening felt abrupt).
  Width, answer height, light surface and ink all use the same soft ease-out curve.
*/
// Revision (user, same day): still too quick to notice — slower, with a symmetric ease-in-out so the
// movement is visible from start to finish instead of happening in the first ~150 ms.
const cardLayoutDuration = .9;
const cardSurfaceDuration = .6;
const answerFadeIn = .55;
const answerFadeInDelay = .35;
const answerFadeOut = .3;
// Centred on the light surface's midpoint (≈ .3 s into its ease-in-out fade).
const inkCrossDelay = .19;
const inkCrossDuration = .16;
// Desktop: the old answer collapses only after the new one has expanded, so the shared row height
// changes in one direction instead of dipping and growing back.
const answerCollapseAfterExpand = .5;
const cardEase: [number, number, number, number] = [.65, .05, .36, 1];
const cardColors = {
  closedInk: "#fff",
  openInk: "#0d2930",
  closedBorder: "#dcf2d259",
  openBorder: "#f7e6ce",
  lightSurface: "#f7e7d4",
};

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

function AnswerText({ text, linkText }: { text: string; linkText?: string }): ReactNode {
  if (!linkText) return text;
  const at = text.indexOf(linkText);
  if (at < 0) throw new Error(`FAQ answer is missing its link text: ${linkText}`);
  return <>{text.slice(0, at)}<Link className="faq__answer-link" href={offersUrl()} prefetch={false}>{linkText}</Link>{text.slice(at + linkText.length)}</>;
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
  const instantCard = reducedMotion ? 0 : undefined;
  const paragraphs = item.answer.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);

  return <motion.article
    ref={(element) => { ref.current = element; register(index, element); }}
    data-faq-index={index}
    className={`faq__card${active ? " faq__card--open" : ""}`}
    initial={{ opacity: 0, y: "2.5rem" }}
    animate={{ opacity: visible ? 1 : 0, y: visible ? "0rem" : "2.5rem", flexGrow: wide && active ? 2.25 : 1, color: active ? cardColors.openInk : cardColors.closedInk, borderColor: active ? cardColors.openBorder : cardColors.closedBorder }}
    transition={{
      opacity: { duration: instant ? 0 : .65, delay: visible && wide && !instant ? (index % 5) * .045 : 0 },
      y: { duration: instant ? 0 : .65, delay: visible && wide && !instant ? (index % 5) * .045 : 0 },
      flexGrow: { duration: instantCard ?? cardLayoutDuration, ease: cardEase },
      borderColor: { duration: instantCard ?? cardSurfaceDuration, ease: cardEase },
      // The ink crosses over in a short tween centred on the light surface's midpoint:
      // softer than a snap, but without a long grey-on-half-light moment where the question would be hard to read.
      color: { duration: instantCard ?? inkCrossDuration, delay: instantCard ?? inkCrossDelay, ease: "easeInOut" },
    }}
    onFocusCapture={() => setForcedVisible(true)}
    onClick={() => onSelect(index)}
  >
    <motion.span
      className="faq__card-surface"
      aria-hidden="true"
      initial={false}
      animate={{ opacity: active ? 1 : 0 }}
      transition={{ duration: instantCard ?? cardSurfaceDuration, ease: cardEase }}
    />
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
      animate={hydrated
        // visibility stays "visible" until the closing fade and collapse finish, then hides the answer from assistive tech.
        ? active ? { height: "auto", opacity: 1, visibility: "visible" } : { height: 0, opacity: 0, transitionEnd: { visibility: "hidden" } }
        : { opacity: active ? 1 : 0 }}
      transition={{
        height: active
          ? { duration: instantCard ?? cardLayoutDuration, ease: cardEase }
          : { duration: instantCard ?? (wide ? answerCollapseAfterExpand : cardLayoutDuration), delay: instantCard ?? (wide ? cardLayoutDuration : 0), ease: cardEase },
        opacity: active
          ? { duration: instantCard ?? answerFadeIn, delay: instantCard ?? answerFadeInDelay, ease: cardEase }
          : { duration: instantCard ?? answerFadeOut, ease: cardEase },
      }}
    >
      {paragraphs.map((paragraph, paragraphIndex) => <p className="faq__answer" key={paragraphIndex}><AnswerText text={paragraph} linkText={paragraphIndex === 0 ? item.linkText : undefined} /></p>)}
    </motion.div>
  </motion.article>;
}

export default function FaqPage({ locale, copy }: { locale: Locale; copy: FaqCopy }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [wide, setWide] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [leadReady, setLeadReady] = useState(false);
  // Site-wide user decision (30 September 2026): every visitor sees the same motion, also when the OS reports
  // prefers-reduced-motion (Windows "Animation effects" off). The FAQ cards follow it like the home page does.
  const reducedMotion = false;
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const lastPointer = useRef({ x: Number.NaN, y: Number.NaN });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockUntil = useRef(0);
  const lastScrollAt = useRef(0);
  const anchorStep = useRef<(() => void) | null>(null);

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
      if (anchorStep.current) cancelFrame(anchorStep.current);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setLeadReady(true), 2300);
    return () => clearTimeout(timer);
  }, []);

  /*
    Single column: the previous answer now collapses smoothly while the tapped one opens. A card above the tapped
    question would pull it upwards, so for the length of the transition the scroll is corrected in every Motion frame,
    after Motion has written the new heights and before paint. The tapped question stays under the finger without a jump.
  */
  function keepCardAnchored(index: number) {
    const card = cardRefs.current[index];
    if (!card) return;
    if (anchorStep.current) cancelFrame(anchorStep.current);
    const top = card.getBoundingClientRect().top;
    const until = performance.now() + cardLayoutDuration * 1000 + 120;
    const stop = () => { if (anchorStep.current) cancelFrame(anchorStep.current); anchorStep.current = null; window.removeEventListener("wheel", stop); window.removeEventListener("touchmove", stop); };
    const step = () => {
      const delta = card.getBoundingClientRect().top - top;
      if (Math.abs(delta) > .5) window.scrollBy(0, delta);
      if (performance.now() > until) stop();
    };
    anchorStep.current = step;
    // The visitor's own scroll gesture always wins over the correction.
    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchmove", stop, { passive: true, once: true });
    frame.postRender(step, true);
  }

  function selectCard(index: number) {
    if (activeIndex === index) return;
    if (!wide && activeIndex !== null) keepCardAnchored(index);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    lockUntil.current = Date.now() + (reducedMotion ? 0 : cardLayoutDuration * 1000 + 80);
    setActiveIndex(index);
  }

  function onCardsPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!wide || event.pointerType !== "mouse" || typeof window.matchMedia !== "function" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const { clientX: x, clientY: y } = event;
    if (Number.isNaN(lastPointer.current.x)) { lastPointer.current = { x, y }; return; }
    const moved = Math.hypot(x - lastPointer.current.x, y - lastPointer.current.y);
    lastPointer.current = { x, y };
    if (moved < 3 || Date.now() - lastScrollAt.current < 180 || Date.now() < lockUntil.current) return;
    const focused = document.activeElement;
    if (focused instanceof Element && focused.matches(".faq__answer-link") && cardRefs.current[activeIndex ?? -1]?.contains(focused)) return;
    const target = event.target;
    const card = target instanceof Element ? target.closest<HTMLElement>("[data-faq-index]") : null;
    if (!card || !event.currentTarget.contains(card)) return;
    const index = Number(card.dataset.faqIndex);
    if (index === activeIndex) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      if (Date.now() - lastScrollAt.current < 180 || Date.now() < lockUntil.current) return;
      const stillFocused = document.activeElement;
      if (stillFocused instanceof Element && stillFocused.matches(".faq__answer-link") && cardRefs.current[activeIndex ?? -1]?.contains(stillFocused)) return;
      const underPointer = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-faq-index]");
      if (underPointer === card) selectCard(index);
    }, 95);
  }

  const relatedHrefs = [pageUrl("contacts", locale), sectionUrl("services", locale, "faq"), portfolioUrl(locale)];
  const pageStyle = {
    "--faq-card-art": `url(${faqCardBackground.src})`,
    "--faq-card-closed-ink": cardColors.closedInk,
    "--faq-card-closed-border": cardColors.closedBorder,
    "--faq-card-light-surface": cardColors.lightSurface,
  } as CSSProperties;
  const groups = Array.from({ length: Math.ceil(copy.questions.length / 5) }, (_, index) => copy.questions.slice(index * 5, index * 5 + 5));

  return <MotionConfig reducedMotion="never">
    <main id="main" className="faq" tabIndex={-1} style={pageStyle}>
      <div className="faq__stage" aria-hidden="true"><picture><source media="(width <= 47.5rem)" srcSet={faqBackgroundMobile.src} type="image/webp" /><img src={faqBackgroundDesktop.src} alt="" fetchPriority="high" /></picture><span className="faq__shade" /></div>
      <div className="faq__content container">
        <MotionConfig reducedMotion="never">
          <section className="faq__hero" aria-labelledby="faq-title">
            <div className="faq__hero-copy">
              <div className="section-eyebrow--rule"><h1>{copy.eyebrow}</h1></div>
              <h2 id="faq-title" className="faq__title" aria-label={copy.headline.join(" ")}>{copy.headline.map((line, index) => <span className="faq__title-mask" key={line}><motion.span className={`faq__title-line faq__title-line--${index}`} {...headlineReveal(index, 1.15)} onAnimationComplete={index === copy.headline.length - 1 ? () => setLeadReady(true) : undefined}>{line}</motion.span>{index < copy.headline.length - 1 ? " " : null}</span>)}</h2>
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
          {copy.related.map((item, index) => <Link key={item.title} className="button button--outline faq__related-button" href={relatedHrefs[index]}><RelatedIcon index={index} /><span>{item.title}</span><ArrowIcon /></Link>)}
        </nav>
      </div>
      <noscript><style>{`.faq__title-line,.faq__card{opacity:1!important;transform:none!important;flex-grow:1!important}.faq__rows,.faq__row{display:block!important}.faq__card{width:100%!important;min-height:0!important;margin-bottom:1rem!important}.faq__question-text,.faq__answer,.faq__answer-shell{width:auto!important;max-width:none!important}.faq .faq__answer-shell:not(.faq__answer-shell--open){height:auto!important;overflow:visible!important;visibility:visible!important;opacity:1!important}.faq__answer{display:block!important}.faq .service-typewriter__motion-char{visibility:visible!important;opacity:1!important}.faq .service-typewriter__motion-cursor{display:none!important}`}</style></noscript>
    </main>
  </MotionConfig>;
}
