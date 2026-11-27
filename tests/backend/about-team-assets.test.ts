import { describe, expect, it } from "vitest";
import { cropBox, depthInputSize, models, normaliseDepth, resizeFloat, subjectBox, toMaskBytes } from "../../scripts/about-team-assets";

describe("about team asset preparation", () => {
  it("crops by fractions without running past the photo", () => {
    expect(cropBox({ left: .2, top: .1, width: .8, height: .5 }, 1000, 2000)).toEqual({ left: 200, top: 200, width: 800, height: 1000 });
    expect(cropBox({ left: .5, top: .5, width: 1, height: 1 }, 100, 100)).toEqual({ left: 50, top: 50, width: 50, height: 50 });
  });

  it("sizes the depth input with the shorter side at the model size and both sides multiples of 14", () => {
    const size = depthInputSize(1536, 3000, models.depth);
    expect(size.width % 14).toBe(0);
    expect(size.height % 14).toBe(0);
    expect(Math.abs(size.width - 518)).toBeLessThanOrEqual(7);
    expect(size.height).toBeGreaterThan(size.width);
  });

  it("resizes the depth map without wrapping or shifting values", () => {
    // A left-to-right ramp must stay a monotonic ramp (a 16-bit round trip once scrambled it).
    const width = 8, height = 2;
    const values = Float32Array.from({ length: width * height }, (_, index) => (index % width) * 10);
    const out = resizeFloat({ values, width, height }, 4, 1);
    expect(Array.from(out)).toEqual([...out].sort((a, b) => a - b));
    expect(out[0]).toBeGreaterThanOrEqual(0);
    expect(out[3]).toBeLessThanOrEqual(70);
    expect(out[3] - out[0]).toBeGreaterThan(40);
  });

  it("stretches the subject's depth to 1..255 with nearer lighter, and leaves the background at 0", () => {
    const depth = Float32Array.from([5, 10, 15, 999]);
    const alpha = Uint8Array.from([255, 255, 255, 0]);
    expect(Array.from(normaliseDepth(depth, alpha))).toEqual([1, 128, 255, 0]);
  });

  it("turns model logits into a mask and keeps probabilities as they are", () => {
    expect(Array.from(toMaskBytes(Float32Array.from([-20, 0, 20])))).toEqual([0, 128, 255]);
    expect(Array.from(toMaskBytes(Float32Array.from([0, .5, 1])))).toEqual([0, 128, 255]);
  });

  it("boxes the subject with a margin and refuses an empty mask", () => {
    const alpha = new Uint8Array(100 * 100);
    for (let y = 40; y < 60; y++) for (let x = 30; x < 50; x++) alpha[y * 100 + x] = 255;
    expect(subjectBox(alpha, 100, 100)).toEqual({ left: 27, top: 37, width: 26, height: 26 });
    expect(() => subjectBox(new Uint8Array(100), 10, 10)).toThrow();
  });
});
