import Image from "next/image";
import Link from "next/link";
import heroBackgroundDesktop from "@/assets/hero/background-desktop.webp";
import heroBackgroundMobile from "@/assets/hero/background-mobile.webp";
import { appConfig } from "@/lib/config";
import { messages } from "@/lib/messages";
import { pageUrl, serviceSlugs, type Locale, type Page, type ServiceSlug } from "@/lib/routing";
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
      <div className="site-header__actions">
        <a className="button button--outline site-header__cta" href="#footer-contact">{copy.landing.hero.contact}</a>
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
        <source media="(max-width: 760px)" srcSet={heroBackgroundMobile.src} type="image/webp" />
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

function SiteFooter({ locale }: { locale: Locale }) {
  const copy = messages[locale].landing;
  return <footer id="footer-contact" className="site-footer">
    <div className="container site-footer__grid">
      <div className="site-footer__brand"><Image src={appConfig.brandLogoPath} alt="WebCreativeTeam" width={230} height={63} unoptimized /></div>
      <div><h2>{copy.footer.company}</h2><Link href={pageUrl("about", locale)}>{messages[locale].aboutLabel}</Link></div>
      <div><h2>{copy.footer.contact}</h2><a href={`mailto:${appConfig.contactEmail}`}>{appConfig.contactEmail}</a></div>
    </div>
    <div className="container site-footer__bottom">{copy.footer.rights}</div>
  </footer>;
}

export default function SitePage({ locale, page }: { locale: Locale; page: Page }) {
  const copy = messages[locale];
  return <div className={`site-page site-page--${page}`}>
    <SiteHeader locale={locale} page={page} />
    {page === "home" ? <HomePage locale={locale} /> : <main id="main" className="container standard-page" tabIndex={-1}>
      <h1>{copy[page].title}</h1>
      {copy[page].description && <p>{copy[page].description}</p>}
    </main>}
    <SiteFooter locale={locale} />
  </div>;
}

export function ServicePage({ locale, slug }: { locale: Locale; slug: ServiceSlug }) {
  const title = messages[locale].serviceLinks[serviceSlugs.indexOf(slug)];
  return <div className="site-page site-page--service">
    <SiteHeader locale={locale} page="service" serviceSlug={slug} />
    <main id="main" className="container standard-page" tabIndex={-1}><h1>{title}</h1></main>
    <SiteFooter locale={locale} />
  </div>;
}
