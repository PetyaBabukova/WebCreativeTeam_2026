import express, { Router, type ErrorRequestHandler } from "express";
import { appConfig, isLocale, siteOrigin } from "../../lib/config.js";
import { clientIpBucket } from "../auth/security.js";
import { captchaConfig, verifyCaptcha } from "../contact/captcha.js";
import { decideSubscription, normalizeNewsletterEmail, requestSubscription, reserveNewsletterDecisionIp, reserveNewsletterIp, resendConfirmation } from "./service.js";

export const newsletterRouter = Router();
newsletterRouter.use(express.json({ limit: appConfig.newsletter.requestBodyLimit, strict: true }));
newsletterRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  if (!req.is("application/json")) { res.status(415).json({ error: "Unsupported content type" }); return; }
  let origin: URL;
  try { origin = siteOrigin(); } catch { res.status(503).json({ error: "Service unavailable" }); return; }
  if (req.get("origin") !== origin.origin || req.get("sec-fetch-site") && !["same-origin", "none"].includes(req.get("sec-fetch-site")!)) {
    res.status(403).json({ error: "Invalid origin" }); return;
  }
  next();
});

newsletterRouter.post("/:operation", async (req, res) => {
  const operation = req.params.operation;
  const body: unknown = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) { res.status(400).json({ error: "Invalid form data" }); return; }
  const data = body as Record<string, unknown>;
  if (operation === "decision") {
    if ((data.action !== "confirm" && data.action !== "decline") || typeof data.token !== "string" || data.token.length > appConfig.newsletter.tokenMaxLength) {
      res.status(400).json({ error: "Invalid decision" }); return;
    }
    if (!reserveNewsletterDecisionIp(clientIpBucket(req.ip))) { res.status(429).json({ error: "Too many requests" }); return; }
    const result = await decideSubscription(data.action, data.token);
    res.status(result === "unavailable" ? 503 : result === "invalid" ? 400 : 200).json({ result });
    return;
  }
  if (operation !== "request" && operation !== "resend") { res.status(404).json({ error: "Not found" }); return; }
  if (typeof data.email !== "string" || typeof data.locale !== "string" || !isLocale(data.locale)) {
    res.status(400).json({ error: "Invalid form data" }); return;
  }
  let email: string;
  try { email = normalizeNewsletterEmail(data.email); } catch { res.status(400).json({ error: "Invalid form data" }); return; }
  if (operation === "request" && (data.consentNews !== true || data.consentPrivacy !== true)) {
    res.status(400).json({ error: "Consent required" }); return;
  }
  const token = data.captchaToken;
  if (typeof token !== "string" || !token || token.length > appConfig.contact.captchaTokenMaxLength || /\s/.test(token)) {
    res.status(400).json({ error: "captcha" }); return;
  }
  const reservation = await reserveNewsletterIp(clientIpBucket(req.ip));
  if (reservation !== "allowed") {
    res.status(reservation === "limited" ? 429 : 503).json({ error: reservation === "limited" ? "Too many requests" : "Service unavailable" }); return;
  }
  const captcha = captchaConfig();
  if (!captcha) { res.status(503).json({ error: "Service unavailable" }); return; }
  let hostname: string;
  try { hostname = siteOrigin().hostname; } catch { res.status(503).json({ error: "Service unavailable" }); return; }
  const verified = await verifyCaptcha(token, captcha.secret, hostname);
  if (verified !== "valid") {
    res.status(verified === "invalid" ? 400 : 503).json({ error: verified === "invalid" ? "captcha" : "Service unavailable" }); return;
  }
  const result = operation === "request" ? await requestSubscription(email, data.locale, "footer") : await resendConfirmation(email);
  res.status(result === "limited" ? 429 : result === "unavailable" ? 503 : 202).json({ result: result === "accepted" ? "check-email" : result });
});

const jsonError: ErrorRequestHandler = (error, _req, res, next) => {
  if (!(error instanceof SyntaxError) && error.type !== "entity.too.large") { next(error); return; }
  res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid form data" });
};
newsletterRouter.use(jsonError);
