"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { appConfig } from "@/lib/config";
import { locales, localeSwitchUrl, pageUrl, sectionUrl, serviceSlugs, serviceUrl, type Locale, type Page, type ServiceSlug } from "@/lib/routing";

type NavigationCopy = {
  menu: string;
  navigation: string;
  language: string;
  home: string;
  services: string;
  servicesToggle: string;
  serviceLinks: string[];
  blog: string;
  about: string;
  faq: string;
  contact: string;
};

type NavigationProps = { locale: Locale; copy: NavigationCopy } & (
  | { page: Page; serviceSlug?: never }
  | { page: "service"; serviceSlug: ServiceSlug }
);

const sharedAnchors = new Set(["services"]);

function currentSharedHash(): string {
  const anchor = window.location.hash.slice(1);
  return sharedAnchors.has(anchor) ? `#${anchor}` : "";
}

function useLocalePreference(locale: Locale) {
  useEffect(() => {
    const sync = () => {
      const { name, maxAgeSeconds, path, sameSite } = appConfig.localeCookie;
      document.cookie = `${name}=${locale}; Max-Age=${maxAgeSeconds}; Path=${path}; SameSite=${sameSite}${window.location.protocol === "https:" ? "; Secure" : ""}`;
    };
    const syncWhenVisible = () => { if (document.visibilityState === "visible") sync(); };
    sync();
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", syncWhenVisible);
    return () => {
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, [locale]);
}

export default function SiteNavigation({ locale, page, serviceSlug, copy }: NavigationProps) {
  if (copy.serviceLinks.length !== serviceSlugs.length) {
    throw new Error(`Expected ${serviceSlugs.length} service navigation labels, received ${copy.serviceLinks.length}`);
  }
  const menuRef = useRef<HTMLDetailsElement>(null);
  const servicesRef = useRef<HTMLDetailsElement>(null);
  const [hash, setHash] = useState("");
  useLocalePreference(locale);

  useEffect(() => {
    const syncHash = () => setHash(currentSharedHash());
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  function closeMenus() {
    if (servicesRef.current) servicesRef.current.open = false;
    if (menuRef.current) menuRef.current.open = false;
  }

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape") return;
    if (servicesRef.current?.open) {
      servicesRef.current.open = false;
      servicesRef.current.querySelector<HTMLElement>("summary")?.focus();
    } else if (menuRef.current?.open) {
      menuRef.current.open = false;
      menuRef.current.querySelector<HTMLElement>(":scope > summary")?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onMenuToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (event.target !== event.currentTarget) return;
    setHash(currentSharedHash());
    if (servicesRef.current) {
      servicesRef.current.open = Boolean(menuRef.current?.open && window.matchMedia("(width <= 47.5rem)").matches);
    }
  }

  return <details className="site-menu" ref={menuRef} onKeyDown={onMenuKeyDown} onToggle={onMenuToggle}>
    <summary className="button--outline" aria-label={copy.menu}>
      <span aria-hidden="true" className="site-menu__bars"><span /><span /></span>
    </summary>
    <div className="site-menu__panel">
      <nav aria-label={copy.navigation}>
        <Link href={pageUrl("home", locale)} aria-current={page === "home" ? "page" : undefined} onClick={closeMenus}>{copy.home}</Link>
        <div className="site-menu__services">
          <Link href={sectionUrl("services", locale, page)} onClick={closeMenus}>{copy.services}</Link>
          <details ref={servicesRef}>
            <summary aria-label={copy.servicesToggle}>
              <span className="site-menu__services-sizer" aria-hidden="true">{copy.services}</span>
              <span className="site-menu__services-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 9 7 7 7-7" /></svg></span>
            </summary>
            <div className="site-menu__submenu">
              {serviceSlugs.map((slug, index) => <Link key={slug} href={serviceUrl(slug, locale)} aria-current={serviceSlug === slug ? "page" : undefined} onClick={closeMenus}>{copy.serviceLinks[index]}</Link>)}
            </div>
          </details>
        </div>
        <Link href={pageUrl("blog", locale)} aria-current={page === "blog" ? "page" : undefined} onClick={closeMenus}>{copy.blog}</Link>
        <Link href={pageUrl("faq", locale)} aria-current={page === "faq" ? "page" : undefined} onClick={closeMenus}>{copy.faq}</Link>
        <Link href={pageUrl("about", locale)} aria-current={page === "about" ? "page" : undefined} onClick={closeMenus}>{copy.about}</Link>
        <Link href={pageUrl("contacts", locale)} aria-current={page === "contacts" ? "page" : undefined} onClick={closeMenus}>{copy.contact}</Link>
      </nav>
      <nav aria-label={copy.language} className="site-menu__languages">
        {locales.map((language) => <a key={language} href={localeSwitchUrl(page === "service" ? { page, serviceSlug } : { page }, language, hash)} hrefLang={language} lang={language} aria-current={language === locale ? "page" : undefined} onClick={closeMenus}>{language.toUpperCase()}</a>)}
      </nav>
    </div>
  </details>;
}
