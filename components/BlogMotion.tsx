"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { MotionConfig, motion, useInView } from "motion/react";
import { headlineReveal } from "./HeroOrb";
import { useCookieChoice } from "./CookieConsent";
import ServiceTypewriter from "./ServiceTypewriter";
import { appConfig, type Locale } from "@/lib/config";
import { adminUrl, blogAdminEditUrl, pageUrl } from "@/lib/routing";

export function BlogDetailAdminActions({ locale, id, version }: { locale: Locale; id: string; version: number }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"session" | "conflict" | "other" | null>(null);
  const bg = locale === "bg";
  const editUrl = blogAdminEditUrl(id, locale);
  async function csrf() {
    const response = await fetch(`${appConfig.paths.authApi}/csrf`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()).csrf as string;
  }
  async function remove() {
    if (busy || !window.confirm(bg ? "Статията ще се скрие веднага, а снимките ще се изтрият. Продължаваме ли?" : "The article will be hidden now and its images deleted. Continue?")) return;
    setBusy(true); setFailure(null);
    let navigated = false;
    try {
      const send = (token: string) => fetch(`${appConfig.paths.blogApi}/admin/${id}`, { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json", "x-csrf-token": token }, body: JSON.stringify({ version }) });
      let response = await send(await csrf());
      if (response.status === 403) response = await send(await csrf());
      if (response.status === 401) { setFailure("session"); return; }
      if (response.status === 409) { setFailure("conflict"); return; }
      if (!response.ok) throw new Error(String(response.status));
      window.location.assign(pageUrl("blog", locale));
      navigated = true;
    } catch (error) { setFailure(error instanceof Error && error.message === "401" ? "session" : "other"); }
    finally { if (!navigated) setBusy(false); }
  }
  return <div className="blog-detail__admin" role="group" aria-label={bg ? "Управление на статията" : "Article management"}>
    <Link className="button button--outline" href={editUrl}>{bg ? "Редактирай" : "Edit"}</Link>
    <button type="button" className="button button--outline" disabled={busy} onClick={() => void remove()}>{busy ? (bg ? "Изтриване…" : "Deleting…") : (bg ? "Изтрий" : "Delete")}</button>
    {failure && <p role="alert" className="blog-detail__admin-error">{failure === "session" ? (bg ? "Сесията е изтекла." : "Your session has expired.") : failure === "conflict" ? (bg ? "Статията е променена или изтрита. Презаредете страницата." : "The article changed or was deleted. Reload the page.") : (bg ? "Изтриването не успя. Опитайте отново." : "Delete failed. Try again.")} {failure === "session" && <Link href={`${adminUrl(locale)}/login?returnTo=${encodeURIComponent(editUrl)}`}>{bg ? "Вход" : "Sign in"}</Link>}{failure === "conflict" && <button type="button" onClick={() => window.location.reload()}>{bg ? "Презареди" : "Reload"}</button>}</p>}
  </div>;
}

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

export function BlogDetailHeader({ locale, title, subtitle, imageUrl, imageAlt }: { locale: Locale; title: string; subtitle: string; imageUrl: string; imageAlt: string }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleInView = useInView(titleRef, { once: true, amount: .2 });
  const cookieChoice = useCookieChoice();
  const titleReady = titleInView && cookieChoice !== null;
  const [subtitleReady, setSubtitleReady] = useState(false);
  const reveal = headlineReveal(0, .1, 1.5);
  return <MotionConfig reducedMotion="never">
    <header className="blog-article__header">
      <h1 ref={titleRef}><span className="blog-detail__title-mask"><motion.span className="blog-detail__title-line" initial={{ ...reveal.initial, filter: "blur(10px)" }} animate={titleReady ? { ...reveal.animate, filter: "blur(0px)" } : { ...reveal.initial, filter: "blur(10px)" }} transition={reveal.transition} onAnimationComplete={() => { if (titleReady) setSubtitleReady(true); }}>{title}</motion.span></span></h1>
      <div className="blog-article__hero-row">
        {subtitle && <motion.p className="blog-article__subtitle" initial={{ opacity: 0, y: 24 }} animate={subtitleReady ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }} transition={{ duration: .65, ease: [.33, 1, .68, 1] }}><ServiceTypewriter text={subtitle} locale={locale} className="blog-detail__subtitle-text" mode="motion" play={subtitleReady} totalDuration={4.5} /></motion.p>}
        <div className="blog-article__visual"><img src={imageUrl} alt={imageAlt} loading="eager" fetchPriority="high" decoding="async" /></div>
      </div>
    </header>
    <noscript><style>{`.blog-detail__title-line,.blog-article__subtitle{opacity:1!important;transform:none!important;filter:none!important}.blog-detail .service-typewriter__motion-char{visibility:visible!important}.blog-detail .service-typewriter__motion-cursor{display:none!important}`}</style></noscript>
  </MotionConfig>;
}

export function BlogCard({ href, imageUrl, category, title, date, dateTime, eager, priority }: { href: string; imageUrl: string; category?: string; title: string; date: string; dateTime: string; eager: boolean; priority: boolean }) {
  return <article className="blog-card">
    <Link className="blog-card__link" href={href}>
      <div className="blog-card__visual">
        <img className="blog-card__image" src={imageUrl} alt="" loading={eager ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" />
      </div>
      <div className="blog-card__copy">
        {category && <p className="blog-card__category">{category}</p>}
        <h3 className="blog-card__title">{title}</h3>
        <time className="blog-card__date" dateTime={dateTime}>{date}</time>
      </div>
    </Link>
  </article>;
}
