import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import nodemailer from "nodemailer";
import { createApp } from "../../server/app.js";
import { appConfig } from "../../lib/config.js";
import * as newsletterService from "../../server/newsletter/service.js";

describe("Express HTTP boundaries", () => {
  it("rejects blog writes and admin reads before parsing uploads or touching content", async () => {
    const app = createApp((_req, res) => { res.send("next"); }, () => true);
    await request(app).get(`${appConfig.paths.blogApi}/admin`).expect(401);
    await request(app).get(`${appConfig.paths.blogApi}/admin/507f1f77bcf86cd799439011`).expect(401);
    await request(app).post(`${appConfig.paths.blogApi}/admin`).set("Content-Type", "multipart/form-data").expect(401);
    await request(app).put(`${appConfig.paths.blogApi}/admin/507f1f77bcf86cd799439011`).set("Content-Type", "multipart/form-data").expect(401);
    await request(app).delete(`${appConfig.paths.blogApi}/admin/507f1f77bcf86cd799439011`).send({ version: 1 }).expect(401);
  });
  it.each([
    [undefined, "/bg", "/faq/bg", "/contacts/bg"],
    ["wct_locale=en", "/en", "/faq/en", "/contacts/en"],
    ["other=value; wct_locale=bg", "/bg", "/faq/bg", "/contacts/bg"],
    ["xwct_locale=en; wct_locale=bg", "/bg", "/faq/bg", "/contacts/bg"],
    ["wct_locale=fr", "/bg", "/faq/bg", "/contacts/bg"],
  ])("redirects bare pages using the validated locale cookie %s", async (cookie, home, faq, contacts) => {
    const app = createApp((_req, res) => { res.send("next"); }, () => true);
    for (const [path, destination] of [["/", home], ["/faq?from=email", `${faq}?from=email`], ["/contacts?from=cta", `${contacts}?from=cta`]]) {
      const response = await request(app).get(path).set(cookie ? { Cookie: `${appConfig.cookieChoice.name}=${appConfig.cookieChoice.version}.all; ${cookie}` } : {}).expect(307);
      expect(response.headers.location).toBe(destination);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });
  it("only handles exact GET and HEAD aliases and leaves other requests to Next", async () => {
    const app = createApp((req, res) => { res.status(404).send(`next:${req.method}:${req.path}`); }, () => true);
    const accepted = `${appConfig.cookieChoice.name}=${appConfig.cookieChoice.version}.all; wct_locale=en`;
    await request(app).head("/faq").set("Cookie", accepted).expect(307).expect("Location", "/faq/en");
    await request(app).head("/contacts").set("Cookie", accepted).expect(307).expect("Location", "/contacts/en");
    for (const path of ["/FAQ", "/faq/", "/contacts/", "/CONTACTS", "/about", "/services/bad/en", "/_next/asset.js"]) {
      await request(app).get(path).expect(404, `next:GET:${path}`);
    }
    await request(app).post("/faq").expect(404, "next:POST:/faq");
  });
  it("ignores and clears a prior language cookie without valid acceptance on public HTML", async () => {
    const app = createApp((_req, res) => { res.send("next"); }, () => true);
    for (const choice of [undefined, "v1.rejected", "v1.necessary", "v0.all", "v1.invalid"]) {
      const header = [`${appConfig.localeCookie.name}=en`, choice && `${appConfig.cookieChoice.name}=${choice}`].filter(Boolean).join("; ");
      const redirect = await request(app).get("/").set("Cookie", header).expect(307);
      expect(redirect.headers.location).toBe("/bg");
      expect(redirect.headers["set-cookie"]?.[0]).toContain(`${appConfig.localeCookie.name}=`);
      expect(redirect.headers["cache-control"]).toBe("private, no-store");
      const page = await request(app).get("/contacts/en").set("Accept", "text/html").set("Cookie", header).expect(200);
      expect(page.headers["set-cookie"]?.[0]).toContain(`${appConfig.localeCookie.name}=`);
      expect(page.headers["cache-control"]).toBe("private, no-store");
    }
    const asset = await request(app).get("/_next/asset.js").set("Accept", "text/html").set("Cookie", "wct_locale=en").expect(200);
    expect(asset.headers["set-cookie"]).toBeUndefined();
  });
  it("reports readiness without caching or implementation headers", async () => {
    let ready = true;
    const app = createApp((_req, res) => { res.send("next"); }, () => ready);
    const response = await request(app).get(appConfig.paths.health).expect(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    ready = false;
    await request(app).get(appConfig.paths.health).expect(503, { status: "unavailable" });
  });
  it("reports CSP in test mode and enforces it with HSTS on a production HTTPS origin", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const app = () => createApp((_req, res) => { res.send("next"); }, () => true);
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("AUTH_CSP_ENFORCE", "");
      vi.stubEnv("SITE_URL", "");
      const local = await request(app()).get(appConfig.paths.health).expect(200);
      expect(local.headers["content-security-policy-report-only"]).toContain("frame-ancestors 'none'");
      expect(local.headers["content-security-policy"]).toBeUndefined();
      expect(local.headers["strict-transport-security"]).toBeUndefined();

      vi.stubEnv("AUTH_CSP_ENFORCE", "1");
      const forced = await request(app()).get(appConfig.paths.health).expect(200);
      expect(forced.headers["content-security-policy"]).toContain("'strict-dynamic'");
      expect(forced.headers["content-security-policy"]).toContain(`frame-src ${appConfig.contact.captchaCspFrameSources.join(" ")}`);
      expect(forced.headers["content-security-policy"]).toContain(`connect-src 'self' ${appConfig.contact.captchaCspConnectSources.join(" ")}`);
      expect(forced.headers["content-security-policy-report-only"]).toBeUndefined();
      expect(forced.headers["strict-transport-security"]).toBeUndefined();
      const second = await request(app()).get(appConfig.paths.health).expect(200);
      const nonce = (policy: string) => policy.match(/'nonce-([^']+)'/)?.[1];
      expect(nonce(forced.headers["content-security-policy"])).toBeTruthy();
      expect(nonce(second.headers["content-security-policy"])).not.toBe(nonce(forced.headers["content-security-policy"]));

      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_CSP_ENFORCE", "");
      vi.stubEnv("SITE_URL", "http://example.test");
      const plainHttp = await request(app()).get(appConfig.paths.health).expect(200);
      expect(plainHttp.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(plainHttp.headers["content-security-policy-report-only"]).toBeUndefined();
      expect(plainHttp.headers["strict-transport-security"]).toBeUndefined();

      vi.stubEnv("SITE_URL", "https://example.test");
      const production = await request(app()).get(appConfig.paths.health).expect(200);
      expect(production.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(production.headers["content-security-policy-report-only"]).toBeUndefined();
      expect(production.headers["strict-transport-security"]).toBe("max-age=31536000");
      expect(production.headers["x-frame-options"]).toBe("DENY");
      expect(production.headers["x-content-type-options"]).toBe("nosniff");

      for (const origin of ["HTTPS://example.test", " https://example.test", ""]) {
        vi.stubEnv("SITE_URL", origin);
        const response = await request(app()).get(appConfig.paths.health).expect(200);
        expect(response.headers["content-security-policy"]).toContain("'strict-dynamic'");
        expect(response.headers["content-security-policy-report-only"]).toBeUndefined();
        expect(response.headers["strict-transport-security"]).toBe(origin ? "max-age=31536000" : undefined);
      }

      vi.stubEnv("SITE_URL", "https://example.test");
      vi.stubEnv("AUTH_DEPLOYMENT_STAGE", "");
      vi.stubEnv("AUTH_CSP_ENFORCE", "0");
      expect(() => app()).toThrow("Invalid CSP configuration");
      vi.stubEnv("AUTH_DEPLOYMENT_STAGE", "staging");
      vi.stubEnv("AUTH_CSP_STAGING_ORIGIN", "https://other.example.test");
      expect(() => app()).toThrow("Invalid CSP configuration");
      vi.stubEnv("AUTH_CSP_STAGING_ORIGIN", "https://example.test");
      const stagingApp = app();
      expect(warning).toHaveBeenCalledWith("CSP report-only observation is active on staging");
      const staging = await request(stagingApp).get(appConfig.paths.health).expect(200);
      expect(staging.headers["content-security-policy"]).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
      expect(staging.headers["content-security-policy-report-only"]).toContain("'strict-dynamic'");
      expect(staging.headers["content-security-policy-report-only"]).toContain(`frame-src ${appConfig.contact.captchaCspFrameSources.join(" ")}`);
      expect(staging.headers["strict-transport-security"]).toBe(production.headers["strict-transport-security"]);
      expect(staging.headers["x-frame-options"]).toBe(production.headers["x-frame-options"]);
      expect(staging.headers["x-content-type-options"]).toBe(production.headers["x-content-type-options"]);
      const forbidden = await request(stagingApp).post("/api/auth/login").send({ email: "test@example.test", password: "test" }).expect(403);
      expect(forbidden.headers["content-security-policy"]).toBe(staging.headers["content-security-policy"]);
      const admin = await request(stagingApp).get("/admin/unknown").expect(200);
      expect(admin.headers["content-security-policy"]).toBe(staging.headers["content-security-policy"]);
      expect(admin.headers["x-frame-options"]).toBe("DENY");
      expect(admin.headers["cache-control"]).toBe("private, no-store");
      expect(admin.headers["referrer-policy"]).toBe("no-referrer");
      const nextPage = await request(stagingApp).get("/about/bg").expect(200);
      expect(nextPage.headers["content-security-policy"]).toBe(staging.headers["content-security-policy"]);
      expect(nextPage.headers["x-frame-options"]).toBe("DENY");

      vi.stubEnv("AUTH_CSP_ENFORCE", "");
      const enforcedAgain = await request(app()).get(appConfig.paths.health).expect(200);
      expect(enforcedAgain.headers["content-security-policy"]).toContain("'strict-dynamic'");
      expect(enforcedAgain.headers["content-security-policy-report-only"]).toBeUndefined();
      vi.stubEnv("AUTH_CSP_ENFORCE", "off");
      expect(() => app()).toThrow("Invalid CSP configuration");
    } finally {
      warning.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("rejects incomplete staging settings and keeps other modes protected", async () => {
    const app = () => createApp((_req, res) => { res.send("next"); }, () => true);
    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_DEPLOYMENT_STAGE", "staging");
      vi.stubEnv("AUTH_CSP_ENFORCE", "0");
      for (const [origin, stagingOrigin] of [
        ["http://example.test", "http://example.test"],
        ["https://example.test", ""],
        ["https://example.test", "https://example.test/app"],
        ["https://example.test", "not-a-url"],
      ]) {
        vi.stubEnv("SITE_URL", origin);
        vi.stubEnv("AUTH_CSP_STAGING_ORIGIN", stagingOrigin);
        expect(() => app()).toThrow("Invalid CSP configuration");
      }

      vi.stubEnv("AUTH_CSP_ENFORCE", "");
      vi.stubEnv("SITE_URL", "https://example.test/app");
      const invalidOrigin = await request(app()).get(appConfig.paths.health).expect(200);
      expect(invalidOrigin.headers["content-security-policy"]).toContain("'strict-dynamic'");
      expect(invalidOrigin.headers["content-security-policy-report-only"]).toBeUndefined();
      expect(invalidOrigin.headers["strict-transport-security"]).toBeUndefined();

      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("AUTH_CSP_ENFORCE", "0");
      const local = await request(app()).get(appConfig.paths.health).expect(200);
      expect(local.headers["content-security-policy-report-only"]).toContain("'strict-dynamic'");
      expect(local.headers["content-security-policy"]).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each([appConfig.paths.api, `${appConfig.paths.api}/unknown`])("returns a JSON 404 for %s", async (path) => {
    const app = createApp(() => { throw new Error("should not reach Next"); }, () => true);
    await request(app).get(path).expect("Content-Type", /json/).expect(404, { error: "Not found" });
  });
  it("forwards Next URLs and leaves request bodies untouched", async () => {
    const app = createApp(async (req, res) => {
      let body = ""; for await (const part of req) body += part;
      res.json({ url: req.url, body });
    }, () => true);
    await request(app).post("/about/bg?_rsc=test").send("original body").expect(200, { url: "/about/bg?_rsc=test", body: "original body" });
  });
  it("does not expose details from rejected handlers", async () => {
    const app = createApp(async () => { throw new Error("private failure"); }, () => true);
    const response = await request(app).get("/bg").expect(500);
    expect(response.body).toEqual({ error: "Internal server error" });
  });
  it("validates contact submissions on the server before attempting email", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SMTP_HOST", "");
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      const payload = {
        locale: "bg", services: [appConfig.contact.diagnosticSlug], name: "Visitor",
        email: "visitor@example.test", phone: "", website: "", budget: "",
        message: "I would like a website assessment.", newsletter: false, privacy: true, captchaToken: "test-token",
      };
      const send = (body: Record<string, unknown>, origin = "http://localhost:3000") =>
        request(app).post(appConfig.paths.contactApi).set("Origin", origin).send(body);
      await send(payload, "http://another.test").expect(403);
      await send({ ...payload, email: "invalid" }).expect(400);
      await send({ ...payload, email: "visitor,other@example.test" }).expect(400);
      await send({ ...payload, email: "Visitor <visitor@example.test>" }).expect(400);
      await send({ ...payload, name: "Vis\u202eitor" }).expect(400);
      await send({ ...payload, name: " A" }).expect(400);
      await send({ ...payload, website: "https://example.test/\u200bhidden" }).expect(400);
      await send({ ...payload, budget: "5 000\u0080" }).expect(400);
      await send({ ...payload, phone: "     " }).expect(400);
      await send({ ...payload, privacy: false }).expect(400);
      await send({ ...payload, services: ["unknown"] }).expect(400);
      await send({ ...payload, website: "javascript:alert(1)" }).expect(400);
      await send({ ...payload, website: "ftp://example.test" }).expect(400);
      await send({ ...payload, website: "not-a-domain" }).expect(400);
      await send({ ...payload, website: "https://user@example.test" }).expect(400);
      await send({ ...payload, budget: "x".repeat(appConfig.contact.budgetMaxLength + 1) }).expect(400);
      await send({ ...payload, message: "short" }).expect(400);
      await send({ ...payload, message: "          a" }).expect(400);
      await request(app).post(appConfig.paths.contactApi).send(payload).expect(403);
      await request(app).post(appConfig.paths.contactApi).set("Origin", "http://localhost:3000").set("Sec-Fetch-Site", "cross-site").send(payload).expect(403);
      await request(app).post(appConfig.paths.contactApi).set("Origin", "http://localhost:3000").set("Content-Type", "text/plain").send("hello").expect(415);
      await request(app).post(appConfig.paths.contactApi).set("Origin", "http://localhost:3000").set("Content-Type", "application/json").send("{").expect(400);
      await request(app).post(appConfig.paths.contactApi).set("Origin", "http://localhost:3000").set("Content-Type", "application/json").send(JSON.stringify({ ...payload, message: "x".repeat(17000) })).expect(413);
      await send(payload).expect(503, { error: "Mail unavailable" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("sends a validated contact submission to the configured contact inbox", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("AUTH_SMTP_PORT", "465");
    vi.stubEnv("AUTH_SMTP_USER", "test");
    vi.stubEnv("AUTH_SMTP_PASSWORD", "test");
    vi.stubEnv("AUTH_SMTP_FROM", "sender@example.test");
    vi.stubEnv("CAPTCHA_SITE_KEY", "public-test-key");
    vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
    const verify = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: true, hostname: "localhost" }));
    const sendMail = vi.fn().mockResolvedValue({ accepted: [appConfig.contactEmail], rejected: [] });
    const close = vi.fn();
    const transport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail, close } as never);
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      const publicConfig = await request(app).get(appConfig.paths.contactApi).expect(200);
      expect(publicConfig.body).toEqual({ siteKey: "public-test-key" });
      expect(publicConfig.headers["cache-control"]).toBe("no-store");
      await request(app).post(appConfig.paths.contactApi).set("Origin", "http://localhost:3000").send({
        locale: "bg", services: [appConfig.contact.diagnosticSlug], name: "Visitor",
        email: "visitor@example.test", phone: "", website: "www.happycolors.eu", budget: "5 000 лв.",
        message: "I would like a website assessment.\r\nPlease help.", newsletter: true, privacy: true, captchaToken: "test-token",
      }).expect(200, { ok: true, newsletter: "unavailable" });
      expect(verify).toHaveBeenCalledOnce();
      const verificationBody = verify.mock.calls[0][1]?.body;
      expect(verificationBody).toBeInstanceOf(URLSearchParams);
      expect((verificationBody as URLSearchParams).get("response")).toBe("test-token");
      expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: appConfig.contactEmail,
        replyTo: { name: "Visitor", address: "visitor@example.test" },
        text: expect.stringContaining("Newsletter interest: yes"),
      }));
      expect(sendMail.mock.calls[0][0].text).toContain("Budget: 5 000 лв.");
      expect(sendMail.mock.calls[0][0].text).toContain("I would like a website assessment.\nPlease help.");
      expect(sendMail.mock.calls[0][0].text).toContain("Website: www.happycolors.eu");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      verify.mockRestore();
      transport.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("does not lose the contact newsletter request when the IP check takes longer than 1.5 seconds", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("AUTH_SMTP_PORT", "465");
    vi.stubEnv("AUTH_SMTP_USER", "test");
    vi.stubEnv("AUTH_SMTP_PASSWORD", "test");
    vi.stubEnv("AUTH_SMTP_FROM", "sender@example.test");
    vi.stubEnv("CAPTCHA_SITE_KEY", "public-test-key");
    vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
    const verify = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: true, hostname: "localhost" }));
    const reserveIp = vi.spyOn(newsletterService, "reserveNewsletterIp").mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("allowed"), appConfig.newsletter.contactWaitMilliseconds + 50)));
    const subscribe = vi.spyOn(newsletterService, "requestSubscription").mockResolvedValue("accepted");
    const sendMail = vi.fn().mockResolvedValue({ accepted: [appConfig.contactEmail], rejected: [] });
    const transport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail, close: vi.fn() } as never);
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      await request(app).post(appConfig.paths.contactApi).set("Origin", "http://localhost:3000").send({
        locale: "bg", services: [], name: "Visitor", email: "Already@Example.test", phone: "", website: "", budget: "",
        message: "Please review my website.", newsletter: true, privacy: true, captchaToken: "test-token",
      }).expect(200, { ok: true, newsletter: "accepted" });
      expect(reserveIp).toHaveBeenCalledOnce();
      expect(subscribe).toHaveBeenCalledWith("already@example.test", "bg", "contact");
      expect(verify).toHaveBeenCalledOnce();
      expect(sendMail).toHaveBeenCalledOnce();
    } finally {
      transport.mockRestore();
      subscribe.mockRestore();
      reserveIp.mockRestore();
      verify.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("still sends the contact enquiry when the newsletter IP check does not answer", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("AUTH_SMTP_PORT", "465");
    vi.stubEnv("AUTH_SMTP_USER", "test");
    vi.stubEnv("AUTH_SMTP_PASSWORD", "test");
    vi.stubEnv("AUTH_SMTP_FROM", "sender@example.test");
    vi.stubEnv("CAPTCHA_SITE_KEY", "public-test-key");
    vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
    const reserveIp = vi.spyOn(newsletterService, "reserveNewsletterIp").mockImplementation(() => new Promise(() => {}));
    const subscribe = vi.spyOn(newsletterService, "requestSubscription").mockResolvedValue("accepted");
    const verify = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: true, hostname: "localhost" }));
    const sendMail = vi.fn().mockResolvedValue({ accepted: [appConfig.contactEmail], rejected: [] });
    const transport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail, close: vi.fn() } as never);
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      await request(app).post(appConfig.paths.contactApi).set("Origin", "http://localhost:3000").send({
        locale: "bg", services: [], name: "Visitor", email: "visitor@example.test", phone: "", website: "", budget: "",
        message: "Please review my website.", newsletter: true, privacy: true, captchaToken: "test-token",
      }).expect(200, { ok: true, newsletter: "unavailable" });
      expect(reserveIp).toHaveBeenCalledOnce();
      expect(subscribe).not.toHaveBeenCalled();
      expect(verify).toHaveBeenCalledOnce();
      expect(sendMail).toHaveBeenCalledOnce();
    } finally {
      transport.mockRestore();
      verify.mockRestore();
      subscribe.mockRestore();
      reserveIp.mockRestore();
      vi.unstubAllEnvs();
    }
  }, appConfig.newsletter.contactIpWaitMilliseconds + 5_000);
  it("rejects missing, wrong-host, and unavailable CAPTCHA responses without sending mail", async () => {
    const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60 * 60 * 1000);
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("AUTH_SMTP_PORT", "465");
    vi.stubEnv("AUTH_SMTP_USER", "test");
    vi.stubEnv("AUTH_SMTP_PASSWORD", "test");
    vi.stubEnv("AUTH_SMTP_FROM", "sender@example.test");
    vi.stubEnv("CAPTCHA_SITE_KEY", "public-test-key");
    vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
    const verify = vi.spyOn(globalThis, "fetch");
    const sendMail = vi.fn();
    const transport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail, close: vi.fn() } as never);
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      const body = {
        locale: "bg", services: [], name: "Visitor", email: "visitor@example.test", phone: "",
        website: "", budget: "", message: `Start\r\n${"x".repeat(1994)}`, newsletter: false, privacy: true,
      };
      const submit = (payload: Record<string, unknown>) => request(app).post(appConfig.paths.contactApi)
        .set("Origin", "http://localhost:3000").send(payload);
      await submit({ ...body, email: "bad", captchaToken: "" }).expect(400, { error: "Invalid form data" });
      await submit(body).expect(400, { error: "captcha" });
      await submit({ ...body, captchaToken: "x".repeat(appConfig.contact.captchaTokenMaxLength + 1) }).expect(400, { error: "captcha" });
      expect(verify).not.toHaveBeenCalled();
      vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "");
      await request(app).get(appConfig.paths.contactApi).expect(503);
      await submit({ ...body, captchaToken: "token" }).expect(503);
      vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
      verify.mockResolvedValueOnce(Response.json({ success: true, hostname: "wrong.example" }));
      await submit({ ...body, captchaToken: "wrong-host" }).expect(400, { error: "captcha" });
      verify.mockResolvedValueOnce(Response.json({ success: true, hostname: "localhost", "error-codes": ["over-quota"] }));
      await submit({ ...body, captchaToken: "quota" }).expect(503);
      verify.mockRejectedValueOnce(new Error("network unavailable"));
      await submit({ ...body, captchaToken: "network" }).expect(503);
      verify.mockImplementation(async () => Response.json({ success: false, hostname: "localhost" }));
      for (let index = 3; index < appConfig.contact.captchaAttemptLimit; index += 1) {
        await submit({ ...body, captchaToken: `invalid-${index}` }).expect(400, { error: "captcha" });
      }
      await submit({ ...body, captchaToken: "attempt-over-limit" }).expect(429);
      expect(verify).toHaveBeenCalledTimes(appConfig.contact.captchaAttemptLimit);
      expect(sendMail).not.toHaveBeenCalled();
    } finally {
      time.mockRestore();
      verify.mockRestore();
      transport.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("reserves contact slots before parallel CAPTCHA checks", async () => {
    const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("AUTH_SMTP_PORT", "465");
    vi.stubEnv("AUTH_SMTP_USER", "test");
    vi.stubEnv("AUTH_SMTP_PASSWORD", "test");
    vi.stubEnv("AUTH_SMTP_FROM", "sender@example.test");
    vi.stubEnv("CAPTCHA_SITE_KEY", "public-test-key");
    vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
    const waiting: Array<(reply: Response) => void> = [];
    const verify = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => waiting.push(resolve)));
    const sendMail = vi.fn().mockResolvedValue({ accepted: [appConfig.contactEmail] });
    const transport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail, close: vi.fn() } as never);
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      const body = {
        locale: "bg", services: [], name: "Visitor", email: "visitor@example.test", phone: "",
        website: "", budget: "", message: "Please review my website.", newsletter: false, privacy: true,
      };
      const sends = Array.from({ length: appConfig.contact.rateLimit + 1 }, (_, index) => request(app)
        .post(appConfig.paths.contactApi).set("Origin", "http://localhost:3000")
        .send({ ...body, captchaToken: `token-${index}` }).then((response) => response));
      await vi.waitFor(() => expect(waiting).toHaveLength(appConfig.contact.rateLimit));
      waiting.forEach((resolve) => resolve(Response.json({ success: true, hostname: "localhost" })));
      const replies = await Promise.all(sends);
      expect(replies.filter((reply) => reply.status === 200)).toHaveLength(appConfig.contact.rateLimit);
      expect(replies.filter((reply) => reply.status === 429)).toHaveLength(1);
      expect(sendMail).toHaveBeenCalledTimes(appConfig.contact.rateLimit);
    } finally {
      time.mockRestore();
      verify.mockRestore();
      transport.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("caps Google verification attempts across rotating client addresses and resets after the window", async () => {
    const base = Date.now() + 10 * 60 * 60 * 1000;
    const time = vi.spyOn(Date, "now").mockReturnValue(base);
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("RENDER", "true");
    vi.stubEnv("RENDER_SERVICE_TYPE", "web");
    vi.stubEnv("AUTH_TRUSTED_PROXY_IPS", "");
    vi.stubEnv("AUTH_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("AUTH_SMTP_PORT", "465");
    vi.stubEnv("AUTH_SMTP_USER", "test");
    vi.stubEnv("AUTH_SMTP_PASSWORD", "test");
    vi.stubEnv("AUTH_SMTP_FROM", "sender@example.test");
    vi.stubEnv("CAPTCHA_SITE_KEY", "public-test-key");
    vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
    const verify = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ success: false }));
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      const body = {
        locale: "bg", services: [], name: "Visitor", email: "visitor@example.test", phone: "",
        website: "", budget: "", message: "Please review my website.", newsletter: false, privacy: true, captchaToken: "token",
      };
      const send = (index: number) => request(app).post(appConfig.paths.contactApi)
        .set("Origin", "http://localhost:3000").set("X-Forwarded-For", `198.51.100.${index + 1}`).send(body);
      for (let index = 0; index < appConfig.contact.captchaGlobalAttemptLimit; index += 1) await send(index).expect(400, { error: "captcha" });
      await send(appConfig.contact.captchaGlobalAttemptLimit).expect(429);
      expect(verify).toHaveBeenCalledTimes(appConfig.contact.captchaGlobalAttemptLimit);
      time.mockReturnValue(base + appConfig.contact.rateWindowMilliseconds + 1);
      await send(appConfig.contact.captchaGlobalAttemptLimit + 1).expect(400, { error: "captcha" });
    } finally {
      time.mockRestore();
      verify.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("caps SMTP attempts after valid CAPTCHA across rotating client addresses", async () => {
    const base = Date.now() + 15 * 60 * 60 * 1000;
    const time = vi.spyOn(Date, "now").mockReturnValue(base);
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("RENDER", "true");
    vi.stubEnv("RENDER_SERVICE_TYPE", "web");
    vi.stubEnv("AUTH_TRUSTED_PROXY_IPS", "");
    vi.stubEnv("AUTH_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("AUTH_SMTP_PORT", "465");
    vi.stubEnv("AUTH_SMTP_USER", "test");
    vi.stubEnv("AUTH_SMTP_PASSWORD", "test");
    vi.stubEnv("AUTH_SMTP_FROM", "sender@example.test");
    vi.stubEnv("CAPTCHA_SITE_KEY", "public-test-key");
    vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
    const verify = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ success: true, hostname: "localhost" }));
    const sendMail = vi.fn().mockResolvedValue({ accepted: [appConfig.contactEmail] });
    const transport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail, close: vi.fn() } as never);
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      const body = {
        locale: "bg", services: [], name: "Visitor", email: "visitor@example.test", phone: "",
        website: "", budget: "", message: "Please review my website.", newsletter: false, privacy: true, captchaToken: "token",
      };
      const send = (index: number) => request(app).post(appConfig.paths.contactApi)
        .set("Origin", "http://localhost:3000").set("X-Forwarded-For", `198.51.100.${index + 1}`).send(body);
      for (let index = 0; index < appConfig.contact.contactGlobalSendLimit; index += 1) await send(index).expect(200, { ok: true });
      await send(appConfig.contact.contactGlobalSendLimit).expect(429);
      expect(verify).toHaveBeenCalledTimes(appConfig.contact.contactGlobalSendLimit + 1);
      expect(sendMail).toHaveBeenCalledTimes(appConfig.contact.contactGlobalSendLimit);
    } finally {
      time.mockRestore();
      verify.mockRestore();
      transport.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("limits simultaneous Google checks across different client addresses", async () => {
    const base = Date.now() + 20 * 60 * 60 * 1000;
    const time = vi.spyOn(Date, "now").mockReturnValue(base);
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("RENDER", "true");
    vi.stubEnv("RENDER_SERVICE_TYPE", "web");
    vi.stubEnv("AUTH_TRUSTED_PROXY_IPS", "");
    vi.stubEnv("AUTH_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("AUTH_SMTP_PORT", "465");
    vi.stubEnv("AUTH_SMTP_USER", "test");
    vi.stubEnv("AUTH_SMTP_PASSWORD", "test");
    vi.stubEnv("AUTH_SMTP_FROM", "sender@example.test");
    vi.stubEnv("CAPTCHA_SITE_KEY", "public-test-key");
    vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
    const waiting: Array<(response: Response) => void> = [];
    const verify = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => waiting.push(resolve)));
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      const body = {
        locale: "bg", services: [], name: "Visitor", email: "visitor@example.test", phone: "",
        website: "", budget: "", message: "Please review my website.", newsletter: false, privacy: true, captchaToken: "token",
      };
      const sends = Array.from({ length: appConfig.contact.captchaConcurrentLimit + 1 }, (_, index) => request(app)
        .post(appConfig.paths.contactApi).set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", `198.51.100.${index + 1}`).send(body).then((response) => response));
      await vi.waitFor(() => expect(waiting).toHaveLength(appConfig.contact.captchaConcurrentLimit));
      waiting.forEach((resolve) => resolve(Response.json({ success: false })));
      const replies = await Promise.all(sends);
      expect(replies.filter((reply) => reply.status === 429)).toHaveLength(1);
      expect(replies.filter((reply) => reply.status === 400)).toHaveLength(appConfig.contact.captchaConcurrentLimit);
    } finally {
      time.mockRestore();
      verify.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("keeps IP limiter tables bounded while admitting a new address", async () => {
    const base = Date.now() + 25 * 60 * 60 * 1000;
    const time = vi.spyOn(Date, "now").mockReturnValue(base);
    const limits = appConfig.contact as unknown as { captchaBucketLimit: number; captchaAttemptLimit: number };
    const oldBucketLimit = limits.captchaBucketLimit;
    const oldAttemptLimit = limits.captchaAttemptLimit;
    limits.captchaBucketLimit = 2;
    limits.captchaAttemptLimit = 1;
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("RENDER", "true");
    vi.stubEnv("RENDER_SERVICE_TYPE", "web");
    vi.stubEnv("AUTH_TRUSTED_PROXY_IPS", "");
    vi.stubEnv("AUTH_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("AUTH_SMTP_PORT", "465");
    vi.stubEnv("AUTH_SMTP_USER", "test");
    vi.stubEnv("AUTH_SMTP_PASSWORD", "test");
    vi.stubEnv("AUTH_SMTP_FROM", "sender@example.test");
    vi.stubEnv("CAPTCHA_SITE_KEY", "public-test-key");
    vi.stubEnv("CAPTCHA_SECRET_SITE_KEY", "private-test-key");
    const verify = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ success: false }));
    try {
      const app = createApp((_req, res) => { res.send("next"); }, () => true);
      const body = {
        locale: "bg", services: [], name: "Visitor", email: "visitor@example.test", phone: "",
        website: "", budget: "", message: "Please review my website.", newsletter: false, privacy: true, captchaToken: "token",
      };
      const send = (lastOctet: number) => request(app).post(appConfig.paths.contactApi)
        .set("Origin", "http://localhost:3000").set("X-Forwarded-For", `198.51.100.${lastOctet}`).send(body);
      await send(1).expect(400, { error: "captcha" });
      await send(2).expect(400, { error: "captcha" });
      await send(3).expect(400, { error: "captcha" });
      await send(1).expect(400, { error: "captcha" });
      expect(verify).toHaveBeenCalledTimes(4);
    } finally {
      limits.captchaBucketLimit = oldBucketLimit;
      limits.captchaAttemptLimit = oldAttemptLimit;
      time.mockRestore();
      verify.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
