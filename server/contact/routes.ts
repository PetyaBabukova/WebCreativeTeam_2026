import express, { Router, type ErrorRequestHandler } from "express";
import nodemailer from "nodemailer";
import { appConfig, isLocale, siteOrigin } from "../../lib/config.js";
import { clientIpBucket, normalizeEmail } from "../auth/security.js";

type ContactRequest = {
  locale: string;
  services: string[];
  name: string;
  email: string;
  phone: string;
  website: string;
  budget: string;
  message: string;
  newsletter: boolean;
  privacy: boolean;
};

const requests = new Map<string, { count: number; until: number }>();
const captchaAttempts = new Map<string, { count: number; until: number }>();
const globalCaptchaAttempts = new Map<string, { count: number; until: number }>();
const globalMailAttempts = new Map<string, { count: number; until: number }>();
let activeCaptchaChecks = 0;
const allowedServices = new Set<string>([...appConfig.contact.serviceSlugs, appConfig.contact.diagnosticSlug]);

function reserve(map: Map<string, { count: number; until: number }>, ip: string, now: number, limit: number): number | null {
  const previous = map.get(ip);
  const entry = previous && previous.until > now ? previous : undefined;
  if (previous && !entry) map.delete(ip);
  if (entry && entry.count >= limit) return null;
  const until = entry ? entry.until : now + appConfig.contact.rateWindowMilliseconds;
  if (!entry && map.size >= appConfig.contact.captchaBucketLimit) {
    let oldestKey: string | undefined;
    let oldestUntil = Infinity;
    for (const [key, value] of map) {
      if (value.until <= now) map.delete(key);
      else if (value.until < oldestUntil) { oldestKey = key; oldestUntil = value.until; }
    }
    if (map.size >= appConfig.contact.captchaBucketLimit && oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(ip, { count: entry ? entry.count + 1 : 1, until });
  return until;
}

function release(map: Map<string, { count: number; until: number }>, ip: string, until: number): void {
  const entry = map.get(ip);
  if (!entry || entry.until !== until) return;
  if (entry.count <= 1) map.delete(ip);
  else map.set(ip, { ...entry, count: entry.count - 1 });
}

function validText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max
    && !Array.from(value).some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 && code !== 9 && code !== 10 || code === 127;
    });
}

function safeStructuredText(value: string): boolean {
  return !/[\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value);
}

function validWebsite(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

function parseContact(value: unknown): ContactRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.locale !== "string" || !isLocale(data.locale)) return null;
  if (!Array.isArray(data.services) || data.services.length > allowedServices.size
    || data.services.some((service) => typeof service !== "string" || !allowedServices.has(service))
    || new Set(data.services).size !== data.services.length) return null;
  if (!validText(data.name, 2, appConfig.contact.nameMaxLength) || !safeStructuredText(data.name) || /[\r\n]/.test(data.name)) return null;
  if (!validText(data.email, 3, appConfig.contact.emailMaxLength)) return null;
  let email: string;
  try { email = normalizeEmail(data.email); } catch { return null; }
  if (!validText(data.phone, 0, appConfig.contact.phoneMaxLength) || data.phone && (!data.phone.trim() || !/^[+0-9() .-]{5,30}$/.test(data.phone))) return null;
  if (!validText(data.website, 0, appConfig.contact.websiteMaxLength) || !safeStructuredText(data.website) || !validWebsite(data.website)) return null;
  if (!validText(data.budget, 0, appConfig.contact.budgetMaxLength) || !safeStructuredText(data.budget) || /[\r\n]/.test(data.budget)) return null;
  const message = typeof data.message === "string" ? data.message.replace(/\r\n/g, "\n") : data.message;
  if (!validText(message, 10, appConfig.contact.messageMaxLength)) return null;
  if (typeof data.newsletter !== "boolean" || data.privacy !== true) return null;
  return { ...data, email, message } as ContactRequest;
}

function mailConfig() {
  const host = process.env.AUTH_SMTP_HOST;
  const port = Number(process.env.AUTH_SMTP_PORT);
  const user = process.env.AUTH_SMTP_USER;
  const pass = process.env.AUTH_SMTP_PASSWORD;
  const from = process.env.AUTH_SMTP_FROM;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from) return null;
  return { host, port, secure: port === 465, auth: { user, pass }, from, connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 30_000 };
}

function captchaConfig() {
  const siteKey = process.env.CAPTCHA_SITE_KEY;
  const secret = process.env.CAPTCHA_SECRET_SITE_KEY;
  return siteKey && secret ? { siteKey, secret } : null;
}

async function verifyCaptcha(token: string, secret: string, hostname: string): Promise<"valid" | "invalid" | "unavailable"> {
  try {
    const response = await fetch(appConfig.contact.captchaVerifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(appConfig.contact.captchaVerifyTimeoutMilliseconds),
    });
    if (!response.ok) return "unavailable";
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) return "unavailable";
    const answer = result as Record<string, unknown>;
    if (answer.success !== true && answer.success !== false) return "unavailable";
    if (answer.success === false) return "invalid";
    if (answer["error-codes"] !== undefined && (!Array.isArray(answer["error-codes"]) || answer["error-codes"].length)) return "unavailable";
    return answer.hostname === hostname ? "valid" : "invalid";
  } catch { return "unavailable"; }
}

export const contactRouter = Router();
contactRouter.use(express.json({ limit: "16kb", strict: true }));
contactRouter.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const config = captchaConfig();
  if (!config) { res.status(503).json({ error: "Service unavailable" }); return; }
  res.status(200).json({ siteKey: config.siteKey });
});
contactRouter.post("/", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!req.is("application/json")) { res.status(415).json({ error: "Unsupported content type" }); return; }
  let site: URL;
  try { site = siteOrigin(); } catch { res.status(503).json({ error: "Service unavailable" }); return; }
  if (req.get("origin") !== site.origin || req.get("sec-fetch-site") && !["same-origin", "none"].includes(req.get("sec-fetch-site")!)) {
    res.status(403).json({ error: "Invalid origin" }); return;
  }
  const data = parseContact(req.body);
  if (!data) { res.status(400).json({ error: "Invalid form data" }); return; }
  const token: unknown = req.body.captchaToken;
  if (typeof token !== "string" || !token || token.length > appConfig.contact.captchaTokenMaxLength || /\s/.test(token)) {
    res.status(400).json({ error: "captcha" }); return;
  }
  const config = mailConfig();
  if (!config) { res.status(503).json({ error: "Mail unavailable" }); return; }
  const captcha = captchaConfig();
  if (!captcha) { res.status(503).json({ error: "Service unavailable" }); return; }
  const now = Date.now();
  const ip = clientIpBucket(req.ip);
  const reservation = reserve(requests, ip, now, appConfig.contact.rateLimit);
  if (reservation === null) {
    console.warn("Contact request rate limited: address");
    res.status(429).json({ error: "Too many requests" }); return;
  }
  const captchaReservation = reserve(captchaAttempts, ip, now, appConfig.contact.captchaAttemptLimit);
  if (captchaReservation === null) {
    release(requests, ip, reservation);
    console.warn("Contact request rate limited: captcha address");
    res.status(429).json({ error: "Too many requests" }); return;
  }
  if (activeCaptchaChecks >= appConfig.contact.captchaConcurrentLimit
    || reserve(globalCaptchaAttempts, "global", now, appConfig.contact.captchaGlobalAttemptLimit) === null) {
    release(requests, ip, reservation);
    release(captchaAttempts, ip, captchaReservation);
    console.warn("Contact request rate limited: captcha global");
    res.status(429).json({ error: "Too many requests" }); return;
  }
  activeCaptchaChecks += 1;
  let verification: "valid" | "invalid" | "unavailable";
  try { verification = await verifyCaptcha(token, captcha.secret, site.hostname); }
  finally { activeCaptchaChecks -= 1; }
  if (verification !== "valid") {
    release(requests, ip, reservation);
    if (verification === "unavailable") console.error("Contact CAPTCHA unavailable");
    res.status(verification === "invalid" ? 400 : 503).json({ error: verification === "invalid" ? "captcha" : "Service unavailable" });
    return;
  }
  if (reserve(globalMailAttempts, "global", now, appConfig.contact.contactGlobalSendLimit) === null) {
    release(requests, ip, reservation);
    console.warn("Contact request rate limited: mail global");
    res.status(429).json({ error: "Too many requests" }); return;
  }
  const transport = nodemailer.createTransport(config);
  try {
    const result = await transport.sendMail({
      from: config.from,
      to: appConfig.contactEmail,
      replyTo: { name: data.name.trim(), address: data.email.trim() },
      subject: data.locale === "bg" ? "Ново запитване от контактната форма" : "New contact form enquiry",
      text: [
        `Name: ${data.name.trim()}`,
        `Email: ${data.email.trim()}`,
        `Phone: ${data.phone.trim() || "—"}`,
        `Website: ${data.website.trim() || "—"}`,
        `Budget: ${data.budget.trim() || "—"}`,
        `Services: ${data.services.join(", ") || "—"}`,
        `Newsletter interest: ${data.newsletter ? "yes" : "no"}`,
        "",
        data.message.trim(),
      ].join("\n"),
    });
    if (!result.accepted?.some((address) => typeof address === "string" && address.toLowerCase() === appConfig.contactEmail)) {
      console.error("Contact mail rejected");
      res.status(502).json({ error: "Mail rejected" }); return;
    }
    res.status(200).json({ ok: true });
  } catch {
    console.error("Contact mail unavailable");
    res.status(503).json({ error: "Mail unavailable" });
  } finally {
    transport.close();
  }
});

const jsonError: ErrorRequestHandler = (error, _req, res, next) => {
  if (!(error instanceof SyntaxError) && error.type !== "entity.too.large") { next(error); return; }
  res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid form data" });
};
contactRouter.use(jsonError);
