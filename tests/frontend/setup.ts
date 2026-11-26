import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
vi.mock("next/font/google", () => ({ Sofia_Sans: () => ({ variable: "font-sofia-sans-test" }), IBM_Plex_Mono: () => ({ variable: "font-about-counter-test" }), Sofia_Sans_Extra_Condensed: () => ({ variable: "font-about-logo-test" }) }));
vi.stubGlobal("IntersectionObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});
vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});
afterEach(cleanup);
