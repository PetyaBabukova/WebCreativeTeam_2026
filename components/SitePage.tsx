import Image from "next/image";
import Link from "next/link";
import heroBackgroundDesktop from "@/assets/hero/background-desktop.webp";
import heroBackgroundMobile from "@/assets/hero/background-mobile.webp";
import serviceDetailBackground from "@/assets/services/products_page_background.webp";
import aiDetailHero from "@/assets/services/products_page_intro_image.webp";
import seoDetailHero from "@/assets/services/SEO_and_Geo_intro_image.webp";
import aiBusinessProcesses from "@/assets/services/products_page_business_proces_section_image.webp";
import aiAssistants from "@/assets/services/produts_page_AI_assistent_image.webp";
import aiIntegrations from "@/assets/services/AI_integration_image.webp";
import seoOptimization from "@/assets/services/SEO_optimization_section_image.webp";
import technicalSeo from "@/assets/services/technical_SEO_section_image.webp";
import { appConfig } from "@/lib/config";
import { messages, serviceDetail } from "@/lib/messages";
import { localeSwitchUrl, locales, pageUrl, serviceSlugs, serviceUrl, type Locale, type Page, type ServiceSlug, type SiteRoute } from "@/lib/routing";
import FooterLegalButton from "./FooterLegalButton";
import FooterNewsletter from "./FooterNewsletter";
import HeroMotion from "./HeroOrb";
import IntroSection from "./IntroSection";
import ServicesSection from "./ServicesSection";
import ServiceTypewriter from "./ServiceTypewriter";
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
    <ServicesSection copy={copy.services} locale={locale} />
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
        <div className="site-footer__brand"><a href={`${pageUrl("home", locale)}#main`} aria-label="WebCreativeTeam"><Image src={appConfig.brandLogoPath} alt="" width={430} height={119} unoptimized /></a></div>
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

function ServiceLinkIcon({ slug }: { slug: ServiceSlug }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
    {slug === "ai-automation" ? <><circle cx="12" cy="5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="M12 7v5M5 16l7-4 7 4" /></>
      : slug === "seo-geo" ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>
        : slug === "digital-marketing" ? <><path d="M3 10v4h4l9 4V6l-9 4H3Zm4 4 2 6h3" /><path d="M19 9c1 1 1 5 0 6" /></>
          : slug === "branding" ? <><path d="m3 12 9-9h8l1 8-9 10-9-9Z" /><circle cx="16" cy="8" r="1.5" /></>
            : <><rect x="2" y="4" width="20" height="14" rx="1.5" /><path d="M9 22h6m-3-4v4" /></>}
  </svg>;
}

const serviceSectionImages = { "business-processes": aiBusinessProcesses, "ai-assistants": aiAssistants, "ai-integrations": aiIntegrations, "seo-optimization": seoOptimization, "technical-seo": technicalSeo } as const;

const serviceDetailHeroImages = { "ai-automation": aiDetailHero, "seo-geo": seoDetailHero } as const;

function serviceDetailHeroImage(slug: ServiceSlug) {
  if (!(slug in serviceDetailHeroImages)) throw new Error(`Missing service hero image: ${slug}`);
  return serviceDetailHeroImages[slug as keyof typeof serviceDetailHeroImages];
}

function serviceSectionImage(image: string) {
  if (!(image in serviceSectionImages)) throw new Error(`Missing service section image: ${image}`);
  return serviceSectionImages[image as keyof typeof serviceSectionImages];
}

export function ServicePage({ locale, slug }: { locale: Locale; slug: ServiceSlug }) {
  const copy = messages[locale];
  const title = copy.serviceLinks[serviceSlugs.indexOf(slug)];
  const detail = serviceDetail(locale, slug);
  const sections = detail && "sections" in detail ? detail.sections : undefined;
  return <div className={`site-page site-page--service${detail ? " site-page--service-detail" : ""}`}>
    <SiteHeader locale={locale} page="service" serviceSlug={slug} />
    {detail ? <main id="main" className="service-detail" tabIndex={-1}>
      <div className="service-detail__background" aria-hidden="true"><Image src={serviceDetailBackground} alt="" fill sizes="100vw" priority unoptimized decoding="sync" /></div>
      <section className="service-detail__hero" aria-labelledby="service-detail-title">
        <div className="container service-detail__hero-inner">
          <div className="service-detail__hero-copy">
            <div className="service-detail__eyebrow"><p>{detail.hero.eyebrow}</p></div>
            <h1 id="service-detail-title" className="service-detail__title"><span>{detail.hero.title}</span>{" "}<ServiceTypewriter key={`${locale}-${detail.hero.accent}`} text={detail.hero.accent} locale={locale} className="service-detail__title-accent" startOnPaint /></h1>
          </div>
          <div className="service-detail__hero-art"><Image src={serviceDetailHeroImage(slug)} alt={detail.hero.imageAlt} fill sizes="(max-width: 47.5rem) 100vw, 55vw" priority decoding="sync" /></div>
          <p className="service-detail__hero-description">{detail.hero.description}</p>
        </div>
      </section>
      <nav className="container service-detail__links" aria-label={copy.servicesLabel}>
        {serviceSlugs.map((serviceSlug, index) => <Link key={serviceSlug} href={serviceUrl(serviceSlug, locale)} className={`button button--outline service-detail__link${serviceSlug === slug ? " button--outline-active" : ""}`} aria-current={serviceSlug === slug ? "page" : undefined}>
          <ServiceLinkIcon slug={serviceSlug} /><span>{copy.serviceLinks[index]}</span>
        </Link>)}
      </nav>
      {sections && <div className="service-detail__sections">
        {sections.map((section, index) => <section key={section.image} className="container service-detail__section" aria-labelledby={section.image}>
          <div className="service-detail__section-heading">
            <div className="service-detail__eyebrow"><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><p>{section.eyebrow}</p></div>
            <h2 id={section.image}>
              <span className="sr-only">{section.titleSegments.map((part) => part.text).join(" ")}</span>
              <span aria-hidden="true">{section.titleSegments[0].text}</span>
              <span className="service-detail__title-followup" aria-hidden="true">
                {section.titleSegments.slice(1).map((part, partIndex) => <span key={`${part.text}-${partIndex}`}>{partIndex > 0 ? " " : null}{part.accent ? <ServiceTypewriter key={`${locale}-${part.text}`} text={part.text} locale={locale} className="service-detail__accent" assistiveText={false} /> : part.text}</span>)}
              </span>
            </h2>
          </div>
          <div className="service-detail__section-art"><Image src={serviceSectionImage(section.image)} alt={section.imageAlt} fill sizes="(max-width: 47.5rem) 100vw, 50vw" loading={index === 0 ? "eager" : "lazy"} decoding="sync" /></div>
          <div className="service-detail__section-bottom">
            <p className="service-detail__body">{section.body}</p>
            {section.cta && <Link className="button button--outline service-detail__cta" href={pageUrl("contacts", locale)}>{copy.landing.hero.contact}</Link>}
          </div>
        </section>)}
      </div>}
    </main> : <main id="main" className="container standard-page" tabIndex={-1}><h1>{title}</h1></main>}
    <SiteFooter locale={locale} route={{ page: "service", serviceSlug: slug }} />
  </div>;
}
