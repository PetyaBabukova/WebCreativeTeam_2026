"use client";

import { appConfig } from "@/lib/config";
import { messages } from "@/lib/messages";
import { pageUrl, type Locale } from "@/lib/routing";
import Link from "next/link";

export default function PrivacyContent({ locale, modal = false }: { locale: Locale; modal?: boolean }) {
  const copy = messages[locale].privacy;
  const Heading = modal ? "h3" : "h2";
  const phone = appConfig.privacyPhone;
  const displayPhone = locale === "bg" ? phone : `${appConfig.contactPhoneCountryCode}${phone.slice(1)}`;
  const prefix = modal ? "privacy-modal" : "privacy";

  return <>
    <p className="privacy-page__updated">{copy.updated}</p>
    {copy.sections.map((section) => <section key={section.id} aria-labelledby={`${prefix}-${section.id}`}>
      <Heading id={`${prefix}-${section.id}`}>{section.heading}</Heading>
      {section.id === "controller" && <p>{copy.controllerLead} <span lang="bg">{appConfig.legalName}</span> {copy.controllerAfter}</p>}
      {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {section.id === "cookies" && <p><Link href={pageUrl("cookies", locale)} target={modal ? "_blank" : undefined} rel={modal ? "noopener noreferrer" : undefined}>{messages[locale].cookies.title}</Link></p>}
      {section.id === "controller" && <p>{copy.contactLead} <span className="privacy-page__contact">{appConfig.contactEmail}</span> {copy.contactOr} <span className="privacy-page__contact">{displayPhone}</span>.</p>}
      {section.id === "rights" && <p>{copy.complaintLead} <a href={appConfig.privacyAuthorityUrl} target={modal ? "_blank" : undefined} rel={modal ? "noopener noreferrer" : undefined}>{copy.complaintLink}</a> {copy.complaintEnd}</p>}
    </section>)}
    <p className="privacy-page__changes">{copy.changes}</p>
  </>;
}
