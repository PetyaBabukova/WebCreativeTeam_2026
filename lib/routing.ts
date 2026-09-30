import { appConfig } from "./config";

export const locales = ["bg", "en"] as const;
export type Locale = (typeof locales)[number];
export type Page = "home" | "about";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function pageUrl(page: Page, locale: Locale): string {
  return page === "home" ? `${appConfig.paths.root}${locale}` : `${appConfig.paths.about}/${locale}`;
}

export const canonicalRedirects = [
  { source: appConfig.paths.root, destination: pageUrl("home", "bg"), permanent: false },
  ...locales.map((locale) => ({
    source: `${pageUrl("home", locale)}${appConfig.paths.about}`, destination: pageUrl("about", locale), permanent: true,
  })),
];
