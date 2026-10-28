"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { flushSync } from "react-dom";
import Image from "next/image";
import { AnimatePresence, MotionConfig, motion, useIsPresent, useReducedMotion } from "motion/react";
import lightBackground from "@/assets/services/products_page_background.webp";
import { appConfig } from "@/lib/config";
import { validContactWebsite } from "@/lib/contactWebsite";
import { fetchCaptchaSiteKey, loadCaptchaScript, type RecaptchaApi } from "@/lib/clientCaptcha";
import { serviceSlugs, type Locale } from "@/lib/routing";
import type { messages } from "@/lib/messages";
import { headlineReveal } from "./HeroOrb";
import ServiceTypewriter from "./ServiceTypewriter";
import { PrivacyModalLink } from "./PrivacyModal";
import "./ContactPage.css";

type ContactCopy = typeof messages.bg.contacts;
type FeedbackKind = "sent" | "sendError" | "validationError" | "captchaError" | "captchaLoading" | "unconfirmed" | "newsletterCheck" | "newsletterLimited" | "newsletterUnavailable" | "newsletterInvalid" | "newsletterPending";
type NewsletterFeedback = Extract<FeedbackKind, `newsletter${string}`>;
type NoticeKind = Exclude<FeedbackKind, "captchaLoading"> | "sending";
type ContactNoticeState = { id: number; kind: NoticeKind };


function ContactField({ id, name, label, type = "text", autoComplete, maxLength, required = false, multiline = false, third = false, onChange }: {
  id: string; name: string; label: string; type?: string; autoComplete?: string;
  maxLength: number; required?: boolean; multiline?: boolean; third?: boolean; onChange?: (value: string) => void;
}) {
  return <div className={third ? "contact__field contact__field--third" : "contact__field"}>
    <label className="sr-only" htmlFor={id}>{label}</label>
    {multiline
      ? <textarea id={id} name={name} placeholder={label} maxLength={maxLength} minLength={10} rows={3} required={required} onInput={(event) => event.currentTarget.setCustomValidity("")} onChange={(event) => onChange?.(event.currentTarget.value)} />
      : <input id={id} name={name} type={type} inputMode={name === "website" ? "url" : undefined} placeholder={label} autoComplete={autoComplete} maxLength={maxLength} minLength={name === "name" ? 2 : undefined} pattern={name === "phone" ? "[+0-9\\(\\) .\\-]{5,30}" : undefined} required={required} onInput={(event) => event.currentTarget.setCustomValidity("")} />}
  </div>;
}

function ContactIcon({ kind }: { kind: "email" | "phone" }) {
  if (kind === "email") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7.5 3H5a2 2 0 0 0-2 2c0 8.8 7.2 16 16 16a2 2 0 0 0 2-2v-2.5l-5-2-2.2 2.2a14 14 0 0 1-6.5-6.5L9.5 8Z" /></svg>;
}

function validContactForm(form: HTMLFormElement, message: string, websiteMessage: string): boolean {
  if (!form.reportValidity()) return false;
  const website = form.elements.namedItem("website");
  if (website instanceof HTMLInputElement && !validContactWebsite(website.value)) {
    website.setCustomValidity(websiteMessage);
    website.reportValidity();
    website.focus();
    return false;
  }
  for (const [name, minimum] of [["name", 2], ["message", 10], ["phone", 1]] as const) {
    const field = form.elements.namedItem(name);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) continue;
    if (field.value && field.value.trim().length < minimum) {
      field.setCustomValidity(message);
      field.reportValidity();
      field.focus();
      return false;
    }
  }
  return true;
}

function CopyableContact({ value, kind, copy }: {
  value: string; kind: "email" | "phone"; copy: ContactCopy;
}) {
  const [result, setResult] = useState<"copied" | "copyFailed" | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);
  const touching = useRef(false);
  const holdReady = useRef(false);

  function cancelHold() {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  useEffect(() => () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
  }, []);

  async function copyValue() {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      setResult("copied");
    } catch {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      field.setSelectionRange(0, value.length);
      try {
        setResult(document.execCommand("copy") ? "copied" : "copyFailed");
      } catch {
        setResult("copyFailed");
      } finally {
        field.remove();
        focused?.focus();
      }
    }
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setResult(null), 2500);
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "touch" || !event.isPrimary) {
      suppressClick.current = false;
      return;
    }
    cancelHold();
    suppressClick.current = false;
    touching.current = true;
    holdReady.current = false;
    start.current = { x: event.clientX, y: event.clientY };
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      holdReady.current = true;
    }, 550);
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (touching.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 12) {
      cancelHold();
      touching.current = false;
      holdReady.current = false;
      suppressClick.current = true;
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "touch") return;
    const shouldCopy = touching.current && holdReady.current;
    touching.current = false;
    holdReady.current = false;
    cancelHold();
    if (shouldCopy) { suppressClick.current = true; void copyValue(); }
  }

  function pointerCancel() {
    cancelHold();
    touching.current = false;
    holdReady.current = false;
    suppressClick.current = true;
  }

  function contextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    if (touching.current || suppressClick.current) event.preventDefault();
  }

  return <span className="contact__method">
    <button className="contact__method-action" type="button" aria-label={`${copy.copy} ${value}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onContextMenu={contextMenu} onKeyDown={() => { suppressClick.current = false; }} onClick={() => {
      if (suppressClick.current) { suppressClick.current = false; return; }
      void copyValue();
    }}><ContactIcon kind={kind} /><span>{value}</span></button>
    <span className="contact__copy-feedback" role="status" aria-live="polite">{result ? copy[result] : ""}</span>
  </span>;
}

function ContactStatusNotice({ notice, copy, locale, onClose, submitButton }: {
  notice: ContactNoticeState; copy: ContactCopy; locale: Locale; onClose: (id: number) => void;
  submitButton: React.RefObject<HTMLButtonElement | null>;
}) {
  const reduceMotion = useReducedMotion();
  const isPresent = useIsPresent();
  const closeButton = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef({ handle: null as number | null, remaining: appConfig.contact.notificationDurationMilliseconds as number, startedAt: 0, hover: false, focus: false });
  const kind = notice.kind;
  const isError = kind === "sendError" || kind === "validationError" || kind === "captchaError" || kind === "newsletterLimited" || kind === "newsletterUnavailable" || kind === "newsletterInvalid";
  const title = kind === "sending" ? copy.noticeSending
    : kind === "sent" ? copy.noticeSentTitle
      : kind === "unconfirmed" ? copy.noticeUnconfirmedTitle
        : kind.startsWith("newsletter") ? copy[kind as NewsletterFeedback] : copy.noticeErrorTitle;
  const titleId = `contact-notice-title-${locale}-${notice.id}`;

  function stopTimer() {
    const current = timer.current;
    if (current.handle === null) return;
    window.clearTimeout(current.handle);
    current.handle = null;
    current.remaining = Math.max(0, current.remaining - (Date.now() - current.startedAt));
  }

  function startTimer() {
    const current = timer.current;
    if (!isPresent || kind === "sending" || current.handle !== null || current.hover || current.focus) return;
    current.startedAt = Date.now();
    current.handle = window.setTimeout(() => onClose(notice.id), current.remaining);
  }

  useEffect(() => {
    const current = timer.current;
    if (current.handle !== null) window.clearTimeout(current.handle);
    current.handle = null;
    if (!isPresent) return;
    current.remaining = appConfig.contact.notificationDurationMilliseconds;
    current.startedAt = 0;
    current.hover = typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches && Boolean(card.current?.matches(":hover"));
    current.focus = Boolean(card.current?.contains(document.activeElement));
    if (kind !== "sending" && !current.hover && !current.focus) {
      current.startedAt = Date.now();
      current.handle = window.setTimeout(() => onClose(notice.id), current.remaining);
    }
    return () => { if (current.handle !== null) window.clearTimeout(current.handle); current.handle = null; };
  }, [isPresent, kind, notice.id, onClose]);

  function close() {
    const hadFocus = document.activeElement === closeButton.current;
    onClose(notice.id);
    if (hadFocus) submitButton.current?.focus();
  }

  return <motion.div ref={card} className={`contact__notice${kind === "sent" || kind === "newsletterCheck" ? " contact__notice--sent" : ""}${isError ? " contact__notice--error" : ""}${kind.startsWith("newsletter") ? " contact__notice--newsletter" : ""}`} role="group" aria-labelledby={titleId}
    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
    animate={{ opacity: 1, y: 0 }}
    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
    transition={reduceMotion ? { duration: .15 } : { type: "spring", visualDuration: .45, bounce: .15 }}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") { timer.current.hover = true; stopTimer(); } }}
    onPointerLeave={(event) => { if (event.pointerType === "mouse") { timer.current.hover = false; startTimer(); } }}
    onFocusCapture={() => { timer.current.focus = true; stopTimer(); }}
    onBlurCapture={(event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      timer.current.focus = false;
      startTimer();
    }}>
    <span className={`contact__notice-icon${kind === "sending" && !reduceMotion ? " contact__notice-icon--sending" : ""}`} aria-hidden="true">
      {kind === "sending" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21 3-8.4 18-2.7-7.2L3 11.1 21 3Z" /><path d="m9.9 13.8 4.8-4.8" /></svg>
        : kind === "sent" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 12.5 5 5L19.5 7" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></svg>}
    </span>
    <div className="contact__notice-text">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={kind} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? .1 : .16 }}>
          <strong id={titleId}>{title}</strong>
        </motion.div>
      </AnimatePresence>
    </div>
    {kind !== "sending" ? <button ref={closeButton} className="contact__notice-close" type="button" aria-label={copy.noticeClose} onClick={close}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button> : null}
  </motion.div>;
}

export default function ContactPage({ locale, copy, serviceNames }: {
  locale: Locale; copy: ContactCopy; serviceNames: string[];
}) {
  const [message, setMessage] = useState("");
  const [leadReady, setLeadReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [captchaRetry, setCaptchaRetry] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackKind | null>(null);
  const [notice, setNotice] = useState<ContactNoticeState | null>(null);
  const [announcement, setAnnouncement] = useState({ status: "", error: "" });
  const captchaHost = useRef<HTMLDivElement>(null);
  const captchaWidget = useRef<{ api: RecaptchaApi; id: number } | null>(null);
  const captchaStatus = useRef<"idle" | "loading" | "ready" | "failed">("idle");
  const siteKeyPromise = useRef<Promise<string | null> | null>(null);
  const pendingForm = useRef<HTMLFormElement | null>(null);
  const captchaExecutingAt = useRef(0);
  const submitting = useRef(false);
  const submitButton = useRef<HTMLButtonElement>(null);
  const noticeAttempt = useRef(0);
  const noticeLoadingTimer = useRef<number | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const queuedNewsletter = useRef<NewsletterFeedback | null>(null);
  const newsletterTimer = useRef<number | null>(null);
  const interestHintId = `contact-interest-hint-${locale}`;
  const diagnosticHintId = `contact-diagnostic-hint-${locale}`;

  const showQueuedNewsletter = useCallback(() => {
    if (newsletterTimer.current !== null) window.clearTimeout(newsletterTimer.current);
    newsletterTimer.current = null;
    const kind = queuedNewsletter.current;
    queuedNewsletter.current = null;
    if (!kind) return;
    noticeAttempt.current += 1;
    setFeedback(kind);
    setNotice({ id: noticeAttempt.current, kind });
  }, []);
  const closeNotice = useCallback((id: number) => {
    setNotice((current) => current?.id === id ? null : current);
    if (queuedNewsletter.current) showQueuedNewsletter();
  }, [showQueuedNewsletter]);

  function queueNewsletterOutcome(result: unknown) {
    const kind = result === "accepted" ? "newsletterCheck" : result === "pending" ? "newsletterPending" : result === "limited" ? "newsletterLimited"
      : result === "invalid" ? "newsletterInvalid" : "newsletterUnavailable";
    queuedNewsletter.current = kind;
    if (newsletterTimer.current !== null) window.clearTimeout(newsletterTimer.current);
    newsletterTimer.current = window.setTimeout(showQueuedNewsletter, 3000);
  }

  function clearLoadingNotice() {
    if (noticeLoadingTimer.current !== null) window.clearTimeout(noticeLoadingTimer.current);
    noticeLoadingTimer.current = null;
  }

  function showOutcome(kind: Exclude<NoticeKind, "sending">) {
    clearLoadingNotice();
    setFeedback(kind);
    setNotice({ id: noticeAttempt.current, kind });
  }

  useEffect(() => () => {
    if (noticeLoadingTimer.current !== null) window.clearTimeout(noticeLoadingTimer.current);
    if (newsletterTimer.current !== null) window.clearTimeout(newsletterTimer.current);
    requestController.current?.abort();
  }, []);

  useEffect(() => {
    if (notice?.kind === "sending") setAnnouncement({ status: copy.noticeSending, error: "" });
    else if (feedback === "sent") setAnnouncement({ status: copy.sent, error: "" });
    else if (feedback === "newsletterCheck" || feedback === "newsletterPending") setAnnouncement({ status: copy[feedback], error: "" });
    else if (feedback === "captchaLoading") setAnnouncement({ status: copy.captchaLoading, error: "" });
    else if (feedback) setAnnouncement({ status: "", error: copy[feedback] });
    else setAnnouncement({ status: "", error: "" });
  }, [notice, feedback, copy]);

  useEffect(() => {
    siteKeyPromise.current = fetchCaptchaSiteKey();
    return () => { siteKeyPromise.current = null; };
  }, [locale]);

  useEffect(() => {
    if (captchaRetry === 0) return;
    let active = true;
    captchaStatus.current = "loading";
    const container = document.createElement("div");
    captchaHost.current?.appendChild(container);
    async function setup() {
      try {
        let siteKey = await siteKeyPromise.current;
        if (!siteKey) {
          siteKeyPromise.current = fetchCaptchaSiteKey();
          siteKey = await siteKeyPromise.current;
        }
        if (!siteKey) throw new Error("reCAPTCHA configuration unavailable");
        const api = await loadCaptchaScript(locale);
        if (!active) return;
        const id = api.render(container, {
          sitekey: siteKey,
          size: "invisible",
          badge: "bottomright",
          callback: (token) => {
            const pending = pendingForm.current;
            if (!active || submitting.current) return;
            if (!pending) { api.reset(id); return; }
            if (!token) { pendingForm.current = null; captchaExecutingAt.current = 0; showOutcome("captchaError"); api.reset(id); return; }
            pendingForm.current = null;
            captchaExecutingAt.current = 0;
            if (!validContactForm(pending, copy.validationError, copy.websiteError)) {
              pending.querySelector<HTMLElement>(":invalid")?.focus();
              setFeedback("validationError");
              api.reset(id);
              return;
            }
            const data = new FormData(pending);
            const body = {
              locale, services: data.getAll("services"), name: data.get("name"),
              email: data.get("email"), phone: data.get("phone"), website: data.get("website"), budget: data.get("budget"),
              message: data.get("message"), newsletter: data.has("newsletter"), privacy: data.has("privacy"),
            };
            submitting.current = true;
            setSending(true);
            const attemptId = noticeAttempt.current;
            const controller = new AbortController();
            requestController.current = controller;
            const requestTimeout = window.setTimeout(() => controller.abort(), appConfig.contact.requestTimeoutMilliseconds);
            noticeLoadingTimer.current = window.setTimeout(() => {
              if (noticeAttempt.current === attemptId) setNotice({ id: attemptId, kind: "sending" });
              noticeLoadingTimer.current = null;
            }, appConfig.contact.notificationLoadingDelayMilliseconds);
            void (async () => {
              try {
                const result = await fetch(appConfig.paths.contactApi, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...body, captchaToken: token }),
                  signal: controller.signal,
                });
                if (!active) return;
                const details: unknown = await result.json().catch(() => null);
                const newsletterResult = details && typeof details === "object" ? (details as { newsletter?: unknown }).newsletter : undefined;
                if (result.ok) {
                  pending.reset();
                  setMessage("");
                  showOutcome("sent");
                  if (body.newsletter) queueNewsletterOutcome(newsletterResult);
                } else if (result.status === 400) {
                  if (!active) return;
                  showOutcome(details && typeof details === "object" && (details as { error?: unknown }).error === "captcha" ? "captchaError" : "validationError");
                } else {
                  showOutcome("sendError");
                  if (body.newsletter && newsletterResult) queueNewsletterOutcome(newsletterResult);
                }
              } catch {
                if (active) showOutcome(controller.signal.aborted ? "unconfirmed" : "sendError");
              } finally {
                window.clearTimeout(requestTimeout);
                clearLoadingNotice();
                if (requestController.current === controller) requestController.current = null;
                if (active) api.reset(id);
                submitting.current = false;
                if (active) setSending(false);
              }
            })();
          },
          "expired-callback": () => {
            if (!active || submitting.current) return;
            const hadPending = pendingForm.current !== null;
            pendingForm.current = null;
            captchaExecutingAt.current = 0;
            api.reset(id);
            if (hadPending) showOutcome("captchaError");
          },
          "error-callback": () => {
            if (!active || submitting.current) return;
            const hadPending = pendingForm.current !== null;
            pendingForm.current = null;
            captchaExecutingAt.current = 0;
            api.reset(id);
            if (hadPending) showOutcome("captchaError");
          },
        });
        captchaWidget.current = { api, id };
        captchaStatus.current = "ready";
        if (pendingForm.current) {
          try { captchaExecutingAt.current = Date.now(); setFeedback(null); api.execute(id); }
          catch { pendingForm.current = null; captchaExecutingAt.current = 0; showOutcome("captchaError"); }
        }
      } catch {
        if (active) {
          captchaStatus.current = "failed";
          pendingForm.current = null;
          showOutcome("captchaError");
        }
      }
    }
    void setup();
    return () => {
      active = false;
      if (captchaWidget.current) captchaWidget.current.api.reset(captchaWidget.current.id);
      captchaWidget.current = null;
      container.remove();
    };
  }, [locale, captchaRetry]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    if (!validContactForm(form, copy.validationError, copy.websiteError)) return;
    if (captchaStatus.current === "loading") return;
    if (captchaExecutingAt.current && Date.now() - captchaExecutingAt.current < 1000) return;
    if (newsletterTimer.current !== null) window.clearTimeout(newsletterTimer.current);
    newsletterTimer.current = null;
    queuedNewsletter.current = null;
    noticeAttempt.current += 1;
    clearLoadingNotice();
    flushSync(() => {
      setNotice(null);
      setFeedback(null);
      setAnnouncement({ status: "", error: "" });
    });
    pendingForm.current = form;
    const widget = captchaWidget.current;
    if (!widget) {
      captchaStatus.current = "loading";
      setFeedback("captchaLoading");
      setCaptchaRetry((attempt) => attempt + 1);
      return;
    }
    try { captchaExecutingAt.current = Date.now(); widget.api.execute(widget.id); }
    catch { pendingForm.current = null; captchaExecutingAt.current = 0; showOutcome("captchaError"); }
  }

  return <MotionConfig reducedMotion="never">
    <main id="main" className="contact" tabIndex={-1}>
      <div className="contact__background" aria-hidden="true">
        <Image src={lightBackground} alt="" fill sizes="100vw" priority unoptimized decoding="sync" />
      </div>
      <div className="container contact__content">
        <header className="contact__hero">
          <div className="section-eyebrow--rule contact__eyebrow"><h1>{copy.title}</h1></div>
          <h2 className="contact__headline" aria-label={copy.headline.join(" ")}>
            {copy.headline.map((line, index) => <span className="contact__headline-mask" key={line}>
              <motion.span className={`contact__headline-line contact__headline-line--${index}`} {...headlineReveal(index, .45)} onAnimationComplete={index === copy.headline.length - 1 ? () => setLeadReady(true) : undefined} aria-hidden="true">{index === 1 ? <><span className="contact__headline-accent">{line}</span><svg className="contact__smile" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="27" /><path d="M22 27v2m20-2v2" /><path className="contact__smile-accent" d="M20 39c5 8 19 11 26 0" /></svg></> : line}</motion.span>
              {index < copy.headline.length - 1 ? " " : null}
            </span>)}
          </h2>
          <p className="contact__intro"><ServiceTypewriter text={copy.intro} locale={locale} className="contact__intro-text" mode="motion" play={leadReady} totalDuration={3.75} /></p>
        </header>

        <div className="contact__body">
          <form className="contact__panel" method="post" action={appConfig.paths.contactApi} onSubmit={submit} aria-label={copy.title}>
            <fieldset className="contact__interests" aria-describedby={interestHintId}>
              <legend>{copy.interest}</legend>
              <p id={interestHintId} className="contact__hint">{copy.interestHint}</p>
              <div className="contact__chips">
                <label className="contact__chip">
                  <input className="contact__chip-input" type="checkbox" name="services" value={appConfig.contact.diagnosticSlug} aria-describedby={diagnosticHintId} />
                  <span className="contact__chip-face button button--outline">{copy.diagnostic}</span>
                </label>
                {serviceNames.map((name, index) => <label className="contact__chip" key={serviceSlugs[index]}>
                  <input className="contact__chip-input" type="checkbox" name="services" value={serviceSlugs[index]} />
                  <span className="contact__chip-face button button--outline">{name}</span>
                </label>)}
              </div>
              <p className="contact__diagnostic-hint" id={diagnosticHintId}>{copy.diagnosticHint}</p>
            </fieldset>
            <div className="contact__fields">
              <p className="contact__required-hint">{copy.requiredHint}</p>
              <ContactField id={`contact-name-${locale}`} name="name" label={`${copy.name} *`} maxLength={appConfig.contact.nameMaxLength} autoComplete="name" required third />
              <ContactField id={`contact-email-${locale}`} name="email" label={`${copy.email} *`} type="email" maxLength={appConfig.contact.emailMaxLength} autoComplete="email" required third />
              <ContactField id={`contact-phone-${locale}`} name="phone" label={copy.phone} type="tel" maxLength={appConfig.contact.phoneMaxLength} autoComplete="tel" third />
              <ContactField id={`contact-website-${locale}`} name="website" label={copy.website} maxLength={appConfig.contact.websiteMaxLength} autoComplete="url" />
              <ContactField id={`contact-budget-${locale}`} name="budget" label={copy.budget} maxLength={appConfig.contact.budgetMaxLength} />
              <div className="contact__message-field">
                <ContactField id={`contact-message-${locale}`} name="message" label={`${copy.message} *`} multiline maxLength={appConfig.contact.messageMaxLength} required onChange={setMessage} />
                <div className="contact__counter"><span>{copy.messageLimit}</span><span>{message.length} / {appConfig.contact.messageMaxLength}</span></div>
                <span className="sr-only" role="status">{message.length === appConfig.contact.messageMaxLength ? copy.limitReached : ""}</span>
              </div>
            </div>
            <div className="contact__form-bottom">
              <div className="contact__consents">
                <label><input className="form-checkbox" type="checkbox" name="newsletter" /><span>{copy.newsletter}</span></label>
                <a className="contact__newsletter-resend" href={`#newsletter-${locale}`}>{copy.newsletterResend}</a>
                <div className="contact__privacy-row"><input className="form-checkbox" id={`contact-privacy-${locale}`} type="checkbox" name="privacy" aria-label={copy.privacy} required /><span><label htmlFor={`contact-privacy-${locale}`}>{copy.privacyPrefix}</label>{" "}<PrivacyModalLink locale={locale}>{copy.privacyLink}</PrivacyModalLink> *</span></div>
              </div>
              <div className="contact__submit">
                <div ref={captchaHost} className="contact__captcha" />
                <button ref={submitButton} className="button button--outline" type="submit" aria-disabled={sending} aria-busy={sending}>{sending ? copy.sending : copy.send}</button>
                <AnimatePresence mode="wait">{notice ? <ContactStatusNotice key={notice.id} notice={notice} copy={copy} locale={locale} onClose={closeNotice} submitButton={submitButton} /> : null}</AnimatePresence>
                <p className="contact__feedback" aria-hidden="true">{feedback ? copy[feedback] : ""}</p>
                <span className="sr-only" role="status">{announcement.status}</span>
                <span className="sr-only" role="alert">{announcement.error}</span>
                <p className="contact__captcha-notice">{copy.captchaNoticeStart}<PrivacyModalLink locale={locale}>{copy.captchaPrivacy}</PrivacyModalLink>{copy.captchaNoticeEnd}</p>
              </div>
            </div>
          </form>
          <address className="contact__direct" aria-label={copy.title}>
            <CopyableContact value={appConfig.contactEmail} kind="email" copy={copy} />
            {appConfig.contactPhones.map((phone) => {
              const international = `${appConfig.contactPhoneCountryCode}${phone.slice(1)}`;
              return <CopyableContact value={locale === "en" ? international : phone} kind="phone" copy={copy} key={phone} />;
            })}
          </address>
        </div>
      </div>
      <noscript><style>{`.contact__headline-line{opacity:1!important;transform:none!important}.contact .service-typewriter__motion-char{visibility:visible!important}.contact .service-typewriter__motion-cursor{display:none!important}`}</style></noscript>
    </main>
  </MotionConfig>;
}
