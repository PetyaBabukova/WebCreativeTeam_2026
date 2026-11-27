import * as THREE from "three";

// WebGL pieces shared by the About scenes (the hero cloud and the team portraits).
// Only the dynamically imported scene modules import this file, so three.js stays out of other routes.

// Glyph fonts are CSS font-family strings that are already loaded; null leaves dots only.
export type GlyphFonts = { letters: string; symbols: string } | null;

// Brand letters, web symbols and digits share the atlas with the soft dot in cell 0. The hero cloud uses
// letters and symbols (glyphCount); the team rain also uses the digits (allCount).
export const glyphs = { letters: "WEBCRATIVM", symbols: "</>{}#@+*", digits: "0123456789" };
export const atlas = { size: 512, cells: 8, padding: 4 };
const pixelRatioCap = { desktop: 1.5, compact: 1.25 };

// Waits for the glyph fonts for at most waitMilliseconds; a font that is still missing leaves the atlas with dots only.
export async function resolveGlyphFonts(letterFont: string, symbolFont: string, waitMilliseconds: number): Promise<GlyphFonts> {
  const loads = [document.fonts.load(`800 48px ${letterFont}`, glyphs.letters), document.fonts.load(`400 48px ${symbolFont}`, glyphs.symbols + glyphs.digits)];
  await Promise.race([Promise.allSettled(loads), new Promise((resolve) => setTimeout(resolve, waitMilliseconds))]);
  return document.fonts.check(`800 48px ${letterFont}`, glyphs.letters) && document.fonts.check(`400 48px ${symbolFont}`, glyphs.symbols + glyphs.digits) ? { letters: letterFont, symbols: symbolFont } : null;
}

// Paints the dot and every glyph white on black, one per cell, with padding so mipmaps do not bleed.
export function paintAtlas(fonts: GlyphFonts) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = atlas.size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D unavailable");
  const cell = atlas.size / atlas.cells;
  const inner = cell - atlas.padding * 2;
  context.fillStyle = "#000";
  context.fillRect(0, 0, atlas.size, atlas.size);
  const dot = context.createRadialGradient(cell / 2, cell / 2, 0, cell / 2, cell / 2, inner / 2);
  dot.addColorStop(0, "#fff");
  dot.addColorStop(.45, "#fff");
  dot.addColorStop(1, "#000");
  context.fillStyle = dot;
  context.fillRect(atlas.padding, atlas.padding, inner, inner);
  const characters = fonts ? [...glyphs.letters].map((glyph) => [glyph, fonts.letters] as const).concat([...glyphs.symbols + glyphs.digits].map((glyph) => [glyph, fonts.symbols] as const)) : [];
  context.fillStyle = "#fff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  characters.forEach(([glyph, family], index) => {
    const slot = index + 1;
    const x = (slot % atlas.cells) * cell + cell / 2;
    const y = Math.floor(slot / atlas.cells) * cell + cell / 2;
    context.font = `800 ${Math.round(inner * .82)}px ${family}`;
    context.fillText(glyph, x, y + inner * .04);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  const allCount = characters.length;
  return { texture, glyphCount: fonts ? glyphs.letters.length + glyphs.symbols.length : 0, allCount };
}

// A transparent renderer with the DPR cap. failed() reports shader compile/link errors (three.js reports
// them instead of throwing) and a lost context; callers check it after their first render.
export function createRenderer(canvas: HTMLCanvasElement, compact: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !compact, alpha: true, powerPreference: "high-performance" });
  let shaderFailed = false;
  renderer.debug.onShaderError = () => { shaderFailed = true; };
  const pixelRatio = Math.min(devicePixelRatio || 1, compact ? pixelRatioCap.compact : pixelRatioCap.desktop);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  return { renderer, pixelRatio, failed: () => shaderFailed || renderer.getContext().isContextLost() };
}

// Hands the GL context back at once instead of waiting for garbage collection.
export function releaseRenderer(renderer: THREE.WebGLRenderer) {
  renderer.dispose();
  renderer.forceContextLoss();
}
