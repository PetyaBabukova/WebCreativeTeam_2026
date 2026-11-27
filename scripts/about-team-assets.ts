// Prepares the About team portraits once, locally: crop, background removal, depth.
// Usage: npm run about:team-assets -- [id ...] [--offline]
// Reads the private originals from assets/about-team/<id>.webp (git-ignored) and writes the public
// derivatives to public/images/about/team/: <id>-color.webp, <id>-depth.webp, <id>-portrait.webp.
// The photos never leave this machine: the only network use is downloading the pinned model files
// once, and --offline forbids even that. onnxruntime-node is pinned to 1.18: later builds need the
// Visual C++ runtime 14.40+ and crash on older Windows runtimes; the WebAssembly build runs out of memory.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

type Crop = { left: number; top: number; width: number; height: number };
type Model = { id: string; revision: string; license: string; size: number; multiple?: number };
type FloatMap = { values: ArrayLike<number>; width: number; height: number };
type Raw = { width: number; height: number; channels: 3 };

const root = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(root, "assets", "about-team");
const outputDir = path.join(root, "public", "images", "about", "team");
const cacheDir = path.join(root, "node_modules", ".cache", "about-team-models");
const modelHost = "https://huggingface.co";

// Pinned, commercially usable models (licences checked 26 Nov 2026). Both expect ImageNet-normalised RGB.
const imageNet = { mean: [.485, .456, .406], std: [.229, .224, .225] };
export const models: Record<"background" | "depth", Model> = {
  background: { id: "onnx-community/BiRefNet_lite-ONNX", revision: "de15b22ba131738a16dff04aab8bdf8dc32e3ac1", license: "MIT", size: 1024 },
  depth: { id: "onnx-community/depth-anything-v2-small", revision: "4472b7362082ad9968fee890ca0f1e5aca36b93d", license: "Apache-2.0", size: 518, multiple: 14 },
};

// Head and shoulders (the dog: head and chest), as fractions of the original photo.
export const members: Record<string, { crop: Crop }> = {
  iva: { crop: { left: 0, top: 0, width: 1, height: 1 } },
  petya: { crop: { left: 0, top: .18, width: 1, height: .55 } },
  poli: { crop: { left: .2, top: .08, width: .8, height: .5 } },
};

// Output heights in pixels. Point data is small; the fallback portrait is sharper.
export const sizes = { points: 384, portrait: 720 };
const alphaCutoff = 128;

export function cropBox(crop: Crop, width: number, height: number): Crop {
  const left = Math.round(crop.left * width);
  const top = Math.round(crop.top * height);
  return { left, top, width: Math.min(width - left, Math.round(crop.width * width)), height: Math.min(height - top, Math.round(crop.height * height)) };
}

// Depth Anything input size: the shorter side scaled to the model size, both sides a multiple of 14.
export function depthInputSize(width: number, height: number, { size, multiple = 1 }: Model) {
  const scale = Math.max(size / width, size / height);
  const round = (value: number) => Math.max(multiple, Math.round(value / multiple) * multiple);
  return { width: round(width * scale), height: round(height * scale) };
}

// Interleaved RGB bytes to a normalised planar float tensor.
export function toTensorData(rgb: Uint8Array, width: number, height: number) {
  const plane = width * height;
  const out = new Float32Array(plane * 3);
  for (let index = 0; index < plane; index++) {
    for (let channel = 0; channel < 3; channel++) {
      out[channel * plane + index] = (rgb[index * 3 + channel] / 255 - imageNet.mean[channel]) / imageNet.std[channel];
    }
  }
  return out;
}

// Floats to 0..255 bytes; logits outside 0..1 go through a sigmoid first.
export function toMaskBytes(values: ArrayLike<number>) {
  let min = Infinity, max = -Infinity;
  for (let index = 0; index < values.length; index++) { min = Math.min(min, values[index]); max = Math.max(max, values[index]); }
  const logits = min < 0 || max > 1;
  return Uint8Array.from(values, (value) => Math.round(255 * (logits ? 1 / (1 + Math.exp(-value)) : value)));
}

// Depth inside the subject stretched to 1..255 (lighter = nearer); the background is 0.
export function normaliseDepth(depth: ArrayLike<number>, alpha: ArrayLike<number>) {
  let min = Infinity, max = -Infinity;
  for (let index = 0; index < depth.length; index++) {
    if (alpha[index] < alphaCutoff) continue;
    min = Math.min(min, depth[index]); max = Math.max(max, depth[index]);
  }
  const range = max > min ? max - min : 1;
  return Uint8Array.from(depth, (value, index) => alpha[index] < alphaCutoff ? 0 : 1 + Math.round(254 * (value - min) / range));
}

// The subject's bounding box from the alpha channel, with a small margin.
export function subjectBox(alpha: ArrayLike<number>, width: number, height: number, margin = .03): Crop {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alpha[y * width + x] < alphaCutoff) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < 0) throw new Error("The background model found no subject");
  const pad = Math.round(Math.max(width, height) * margin);
  left = Math.max(0, left - pad); top = Math.max(0, top - pad);
  return { left, top, width: Math.min(width, right + pad + 1) - left, height: Math.min(height, bottom + pad + 1) - top };
}

async function loadModel(model: Model, offline: boolean) {
  const file = path.join(cacheDir, model.id, model.revision, "onnx", "model.onnx");
  if (!existsSync(file)) {
    if (offline) throw new Error(`${model.id} is not cached and --offline forbids downloading it`);
    const url = `${modelHost}/${model.id}/resolve/${model.revision}/onnx/model.onnx`;
    const started = Date.now();
    const response = await fetch(url);
    console.log(`[about-team] GET ${url} ${response.status} ${Date.now() - started} ms`);
    if (!response.ok) throw new Error(`Downloading ${model.id} failed with ${response.status}`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  return ort.InferenceSession.create(await readFile(file));
}

// Runs a model on the image resized to width × height; returns its single-channel output at the image size.
async function predict(session: ort.InferenceSession, image: Buffer, info: Raw, width: number, height: number): Promise<FloatMap> {
  const { data } = await sharp(image, { raw: info }).resize(width, height, { fit: "fill", kernel: "cubic" }).raw().toBuffer({ resolveWithObject: true });
  const input = new ort.Tensor("float32", toTensorData(data, width, height), [1, 3, height, width]);
  const started = Date.now();
  const result = await session.run({ [session.inputNames[0]]: input });
  const output = result[session.outputNames[0]];
  const [outHeight, outWidth] = output.dims.slice(-2);
  console.log(`[about-team] ${session.inputNames[0]} ${width}x${height} -> ${outWidth}x${outHeight} in ${Date.now() - started} ms`);
  return { values: output.data as Float32Array, width: outWidth, height: outHeight };
}

// Bilinear resize of a single-channel float map (sample centres aligned), kept in floats.
export function resizeFloat({ values, width, height }: FloatMap, toWidth: number, toHeight: number) {
  const out = new Float32Array(toWidth * toHeight);
  for (let y = 0; y < toHeight; y++) {
    const sy = Math.min(height - 1, Math.max(0, (y + .5) * height / toHeight - .5));
    const y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < toWidth; x++) {
      const sx = Math.min(width - 1, Math.max(0, (x + .5) * width / toWidth - .5));
      const x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      const top = values[y0 * width + x0] * (1 - fx) + values[y0 * width + x1] * fx;
      const bottom = values[y1 * width + x0] * (1 - fx) + values[y1 * width + x1] * fx;
      out[y * toWidth + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

// Each model is loaded, used and released on its own to keep peak memory low.
async function withModel<T>(model: Model, offline: boolean, use: (session: ort.InferenceSession) => Promise<T>) {
  const session = await loadModel(model, offline);
  try { return await use(session); } finally { await session.release(); }
}

async function prepare(id: string, offline: boolean) {
  const started = Date.now();
  const source = sharp(path.join(sourceDir, `${id}.webp`)).rotate();
  const meta = await source.metadata();
  const box = cropBox(members[id].crop, meta.width, meta.height);
  const { data: image, info } = await source.extract(box).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw: Raw = { width: info.width, height: info.height, channels: 3 };

  const maskOut = await withModel(models.background, offline, (session) => predict(session, image, raw, models.background.size, models.background.size));
  const maskBytes = toMaskBytes(maskOut.values);
  const alpha = await sharp(Buffer.from(maskBytes), { raw: { width: maskOut.width, height: maskOut.height, channels: 1 } })
    .resize(info.width, info.height, { fit: "fill" }).extractChannel(0).raw().toBuffer();
  const size = depthInputSize(info.width, info.height, models.depth);
  const depthOut = await withModel(models.depth, offline, (session) => predict(session, image, raw, size.width, size.height));
  const near = normaliseDepth(resizeFloat(depthOut, info.width, info.height), alpha);

  const rgbaBytes = Buffer.alloc(info.width * info.height * 4);
  for (let index = 0; index < alpha.length; index++) {
    rgbaBytes.set(image.subarray(index * 3, index * 3 + 3), index * 4);
    rgbaBytes[index * 4 + 3] = alpha[index];
  }
  const subject = subjectBox(alpha, info.width, info.height);
  const rgba = () => sharp(rgbaBytes, { raw: { width: info.width, height: info.height, channels: 4 } }).extract(subject);
  const grey = sharp(Buffer.from(near), { raw: { width: info.width, height: info.height, channels: 1 } }).extract(subject);
  const outputs: [string, ReturnType<typeof sharp>][] = [
    [`${id}-color.webp`, rgba().resize({ height: sizes.points }).webp({ quality: 88, alphaQuality: 100 })],
    [`${id}-depth.webp`, grey.resize({ height: sizes.points }).webp({ lossless: true })],
    [`${id}-portrait.webp`, rgba().resize({ height: sizes.portrait }).webp({ quality: 82, alphaQuality: 90 })],
  ];
  for (const [file, output] of outputs) {
    const result = await output.toFile(path.join(outputDir, file));
    console.log(`[about-team] ${file} ${result.width}x${result.height} ${(result.size / 1024).toFixed(1)} KB`);
  }
  console.log(`[about-team] ${id}: crop ${JSON.stringify(box)}, subject ${JSON.stringify(subject)}, ${Date.now() - started} ms`);
}

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const ids = args.filter((arg) => !arg.startsWith("--"));
  const unknown = ids.filter((id) => !members[id]);
  if (unknown.length) throw new Error(`Unknown member: ${unknown.join(", ")}`);
  console.log(`[about-team] ${models.background.id}@${models.background.revision.slice(0, 7)} (${models.background.license}), ${models.depth.id}@${models.depth.revision.slice(0, 7)} (${models.depth.license}); offline=${offline}`);
  await mkdir(outputDir, { recursive: true });
  for (const id of ids.length ? ids : Object.keys(members)) await prepare(id, offline);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => { console.error(`[about-team] ${error.stack ?? error}`); process.exit(1); });
}
