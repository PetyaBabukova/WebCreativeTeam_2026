export const locales = ["bg", "en"] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export const appConfig = {
  defaultPort: 3000,
  contactEmail: "office@webcreativeteam.com",
  brandLogoPath: "/logo_2026_DARK_HORIZONTAL.svg",
  socialProfiles: {
    linkedin: "https://www.linkedin.com/company/webcreativeteam",
    facebook: "https://www.facebook.com/webcreativeteam",
    instagram: null,
    youtube: "https://www.youtube.com/@WebCreativeTeam",
    tiktok: null,
  },
  listenHost: "0.0.0.0",
  localHost: "localhost",
  testHost: "127.0.0.1",
  testPort: 3100,
  localeCookie: {
    name: "wct_locale",
    maxAgeSeconds: 2592000,
    path: "/",
    sameSite: "Lax",
  },
  paths: {
    root: "/",
    about: "/about",
    blog: "/blog",
    faq: "/faq",
    contacts: "/contacts",
    services: "/services",
    health: "/healthz",
    api: "/api",
  },
} as const;

export function localizedPath(path: string, locale: Locale): string {
  return path === appConfig.paths.root ? `${path}${locale}` : `${path}/${locale}`;
}

export function localOrigin(host: string, port: number | string): string {
  return `http://${host}:${port}`;
}

export const testOrigin = localOrigin(appConfig.testHost, appConfig.testPort);

export function siteOrigin(env: { SITE_URL?: string; PORT?: string } = { SITE_URL: process.env.SITE_URL, PORT: process.env.PORT }): URL {
  const url = new URL(env.SITE_URL ?? localOrigin(appConfig.localHost, env.PORT ?? appConfig.defaultPort));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== appConfig.paths.root || url.search || url.hash) {
    throw new Error("SITE_URL must be an HTTP(S) origin without credentials, path, query or hash");
  }
  return url;
}
