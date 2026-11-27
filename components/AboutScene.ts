import * as THREE from "three";
import { atlas, createRenderer, paintAtlas, releaseRenderer, type GlyphFonts } from "./aboutGl";

export { glyphs, resolveGlyphFonts, type GlyphFonts } from "./aboutGl";

// The About hero's particle cloud. It owns the WebGL renderer and every GPU resource;
// AboutPage owns when it runs. Loaded with a dynamic import so three.js stays out of other routes.

// setCollapse(0..1) pulls the cloud into a narrow column as the hero scrolls away.
export type AboutScene = { start(): void; setPaused(paused: boolean): void; setCollapse(value: number): void; dispose(): void };
type Options = { canvas: HTMLCanvasElement; compact: boolean; glyphFonts: GlyphFonts; onContextLost: () => void };

const palette = ["#ef7f1a", "#ff9a42", "#ffbd65", "#ffd688", "#fff4db", "#fefefe", "#e3dc73", "#a3db64", "#68d58a", "#749728", "#59b300", "#ff6600"];
const glowPalette = ["#ff9a42", "#a3db64", "#ffd688"];
const budget = { desktop: 6000, compact: 1500, slowFrameMilliseconds: 25, maxReductions: 2 };
// Share of the particles drawn as glyphs instead of dots.
const glyphShare = .3;
// Near particles never grow beyond this on screen, whatever their depth.
const maxParticlePixels = 26;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uOffset;
  uniform float uSpread;
  uniform float uCells;
  uniform float uViewport;
  uniform float uMaxPixels;
  uniform float uCollapse;
  attribute vec4 aSeed;
  attribute vec3 aColor;
  attribute float aScale;
  attribute float aGlow;
  attribute float aGlyph;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vGlow;
  varying float vDot;
  varying float vDepth;

  vec3 flow(vec4 s, float t) {
    float angle = s.x * 6.2831 + t * (0.12 + s.w * 0.18);
    float radius = (0.9 + s.y * s.y * 3.0) * uSpread;
    float height = (s.z - 0.5) * 2.6 * uSpread;
    vec3 p = vec3(cos(angle) * radius, height + sin(angle * 1.7 + s.w * 6.0) * 0.6, sin(angle) * radius * 0.75);
    p += 0.55 * vec3(sin(p.y * 1.3 + t * 0.6 + s.w * 4.0), sin(p.z * 1.1 + t * 0.5), sin(p.x * 1.2 - t * 0.4));
    float twist = height * 0.35 + t * 0.05;
    p.xz = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * p.xz;
    return p;
  }

  void main() {
    vec3 swirl = flow(aSeed, uTime);
    // On scroll the swirl narrows into a tall column above the centre and keeps turning.
    vec3 stem = vec3(swirl.x * 0.15, swirl.y * 1.4 + 0.3, swirl.z * 0.15);
    vec4 view = modelViewMatrix * vec4(mix(swirl, stem, smoothstep(0.0, 1.0, uCollapse)) + uOffset, 1.0);
    // Camera-facing quad; symbols turn slowly around the view axis.
    float spin = aGlyph > 0.5 ? aSeed.w * 6.2831 + uTime * (aSeed.w - 0.5) * 0.8 : 0.0;
    vec2 corner = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * position.xy;
    float pixelsPerUnit = projectionMatrix[1][1] * uViewport * 0.5 / max(-view.z, 0.1);
    view.xy += corner * min(aScale, uMaxPixels / pixelsPerUnit);
    float column = mod(aGlyph, uCells);
    float row = floor(aGlyph / uCells);
    vUv = (vec2(column, row) + vec2(uv.x, 1.0 - uv.y)) / uCells;
    vColor = aColor;
    vGlow = aGlow;
    vDot = aGlyph < 0.5 ? 1.0 : 0.0;
    vDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uFocus;
  // Shared with the vertex shader, so it must use the same (high) precision to link.
  uniform highp float uCollapse;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vGlow;
  varying float vDot;
  varying float vDepth;

  void main() {
    float mask = texture2D(uAtlas, vUv).r;
    // Alpha test keeps shapes crisp without sorting; dots keep a softer rim through a lower threshold.
    if (mask < mix(0.5, 0.18, vDot)) discard;
    float depthFade = 1.0 - smoothstep(uFocus - 3.5, uFocus + 6.0, vDepth);
    // Far particles vanish instead of painting black silhouettes over the background.
    if (depthFade < 0.08) discard;
    vec3 color = vColor * mix(1.0, mask, vDot) * (1.0 + vGlow * 0.8) * (1.0 - 0.4 * uCollapse);
    gl_FragColor = vec4(color * depthFade * depthFade, 1.0);
    #include <colorspace_fragment>
  }
`;

function attributes(count: number, glyphCount: number) {
  const seeds = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const glows = new Float32Array(count);
  const shapes = new Float32Array(count);
  const color = new THREE.Color();
  let seed = 2026;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let index = 0; index < count; index++) {
    for (let part = 0; part < 4; part++) seeds[index * 4 + part] = random();
    const glowing = random() < .03;
    const glyph = glyphCount > 0 && random() < glyphShare ? 1 + Math.floor(random() * glyphCount) : 0;
    color.set(glowing ? glowPalette[Math.floor(random() * glowPalette.length)] : palette[Math.floor(random() * palette.length)]);
    color.toArray(colors, index * 3);
    // World units: about 4–8px for dots and 14–24px for symbols at the desktop camera distance, capped on screen.
    scales[index] = glyph ? .13 + random() * .09 : (glowing ? .065 : .035) + random() * .04;
    glows[index] = glowing ? 1 : 0;
    shapes[index] = glyph;
  }
  return { seeds, colors, scales, glows, shapes };
}

// Throws when WebGL is unavailable or a shader fails; the caller then keeps the static hero.
export function createAboutScene(options: Options): AboutScene {
  const gl = createRenderer(options.canvas, options.compact);
  // Buffers, textures and programs reach the GPU only on the first render, which buildScene guards itself;
  // any earlier failure only has to release the context.
  try {
    return buildScene(gl, options);
  } catch (error) {
    gl.renderer.dispose();
    throw error;
  }
}

function buildScene({ renderer, pixelRatio: initialRatio, failed }: ReturnType<typeof createRenderer>, { canvas, compact, glyphFonts, onContextLost }: Options): AboutScene {
  let pixelRatio = initialRatio;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 60);
  camera.position.set(0, 0, 13);

  const count = compact ? budget.compact : budget.desktop;
  const { texture, glyphCount } = paintAtlas(glyphFonts);
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry().copy(quad as unknown as THREE.InstancedBufferGeometry);
  quad.dispose();
  const data = attributes(count, glyphCount);
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(data.seeds, 4));
  geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(data.colors, 3));
  geometry.setAttribute("aScale", new THREE.InstancedBufferAttribute(data.scales, 1));
  geometry.setAttribute("aGlow", new THREE.InstancedBufferAttribute(data.glows, 1));
  geometry.setAttribute("aGlyph", new THREE.InstancedBufferAttribute(data.shapes, 1));
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: { uTime: { value: 0 }, uOffset: { value: new THREE.Vector3() }, uSpread: { value: 1 }, uFocus: { value: 13 }, uCells: { value: atlas.cells }, uAtlas: { value: texture }, uViewport: { value: 1 }, uMaxPixels: { value: maxParticlePixels }, uCollapse: { value: 0 } },
  });
  const cloud = new THREE.Mesh(geometry, material);
  cloud.frustumCulled = false;
  scene.add(cloud);

  let raf = 0;
  let running = false;
  let paused = false;
  let started = false;
  let disposed = false;
  let lastFrame = 0;
  let reductions = 0;
  const frameTimes: number[] = [];

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    material.uniforms.uViewport.value = height;
    camera.aspect = width / height;
    // Keep the cloud in the upper half: portrait screens move the camera back instead of cropping it.
    camera.position.z = 13 / Math.min(1, Math.max(.78, camera.aspect * 1.5));
    camera.updateProjectionMatrix();
    material.uniforms.uFocus.value = camera.position.z;
    material.uniforms.uSpread.value = Math.min(1, Math.max(.75, camera.aspect * .75));
    material.uniforms.uOffset.value.set(0, camera.aspect < 1 ? 2.2 : 1.25, 0);
    if (!running) renderer.render(scene, camera);
  }

  // Halve the particles when the median frame is slow, at most twice per visit.
  function adapt(delta: number) {
    frameTimes.push(delta);
    if (frameTimes.length < 60) return;
    const median = [...frameTimes].sort((a, b) => a - b)[30];
    frameTimes.length = 0;
    if (median <= budget.slowFrameMilliseconds || reductions >= budget.maxReductions) return;
    reductions++;
    geometry.instanceCount = Math.max(1, Math.floor(geometry.instanceCount / 2));
    pixelRatio = Math.max(.75, pixelRatio * .7);
    renderer.setPixelRatio(pixelRatio);
    resize();
  }

  function frame(now: number) {
    if (!running) return;
    const delta = lastFrame ? Math.min(50, now - lastFrame) : 16;
    lastFrame = now;
    material.uniforms.uTime.value += delta / 1000;
    renderer.render(scene, camera);
    adapt(delta);
    raf = requestAnimationFrame(frame);
  }

  function sync() {
    const shouldRun = started && !paused && !disposed;
    if (shouldRun === running) return;
    running = shouldRun;
    lastFrame = 0;
    frameTimes.length = 0;
    cancelAnimationFrame(raf);
    if (running) raf = requestAnimationFrame(frame);
  }

  const onLost = (event: Event) => { event.preventDefault(); started = false; sync(); onContextLost(); };
  const observer = new ResizeObserver(resize);
  function release() {
    observer.disconnect();
    canvas.removeEventListener("webglcontextlost", onLost);
    geometry.dispose();
    material.dispose();
    texture.dispose();
    releaseRenderer(renderer);
  }
  try {
    canvas.addEventListener("webglcontextlost", onLost);
    observer.observe(canvas);
    resize();
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    if (failed()) throw new Error("About scene failed to initialise");
  } catch (error) {
    release();
    throw error;
  }

  return {
    start() { started = true; sync(); },
    setPaused(next) { paused = next; sync(); },
    // A paused cloud still follows the scroll: one frame is drawn with the new shape.
    setCollapse(value) {
      if (disposed || material.uniforms.uCollapse.value === value) return;
      material.uniforms.uCollapse.value = value;
      if (!running) renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sync();
      release();
    },
  };
}
