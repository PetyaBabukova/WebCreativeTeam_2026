import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import BgHome, { generateMetadata as bgHomeMetadata } from "@/app/(bg)/bg/page";
import EnHome, { generateMetadata as enHomeMetadata } from "@/app/(en)/en/page";
import BgAbout, { generateMetadata as bgAboutMetadata } from "@/app/(bg)/about/bg/page";
import EnAbout, { generateMetadata as enAboutMetadata } from "@/app/(en)/about/en/page";
import BgBlog, { generateMetadata as bgBlogMetadata } from "@/app/(bg)/blog/bg/page";
import EnBlog, { generateMetadata as enBlogMetadata } from "@/app/(en)/blog/en/page";
import BgFaq, { generateMetadata as bgFaqMetadata } from "@/app/(bg)/faq/bg/page";
import EnFaq, { generateMetadata as enFaqMetadata } from "@/app/(en)/faq/en/page";
import BgContacts, { generateMetadata as bgContactsMetadata } from "@/app/(bg)/contacts/bg/page";
import EnContacts, { generateMetadata as enContactsMetadata } from "@/app/(en)/contacts/en/page";
import BgService, { generateMetadata as bgServiceMetadata } from "@/app/(bg)/services/[slug]/bg/page";
import EnService, { generateMetadata as enServiceMetadata } from "@/app/(en)/services/[slug]/en/page";
import BgLayout from "@/app/(bg)/layout";
import EnLayout from "@/app/(en)/layout";
import GlobalNotFound from "@/app/global-not-found";
import NotFoundPage from "@/components/NotFoundPage";
import SiteNavigation from "@/components/SiteNavigation";
import { messages } from "@/lib/messages";
import { isLocale, canonicalRedirects, localeSwitchUrl, pageUrl, serviceSlugs, serviceUrl } from "@/lib/routing";
import { appConfig, localOrigin, siteOrigin } from "@/lib/config";

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");

beforeEach(() => {
  document.cookie = `${appConfig.localeCookie.name}=; Max-Age=0; Path=/`;
  window.location.hash = "";
});

afterEach(() => {
  document.cookie = `${appConfig.localeCookie.name}=; Max-Age=0; Path=/`;
  window.location.hash = "";
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
  if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
});

function navigationCopy() {
  return {
    menu: "Menu", navigation: "Navigation", language: "Language", home: "Home", services: "Services",
    servicesToggle: "Services submenu", serviceLinks: messages.en.serviceLinks, blog: "Blog", about: "About", faq: "FAQs", contact: "Contact",
  };
}

describe("public pages", () => {
  it.each([
    [BgHome, "Пауза на въртенето"],
    [EnHome, "Pause logo rotation"],
  ] as const)("toggles the localized orb pause control %#", (Page, label) => {
    render(<Page />);
    const control = screen.getByRole("button", { name: label });
    const tilt = document.querySelector<HTMLElement>(".hero-orb__tilt")!;
    const pointerSurface = document.querySelector<HTMLElement>(".hero-orb__entrance")!;
    const initialTransform = tilt.style.transform;
    fireEvent.pointerMove(pointerSurface, { pointerType: "mouse", clientX: 40, clientY: 40 });
    expect(tilt.style.transform).toBe(initialTransform);
    expect(control).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-pressed", "false");
  });
  it.each([[BgContacts, "bg"], [EnContacts, "en"]] as const)("routes footer and header links through the active locale %#", (Page, locale) => {
    render(<Page />);
    const copy = messages[locale];
    const footer = screen.getByRole("contentinfo");
    const navigation = within(footer).getByRole("navigation", { name: copy.landing.footer.navigation });
    const expected = [pageUrl("home", locale), ...serviceSlugs.map((slug) => serviceUrl(slug, locale)), pageUrl("blog", locale), pageUrl("faq", locale), pageUrl("about", locale), pageUrl("contacts", locale)];
    expect(within(navigation).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(expected);
    expect(within(document.querySelector(".site-header") as HTMLElement).getByRole("link", { name: copy.landing.hero.contact }).getAttribute("href")).toBe(pageUrl("contacts", locale));
    expect(within(footer).getAllByRole("link", { name: copy.landing.hero.contact })).toHaveLength(1);
    expect(within(footer).getByRole("link", { name: locale === "bg" ? "EN" : "BG" })).toHaveAttribute("href", pageUrl("contacts", locale === "bg" ? "en" : "bg"));
    expect(within(footer).getByRole("button", { name: copy.landing.footer.subscribe })).toBeDisabled();
    expect(within(footer).getByRole("textbox", { name: copy.landing.footer.email })).toBeEnabled();
    expect(within(footer).getByRole("checkbox", { name: `${copy.landing.footer.consentPrivacy} ${copy.landing.footer.privacyPolicy}` })).toBeEnabled();
    expect(within(footer).getByRole("textbox", { name: copy.landing.footer.email })).not.toHaveAttribute("name");
    expect(within(footer).getAllByRole("button", { name: /^(LinkedIn|Facebook|Instagram|YouTube|TikTok)$/ })).toHaveLength(5);
    expect(footer).not.toHaveTextContent(locale === "bg" ? "Профилите скоро ще бъдат достъпни." : "Our profiles will be available soon.");
    expect(footer).not.toHaveTextContent(locale === "bg" ? "Абонаментът все още не е достъпен." : "Newsletter signup is not available yet.");
  });
  it.each([
    [BgHome, bgHomeMetadata, "bg", "home", "/bg"],
    [EnHome, enHomeMetadata, "en", "home", "/en"],
    [BgAbout, bgAboutMetadata, "bg", "about", "/about/bg"],
    [EnAbout, enAboutMetadata, "en", "about", "/about/en"],
    [BgBlog, bgBlogMetadata, "bg", "blog", "/blog/bg"],
    [EnBlog, enBlogMetadata, "en", "blog", "/blog/en"],
    [BgFaq, bgFaqMetadata, "bg", "faq", "/faq/bg"],
    [EnFaq, enFaqMetadata, "en", "faq", "/faq/en"],
    [BgContacts, bgContactsMetadata, "bg", "contacts", "/contacts/bg"],
    [EnContacts, enContactsMetadata, "en", "contacts", "/contacts/en"],
  ] as const)("renders localized content and public metadata %#", async (Page, metadata, locale, page, url) => {
    render(<Page />);
    const homeSeo = locale === "bg" ? {
      heading: "Стратегия, технологии и креативност се срещат в решения, които отличават брандовете и превръщат идеите в резултати",
      title: "Дигитална агенция за успешен бизнес | WebCreativeTeam",
      description: "Съчетаваме AI, SEO, маркетинг, брандинг и уеб решения в цялостни дигитални услуги, създадени да подкрепят развитието на вашата компания.",
    } : {
      heading: "Strategy, technology and creativity come together in solutions that make brands stand out and turn ideas into results",
      title: "Digital Agency for Business Success | WebCreativeTeam",
      description: "We combine AI, SEO, marketing, branding and web solutions into comprehensive digital services designed to support your company’s growth.",
    };
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(page === "home" ? homeSeo.heading : messages[locale][page].title);
    const language = within(document.querySelector(".site-header") as HTMLElement).getByRole("navigation", { name: messages[locale].language, hidden: true });
    expect(within(language).getByRole("link", { name: locale.toUpperCase(), hidden: true })).toHaveAttribute("href", url);
    const alternate = locale === "bg" ? "en" : "bg";
    expect(within(language).getByRole("link", { name: alternate.toUpperCase(), hidden: true })).toHaveAttribute("href", url.replace(/(bg|en)$/, alternate));
    const result = await metadata();
    if (page === "home") {
      expect(result.title).toBe(homeSeo.title);
      expect(result.description).toBe(homeSeo.description);
    }
    expect(result.alternates?.canonical).toBe(url);
    expect(result.robots).toEqual({ index: false, follow: false });
    expect(result.alternates?.languages).toEqual({ bg: pageUrl(page, "bg"), en: pageUrl(page, "en") });
  });
  it.each([
    [BgService, bgServiceMetadata, "bg"],
    [EnService, enServiceMetadata, "en"],
  ] as const)("validates localized service routes %#", async (Page, metadata, locale) => {
    const params = { params: Promise.resolve({ slug: "branding" }) };
    render(await Page(params));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(messages[locale].serviceLinks[3]);
    expect((await metadata(params)).alternates?.canonical).toBe(serviceUrl("branding", locale));
    const invalid = { params: Promise.resolve({ slug: "unknown" }) };
    await expect(Page(invalid)).rejects.toThrow();
    await expect(metadata(invalid)).rejects.toThrow();
  });
  it.each([[BgLayout, "bg"], [EnLayout, "en"]] as const)("provides one complete locale document %#", (Layout, lang) => {
    const html = renderToStaticMarkup(<Layout><main id="main">Content</main></Layout>);
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain('href="#main"');
    expect(html.match(/<html/g)).toHaveLength(1);
  });
  it("renders a complete global 404 and translated fallback content", () => {
    expect(renderToStaticMarkup(<GlobalNotFound />)).toContain('<html lang="bg">');
    render(<NotFoundPage locale="en" />);
    expect(screen.getByRole("heading")).toHaveTextContent("Page not found");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en");
  });
  it("recognizes only supported languages and keeps only path canonical redirects in Next", () => {
    expect(isLocale("bg")).toBe(true); expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false); expect(isLocale("BG")).toBe(false);
    expect(canonicalRedirects).toEqual([
      { source: "/bg/about", destination: "/about/bg", permanent: true },
      { source: "/en/about", destination: "/about/en", permanent: true },
    ]);
  });
  it("builds equivalent language URLs for pages and services", () => {
    expect(localeSwitchUrl({ page: "blog" }, "en")).toBe(pageUrl("blog", "en"));
    expect(localeSwitchUrl({ page: "home" }, "bg", "#services")).toBe(`${pageUrl("home", "bg")}#services`);
    expect(localeSwitchUrl({ page: "service", serviceSlug: "branding" }, "en")).toBe(serviceUrl("branding", "en"));
    expect(localeSwitchUrl({ page: "service", serviceSlug: "branding" }, "bg", "#services")).toBe(serviceUrl("branding", "bg"));
    expect(localeSwitchUrl({ page: "contacts" }, "en")).toBe(pageUrl("contacts", "en"));
  });
  it("validates the configured origin rather than trusting request headers", async () => {
    expect(siteOrigin({}).origin).toBe(localOrigin(appConfig.localHost, appConfig.defaultPort));
    expect(siteOrigin({ PORT: "4123" }).origin).toBe(localOrigin(appConfig.localHost, 4123));
    expect(siteOrigin({ SITE_URL: "https://example.com" }).origin).toBe("https://example.com");
    for (const url of ["bad", "ftp://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?q=x", "https://example.com/#hash"]) {
      expect(() => siteOrigin({ SITE_URL: url })).toThrow();
    }
    vi.stubEnv("SITE_URL", "https://test.example");
    expect((await bgHomeMetadata()).metadataBase?.toString()).toBe("https://test.example/");
    vi.unstubAllEnvs();
  });
  it("keeps the active locale preference in sync with navigation and restored pages", () => {
    const copy = navigationCopy();
    expect(document.cookie).not.toContain(`${appConfig.localeCookie.name}=`);
    const view = render(<SiteNavigation locale="en" page="blog" copy={copy} />);
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=en`);
    view.rerender(<SiteNavigation locale="bg" page="blog" copy={copy} />);
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=bg`);
    document.cookie = `${appConfig.localeCookie.name}=en; Path=/`;
    fireEvent(window, new Event("pageshow"));
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=bg`);
    document.cookie = `${appConfig.localeCookie.name}=en; Path=/`;
    fireEvent(document, new Event("visibilitychange"));
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=bg`);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.cookie = `${appConfig.localeCookie.name}=en; Path=/`;
    fireEvent(document, new Event("visibilitychange"));
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=en`);
  });
  it("switches the locale of the current service without the retired contact anchor", () => {
    const copy = navigationCopy();
    window.location.hash = "#footer-contact";
    render(<SiteNavigation locale="en" page="service" serviceSlug="branding" copy={copy} />);
    const language = screen.getByRole("navigation", { name: "Language", hidden: true });
    expect(within(language).getByRole("link", { name: "BG", hidden: true })).toHaveAttribute("href", serviceUrl("branding", "bg"));
  });
  it("opens nested services on mobile and closes each menu layer with Escape", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
    const { container } = render(<SiteNavigation locale="bg" page="home" copy={navigationCopy()} />);
    const menu = container.querySelector<HTMLDetailsElement>(".site-menu")!;
    const services = container.querySelector<HTMLDetailsElement>(".site-menu__services details")!;
    menu.open = true;
    fireEvent(menu, new Event("toggle", { bubbles: true }));
    expect(services.open).toBe(true);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(services.open).toBe(false);
    expect(menu.open).toBe(true);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(menu.open).toBe(false);
    fireEvent.keyDown(menu, { key: "Escape" });
  });
  it("supports desktop hover and closes the open menu after navigation", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
    const { container } = render(<SiteNavigation locale="en" page="about" copy={navigationCopy()} />);
    const menu = container.querySelector<HTMLDetailsElement>(".site-menu")!;
    const services = container.querySelector<HTMLDetailsElement>(".site-menu__services details")!;
    const surface = container.querySelector<HTMLElement>(".site-menu__services")!;
    menu.open = true;
    fireEvent(menu, new Event("toggle", { bubbles: true }));
    expect(services.open).toBe(false);
    fireEvent.pointerEnter(surface, { pointerType: "touch" });
    expect(services.open).toBe(false);
    fireEvent.pointerEnter(surface, { pointerType: "mouse" });
    expect(services.open).toBe(true);
    fireEvent.pointerLeave(surface, { pointerType: "touch" });
    expect(services.open).toBe(true);
    fireEvent.pointerLeave(surface, { pointerType: "mouse" });
    expect(services.open).toBe(false);
    services.open = true;
    fireEvent.click(within(screen.getByRole("navigation", { name: "Navigation", hidden: true })).getByRole("link", { name: "Contact", hidden: true }));
    expect(services.open).toBe(false);
    expect(menu.open).toBe(false);
  });
  it("keeps only shared anchors while changing languages", () => {
    window.location.hash = "#services";
    render(<SiteNavigation locale="en" page="home" copy={navigationCopy()} />);
    const language = screen.getByRole("navigation", { name: "Language", hidden: true });
    expect(within(language).getByRole("link", { name: "BG", hidden: true })).toHaveAttribute("href", "/bg#services");
    window.location.hash = "#unrelated";
    fireEvent(window, new Event("hashchange"));
    expect(within(language).getByRole("link", { name: "BG", hidden: true })).toHaveAttribute("href", "/bg");
  });
  it("rejects mismatched service labels before rendering navigation", () => {
    expect(() => render(<SiteNavigation locale="en" page="home" copy={{ ...navigationCopy(), serviceLinks: [] }} />)).toThrow("Expected 5 service navigation labels");
  });
});
