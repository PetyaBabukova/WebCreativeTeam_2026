import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AboutTeam, { memberAt, teamProgress, type TeamCopy } from "@/components/AboutTeam";
import { mixAt, samplePortrait } from "@/components/AboutTeamScene";

// A width × height RGBA image filled by a per-pixel function.
function image(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("samplePortrait", () => {
  it("lays the dots on an even hexagonal grid and skips the transparent background", () => {
    // Left half opaque, right half transparent.
    const color = image(40, 40, (x) => [128, 128, 128, x < 20 ? 255 : 0]);
    const depth = image(40, 40, () => [128, 128, 128, 255]);
    const points = samplePortrait(color, depth, 10_000, 20);
    const xs = Array.from({ length: points.count }, (_, index) => points.positions[index * 3]);
    // Nothing from the transparent half (x > 0 in portrait units, since the portrait is centred).
    expect(Math.max(...xs)).toBeLessThan(0);
    // Two rows: the second starts half a step to the right of the first.
    const rows = new Map<number, number[]>();
    for (let index = 0; index < points.count; index++) {
      const y = points.positions[index * 3 + 1].toFixed(4);
      rows.set(Number(y), [...(rows.get(Number(y)) ?? []), points.positions[index * 3]]);
    }
    const [first, second] = [...rows.values()];
    const step = first[1] - first[0];
    expect(step).toBeCloseTo(points.spacing, 5);
    expect(second[0] - first[0]).toBeCloseTo(step / 2, 5);
  });

  it("never exceeds the point budget, however fine the requested grid", () => {
    const color = image(200, 200, () => [200, 200, 200, 255]);
    const depth = image(200, 200, () => [128, 128, 128, 255]);
    expect(samplePortrait(color, depth, 500, 400).count).toBeLessThanOrEqual(500);
  });

  it("stretches the photo's lightness, lights nearer points more and fades the lower edge", () => {
    // A dim photo (lightness 40..80 of 255): the stretch still reaches full white on the lightest, nearest points.
    const color = image(60, 60, (x) => { const v = 40 + Math.round(x / 59 * 40); return [v, v, v, 255]; });
    const near = image(60, 60, () => [255, 255, 255, 255]);
    const far = image(60, 60, () => [0, 0, 0, 255]);
    const tones = (points: ReturnType<typeof samplePortrait>) => Array.from({ length: points.count }, (_, index) => points.colors[index * 3 + 1]);
    const lit = samplePortrait(color, near, 10_000, 30);
    expect(Math.max(...tones(lit))).toBeGreaterThan(.9);
    // Same photo, everything far away: darker.
    expect(Math.max(...tones(samplePortrait(color, far, 10_000, 30)))).toBeLessThan(Math.max(...tones(lit)) * .6);
    // The bottom row has faded out.
    const bottom = Math.min(...Array.from({ length: lit.count }, (_, index) => lit.positions[index * 3 + 1]));
    const bottomTones = Array.from({ length: lit.count }, (_, index) => index).filter((index) => lit.positions[index * 3 + 1] === bottom).map((index) => lit.colors[index * 3 + 1]);
    expect(Math.max(...bottomTones)).toBeLessThan(.05);
  });

  it("refuses a portrait with no subject", () => {
    const empty = image(10, 10, () => [0, 0, 0, 0]);
    expect(() => samplePortrait(empty, empty, 100, 10)).toThrow();
  });
});

describe("AboutTeam", () => {
  const member = (id: string, name: string) => ({ id, name, role: `${name} role`, bio: `${name} bio` });
  const copy: TeamCopy = {
    heading: "Team", next: "Next team member: {name}", first: "Back to the first team member: {name}", position: "{current} of {total}", portraitAlt: "Portrait of {name}",
    members: [member("a", "Ann"), member("b", "Bo"), member("c", "Cy"), member("d", "Dee")],
  };

  // jsdom has neither media queries nor observers; a tall screen with scripting gets the scroll stage.
  const screenWith = (features: string[]) => (query: string) => ({ matches: features.some((feature) => query.includes(feature)), media: query, addEventListener() {}, removeEventListener() {} });
  beforeEach(() => {
    vi.stubGlobal("matchMedia", screenWith(["scripting"]));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("takes its members, count and order from the copy alone, so a new member needs no code", () => {
    const { container } = render(<AboutTeam copy={copy} />);
    const items = within(container.querySelector(".about-team__members")!).getAllByRole("listitem");
    expect(items.map((item) => within(item).getByRole("heading", { level: 3 }).textContent)).toEqual(["Ann", "Bo", "Cy", "Dee"]);
    expect(container.querySelector(".about-team__counter")!.textContent).toBe("01 / 04");
    expect(container.querySelectorAll(".about-team__progress span")).toHaveLength(4);
    expect(screen.getByAltText("Portrait of Dee")).toBeInTheDocument();
    expect(screen.getByText("4 of 4")).toBeInTheDocument();
    // Three scroll steps after the first screen.
    expect(container.querySelector<HTMLElement>(".about-team")!.style.getPropertyValue("--about-team-steps")).toBe("3");
  });

  it("serves the undecided markup, and the client settles on the photo-less scroll stage before the next paint", () => {
    // The server leaves the choice to CSS (stage with scripting, cards without), with the next button hidden.
    const html = renderToString(<AboutTeam copy={copy} />);
    expect(html).toContain('data-about-team="auto"');
    // A layout effect, not a later effect, so no frame shows a state between the two.
    const { container } = render(<AboutTeam copy={copy} />);
    const section = container.querySelector(".about-team")!;
    expect(section.getAttribute("data-about-team")).toBe("preparing");
    // The next button waits for the scene, so it does not join the tab order early.
    expect(container.querySelector(".about-team__next")).toHaveAttribute("hidden");
  });

  it("keeps the cards on a very short screen and in a browser that cannot tell whether scripting is on", () => {
    // Without the scripting media feature the CSS never showed the stage, so the client must not either.
    for (const features of [["scripting", "height"], []]) {
      vi.stubGlobal("matchMedia", screenWith(features));
      const { container, unmount } = render(<AboutTeam copy={copy} />);
      expect(container.querySelector(".about-team")!.getAttribute("data-about-team")).toBe("cards");
      expect(container.querySelector(".about-team__next")).toHaveAttribute("hidden");
      unmount();
    }
  });
});

describe("team scroll mapping", () => {
  it("maps the section's scroll range to 0..1 and stays put without a range", () => {
    // Section at 1000px, 3000px tall, 1000px screen: 2000px of travel.
    expect(teamProgress(500, 1000, 3000, 1000)).toBe(0);
    expect(teamProgress(2000, 1000, 3000, 1000)).toBe(.5);
    expect(teamProgress(9000, 1000, 3000, 1000)).toBe(1);
    expect(teamProgress(2000, 1000, 800, 1000)).toBe(0);
  });

  it("switches members only well past the middle, so stopping on a boundary does not flicker", () => {
    expect(memberAt(.39, 0, 3)).toBe(0);
    expect(memberAt(.45, 0, 3)).toBe(0);
    expect(memberAt(.54, 0, 3)).toBe(0);
    expect(memberAt(.56, 0, 3)).toBe(1);
    // Coming back up, the later member holds the same band.
    expect(memberAt(.46, 1, 3)).toBe(1);
    expect(memberAt(.44, 1, 3)).toBe(0);
  });

  it("lands on the nearest member after a jump, without stepping through the ones in between", () => {
    // From the first member straight into the band between the second and the third.
    expect(memberAt(1.5, 0, 3)).toBe(2);
    expect(memberAt(2, 0, 3)).toBe(2);
    expect(memberAt(0, 2, 3)).toBe(0);
  });
});

describe("portrait mix along the scroll", () => {
  const round = (mix: ReturnType<typeof mixAt>) => ({ index: mix.index, scatter: Number(mix.scatter.toFixed(2)), nextScatter: Number(mix.nextScatter.toFixed(2)) });

  it("holds a member whole, then scatters it while the next one assembles, and holds the next one whole", () => {
    expect(round(mixAt(0, 3))).toEqual({ index: 0, scatter: 0, nextScatter: 1 });
    expect(round(mixAt(.3, 3))).toEqual({ index: 0, scatter: 0, nextScatter: 1 });
    // The hand-over: both portraits partly scattered, like sand pouring from one into the other.
    const middle = mixAt(.5, 3);
    expect(middle.scatter).toBeGreaterThan(.5);
    expect(middle.scatter).toBeLessThan(1);
    expect(middle.nextScatter).toBeGreaterThan(.5);
    expect(middle.nextScatter).toBeLessThan(1);
    expect(round(mixAt(.6, 3)).scatter).toBe(1);
    expect(round(mixAt(.7, 3))).toEqual({ index: 0, scatter: 1, nextScatter: 0 });
    expect(round(mixAt(1, 3))).toEqual({ index: 1, scatter: 0, nextScatter: 1 });
  });

  it("follows the scroll both ways: the same position always gives the same mix", () => {
    // Scrolling back through a hand-over reverses it step by step: the next portrait scatters again.
    const back = [.7, .65, .6, .55, .5, .45, .4].map((position) => mixAt(position, 3).nextScatter);
    expect(back).toEqual([...back].sort((a, b) => a - b));
    expect(back[0]).toBe(0);
    expect(back.at(-1)).toBe(1);
    // Scatter grows monotonically through a hand-over.
    const scatters = [.3, .35, .4, .45, .5, .55, .6].map((position) => mixAt(position, 3).scatter);
    expect(scatters).toEqual([...scatters].sort((a, b) => a - b));
  });

  it("ends on the last member whole and clamps outside the range", () => {
    expect(round(mixAt(2, 3))).toEqual({ index: 1, scatter: 1, nextScatter: 0 });
    expect(round(mixAt(9, 3))).toEqual({ index: 1, scatter: 1, nextScatter: 0 });
    expect(round(mixAt(-1, 3))).toEqual({ index: 0, scatter: 0, nextScatter: 1 });
    expect(round(mixAt(0, 1))).toEqual({ index: 0, scatter: 0, nextScatter: 1 });
  });
});
