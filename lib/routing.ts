import { appConfig, localizedPath, locales, type Locale } from "./config";

export { isLocale, locales } from "./config";
export type { Locale } from "./config";
export type Page = "home" | "about" | "blog" | "faq" | "contacts";
export const serviceSlugs = ["ai-automation", "seo-geo", "digital-marketing", "branding", "web-solutions"] as const;
export type ServiceSlug = (typeof serviceSlugs)[number];
export type SiteRoute = { page: Page; serviceSlug?: never } | { page: "service"; serviceSlug: ServiceSlug };

export function isServiceSlug(value: string): value is ServiceSlug {
  return (serviceSlugs as readonly string[]).includes(value);
}

export function serviceUrl(slug: ServiceSlug, locale: Locale): string {
  return `${appConfig.paths.services}/${slug}/${locale}`;
}

const aiAutomationSectionIds = ["business-processes", "ai-assistants", "ai-integrations"] as const;

export function aiAutomationSectionId(index: number): string {
  const id = aiAutomationSectionIds[index];
  if (!id) throw new Error(`Missing AI automation section ID at index ${index}`);
  return id;
}

export function pageUrl(page: Page, locale: Locale): string {
  return localizedPath(page === "home" ? appConfig.paths.root : appConfig.paths[page], locale);
}

export function sectionUrl(section: string, locale: Locale, page: Page | "service"): string {
  return `${page === "home" ? "" : pageUrl("home", locale)}#${section}`;
}

export function localeSwitchUrl(route: SiteRoute, locale: Locale, hash = ""): string {
  if (route.page === "service") {
    return serviceUrl(route.serviceSlug, locale);
  }
  return `${pageUrl(route.page, locale)}${hash}`;
}

export const canonicalRedirects = [
  ...locales.map((locale) => ({
    source: `${pageUrl("home", locale)}${appConfig.paths.about}`, destination: pageUrl("about", locale), permanent: true,
  })),
];
