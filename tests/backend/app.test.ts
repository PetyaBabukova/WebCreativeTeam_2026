import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app.js";
import { appConfig } from "../../lib/config.js";

describe("Express HTTP boundaries", () => {
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
