import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { appConfig, isLocale, localizedPath, type Locale } from "../lib/config.js";
import { authRouter } from "./auth/routes.js";
import { authTrustedProxies } from "./auth/config.js";

const localeRedirectPaths: ReadonlyArray<string> = [appConfig.paths.root, appConfig.paths.faq, appConfig.paths.contacts];

function preferredLocale(cookieHeader: string | undefined): Locale {
  const entry = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${appConfig.localeCookie.name}=`));
  const value = entry?.slice(appConfig.localeCookie.name.length + 1);
  return value && isLocale(value) ? value : "bg";
}

export function createApp(nextHandler: RequestHandler, isReady: () => boolean) {
  const app = express();
  app.disable("x-powered-by");
  const trusted = authTrustedProxies();
  if (typeof trusted === "number" || trusted.length) app.set("trust proxy", trusted);
  app.use((req, res, next) => {
    const nonce = randomBytes(16).toString("base64");
    const policy = [
      "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
      "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join("; ");
    req.headers["content-security-policy"] = policy;
    req.headers["x-nonce"] = nonce;
    const enforceCsp = process.env.AUTH_CSP_ENFORCE === "1" || process.env.NODE_ENV === "production" && process.env.SITE_URL?.startsWith("https://");
    res.set(enforceCsp ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", policy);
    if (process.env.NODE_ENV === "production" && process.env.SITE_URL?.startsWith("https://")) res.set("Strict-Transport-Security", "max-age=31536000");
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
  app.use(appConfig.paths.admin, (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Frame-Options", "DENY");
    res.set("X-Content-Type-Options", "nosniff");
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
