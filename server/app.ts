import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { appConfig } from "../lib/config.js";

export function createApp(nextHandler: RequestHandler, isReady: () => boolean) {
  const app = express();
  app.disable("x-powered-by");
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
