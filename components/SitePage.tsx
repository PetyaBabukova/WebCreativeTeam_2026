import Image from "next/image";
import Link from "next/link";
import heroBackgroundDesktop from "@/2026_Redesign/Assets/Hero_Background_Desktop_3840x2160.webp";
import heroBackgroundMobile from "@/2026_Redesign/Assets/Hero_Background_Mobile_1440x2560.webp";
import { appConfig } from "@/lib/config";
import { messages } from "@/lib/messages";
import { locales, pageUrl, type Locale, type Page } from "@/lib/routing";
import HeroMotion from "./HeroOrb";
import "./SitePage.css";

function SiteHeader({ locale, page }: { locale: Locale; page: Page }) {
  const copy = messages[locale];
  return <header className="site-header">
    <div className="container site-header__inner">
      <Link href={pageUrl("home", locale)} className="site-header__brand">
        <Image src={appConfig.brandLogoPath} alt="WebCreativeTeam" width={280} height={77} priority unoptimized />
      </Link>
      <div className="site-header__actions">
        <a className="button site-header__cta" href="#footer-contact">{copy.landing.hero.contact}</a>
        <details className="site-menu">
          <summary aria-label={copy.landing.menu}><span aria-hidden="true" className="site-menu__bars"><span /><span /></span></summary>
          <div className="site-menu__panel">
            <nav aria-label={copy.navigation}>
              <Link href={pageUrl("home", locale)} aria-current={page === "home" ? "page" : undefined}>{copy.homeLabel}</Link>
              <Link href={pageUrl("about", locale)} aria-current={page === "about" ? "page" : undefined}>{copy.aboutLabel}</Link>
            </nav>
            <nav aria-label={copy.language} className="site-menu__languages">
              {locales.map((language) => <Link key={language} href={pageUrl(page, language)} hrefLang={language} lang={language} aria-current={language === locale ? "page" : undefined}>{language.toUpperCase()}</Link>)}
            </nav>
          </div>
        </details>
      </div>
    </div>
  </header>;
}

function HomePage({ locale }: { locale: Locale }) {
  const copy = messages[locale].landing;
  return <main id="main" className="site-home" tabIndex={-1}>
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__stage" aria-hidden="true">
        <picture className="hero__art">
          <source media="(max-width: 760px)" srcSet={heroBackgroundMobile.src} type="image/webp" />
          <img src={heroBackgroundDesktop.src} alt="" fetchPriority="high" className="hero__background" />
        </picture>
        <div className="hero__shade" />
      </div>
      <div className="container hero__inner">
        <HeroMotion
          lines={copy.hero.lines}
          description={copy.hero.description}
          rotationPauseLabel={copy.hero.rotationPause}
        />
      </div>
    </section>
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
    {page === "home" ? <HomePage locale={locale} /> : <main id="main" className="container standard-page" tabIndex={-1}><h1>{copy.about.title}</h1><p>{copy.about.description}</p></main>}
    <SiteFooter locale={locale} />
  </div>;
}
