"use client";

import { createContext, lazy, Suspense, useCallback, useContext, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { pageUrl, type Locale } from "@/lib/routing";

const PrivacyContent = lazy(() => import("./PrivacyContent"));
const PrivacyModalContext = createContext<((opener: HTMLAnchorElement) => void) | null>(null);

export function PrivacyModalProvider({ children, locale, enabled, title, closeLabel, loadingLabel }: {
  children: ReactNode; locale: Locale; enabled: boolean; title: string; closeLabel: string; loadingLabel: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLAnchorElement>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const open = useCallback((link: HTMLAnchorElement) => {
    if (!dialog.current || dialog.current.open) return;
    opener.current = link;
    setHasOpened(true);
    dialog.current.showModal();
  }, []);
  const onClose = useCallback(() => {
    opener.current?.focus();
    opener.current = null;
  }, []);

  return <PrivacyModalContext.Provider value={enabled ? open : null}>
    {children}
    {enabled && <dialog ref={dialog} className="privacy-modal privacy-page" aria-labelledby="privacy-modal-title" onClose={onClose}>
      <div className="privacy-modal__header">
        <h2 id="privacy-modal-title">{title}</h2>
        <button type="button" className="privacy-modal__close" aria-label={closeLabel} onClick={() => dialog.current?.close()}><span aria-hidden="true">×</span></button>
      </div>
      <div className="privacy-modal__scroll" role="region" aria-labelledby="privacy-modal-title" tabIndex={0}>
        <div className="privacy-page__content">{hasOpened && <Suspense fallback={<p role="status">{loadingLabel}</p>}><PrivacyContent locale={locale} modal /></Suspense>}</div>
      </div>
    </dialog>}
  </PrivacyModalContext.Provider>;
}

export function PrivacyModalLink({ locale, children, className, current }: {
  locale: Locale; children: ReactNode; className?: string; current?: boolean;
}) {
  const open = useContext(PrivacyModalContext);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!open || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(event.currentTarget);
  };
  return <Link href={pageUrl("privacy", locale)} className={className} aria-current={current ? "page" : undefined} onClick={onClick}>{children}</Link>;
}
