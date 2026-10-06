import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { appConfig, isLocale, localizedPath, type Locale } from "../lib/config.js";

const localeRedirectPaths: ReadonlyArray<string> = [appConfig.paths.root, appConfig.paths.faq, appConfig.paths.contacts];

function preferredLocale(cookieHeader: string | undefined): Locale {
  const entry = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${appConfig.localeCookie.name}=`));
  const value = entry?.slice(appConfig.localeCookie.name.length + 1);
  return value && isLocale(value) ? value : "bg";
}

export function createApp(nextHandler: RequestHandler, isReady: () => boolean) {
  const app = express();
  app.disable("x-powered-by");
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
