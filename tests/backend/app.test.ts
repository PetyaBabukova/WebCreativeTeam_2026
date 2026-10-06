import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app.js";
import { appConfig } from "../../lib/config.js";

describe("Express HTTP boundaries", () => {
  it.each([
    [undefined, "/bg", "/faq/bg", "/contacts/bg"],
    ["wct_locale=en", "/en", "/faq/en", "/contacts/en"],
    ["other=value; wct_locale=bg", "/bg", "/faq/bg", "/contacts/bg"],
    ["xwct_locale=en; wct_locale=bg", "/bg", "/faq/bg", "/contacts/bg"],
    ["wct_locale=fr", "/bg", "/faq/bg", "/contacts/bg"],
  ])("redirects bare pages using the validated locale cookie %s", async (cookie, home, faq, contacts) => {
    const app = createApp((_req, res) => { res.send("next"); }, () => true);
    for (const [path, destination] of [["/", home], ["/faq?from=email", `${faq}?from=email`], ["/contacts?from=cta", `${contacts}?from=cta`]]) {
      const response = await request(app).get(path).set(cookie ? { Cookie: cookie } : {}).expect(307);
      expect(response.headers.location).toBe(destination);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });
  it("only handles exact GET and HEAD aliases and leaves other requests to Next", async () => {
    const app = createApp((req, res) => { res.status(404).send(`next:${req.method}:${req.path}`); }, () => true);
    await request(app).head("/faq").set("Cookie", "wct_locale=en").expect(307).expect("Location", "/faq/en");
    await request(app).head("/contacts").set("Cookie", "wct_locale=en").expect(307).expect("Location", "/contacts/en");
    for (const path of ["/FAQ", "/faq/", "/contacts/", "/CONTACTS", "/about", "/services/bad/en", "/_next/asset.js"]) {
      await request(app).get(path).expect(404, `next:GET:${path}`);
    }
    await request(app).post("/faq").expect(404, "next:POST:/faq");
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
});
