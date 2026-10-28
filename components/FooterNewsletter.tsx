"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { appConfig } from "@/lib/config";
import { fetchCaptchaSiteKey, loadCaptchaScript, type RecaptchaApi } from "@/lib/clientCaptcha";
import type { messages } from "@/lib/messages";
import type { Locale } from "@/lib/routing";
import { PrivacyModalLink } from "./PrivacyModal";
import { useStatusNotice } from "./StatusNotice";

type FooterCopy = typeof messages.bg.landing.footer;
type Operation = "request" | "resend";
type PendingRequest = { operation: Operation; email: string; consentNews: boolean; consentPrivacy: boolean };

export default function FooterNewsletter({ locale, copy }: { locale: Locale; copy: FooterCopy }) {
  const emailId = `footer-email-${locale}`;
  const privacyId = `footer-privacy-${locale}`;
  const formRef = useRef<HTMLFormElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const captchaHost = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: RecaptchaApi; id: number } | null>(null);
  const pending = useRef<PendingRequest | null>(null);
  const busyRef = useRef(false);
  const active = useRef(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const { publish, dismiss } = useStatusNotice();

  function showFeedback(text: string, success: boolean) {
    setFeedback(text);
    publish({ source: "footer", kind: success ? "success" : "error", text, closeLabel: copy.close, returnFocus: submitButton.current });
  }

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pending.current = null; busyRef.current = false; dismiss("footer"); if (widget.current) widget.current.api.reset(widget.current.id); };
  }, [dismiss]);

  async function send(request: PendingRequest, captchaToken: string) {
    try {
      const response = await fetch(`${appConfig.paths.newsletterApi}/${request.operation}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: request.email, locale, captchaToken,
          ...(request.operation === "request" ? { consentNews: request.consentNews, consentPrivacy: request.consentPrivacy } : {}),
        }),
        signal: AbortSignal.timeout(appConfig.contact.requestTimeoutMilliseconds),
      });
      if (!active.current) return;
      const details: unknown = await response.json().catch(() => null);
      const captchaFailed = details && typeof details === "object" && "error" in details && details.error === "captcha";
      const success = response.status === 202;
      showFeedback(success ? request.operation === "resend" ? copy.resendCheck : copy.checkEmail
        : response.status === 429 ? copy.limited : captchaFailed ? copy.captchaError : response.status === 400 ? copy.invalid : copy.error, success);
    } catch {
      if (active.current) showFeedback(copy.error, false);
    } finally {
      if (active.current) { busyRef.current = false; setBusy(false); widget.current?.api.reset(widget.current.id); }
    }
  }

  async function execute(operation: Operation) {
    if (busyRef.current || !formRef.current) return;
    const email = formRef.current.elements.namedItem("email");
    if (!(email instanceof HTMLInputElement) || !email.reportValidity()) return;
    if (operation === "request" && !formRef.current.reportValidity()) return;
    const fields = new FormData(formRef.current);
    const emailValue = fields.get("email");
    if (typeof emailValue !== "string") return;
    setFeedback("");
    dismiss("footer");
    busyRef.current = true;
    setBusy(true);
    pending.current = { operation, email: emailValue, consentNews: fields.has("consentNews"), consentPrivacy: fields.has("consentPrivacy") };
    try {
      if (!widget.current) {
        const siteKey = await fetchCaptchaSiteKey();
        if (!siteKey || !active.current || !captchaHost.current) throw new Error("CAPTCHA unavailable");
        const api = await loadCaptchaScript(locale);
        if (!active.current) return;
        const id = api.render(captchaHost.current, {
          sitekey: siteKey, size: "invisible", badge: "bottomright",
          callback: (token) => {
            const request = pending.current;
            pending.current = null;
            if (!active.current || !request || !token) { if (active.current) { busyRef.current = false; setBusy(false); showFeedback(copy.captchaError, false); api.reset(id); } return; }
            void send(request, token);
          },
          "expired-callback": () => { pending.current = null; busyRef.current = false; setBusy(false); showFeedback(copy.captchaError, false); api.reset(id); },
          "error-callback": () => { pending.current = null; busyRef.current = false; setBusy(false); showFeedback(copy.captchaError, false); api.reset(id); },
        });
        widget.current = { api, id };
      }
      widget.current.api.execute(widget.current.id);
    } catch {
      if (active.current) { pending.current = null; busyRef.current = false; setBusy(false); showFeedback(copy.captchaError, false); }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void execute("request"); }

  return <form ref={formRef} className="site-footer__newsletter-form" onSubmit={submit}>
    <div className="site-footer__email-row">
      <label className="sr-only" htmlFor={emailId}>{copy.email}</label>
      <input id={emailId} name="email" type="email" autoComplete="email" placeholder={copy.email} maxLength={appConfig.contact.emailMaxLength} required />
      <button ref={submitButton} type="submit" aria-label={copy.subscribe} aria-busy={busy} disabled={busy}>→</button>
    </div>
    <label className="site-footer__consent">
      <input className="form-checkbox" type="checkbox" name="consentNews" required />
      <span>{copy.consentNews}</span>
    </label>
    <div className="site-footer__consent">
      <input className="form-checkbox" id={privacyId} type="checkbox" name="consentPrivacy" required aria-label={`${copy.consentPrivacy} ${copy.privacyPolicy}`} />
      <div><label htmlFor={privacyId}>{copy.consentPrivacy}</label> <PrivacyModalLink className="site-footer__legal-button" locale={locale}>{copy.privacyPolicy}</PrivacyModalLink>.</div>
    </div>
    <button className="site-footer__resend" type="button" disabled={busy} onClick={() => void execute("resend")}>{copy.resend}</button>
    <div ref={captchaHost} />
    <span className="sr-only" role="status" aria-live="polite">{busy ? copy.sending : feedback}</span>
  </form>;
}
