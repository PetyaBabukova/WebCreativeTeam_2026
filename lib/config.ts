export const locales = ["bg", "en"] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

const privacyPhone = "0887454509";

export const appConfig = {
  defaultPort: 3000,
  contactEmail: "info@webcreativeteam.com",
  legalName: "Уеб Криейтив Тиим ЕООД",
  contactPhones: ["0889912671", privacyPhone],
  privacyPhone,
  contactPhoneCountryCode: "+359",
  privacyAuthorityUrl: "https://cpdp.bg/",
  contact: {
    serviceSlugs: ["ai-automation", "seo-geo", "digital-marketing", "branding", "web-solutions"],
    diagnosticSlug: "free-diagnostic",
    messageMaxLength: 2000,
    nameMaxLength: 100,
    emailMaxLength: 254,
    phoneMaxLength: 30,
    websiteMaxLength: 2048,
    budgetMaxLength: 100,
    rateLimit: 5,
    rateWindowMilliseconds: 15 * 60 * 1000,
    captchaTokenMaxLength: 4096,
    captchaAttemptLimit: 10,
    captchaBucketLimit: 10000,
    captchaGlobalAttemptLimit: 120,
    captchaConcurrentLimit: 20,
    contactGlobalSendLimit: 30,
    captchaVerifyTimeoutMilliseconds: 5000,
    captchaScriptTimeoutMilliseconds: 12000,
    requestTimeoutMilliseconds: 30000,
    notificationLoadingDelayMilliseconds: 250,
    notificationDurationMilliseconds: 12000,
    captchaScriptUrl: "https://www.google.com/recaptcha/api.js",
    captchaVerifyUrl: "https://www.google.com/recaptcha/api/siteverify",
    captchaCspScriptSources: ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
    captchaCspFrameSources: ["'self'", "https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"],
    captchaCspConnectSources: ["https://www.google.com/recaptcha/"],
  },
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
  cookieChoice: {
    name: "wct_cookie_choice",
    version: "v1",
    maxAgeSeconds: 15552000,
    path: "/",
    sameSite: "Lax",
    eventName: "wct-cookie-choice-change",
  },
  paths: {
    root: "/",
    about: "/about",
    blog: "/blog",
    legacyArticles: "/articles",
    faq: "/faq",
    portfolio: "/portfolio",
    contacts: "/contacts",
    privacy: "/privacy",
    cookies: "/cookies",
    services: "/services",
    offers: "/servicess/offers",
    health: "/healthz",
    api: "/api",
    admin: "/admin",
    authApi: "/api/auth",
    contactApi: "/api/contact",
    newsletterApi: "/api/newsletter",
    blogApi: "/api/blog",
    newsletterConfirm: "/newsletter/confirm",
    newsletterDecline: "/newsletter/decline",
  },
  auth: {
    cookieName: "__Host-wct_admin",
    developmentCookieName: "wct_admin_dev",
    idleSeconds: 12 * 60 * 60,
    absoluteSeconds: 2 * 24 * 60 * 60,
    activityWriteSeconds: 5 * 60,
    statusRetryMilliseconds: 10 * 1000,
    statusRetryMaxMilliseconds: 2 * 60 * 1000,
    reauthSeconds: 5 * 60,
    invitationStatusPollMilliseconds: 30 * 1000,
    invitationStatusPollMaxMilliseconds: 2 * 60 * 1000,
    invitationStatusUnknownSeconds: 60 * 60,
    invitationSeconds: 48 * 60 * 60,
    resetSeconds: 30 * 60,
    tokenBytes: 32,
    auditRetentionSeconds: 90 * 24 * 60 * 60,
    outboxRetentionSeconds: 48 * 60 * 60,
    outboxLeaseSeconds: 5 * 60,
    outboxPollMilliseconds: 1000,
    passwordMinLength: 15,
    passwordMaxLength: 1024,
    loginLimit: 8,
    sensitiveLimit: 5,
    limitWindowSeconds: 15 * 60,
  },
  newsletter: {
    collection: "newsletters",
    legacyCollections: ["newsletterSubscriptions", "newsletterPendingSubscriptions", "newsletterOutbox", "newsletterRateLimits"],
    legacyDatabasePrefix: "wct_2026_",
    pendingMilliseconds: 30 * 24 * 60 * 60 * 1000,
    unsubscribedYears: 3,
    outboxMilliseconds: 48 * 60 * 60 * 1000,
    resendWaitMilliseconds: 24 * 60 * 60 * 1000,
    statusNoticeWaitMilliseconds: 30 * 24 * 60 * 60 * 1000,
    newsletterDatabaseOperationTimeoutMilliseconds: 5000,
    workerPollMilliseconds: 1000,
    contactWaitMilliseconds: 1500,
    contactIpWaitMilliseconds: 8000,
    requestBodyLimit: "8kb",
    ipWindowMilliseconds: 15 * 60 * 1000,
    ipWindowLimit: 5,
    ipDailyLimit: 10,
    globalHourlyLimit: 20,
    globalDailyLimit: 50,
    localMinuteLimit: 10,
    decisionMinuteLimit: 30,
    decisionGlobalMinuteLimit: 100,
    localBucketLimit: 10_000,
    localGlobalMinuteLimit: 100,
    tokenMaxLength: 256,
  },
  blog: {
    collection: "articles",
    pageSize: 9,
    bucketEnv: "BLOG_GCS_BUCKET",
    imageOrigin: "https://storage.googleapis.com",
    imagePrefix: "blog",
    legacyImagePrefix: "https://filedn.com/lL84jfUjkOJ5JauGvrOlJsV/webcreativeteam/blogimages/",
    maxFileBytes: 8 * 1024 * 1024,
    maxTotalBytes: 20 * 1024 * 1024,
    maxPixels: 24_000_000,
    maxImages: 20,
    maxHtmlBytes: 200 * 1024,
    maxWords: 2000,
  },
} as const;

export type CookieChoice = "all" | "rejected" | "necessary";

export function cookieValue(header: string | undefined, name: string): string | null {
  const entry = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : null;
}

export function parseCookieChoice(header: string | undefined): CookieChoice | null {
  const value = cookieValue(header, appConfig.cookieChoice.name);
  const prefix = `${appConfig.cookieChoice.version}.`;
  if (!value?.startsWith(prefix)) return null;
  const choice = value.slice(prefix.length);
  return choice === "all" || choice === "rejected" || choice === "necessary" ? choice : null;
}

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
