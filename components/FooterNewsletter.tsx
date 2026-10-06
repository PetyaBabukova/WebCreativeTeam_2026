import type { messages } from "@/lib/messages";
import type { Locale } from "@/lib/routing";
import FooterLegalButton from "./FooterLegalButton";

type FooterCopy = typeof messages.bg.landing.footer;

export default function FooterNewsletter({ locale, copy }: { locale: Locale; copy: FooterCopy }) {
  const emailId = `footer-email-${locale}`;
  const privacyId = `footer-privacy-${locale}`;

  // The backend is not connected; keep submission disabled and avoid serializable field names.
  return <form className="site-footer__newsletter-form">
    <div className="site-footer__email-row">
      <label className="sr-only" htmlFor={emailId}>{copy.email}</label>
      <input id={emailId} type="email" autoComplete="email" placeholder={copy.email} required />
      <button type="submit" aria-label={copy.subscribe} disabled>→</button>
    </div>
    <label className="site-footer__consent">
      <input className="form-checkbox" type="checkbox" required />
      <span>{copy.consentNews}</span>
    </label>
    <div className="site-footer__consent">
      <input className="form-checkbox" id={privacyId} type="checkbox" required aria-label={`${copy.consentPrivacy} ${copy.privacyPolicy}`} />
      <div><label htmlFor={privacyId}>{copy.consentPrivacy}</label> <FooterLegalButton label={copy.privacyPolicy} title={copy.privacyPolicy} unavailable={copy.legalUnavailable} close={copy.close} />.</div>
    </div>
  </form>;
}
