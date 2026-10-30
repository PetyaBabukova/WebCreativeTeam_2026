import express, { type Request, type Response } from "express";
import Busboy from "busboy";
import { appConfig } from "../../lib/config.js";
import { privateResponse, validCsrf, validOrigin, verifySession } from "../auth/security.js";
import { adminArticle, adminArticles, BlogError, blogImageFile, createArticle, deleteArticle, updateArticle, type Upload } from "./service.js";

export const blogRouter = express.Router();
const imageRequests = new Map<string, { count: number; expires: number }>();
let activeImageRequests = 0;
const activeImageIps = new Map<string, number>();

function imageRateAllowed(ip: string): boolean {
  const now = Date.now();
  const previous = imageRequests.get(ip);
  if (previous && previous.expires > now) {
    if (previous.count >= appConfig.blog.imageRateLimit) return false;
    previous.count++;
    return true;
  }
  if (imageRequests.size >= appConfig.blog.imageRateBucketLimit) {
    for (const [key, entry] of imageRequests) if (entry.expires <= now) imageRequests.delete(key);
    if (imageRequests.size >= appConfig.blog.imageRateBucketLimit) imageRequests.delete(imageRequests.keys().next().value!);
  }
  imageRequests.set(ip, { count: 1, expires: now + appConfig.blog.imageRateWindowMilliseconds });
  return true;
}

function imageError(res: Response, status: number) {
  if (res.headersSent) { res.destroy(); return; }
  res.set("Cache-Control", "no-store").status(status).end();
}

async function serveImage(req: Request, res: Response, head: boolean) {
  res.set("X-Content-Type-Options", "nosniff");
  let file: ReturnType<typeof blogImageFile>;
  try { file = blogImageFile(req.originalUrl); }
  catch (error) { imageError(res, error instanceof BlogError && error.status === 503 ? 503 : 404); return; }
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (activeImageRequests >= appConfig.blog.imageConcurrentLimit || (activeImageIps.get(ip) ?? 0) >= appConfig.blog.imageConcurrentIpLimit || !imageRateAllowed(ip)) {
    res.set("Retry-After", String(Math.ceil(appConfig.blog.imageRateWindowMilliseconds / 1000)));
    imageError(res, 429);
    return;
  }
  activeImageRequests++;
  activeImageIps.set(ip, (activeImageIps.get(ip) ?? 0) + 1);
  let released = false;
  const deadline = setTimeout(() => imageError(res, 503), appConfig.blog.imageDeadlineMilliseconds);
  deadline.unref();
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(deadline);
    activeImageRequests--;
    const remaining = (activeImageIps.get(ip) ?? 1) - 1;
    if (remaining) activeImageIps.set(ip, remaining); else activeImageIps.delete(ip);
  };
  res.once("close", release);
  res.once("finish", release);
  try {
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > appConfig.blog.maxFileBytes || metadata.contentType !== "image/webp" || (metadata.contentEncoding && metadata.contentEncoding !== "identity") || !metadata.generation) {
      imageError(res, 404);
      return;
    }
    if (res.destroyed || res.writableEnded) return;
    if (head) {
      res.set({ "Content-Type": "image/webp", "Content-Length": String(size), "Cache-Control": `public, max-age=${appConfig.blog.imageCacheSeconds}` }).status(200).end();
      return;
    }
    const stream = blogImageFile(req.originalUrl, String(metadata.generation)).createReadStream();
    res.once("close", () => { if (!res.writableFinished) stream.destroy(); });
    stream.on("error", (error: unknown) => {
      console.warn("Blog image read failed", { name: error instanceof Error ? error.name : "Unknown" });
      imageError(res, error && typeof error === "object" && "code" in error && error.code === 404 ? 404 : 503);
    });
    stream.once("end", () => { if (!res.headersSent) imageError(res, 503); });
    stream.once("data", (chunk: Buffer) => {
      stream.pause();
      if (res.destroyed) { stream.destroy(); return; }
      res.set({ "Content-Type": "image/webp", "Content-Length": String(size), "Cache-Control": `public, max-age=${appConfig.blog.imageCacheSeconds}` }).status(200);
      res.write(chunk);
      stream.pipe(res);
    });
  } catch (error) {
    console.warn("Blog image lookup failed", { name: error instanceof Error ? error.name : "Unknown" });
    imageError(res, error && typeof error === "object" && "code" in error && error.code === 404 ? 404 : 503);
  }
}

const imageRoute = `${appConfig.blog.imageRoute}/:articleId/:role/:file`;
blogRouter.head(imageRoute, (req, res) => { void serveImage(req, res, true); });
blogRouter.get(imageRoute, (req, res) => { void serveImage(req, res, false); });
blogRouter.use(appConfig.blog.imageRoute, (_req, res) => { imageError(res, 404); });

function safe(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => { void handler(req, res).catch((error: unknown) => {
    if (res.headersSent) return;
    if (error instanceof BlogError) {
      if (error.status === 413) res.set("Connection", "close");
      res.status(error.status).json({ error: error.message }); return;
    }
    console.error("Blog request failed", { name: error instanceof Error ? error.name : "Unknown" });
    res.status(503).json({ error: "Blog temporarily unavailable" });
  }); };
}
async function admin(req: Request, res: Response, write = false) {
  const verified = await verifySession(req, write);
  if (!verified) { res.status(401).json({ error: "Sign in required" }); return null; }
  if (write && (!validOrigin(req) || req.get("sec-fetch-site") && !["same-origin", "none"].includes(req.get("sec-fetch-site")!) || !validCsrf(verified.session, "private", req.get("x-csrf-token")))) {
    res.status(403).json({ error: "Forbidden" }); return null;
  }
  return verified;
}
function multipart(req: Request): Promise<{ input: Record<string, unknown>; files: Upload[] }> {
  return new Promise((resolve, reject) => {
    if (!req.is("multipart/form-data")) { reject(new BlogError(415, "Multipart form required")); return; }
    const input: Record<string, unknown> = {};
    const files: Upload[] = [];
    let total = 0;
    let failure: Error | undefined;
    let parser: ReturnType<typeof Busboy>;
    try { parser = Busboy({ headers: req.headers, limits: { fields: 10, files: appConfig.blog.maxImages, parts: appConfig.blog.maxImages + 10, fileSize: appConfig.blog.maxFileBytes, fieldSize: appConfig.blog.maxHtmlBytes, headerPairs: 30 } }); }
    catch { reject(new BlogError(400, "Invalid multipart form")); return; }
    function fail(message: string) {
      if (failure) return;
      failure = new BlogError(413, message);
      req.unpipe(parser);
      req.resume();
      parser.destroy(failure);
    }
    parser.on("field", (name, value, info) => {
      if (info.nameTruncated || info.valueTruncated || Object.hasOwn(input, name)) fail("Invalid form fields");
      total += Buffer.byteLength(value);
      if (total > appConfig.blog.maxTotalBytes) fail("Form too large");
      input[name] = value;
    });
    parser.on("file", (name, stream) => {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("error", (error) => reject(error instanceof BlogError ? error : new BlogError(400, "Invalid image upload")));
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length; total += chunk.length;
        if (total > appConfig.blog.maxTotalBytes) fail("Form too large");
        if (!failure) chunks.push(chunk);
      });
      stream.on("limit", () => fail("Image too large"));
      stream.on("end", () => { if (!failure) files.push({ name, bytes: Buffer.concat(chunks, size) }); });
    });
    parser.on("fieldsLimit", () => fail("Too many fields"));
    parser.on("filesLimit", () => fail("Too many images"));
    parser.on("partsLimit", () => fail("Too many form parts"));
    parser.on("error", (error) => reject(error instanceof BlogError ? error : new BlogError(400, "Invalid multipart form")));
    req.on("close", () => { if (!req.complete) reject(new BlogError(400, "Request aborted")); });
    parser.on("close", () => failure ? reject(failure) : resolve({ input, files }));
    req.pipe(parser);
  });
}

blogRouter.use("/admin", (_req, res, next) => { privateResponse(res); next(); });
blogRouter.get("/admin", safe(async (req, res) => {
  if (!await admin(req, res)) return;
  res.json({ articles: await adminArticles() });
}));
blogRouter.get("/admin/:id", safe(async (req, res) => {
  if (!await admin(req, res)) return;
  const article = await adminArticle(String(req.params.id));
  if (!article) throw new BlogError(404, "Article not found");
  res.json({ article });
}));
blogRouter.post("/admin", safe(async (req, res) => {
  const verified = await admin(req, res, true);
  if (!verified) return;
  const { input, files } = await multipart(req);
  const article = await createArticle(input, files, verified.user._id);
  res.status(201).json({ article });
}));
blogRouter.put("/admin/:id", safe(async (req, res) => {
  const verified = await admin(req, res, true);
  if (!verified) return;
  const { input, files } = await multipart(req);
  const article = await updateArticle(String(req.params.id), input, files, verified.user._id);
  res.json({ article });
}));
blogRouter.delete("/admin/:id", express.json({ limit: "1kb" }), safe(async (req, res) => {
  if (!await admin(req, res, true)) return;
  if (!req.is("application/json") || !req.body || Object.keys(req.body).length !== 1 || typeof req.body.version !== "number") throw new BlogError(400, "Invalid request");
  await deleteArticle(String(req.params.id), req.body.version);
  res.status(204).end();
}));
