import Image from "next/image";
import Link from "next/link";
import heroBackgroundDesktop from "@/assets/hero/background-desktop.webp";
import heroBackgroundMobile from "@/assets/hero/background-mobile.webp";
import { appConfig } from "@/lib/config";
import { messages } from "@/lib/messages";
import { localeSwitchUrl, locales, pageUrl, serviceSlugs, serviceUrl, type Locale, type Page, type ServiceSlug, type SiteRoute } from "@/lib/routing";
import FooterLegalButton from "./FooterLegalButton";
import FooterNewsletter from "./FooterNewsletter";
import HeroMotion from "./HeroOrb";
import IntroSection from "./IntroSection";
import ServicesSection from "./ServicesSection";
import SiteNavigation from "./SiteNavigation";
import "./SitePage.css";

type HeaderProps = { locale: Locale } & (
  | { page: Page; serviceSlug?: never }
  | { page: "service"; serviceSlug: ServiceSlug }
);

function SiteHeader(props: HeaderProps) {
  const { locale } = props;
  const copy = messages[locale];
  return <header className="site-header">
    <div className="container site-header__inner">
      <Link href={pageUrl("home", locale)} className="site-header__brand">
        <Image src={appConfig.brandLogoPath} alt="WebCreativeTeam" width={280} height={77} priority unoptimized />
      </Link>
      <div className="container site-header__actions">
        <Link className="button button--outline site-header__cta" href={pageUrl("contacts", locale)}>{copy.landing.hero.contact}</Link>
        <SiteNavigation {...props} copy={{
          menu: copy.landing.menu,
          navigation: copy.navigation,
          language: copy.language,
          home: copy.homeLabel,
          services: copy.servicesLabel,
          servicesToggle: copy.servicesToggle,
          serviceLinks: copy.serviceLinks,
          blog: copy.blogLabel,
          about: copy.aboutLabel,
          faq: copy.faqLabel,
          contact: copy.contactLabel,
        }} />
      </div>
    </div>
  </header>;
}

function HomePage({ locale }: { locale: Locale }) {
  const copy = messages[locale].landing;
  return <main id="main" className="site-home" tabIndex={-1}>
    <div className="hero__stage" aria-hidden="true">
      <picture className="hero__art">
        <source media="(width <= 47.5rem)" srcSet={heroBackgroundMobile.src} type="image/webp" />
        <img src={heroBackgroundDesktop.src} alt="" fetchPriority="high" className="hero__background" />
      </picture>
      <div className="hero__shade" />
    </div>
    <section className="hero" aria-labelledby="hero-title">
      <div className="container hero__inner">
        <HeroMotion
          lines={copy.hero.lines}
          description={copy.hero.description}
          rotationPauseLabel={copy.hero.rotationPause}
        />
      </div>
    </section>
    <IntroSection copy={copy.intro} />
    <ServicesSection copy={copy.services} />
  </main>;
}

const socialNames = ["linkedin", "facebook", "instagram", "youtube", "tiktok"] as const;
const socialLabels = { linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" } as const;

function SocialIcon({ name }: { name: (typeof socialNames)[number] }) {
  if (name === "instagram") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>;
  if (name === "youtube") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="5" fill="currentColor" /><path d="m10 8 6 4-6 4z" fill="white" /></svg>;
  if (name === "tiktok") return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15 2h3c.2 2.2 1.5 3.4 4 3.6v3.2a9 9 0 0 1-4-1.2v7.1a7 7 0 1 1-7-7h.6v3.4a3.6 3.6 0 1 0 3.4 3.6V2Z" /></svg>;
  return <span aria-hidden="true" className="site-footer__social-glyph">{name === "linkedin" ? "in" : "f"}</span>;
}

function SiteFooter({ locale, route }: { locale: Locale; route: SiteRoute }) {
  const copy = messages[locale];
  const footer = copy.landing.footer;
  const legal = { unavailable: footer.legalUnavailable, close: footer.close };
  return <footer className="site-footer">
    <div className="container site-footer__callout">
      <div className="site-footer__callout-copy"><p><span>{footer.idea} {footer.promise}</span></p></div>
    </div>
    <div className="site-footer__surface">
    <div className="site-footer__main">
      <div className="container site-footer__grid">
        <div className="site-footer__brand"><Link href={`${pageUrl("home", locale)}#main`} aria-label="WebCreativeTeam"><Image src={appConfig.brandLogoPath} alt="" width={430} height={119} unoptimized /></Link></div>
        <nav className="site-footer__navigation" aria-label={footer.navigation}>
          <Link href={pageUrl("home", locale)}>{copy.homeLabel}</Link>
          {serviceSlugs.map((slug, index) => <Link key={slug} href={serviceUrl(slug, locale)}>{copy.serviceLinks[index]}</Link>)}
          <Link href={pageUrl("blog", locale)}>{copy.blogLabel}</Link>
          <Link href={pageUrl("faq", locale)}>{copy.faqLabel}</Link>
          <Link href={pageUrl("about", locale)}>{copy.aboutLabel}</Link>
          <Link href={pageUrl("contacts", locale)}>{copy.contactLabel}</Link>
        </nav>
        <section className="site-footer__newsletter" aria-labelledby={`newsletter-${locale}`}>
          <h2 id={`newsletter-${locale}`}>{footer.newsletterTitle}</h2>
          <p>{footer.newsletterDescription}</p>
          <FooterNewsletter locale={locale} copy={footer} />
        </section>
        <section className="site-footer__social" aria-labelledby={`social-${locale}`}>
          <h2 id={`social-${locale}`}>{footer.follow}</h2>
          <div className="site-footer__social-icons">
            {socialNames.map((name) => {
              const url = appConfig.socialProfiles[name];
              const icon = <SocialIcon name={name} />;
              const className = `button site-footer__social-icon site-footer__social-icon--${name}`;
              return url ? <a key={name} href={url} target="_blank" rel="noopener noreferrer" aria-label={socialLabels[name]} className={className}>{icon}</a> : <button key={name} type="button" disabled aria-label={socialLabels[name]} className={className}>{icon}</button>;
            })}
          </div>
          <Link className="button button--outline site-footer__cta" href={pageUrl("contacts", locale)}>{copy.landing.hero.contact}</Link>
        </section>
      </div>
    </div>
    <div className="container site-footer__bottom">
      <p>{footer.rights}</p>
      <div className="site-footer__bottom-links">
        <FooterLegalButton label={footer.privacy} title={footer.privacyPolicy} {...legal} />
        <FooterLegalButton label={footer.cookies} title={footer.cookies} {...legal} />
        <FooterLegalButton label={footer.terms} title={footer.terms} {...legal} />
      </div>
      <nav className="site-footer__languages" aria-label={copy.language}>{locales.map((language) => <a key={language} href={localeSwitchUrl(route, language)} lang={language} hrefLang={language} aria-current={language === locale ? "page" : undefined}>{language.toUpperCase()}</a>)}</nav>
    </div>
    </div>
  </footer>;
}

export default function SitePage({ locale, page }: { locale: Locale; page: Page }) {
  const copy = messages[locale];
  return <div className={`site-page site-page--${page}`}>
    <SiteHeader locale={locale} page={page} />
    {page === "home" ? <HomePage locale={locale} /> : <main id="main" className="container standard-page" tabIndex={-1}>
      <h1>{copy[page].title}</h1>
      {copy[page].description && <p>{copy[page].description}</p>}
      {page === "contacts" && <a href={`mailto:${appConfig.contactEmail}`}>{appConfig.contactEmail}</a>}
    </main>}
    <SiteFooter locale={locale} route={{ page }} />
  </div>;
}

export function ServicePage({ locale, slug }: { locale: Locale; slug: ServiceSlug }) {
  const title = messages[locale].serviceLinks[serviceSlugs.indexOf(slug)];
  return <div className="site-page site-page--service">
    <SiteHeader locale={locale} page="service" serviceSlug={slug} />
    <main id="main" className="container standard-page" tabIndex={-1}><h1>{title}</h1></main>
    <SiteFooter locale={locale} route={{ page: "service", serviceSlug: slug }} />
  </div>;
}
