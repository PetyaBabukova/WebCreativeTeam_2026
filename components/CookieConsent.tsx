"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { appConfig, cookieValue, parseCookieChoice, type CookieChoice } from "@/lib/config";
import { messages } from "@/lib/messages";
import { pageUrl, type Locale } from "@/lib/routing";
import "./CookieConsent.css";

type ConsentContext = {
  choice: CookieChoice | null;
  choose: (choice: CookieChoice) => void;
  open: (link: HTMLAnchorElement) => void;
};

const Context = createContext<ConsentContext | null>(null);

function useConsent() {
  const value = useContext(Context);
  if (!value) throw new Error("Cookie consent context is missing");
  return value;
}

function clearLocaleCookie() {
  const { name, path, sameSite } = appConfig.localeCookie;
  document.cookie = `${name}=; Max-Age=0; Path=${path}; SameSite=${sameSite}${location.protocol === "https:" ? "; Secure" : ""}`;
}

function writeChoice(choice: CookieChoice) {
  const { name, version, maxAgeSeconds, path, sameSite } = appConfig.cookieChoice;
  document.cookie = `${name}=${version}.${choice}; Max-Age=${maxAgeSeconds}; Path=${path}; SameSite=${sameSite}${location.protocol === "https:" ? "; Secure" : ""}`;
  if (choice !== "all") clearLocaleCookie();
  window.dispatchEvent(new Event(appConfig.cookieChoice.eventName));
}

export function CookieConsentProvider({ locale, autoOpen, inline, children }: {
  locale: Locale; autoOpen: boolean; inline: boolean; children: ReactNode;
}) {
  const copy = messages[locale].cookies;
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLAnchorElement>(null);
  const manuallyOpened = useRef(false);
  const pageChoice = useRef<CookieChoice | null>(null);
  const [choice, setChoice] = useState<CookieChoice | null>(null);
  const [expanded, setExpanded] = useState(false);

  const sync = useCallback(() => {
    const current = parseCookieChoice(document.cookie);
    if (current !== "all" && cookieValue(document.cookie, appConfig.localeCookie.name) !== null) clearLocaleCookie();
    const effectiveChoice = current ?? pageChoice.current;
    setChoice(effectiveChoice);
    if (inline) return;
    if (autoOpen && effectiveChoice === null && !dialog.current?.open) {
      manuallyOpened.current = false;
      setExpanded(false);
      dialog.current?.showModal();
    } else if (effectiveChoice !== null && dialog.current?.open && !manuallyOpened.current) {
      dialog.current.close();
    }
  }, [autoOpen, inline]);

  useEffect(() => {
    sync();
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(appConfig.cookieChoice.eventName, sync);
    return () => {
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(appConfig.cookieChoice.eventName, sync);
    };
  }, [sync]);

  const choose = useCallback((next: CookieChoice) => {
    pageChoice.current = next;
    writeChoice(next);
    if (parseCookieChoice(document.cookie) !== null) pageChoice.current = null;
    setChoice(next);
    if (dialog.current?.open) dialog.current.close();
  }, []);

  const open = useCallback((link: HTMLAnchorElement) => {
    if (inline) {
      document.getElementById("cookie-page-controls")?.focus();
      return;
    }
    if (dialog.current?.open) return;
    opener.current = link;
    manuallyOpened.current = true;
    setChoice(parseCookieChoice(document.cookie));
    setExpanded(false);
    dialog.current?.showModal();
  }, [inline]);

  const onClose = () => {
    // Another tab may have saved a choice since this dialog was opened.
    if (parseCookieChoice(document.cookie) === null && pageChoice.current === null) {
      pageChoice.current = "necessary";
      writeChoice("necessary");
      if (parseCookieChoice(document.cookie) !== null) pageChoice.current = null;
    }
    setChoice(parseCookieChoice(document.cookie) ?? pageChoice.current);
    if (opener.current?.isConnected) opener.current.focus();
    else document.getElementById("main")?.focus();
    opener.current = null;
    manuallyOpened.current = false;
  };

  return <Context.Provider value={{ choice, choose, open }}>
    {children}
    {!inline && <dialog ref={dialog} lang={locale} className="privacy-modal privacy-page cookie-modal" aria-labelledby="cookie-modal-title" onClose={onClose}>
      <div className="privacy-modal__header">
        <h2 id="cookie-modal-title">{copy.dialogTitle}</h2>
        <button type="button" className="privacy-modal__close" aria-label={copy.closeLabel} onClick={() => dialog.current?.close()}><span aria-hidden="true">×</span></button>
      </div>
      <div className="privacy-modal__scroll cookie-modal__scroll" tabIndex={0}>
        <p>{copy.summary}</p>
        <p className="cookie-consent__note">{copy.necessaryNote}</p>
        <CookieControls locale={locale} id="cookie-modal-controls" />
        <button type="button" className="cookie-consent__details" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? copy.hideDetails : copy.showDetails}</button>
        {expanded && <CookieDetails locale={locale} modal />}
      </div>
    </dialog>}
  </Context.Provider>;
}

export function CookieConsentLink({ locale, children, className, current }: {
  locale: Locale; children: ReactNode; className?: string; current?: boolean;
}) {
  const { open } = useConsent();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(event.currentTarget);
  };
  return <Link href={pageUrl("cookies", locale)} className={className} aria-current={current ? "page" : undefined} onClick={onClick}>{children}</Link>;
}

function CookieControls({ locale, id }: { locale: Locale; id: string }) {
  const copy = messages[locale].cookies;
  const { choice, choose } = useConsent();
  const options: readonly { value: CookieChoice; label: string }[] = [
    { value: "all", label: copy.acceptAll },
    { value: "rejected", label: copy.rejectAll },
    { value: "necessary", label: copy.necessaryOnly },
  ];
  return <div className="cookie-consent__controls" id={id} tabIndex={-1}>
    {choice && <p className="cookie-consent__current">{copy.currentChoice} {options.find((item) => item.value === choice)?.label}</p>}
    <div className="cookie-consent__actions">
      {options.map(({ value, label }) => <button key={value} type="button" className="button button--outline cookie-consent__action" aria-pressed={choice === value} onClick={() => choose(value)}>{label}</button>)}
    </div>
  </div>;
}

function CookieDetails({ locale, modal = false }: { locale: Locale; modal?: boolean }) {
  const copy = messages[locale].cookies;
  const Heading = modal ? "h3" : "h2";
  return <div className="cookie-consent__policy">
    <p className="privacy-page__updated">{copy.updated}</p>
    <section aria-labelledby={`cookie-${modal ? "modal" : "page"}-purpose`}>
      <Heading id={`cookie-${modal ? "modal" : "page"}-purpose`}>{copy.purposeTitle}</Heading>
      <p>{copy.purpose}</p>
      <p>{copy.language}</p>
    </section>
    <section aria-labelledby={`cookie-${modal ? "modal" : "page"}-used`}>
      <Heading id={`cookie-${modal ? "modal" : "page"}-used`}>{copy.usedTitle}</Heading>
      <ul className="cookie-consent__list">
        {copy.storage.map((item) => <li key={item.name}><strong>{item.name}</strong> — {item.description}</li>)}
      </ul>
      <p>{copy.recaptcha}</p>
      <p>{copy.noAnalytics}</p>
    </section>
    <section aria-labelledby={`cookie-${modal ? "modal" : "page"}-control`}>
      <Heading id={`cookie-${modal ? "modal" : "page"}-control`}>{copy.controlTitle}</Heading>
      <p>{copy.control}</p>
      <p><Link href={pageUrl("privacy", locale)} target={modal ? "_blank" : undefined} rel={modal ? "noopener noreferrer" : undefined}>{copy.privacyLink}</Link></p>
    </section>
  </div>;
}

export function CookiePolicyPage({ locale }: { locale: Locale }) {
  const copy = messages[locale].cookies;
  return <main id="main" className="container standard-page privacy-page cookie-page" tabIndex={-1}>
    <div className="privacy-page__content">
      <h1>{copy.title}</h1>
      <CookieDetails locale={locale} />
      <p className="cookie-consent__note">{copy.necessaryNote}</p>
      <CookieControls locale={locale} id="cookie-page-controls" />
    </div>
  </main>;
}
