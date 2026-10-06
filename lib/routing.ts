import { appConfig } from "./config";

export const locales = ["bg", "en"] as const;
export type Locale = (typeof locales)[number];
export type Page = "home" | "about" | "blog";
export const serviceSlugs = ["ai-automation", "seo-geo", "digital-marketing", "branding", "web-solutions"] as const;
export type ServiceSlug = (typeof serviceSlugs)[number];

export function isServiceSlug(value: string): value is ServiceSlug {
  return (serviceSlugs as readonly string[]).includes(value);
}

export function serviceUrl(slug: ServiceSlug, locale: Locale): string {
  return `${appConfig.paths.services}/${slug}/${locale}`;
}

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function pageUrl(page: Page, locale: Locale): string {
  return page === "home" ? `${appConfig.paths.root}${locale}` : `${appConfig.paths[page]}/${locale}`;
}

export function sectionUrl(section: string, locale: Locale, page: Page | "service"): string {
  return `${page === "home" ? "" : pageUrl("home", locale)}#${section}`;
}

export const canonicalRedirects = [
  { source: appConfig.paths.root, destination: pageUrl("home", "bg"), permanent: false },
  ...locales.map((locale) => ({
    source: `${pageUrl("home", locale)}${appConfig.paths.about}`, destination: pageUrl("about", locale), permanent: true,
  })),
];
