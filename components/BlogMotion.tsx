"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { MotionConfig, motion, useInView } from "motion/react";
import { headlineReveal } from "./HeroOrb";
import { useCookieChoice } from "./CookieConsent";
import ServiceTypewriter from "./ServiceTypewriter";
import type { Locale } from "@/lib/config";

export function BlogIntro({ locale, eyebrow, headline, accent, lead }: { locale: Locale; eyebrow: string; headline: string; accent: string; lead: string }) {
  return <header className="blog-page__intro">
    <div className="section-eyebrow--rule"><p>{eyebrow}</p></div>
    <h1 aria-label={`${headline} ${accent}`}>
      {[headline, accent].map((line, index) => <span className="blog-page__title-mask" key={line}>
        <span className={`blog-page__title-line blog-page__title-line--${index}`}>{line}</span>
      </span>)}
    </h1>
    <p className="blog-page__lead"><ServiceTypewriter text={lead} locale={locale} className="blog-page__lead-text" startOnPaint totalDuration={2.6} /></p>
  </header>;
}

export function BlogDetailHeader({ locale, title, subtitle }: { locale: Locale; title: string; subtitle: string }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleInView = useInView(titleRef, { once: true, amount: .2 });
  const cookieChoice = useCookieChoice();
  const titleReady = titleInView && cookieChoice !== null;
  const [subtitleReady, setSubtitleReady] = useState(false);
  const reveal = headlineReveal(0, .1, 1.5);
  return <MotionConfig reducedMotion="never">
    <header className="blog-article__header">
      <h1 ref={titleRef}><span className="blog-detail__title-mask"><motion.span className="blog-detail__title-line" initial={{ ...reveal.initial, filter: "blur(10px)" }} animate={titleReady ? { ...reveal.animate, filter: "blur(0px)" } : { ...reveal.initial, filter: "blur(10px)" }} transition={reveal.transition} onAnimationComplete={() => { if (titleReady) setSubtitleReady(true); }}>{title}</motion.span></span></h1>
      {subtitle && <motion.p className="blog-article__subtitle" initial={{ opacity: 0, y: 24 }} animate={subtitleReady ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }} transition={{ duration: .65, ease: [.33, 1, .68, 1] }}><ServiceTypewriter text={subtitle} locale={locale} className="blog-detail__subtitle-text" mode="motion" play={subtitleReady} totalDuration={4.5} /></motion.p>}
    </header>
    <noscript><style>{`.blog-detail__title-line,.blog-article__subtitle{opacity:1!important;transform:none!important;filter:none!important}.blog-detail .service-typewriter__motion-char{visibility:visible!important}.blog-detail .service-typewriter__motion-cursor{display:none!important}`}</style></noscript>
  </MotionConfig>;
}

export function BlogCard({ href, imageUrl, title, date, dateTime, featured = false }: { href: string; imageUrl: string; title: string; date: string; dateTime: string; featured?: boolean }) {
  return <article className={`blog-card${featured ? " blog-card--featured" : ""}`}>
    <Link className="blog-card__link" href={href}>
      <div className="blog-card__visual">
        <img className="blog-card__image" src={imageUrl} alt="" loading={featured ? "eager" : "lazy"} fetchPriority={featured ? "high" : undefined} decoding="async" />
        {featured ? <h2 className="blog-card__title">{title}</h2> : <h3 className="blog-card__title">{title}</h3>}
        <time dateTime={dateTime}>{date}</time>
      </div>
    </Link>
  </article>;
}
