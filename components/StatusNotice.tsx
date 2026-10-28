"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { appConfig } from "@/lib/config";

export type StatusNoticeInput = {
  source: "contact" | "footer";
  kind: "sending" | "success" | "error" | "neutral";
  text: string;
  closeLabel: string;
  onClose?: () => void;
  returnFocus?: HTMLElement | null;
};
type PresentedNotice = StatusNoticeInput & { sequence: number };

type StatusNoticeContextValue = {
  publish: (notice: StatusNoticeInput) => void;
  dismiss: (source: StatusNoticeInput["source"]) => void;
};

const StatusNoticeContext = createContext<StatusNoticeContextValue | null>(null);

function NoticeCard({ notice, close }: { notice: StatusNoticeInput; close: () => void }) {
  const reduceMotion = useReducedMotion();
  const isPresent = useIsPresent();
  const closeButton = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef({ handle: null as number | null, remaining: appConfig.contact.notificationDurationMilliseconds as number, startedAt: 0, hover: false, focus: false });

  function stopTimer() {
    const current = timer.current;
    if (current.handle === null) return;
    window.clearTimeout(current.handle);
    current.handle = null;
    current.remaining = Math.max(0, current.remaining - (Date.now() - current.startedAt));
  }

  function startTimer() {
    const current = timer.current;
    if (!isPresent || notice.kind === "sending" || current.handle !== null || current.hover || current.focus) return;
    current.startedAt = Date.now();
    current.handle = window.setTimeout(close, current.remaining);
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
    if (notice.kind !== "sending" && !current.hover && !current.focus) {
      current.startedAt = Date.now();
      current.handle = window.setTimeout(close, current.remaining);
    }
    return () => { if (current.handle !== null) window.clearTimeout(current.handle); current.handle = null; };
  }, [close, isPresent, notice.kind, notice.text]);

  function closeByButton() {
    const hadFocus = document.activeElement === closeButton.current;
    close();
    if (hadFocus) notice.returnFocus?.focus();
  }

  return <motion.div ref={card} className={`contact__notice contact__notice--newsletter${notice.kind === "success" ? " contact__notice--sent" : ""}${notice.kind === "error" ? " contact__notice--error" : ""}`} role="group" aria-label={notice.text}
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
    <span className={`contact__notice-icon${notice.kind === "sending" && !reduceMotion ? " contact__notice-icon--sending" : ""}`} aria-hidden="true">
      {notice.kind === "sending" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21 3-8.4 18-2.7-7.2L3 11.1 21 3Z" /><path d="m9.9 13.8 4.8-4.8" /></svg>
        : notice.kind === "success" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 12.5 5 5L19.5 7" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></svg>}
    </span>
    <div className="contact__notice-text"><strong>{notice.text}</strong></div>
    {notice.kind !== "sending" ? <button ref={closeButton} className="contact__notice-close" type="button" aria-label={notice.closeLabel} onClick={closeByButton}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button> : null}
  </motion.div>;
}

export function StatusNoticeProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<PresentedNotice | null>(null);
  const currentRef = useRef<PresentedNotice | null>(null);
  const queue = useRef<PresentedNotice[]>([]);
  const sequence = useRef(0);

  const publish = useCallback((notice: StatusNoticeInput) => {
    const presented = { ...notice, sequence: ++sequence.current };
    if (currentRef.current && currentRef.current.source !== notice.source) {
      queue.current = [...queue.current.filter((entry) => entry.source !== notice.source), presented];
      return;
    }
    currentRef.current = presented;
    setCurrent(presented);
  }, []);

  const dismiss = useCallback((source: StatusNoticeInput["source"], notify = false, expectedSequence?: number) => {
    if (expectedSequence !== undefined && currentRef.current?.sequence !== expectedSequence) return;
    if (currentRef.current?.source !== source) {
      queue.current = queue.current.filter((entry) => entry.source !== source);
      return;
    }
    const old = currentRef.current;
    const next = queue.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
    if (notify) old.onClose?.();
  }, []);

  return <StatusNoticeContext.Provider value={{ publish, dismiss }}>
    {children}
    <AnimatePresence mode="wait">{current ? <NoticeCard key={current.source} notice={current} close={() => dismiss(current.source, true, current.sequence)} /> : null}</AnimatePresence>
  </StatusNoticeContext.Provider>;
}

export function useStatusNotice() {
  const context = useContext(StatusNoticeContext);
  if (!context) throw new Error("StatusNoticeProvider is missing");
  return context;
}
