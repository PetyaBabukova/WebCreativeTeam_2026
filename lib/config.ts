export const appConfig = {
  defaultPort: 3000,
  contactEmail: "office@webcreativeteam.com",
  brandLogoPath: "/logo_2026_DARK_HORIZONTAL.svg",
  listenHost: "0.0.0.0",
  localHost: "localhost",
  testHost: "127.0.0.1",
  testPort: 3100,
  paths: {
    root: "/",
    about: "/about",
    blog: "/blog",
    faq: "/faq",
    services: "/services",
    health: "/healthz",
    api: "/api",
  },
} as const;

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
