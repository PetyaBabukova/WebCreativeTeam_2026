import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { appConfig, isLocale, localizedPath, siteOrigin, type Locale } from "../lib/config.js";
import { authRouter } from "./auth/routes.js";
import { authTrustedProxies } from "./auth/config.js";
import { contactRouter } from "./contact/routes.js";

const localeRedirectPaths: ReadonlyArray<string> = [appConfig.paths.root, appConfig.paths.faq, appConfig.paths.contacts];

function preferredLocale(cookieHeader: string | undefined): Locale {
  const entry = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${appConfig.localeCookie.name}=`));
  const value = entry?.slice(appConfig.localeCookie.name.length + 1);
  return value && isLocale(value) ? value : "bg";
}

class CspConfigurationError extends Error {
  code = "CSP_CONFIG";
  constructor() { super("Invalid CSP configuration"); }
}

function cspConfiguration(): { mode: "enforce" | "report-only" | "staging-observe"; productionHttps: boolean } {
  const override = process.env.AUTH_CSP_ENFORCE;
  if (override !== undefined && override !== "" && override !== "0" && override !== "1") throw new CspConfigurationError();
  let origin: URL | undefined;
  try { origin = siteOrigin({ SITE_URL: process.env.SITE_URL, PORT: process.env.PORT }); } catch { /* Auth configuration validates its own origin. */ }
  const production = process.env.NODE_ENV === "production";
  const productionHttps = production && origin?.protocol === "https:";
  if (override === "0" && production) {
    if (!productionHttps || process.env.AUTH_DEPLOYMENT_STAGE !== "staging" || !process.env.AUTH_CSP_STAGING_ORIGIN) throw new CspConfigurationError();
    try {
      if (siteOrigin({ SITE_URL: process.env.AUTH_CSP_STAGING_ORIGIN }).origin !== origin?.origin) throw new CspConfigurationError();
    } catch { throw new CspConfigurationError(); }
    return { mode: "staging-observe", productionHttps };
  }
  return { mode: override === "1" || production ? "enforce" : "report-only", productionHttps };
}

export function createApp(nextHandler: RequestHandler, isReady: () => boolean) {
  const app = express();
  app.disable("x-powered-by");
  const { mode: policyMode, productionHttps } = cspConfiguration();
  if (policyMode === "staging-observe") console.warn("CSP report-only observation is active on staging");
  const trusted = authTrustedProxies();
  if (typeof trusted === "number" || trusted.length) app.set("trust proxy", trusted);
  app.use((req, res, next) => {
    const nonce = randomBytes(16).toString("base64");
    const policy = [
      "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${appConfig.contact.captchaCspScriptSources.join(" ")}`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
      `connect-src 'self' ${appConfig.contact.captchaCspConnectSources.join(" ")}`, `frame-src ${appConfig.contact.captchaCspFrameSources.join(" ")}`,
      "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join("; ");
    req.headers["content-security-policy"] = policy;
    req.headers["x-nonce"] = nonce;
    res.set("X-Frame-Options", "DENY");
    res.set("X-Content-Type-Options", "nosniff");
    if (policyMode === "staging-observe") {
      res.set("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
      res.set("Content-Security-Policy-Report-Only", policy);
    } else {
      res.set(policyMode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", policy);
    }
    if (productionHttps) res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") { next(); return; }
    const redirect = localeRedirectPaths.find((path) => req.path === path);
    if (!redirect) { next(); return; }
    const queryIndex = req.originalUrl.indexOf("?");
    const search = queryIndex < 0 ? "" : req.originalUrl.slice(queryIndex);
    res.set("Cache-Control", "private, no-store").redirect(307, `${localizedPath(redirect, preferredLocale(req.get("cookie")))}${search}`);
  });
  app.get(appConfig.paths.health, (_req, res) => {
    const ready = isReady();
    res.set("Cache-Control", "no-store").status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable" });
  });
  app.use(appConfig.paths.authApi, authRouter);
  app.use(appConfig.paths.contactApi, contactRouter);
  app.use(appConfig.paths.admin, (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });
  // Express owns /api; register future API routes before this JSON fallback.
  app.use(appConfig.paths.api, (_req, res) => { res.status(404).json({ error: "Not found" }); });
  app.use(nextHandler);
  const errors: ErrorRequestHandler = (_error, _req, res, next) => {
    if (res.headersSent) { next(_error); return; }
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(errors);
  return app;
}
