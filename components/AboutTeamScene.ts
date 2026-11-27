import * as THREE from "three";
import { atlas, createRenderer, paintAtlas, releaseRenderer, type GlyphFonts } from "./aboutGl";

export { resolveGlyphFonts } from "./aboutGl";

// The About team portraits: halftone point clouds with depth relief, a glowing "digital rain" behind them
// and a glowing relief base under the bust.
// It owns the WebGL renderer and every GPU resource; AboutTeam owns when it runs and which member shows.

export type TeamScene = {
  // Scroll position across the members, 0..count-1; the scene shows the matching mix of two portraits.
  setProgress(position: number): void;
  // Resolves when the member's points are ready; rejects when its images fail (the photo then stands in).
  ready(index: number): Promise<void>;
  setPaused(paused: boolean): void;
  // Pointer position in -1..1 on both axes; the portrait turns towards it.
  setPointer(x: number, y: number): void;
  dispose(): void;
};
// eyeLine: height of the eyes as a share of the portrait from the top; portraits are aligned on it.
export type PortraitSource = { color: string; depth: string; eyeLine: number };
// smooth: ease the shown position after the scroll (off with reduced motion).
// onMix: called when the drawn mix changes, with "k:scatter|k+1:scatter" and the eye line's distance from the
// canvas top in CSS pixels (null before the member's points are ready).
type Options = {
  canvas: HTMLCanvasElement; compact: boolean; smooth: boolean; glyphFonts: GlyphFonts; portraits: PortraitSource[]; referenceEyeLine: number;
  onContextLost: () => void; onMix?: (mix: string, eyes: number | null) => void;
  // Height of the header over the canvas top, in CSS pixels; the outgoing portrait fades before it.
  topInset?: () => number;
};
// aspect: width / height of the portrait, which is 2 units tall.
export type PortraitPoints = { positions: Float32Array; colors: Float32Array; seeds: Float32Array; count: number; spacing: number; aspect: number };

// Owner decision, 26 Nov 2026: monochrome, small dots with visible gaps (an even halftone grid), as in the reference.
// Owner, 27 Nov 2026: the stage 4b look, a touch sparser and with slightly smaller dots.
const budget = { desktop: 40000, compact: 18000, desktopRows: 155, compactRows: 112, slowFrameMilliseconds: 25, maxReductions: 2 };
// Owner, 26 Nov 2026: the rain keeps moving while the section is on screen, bright and glowing, with sparkles.
// glow: a soft round halo drawn under each glyph; sparkle: share of glyphs flashing at a time;
// behindFace: brightness of the rain right behind the portrait, so the face stays readable.
const rain = { desktopColumns: 64, compactColumns: 26, perColumn: 16, palette: ["#ffffff", "#dceaff", "#b8d2ff"], glowScale: 2.2, glowStrength: .05, strength: .45, sparkle: .003, swapRate: 5, behindFace: .12 };
// Owner, 27 Nov 2026: the rain is a quiet background (strength: brightness of the glyphs; a faint glow, rare sparkles).
// The relief base under the bust: ridge lines across a gently moving terrain.
// Narrow screens draw fewer, dimmer lines: the small portrait would pack them into one bright band.
// Owner, 27 Nov 2026: the base sits lower so it never covers a chin. top is the flat level, swell the lift under
// the shoulders and maxRise the cap on terrain plus swell, so the highest ridge stays at or below top + maxRise.
const base = { lines: 40, compactLines: 22, segments: 200, width: 4.6, depth: 2.2, top: -1.12, swell: .12, maxRise: .3, compactStrength: .55 };
// Cool white of the dots; a dot's size and brightness follow the photo's lightness.
// Above 1 so the brightest dots hold their own against the glowing rain; raised with the smaller dots (27 Nov 2026)
// so the faces stay readable. tone lifts the mid-tones (lightness ** tone).
const dotTint = [1.08, 1.12, 1.2];
const tone = .85;
// Dot diameter as a share of the grid step: the smallest and the largest dot.
const dotSize = { min: .26, max: .62 };
// The portrait's breathing settles within five seconds of a member appearing; the rain and the base keep
// moving while the section is on screen (owner decision) and stop with the page-wide pause and off screen.
export const timing = { life: 5000, settle: 1000 };
// Owner, 27 Nov 2026: the change follows the scroll. Between member k and k+1 (f = 0..1) member k slides up and
// dusts away while k+1 rises from the relief into place. The shown position eases after the scroll over
// smoothingMilliseconds; a jump of more than one member is applied at once.
// Owner, 27 Nov 2026 (stage 4d): the portraits slide with the scroll like frames on a strip instead of turning to dust
// and lighting up. Zones are [start, end] shares of f; distance is the slide in portrait units (reducedDistance with
// reduced motion, where the change is mostly a cross-fade).
export const scrub = {
  slideOut: [.15, .75], scatterOut: [.35, .75], slideIn: [.25, .85], scatterIn: [.25, .65],
  distance: 1.1, reducedDistance: .2, smoothingMilliseconds: 220,
} as const;
const zone = (f: number, [start, end]: readonly [number, number]) => (f - start) / (end - start);
const ease = (value: number) => { const step = Math.min(1, Math.max(0, value)); return step * step * (3 - 2 * step); };

// The two portraits drawn at a scroll position: index k and its scatter, and k+1's scatter (1 = fully scattered).
export function mixAt(position: number, count: number) {
  if (count < 2) return { index: 0, scatter: 0, slide: 0, nextScatter: 1, nextSlide: 1 };
  const last = count - 1;
  const clamped = Math.min(last, Math.max(0, position));
  const index = Math.min(Math.floor(clamped), last - 1);
  const f = clamped - index;
  // slide: the outgoing portrait's share of the way up; nextSlide: the incoming one's share of the way still below.
  return {
    index,
    scatter: ease(zone(f, scrub.scatterOut)),
    slide: ease(zone(f, scrub.slideOut)),
    nextScatter: 1 - ease(zone(f, scrub.scatterIn)),
    nextSlide: 1 - ease(zone(f, scrub.slideIn)),
  };
}
export const formatMix = ({ index, scatter, slide, nextScatter, nextSlide }: ReturnType<typeof mixAt>) =>
  `${index}:${scatter.toFixed(2)}:${slide.toFixed(2)}|${index + 1}:${nextScatter.toFixed(2)}:${nextSlide.toFixed(2)}`;
// Sand: each point starts after a delay of up to stagger (a share of the change), in a sweep across the portrait
// with some noise; it drifts drift units outwards plus a little wind to the side and down.
// Stage 4d: only a light dusting at the edges while the portrait slides (it was a whole cloud).
const sand = { stagger: .45, drift: [.08, .3], wind: [.1, -.06], swirl: .02 };
// Band (portrait units) over which the incoming portrait fades in above the relief, and the share of the screen
// height over which the outgoing one fades before the header.
const fadeBand = { base: .2, top: .15 };
// Portrait placement as shares of the visible height (wide screens: centre slightly right; narrow: near the top),
// matched by the photo stand-in in AboutPage.css.
// wideWidth / narrowWidth cap a wide portrait's width as a share of the visible width.
export const placement = { wideHeight: .66, wideRight: .08, wideDrop: .06, wideWidth: .44, narrowHeight: .42, narrowTop: .15, narrowWidth: .84 };
// Relief depth as a share of the portrait height, and the largest turn towards the pointer (radians).
const relief = .28;
const maxTurn = .35;
const alphaCutoff = 128;

// Picks up to maxPoints opaque pixels on an even grid. The portrait is 2 units tall, centred; depth 255 is nearest.
// Lightness is stretched per photo (2nd to 98th percentile), so a dim photo still reads as a lit face.
export function samplePortrait(color: ImageData, depth: ImageData, maxPoints: number, rows: number): PortraitPoints {
  const { width, height } = color;
  let opaque = 0;
  for (let index = 3; index < color.data.length; index += 4) if (color.data[index] >= alphaCutoff) opaque++;
  if (!opaque) throw new Error("Portrait has no opaque pixels");
  // A hexagonal grid (every other row shifted by half a step) reads as a halftone, like the reference.
  const rowStep = Math.sqrt(3) / 2;
  const stride = Math.max(1, height / rows, Math.sqrt(opaque / (maxPoints * rowStep)));
  let seed = 7;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const grid: number[] = [];
  for (let row = 0, y = stride / 2; y < height; row++, y += stride * rowStep) {
    for (let x = stride / 2 + (row % 2) * stride / 2; x < width; x += stride) {
      const pixel = Math.floor(y) * width + Math.floor(x);
      if (color.data[pixel * 4 + 3] >= alphaCutoff) grid.push(x, y, pixel);
    }
  }
  const count = Math.min(grid.length / 3, maxPoints);
  const picked = Array.from({ length: count }, (_, index) => grid[index * 3 + 2]);
  const luma = (pixel: number) => (.2126 * color.data[pixel * 4] + .7152 * color.data[pixel * 4 + 1] + .0722 * color.data[pixel * 4 + 2]) / 255;
  const sorted = picked.slice(0, count).map(luma).sort((x, y) => x - y);
  const dark = sorted[Math.floor(count * .02)];
  const light = sorted[Math.min(count - 1, Math.floor(count * .98))];
  const range = light > dark ? light - dark : 1;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  const scale = 2 / height;
  for (let index = 0; index < count; index++) {
    const pixel = picked[index];
    const px = grid[index * 3];
    const py = grid[index * 3 + 1];
    const near = depth.data[(Math.min(depth.height - 1, Math.floor(py)) * depth.width + Math.min(depth.width - 1, Math.floor(px))) * 4] / 255;
    positions[index * 3] = (px - width / 2) * scale;
    positions[index * 3 + 1] = (height / 2 - py) * scale;
    positions[index * 3 + 2] = (near - .5) * 2 * relief;
    // Monochrome: stretched lightness; farther points are darker, which reads as volume.
    // The lower part fades out instead of ending at a hard edge.
    const fade = 1 - THREE.MathUtils.smoothstep(py / height, .7, 1);
    const lightness = Math.min(1, Math.max(0, (luma(pixel) - dark) / range)) ** tone * (.45 + .55 * near) * fade;
    for (let channel = 0; channel < 3; channel++) colors[index * 3 + channel] = lightness * dotTint[channel];
    for (let part = 0; part < 4; part++) seeds[index * 4 + part] = random();
  }
  return { positions, colors, seeds, count, spacing: stride * scale, aspect: width / height };
}

async function readPixels(url: string): Promise<ImageData> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D unavailable");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

const portraitVertex = /* glsl */ `
  uniform float uTime;
  uniform float uScatter;
  uniform float uLife;
  uniform float uSize;
  uniform float uViewport;
  // uClipY: in this portrait's own units, the level under which it fades into the relief; uClip: how much (0..1).
  // uTopNdc: the screen height (-1..1) under the header above which the portrait fades out; uTop: how much (0..1).
  uniform float uClipY;
  uniform float uClip;
  uniform float uTopNdc;
  uniform float uTop;
  attribute vec3 aColor;
  attribute vec4 aSeed;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    // Breathing: a drift well under the grid step, so the halftone stays even; it fades out with the automatic motion.
    p += uLife * 0.002 * sin(vec3(1.3, 1.1, 0.9) * uTime + aSeed.xyz * 6.2831);
    // Sand: each point leaves (or lands) on its own delay, sweeping across the portrait with some noise,
    // with a soft start and end; it drifts outwards and a little sideways and down, as if blown.
    float delay = clamp(0.5 + 0.3 * position.x + (aSeed.w - 0.5) * 0.6, 0.0, 1.0) * ${sand.stagger.toFixed(2)};
    float local = clamp((uScatter - delay) / ${(1 - sand.stagger).toFixed(2)}, 0.0, 1.0);
    float s = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
    vec3 direction = normalize(aSeed.xyz - 0.5 + vec3(0.0, 0.0, 0.001));
    p += direction * s * (${sand.drift[0].toFixed(2)} + aSeed.w * ${(sand.drift[1] - sand.drift[0]).toFixed(2)});
    p += vec3(${sand.wind[0].toFixed(2)}, ${sand.wind[1].toFixed(2)}, 0.0) * s * s + vec3(sin(aSeed.y * 6.2831 + s * 3.0), cos(aSeed.z * 6.2831 + s * 2.0), 0.0) * ${sand.swirl.toFixed(2)} * s;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    // Halftone: brighter dots are larger.
    float tone = clamp(aColor.g / ${dotTint[1].toFixed(2)}, 0.0, 1.0);
    gl_PointSize = max(1.5, uSize * mix(${dotSize.min.toFixed(2)}, ${dotSize.max.toFixed(2)}, tone) * projectionMatrix[1][1] * uViewport * 0.5 / -view.z);
    vColor = aColor;
    gl_Position = projectionMatrix * view;
    // Rising out of the relief, and fading before the header instead of being cut.
    float relief = mix(1.0, smoothstep(uClipY, uClipY + ${fadeBand.base.toFixed(2)}, position.y), uClip);
    float top = 1.0 - uTop * smoothstep(uTopNdc - ${(fadeBand.top * 2).toFixed(2)}, uTopNdc, gl_Position.y / gl_Position.w);
    vAlpha = (1.0 - s) * relief * top;
  }
`;

const portraitFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Round dots with a soft rim, so small dots stay round instead of turning into single pixels.
    float r = length(gl_PointCoord - 0.5);
    float edge = 1.0 - smoothstep(0.32, 0.5, r);
    if (edge * vAlpha < 0.02) discard;
    // Tones are already display values (sRGB), so no colour space conversion here.
    gl_FragColor = vec4(vColor, vAlpha * edge);
  }
`;

const rainVertex = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uCells;
  uniform float uSize;
  uniform float uGlyphs;
  uniform float uScale;
  // Portrait centre (x) and half width in world units, where the rain dims.
  uniform vec2 uFace;
  attribute vec4 aDrop;
  attribute vec3 aColor;
  attribute float aGlyph;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec2 vLocal;
  varying float vLight;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    // aDrop: column x, phase, speed, place in the trail (0 = head).
    float span = uHeight * 1.5;
    float head = uHeight * 0.75 - mod(aDrop.y * span + uTime * aDrop.z, span);
    vec3 p = vec3(aDrop.x, head + aDrop.w * uSize * 1.2, -1.6);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    view.xy += position.xy * uSize * uScale;
    // The glyphs change as they fall, each at its own moment.
    float swap = floor(uTime * ${rain.swapRate.toFixed(1)} * (0.5 + aDrop.z) + aGlyph * 7.0);
    float glyph = uGlyphs > 0.5 ? 1.0 + mod(aGlyph + swap, uGlyphs) : 0.0;
    float column = mod(glyph, uCells);
    float row = floor(glyph / uCells);
    vUv = (vec2(column, row) + vec2(uv.x, 1.0 - uv.y)) / uCells;
    vLocal = uv - 0.5;
    vColor = aColor;
    // A bright head with a fading trail; now and then a glyph flashes.
    float trail = pow(1.0 - aDrop.w / ${rain.perColumn.toFixed(1)}, 1.6);
    float headBoost = aDrop.w < 0.5 ? 1.3 : 1.0;
    float sparkle = hash(vec2(aGlyph + aDrop.x * 97.0, floor(uTime * 9.0) + aDrop.w)) < ${rain.sparkle.toFixed(3)} ? 3.0 : 1.0;
    float edge = 1.0 - smoothstep(0.38, 0.5, abs(p.y) / uHeight);
    float face = mix(${rain.behindFace.toFixed(2)}, 1.0, smoothstep(0.6, 1.1, abs(aDrop.x - uFace.x) / uFace.y));
    vLight = trail * headBoost * sparkle * edge * face;
    gl_Position = projectionMatrix * view;
  }
`;

const rainFragment = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uStrength;
  uniform float uHalo;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec2 vLocal;
  varying float vLight;

  void main() {
    // The halo layer is a soft round glow; the glyph layer is the crisp glyph.
    float halo = pow(max(0.0, 1.0 - length(vLocal) * 2.0), 2.0);
    float mask = uHalo > 0.5 ? halo : texture2D(uAtlas, vUv).r;
    float light = mask * vLight * uStrength;
    if (light < 0.004) discard;
    gl_FragColor = vec4(vColor * light, 1.0);
    #include <colorspace_fragment>
  }
`;

function rainGeometry(columns: number) {
  const count = columns * rain.perColumn;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry().copy(quad as unknown as THREE.InstancedBufferGeometry);
  quad.dispose();
  const drops = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const shapes = new Float32Array(count);
  const color = new THREE.Color();
  let seed = 11;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let column = 0; column < columns; column++) {
    const phase = random();
    const speed = .35 + random() * .8;
    const x = (column + .5 + (random() - .5) * .6) / columns - .5;
    color.set(rain.palette[Math.floor(random() * rain.palette.length)]);
    for (let place = 0; place < rain.perColumn; place++) {
      const index = column * rain.perColumn + place;
      // x is a share of the width here; resize() scales the columns to the visible width.
      drops.set([x, phase, speed, place], index * 4);
      color.toArray(colors, index * 3);
      // A seed for the glyph; the shader turns it into a changing glyph.
      shapes[index] = Math.floor(random() * 64);
    }
  }
  geometry.setAttribute("aDrop", new THREE.InstancedBufferAttribute(drops, 4));
  geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute("aGlyph", new THREE.InstancedBufferAttribute(shapes, 1));
  geometry.instanceCount = count;
  return { geometry, columnX: Float32Array.from({ length: count }, (_, index) => drops[index * 4]) };
}

const baseVertex = /* glsl */ `
  uniform float uTime;
  attribute float aLine;
  varying float vHeight;
  varying float vFade;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec3 p = position;
    vec2 q = p.xz * vec2(1.4, 2.2) + vec2(uTime * 0.04, uTime * 0.025);
    float terrain = noise(q) * 0.55 + noise(q * 2.3 + 4.0) * 0.3 + noise(q * 5.1 - 2.0) * 0.15;
    // A swell under the shoulders, so the bust seems to rise out of the relief.
    float swell = exp(-(p.x * p.x * 0.9 + (p.z - 0.2) * (p.z - 0.2) * 3.0));
    float height = min(terrain * (0.18 + 0.32 * swell) + ${base.swell.toFixed(2)} * swell, ${base.maxRise.toFixed(2)});
    p.y += height;
    vHeight = clamp(height / ${base.maxRise.toFixed(2)}, 0.0, 1.0);
    vFade = (1.0 - smoothstep(0.55, 1.0, abs(p.x) / ${(base.width / 2).toFixed(2)})) * smoothstep(0.0, 0.25, aLine) * (1.0 - smoothstep(0.75, 1.0, aLine));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const baseFragment = /* glsl */ `
  uniform float uStrength;
  varying float vHeight;
  varying float vFade;

  void main() {
    // Ridges glow brighter the higher they rise.
    float light = (0.06 + 0.8 * pow(vHeight, 1.6)) * vFade * uStrength;
    if (light < 0.004) discard;
    gl_FragColor = vec4(vec3(0.82, 0.9, 1.0) * light, 1.0);
    #include <colorspace_fragment>
  }
`;

function baseGeometry(lineCount: number) {
  const positions: number[] = [];
  const lines: number[] = [];
  for (let line = 0; line < lineCount; line++) {
    const share = line / (lineCount - 1);
    const z = -base.depth * .4 + share * base.depth;
    for (let segment = 0; segment < base.segments; segment++) {
      for (const end of [segment, segment + 1]) {
        positions.push((end / base.segments - .5) * base.width, base.top, z);
        lines.push(share);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aLine", new THREE.Float32BufferAttribute(lines, 1));
  return geometry;
}

// Throws when WebGL is unavailable or a shader fails; the caller then keeps the photo cards.
export function createTeamScene(options: Options): TeamScene {
  const gl = createRenderer(options.canvas, options.compact);
  try {
    return buildScene(gl, options);
  } catch (error) {
    gl.renderer.dispose();
    throw error;
  }
}

type Portrait = { points: THREE.Points; material: THREE.ShaderMaterial };

function buildScene({ renderer, pixelRatio: initialRatio, failed }: ReturnType<typeof createRenderer>, options: Options): TeamScene {
  const { canvas, compact, glyphFonts, portraits, onContextLost } = options;
  let pixelRatio = initialRatio;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 30);
  camera.position.set(0, 0, 6);
  const group = new THREE.Group();
  scene.add(group);

  const { texture, allCount } = paintAtlas(glyphFonts);
  const rainData = rainGeometry(compact ? rain.compactColumns : rain.desktopColumns);
  // Additive blending makes overlapping glyphs and their glow add up to light.
  const glowing = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending };
  const rainUniforms = { uTime: { value: 0 }, uHeight: { value: 4 }, uCells: { value: atlas.cells }, uSize: { value: .1 }, uGlyphs: { value: allCount }, uAtlas: { value: texture }, uFace: { value: new THREE.Vector2(0, 1) } };
  const rainGlowMaterial = new THREE.ShaderMaterial({ vertexShader: rainVertex, fragmentShader: rainFragment, ...glowing, uniforms: { ...rainUniforms, uScale: { value: rain.glowScale }, uStrength: { value: rain.glowStrength }, uHalo: { value: 1 } } });
  const rainMaterial = new THREE.ShaderMaterial({ vertexShader: rainVertex, fragmentShader: rainFragment, ...glowing, uniforms: { ...rainUniforms, uScale: { value: 1 }, uStrength: { value: rain.strength }, uHalo: { value: 0 } } });
  const rainMeshes = [new THREE.Mesh(rainData.geometry, rainGlowMaterial), new THREE.Mesh(rainData.geometry, rainMaterial)];
  for (const mesh of rainMeshes) { mesh.frustumCulled = false; mesh.renderOrder = -2; scene.add(mesh); }
  const baseMaterial = new THREE.ShaderMaterial({ vertexShader: baseVertex, fragmentShader: baseFragment, ...glowing, uniforms: { uTime: { value: 0 }, uStrength: { value: compact ? base.compactStrength : 1 } } });
  const baseLines = new THREE.LineSegments(baseGeometry(compact ? base.compactLines : base.lines), baseMaterial);
  baseLines.frustumCulled = false;
  baseLines.renderOrder = -1;
  group.add(baseLines);

  const maxPoints = compact ? budget.compact : budget.desktop;
  const rows = compact ? budget.compactRows : budget.desktopRows;
  // One portrait per member, created when its points are ready and kept until dispose; only the mixed two draw.
  const members = new Map<number, Portrait>();
  const loads = new Map<number, Promise<void>>();
  const load = (index: number) => {
    let entry = loads.get(index);
    if (!entry) {
      const source = portraits[index];
      entry = Promise.all([readPixels(source.color), readPixels(source.depth)]).then(([color, depth]) => {
        if (disposed) return;
        members.set(index, createPortrait(samplePortrait(color, depth, maxPoints, rows), index));
        // Paused or not, the arriving member shows at once in its place in the scroll.
        lastMix = "";
        if (running) return;
        draw();
      });
      // A failed load may be retried on the next ready() call.
      entry.catch(() => loads.delete(index));
      loads.set(index, entry);
    }
    return entry;
  };

  let raf = 0;
  let running = false;
  let paused = false;
  let disposed = false;
  let lastFrame = 0;
  let clock = 0;
  // Scroll position asked for (target) and drawn (shown); null until the first setProgress.
  let target: number | null = null;
  let shown = 0;
  let settledMember = -1;
  let lastMix = "";
  // A clip level far below any portrait (no fade into the relief), and the header line as a screen height.
  const noClip = -1e3;
  let topNdc = 1;
  // The relief and header fades reach full strength over the first sixth of a slide.
  const edgeEase = 6;
  // The header's bottom edge (plus a margin) as a screen height in -1..1; read again as the canvas moves.
  const measureTop = () => {
    const height = canvas.clientHeight;
    if (height) topNdc = 1 - 2 * Math.min(height, (options.topInset?.() ?? 0) + 20) / height;
  };
  // Time the current member has had its automatic motion, counted only while running.
  let lifeElapsed = timing.life;
  let reductions = 0;
  const frameTimes: number[] = [];
  const turn = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let visibleHeight = 1;

  const life = () => 1 - THREE.MathUtils.smoothstep(lifeElapsed, timing.life - timing.settle, timing.life);

  function createPortrait(data: PortraitPoints, index: number): Portrait {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(data.colors, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(data.seeds, 4));
    const material = new THREE.ShaderMaterial({
      vertexShader: portraitVertex, fragmentShader: portraitFragment, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: clock }, uScatter: { value: 1 }, uLife: { value: life() }, uSize: { value: data.spacing }, uViewport: { value: canvas.height || 1 }, uClipY: { value: noClip }, uClip: { value: 0 }, uTopNdc: { value: topNdc }, uTop: { value: 0 } },
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.visible = false;
    points.userData.aspect = data.aspect;
    points.userData.eyeLine = portraits[index]?.eyeLine ?? options.referenceEyeLine;
    fitPortrait(points);
    group.add(points);
    return { points, material };
  }

  function removePortrait(portrait: Portrait) {
    group.remove(portrait.points);
    portrait.points.geometry.dispose();
    portrait.material.dispose();
  }

  // The eye line as a distance from the canvas top in CSS pixels, for the member drawn assembled (or null).
  const eyePoint = new THREE.Vector3();
  function eyesOnScreen(index: number) {
    const portrait = members.get(index);
    if (!portrait) return null;
    const { points } = portrait;
    eyePoint.set(0, 1 - 2 * points.userData.eyeLine, 0);
    group.updateMatrixWorld();
    points.localToWorld(eyePoint).project(camera);
    return (1 - eyePoint.y) / 2 * canvas.clientHeight;
  }

  function applyMix(delta: number) {
    if (target === null) return;
    const count = portraits.length;
    // Ease after the scroll; a jump of more than one member, a pause and reduced motion apply at once.
    if (!options.smooth || paused || Math.abs(target - shown) > 1) shown = target;
    else shown += (target - shown) * (1 - Math.exp(-delta / scrub.smoothingMilliseconds));
    if (Math.abs(target - shown) < .0005) shown = target;
    const mix = mixAt(shown, count);
    const distance = options.smooth ? scrub.distance : scrub.reducedDistance;
    // The relief level in group units (the middle of its rise), turned into each incoming portrait's own units.
    const clipLevel = base.top + base.maxRise / 2;
    for (const [index, portrait] of members) {
      const outgoing = index === mix.index;
      const incoming = index === mix.index + 1;
      const scatter = outgoing ? mix.scatter : incoming ? mix.nextScatter : 1;
      const { points, material } = portrait;
      points.position.y = points.userData.eyeOffset + (outgoing ? mix.slide * distance : incoming ? -mix.nextSlide * distance : 0);
      material.uniforms.uScatter.value = scatter;
      // Only while moving: the incoming portrait rises out of the relief, the outgoing one fades before the header.
      // Both effects ease in and out with the slide, so a portrait at rest is never cut.
      material.uniforms.uClipY.value = incoming ? (clipLevel - points.position.y) / points.scale.y : noClip;
      material.uniforms.uClip.value = incoming ? Math.min(1, mix.nextSlide * edgeEase) : 0;
      material.uniforms.uTop.value = outgoing ? Math.min(1, mix.slide * edgeEase) : 0;
      material.uniforms.uTopNdc.value = topNdc;
      points.visible = scatter < .999;
    }
    // The breathing starts again for each member that settles.
    const settled = Math.round(shown);
    if (settled !== settledMember) { settledMember = settled; lifeElapsed = 0; }
    const text = formatMix(mix);
    if (text !== lastMix) { lastMix = text; options.onMix?.(text, eyesOnScreen(settled)); }
  }

  function updateUniforms(delta: number) {
    applyMix(delta);
    const lifeValue = life();
    for (const portrait of members.values()) {
      portrait.material.uniforms.uTime.value = clock;
      portrait.material.uniforms.uLife.value = lifeValue;
    }
    rainUniforms.uTime.value = clock;
    baseMaterial.uniforms.uTime.value = clock;
    turn.x += (turn.targetX - turn.x) * .08;
    turn.y += (turn.targetY - turn.y) * .08;
    group.rotation.set(turn.y * maxTurn * .5, turn.x * maxTurn, 0);
  }

  // A wide portrait shrinks until it fits the allowed width. Then it moves so its eyes sit on the reference eye
  // line in group units (after the fit, so a shrunken portrait still lines up).
  let widthLimit = Infinity;
  function fitPortrait(points: THREE.Points) {
    const fit = Math.min(1, widthLimit / (2 * points.userData.aspect));
    points.scale.setScalar(fit);
    // The slide is added on top of this offset in applyMix.
    points.userData.eyeOffset = (1 - 2 * options.referenceEyeLine) - fit * (1 - 2 * points.userData.eyeLine);
    points.position.y = points.userData.eyeOffset;
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    visibleHeight = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visibleWidth = visibleHeight * camera.aspect;
    const narrow = camera.aspect < .9;
    const scale = narrow ? Math.min(placement.narrowHeight * visibleHeight, placement.narrowWidth * visibleWidth) / 2 : placement.wideHeight * visibleHeight / 2;
    group.scale.setScalar(scale);
    group.position.set(narrow ? 0 : visibleWidth * placement.wideRight, narrow ? visibleHeight * (.5 - placement.narrowTop) - scale : -visibleHeight * placement.wideDrop, 0);
    rainUniforms.uHeight.value = visibleHeight;
    rainUniforms.uSize.value = visibleHeight * (narrow ? .022 : .018);
    // The rain is behind the portrait plane; its dimmed band follows the portrait (about 0.8 of its height wide).
    rainUniforms.uFace.value.set(group.position.x, scale * .8);
    const columns = rainData.geometry.getAttribute("aDrop") as THREE.InstancedBufferAttribute;
    for (let index = 0; index < rainData.columnX.length; index++) columns.setX(index, rainData.columnX[index] * visibleWidth);
    columns.needsUpdate = true;
    widthLimit = (narrow ? placement.narrowWidth : placement.wideWidth) * visibleWidth / scale;
    measureTop();
    for (const portrait of members.values()) { portrait.material.uniforms.uViewport.value = canvas.height; fitPortrait(portrait.points); }
    lastMix = "";
    if (!running) draw();
  }

  function draw(delta = 0) {
    updateUniforms(delta);
    renderer.render(scene, camera);
  }

  // Lower the resolution when the median frame is slow, at most twice per visit. The dots stay: thinning them
  // would break the even halftone grid.
  function adapt(delta: number) {
    frameTimes.push(delta);
    if (frameTimes.length < 60) return;
    const median = [...frameTimes].sort((a, b) => a - b)[30];
    frameTimes.length = 0;
    if (median <= budget.slowFrameMilliseconds || reductions >= budget.maxReductions) return;
    reductions++;
    pixelRatio = Math.max(1, pixelRatio * .7);
    renderer.setPixelRatio(pixelRatio);
    resize();
  }

  function frame(now: number) {
    if (!running) return;
    const delta = lastFrame ? Math.min(50, now - lastFrame) : 16;
    lastFrame = now;
    clock += delta / 1000;
    lifeElapsed = Math.min(timing.life, lifeElapsed + delta);
    draw(delta);
    adapt(delta);
    // The rain keeps moving, so the loop runs until the section leaves the screen or the page is paused.
    raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (disposed) return;
    if (paused) { draw(); return; }
    if (running) return;
    running = true;
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }

  const onLost = (event: Event) => { event.preventDefault(); running = false; cancelAnimationFrame(raf); onContextLost(); };
  const observer = new ResizeObserver(resize);
  function release() {
    observer.disconnect();
    canvas.removeEventListener("webglcontextlost", onLost);
    for (const portrait of members.values()) removePortrait(portrait);
    members.clear();
    rainData.geometry.dispose();
    rainMaterial.dispose();
    rainGlowMaterial.dispose();
    baseLines.geometry.dispose();
    baseMaterial.dispose();
    texture.dispose();
    releaseRenderer(renderer);
  }
  try {
    canvas.addEventListener("webglcontextlost", onLost);
    observer.observe(canvas);
    resize();
    // Compile the portrait program too, with a one-point stand-in, so a shader failure shows now.
    const probe = createPortrait({ positions: new Float32Array(3), colors: new Float32Array(3), seeds: new Float32Array(4), count: 1, spacing: .01, aspect: 1 }, -1);
    probe.points.visible = true;
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    removePortrait(probe);
    if (failed()) throw new Error("About team scene failed to initialise");
  } catch (error) {
    release();
    throw error;
  }
  // Every member's data loads now, so a change rarely waits for the network.
  portraits.forEach((_, index) => { load(index).catch(() => undefined); });

  return {
    setProgress(position) {
      if (disposed) return;
      // The canvas reaches its sticky place by scrolling, so the header line is measured with the scroll.
      measureTop();
      const next = Math.min(portraits.length - 1, Math.max(0, position));
      // The first position is shown as it is, without easing in from the first member.
      if (target === null) shown = next;
      target = next;
      wake();
    },
    ready(index) {
      return disposed ? Promise.resolve() : load(index);
    },
    setPaused(next) {
      if (paused === next) return;
      paused = next;
      if (paused) { running = false; cancelAnimationFrame(raf); if (!disposed) draw(); }
      else wake();
    },
    // Paused, the portrait does not turn either.
    setPointer(x, y) {
      if (paused) return;
      turn.targetX = Math.max(-1, Math.min(1, x));
      turn.targetY = Math.max(-1, Math.min(1, y));
      wake();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      release();
    },
  };
}
