import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
vi.mock("next/font/google", () => ({ Sofia_Sans: () => ({ variable: "font-sofia-sans-test" }) }));
vi.stubGlobal("IntersectionObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});
afterEach(cleanup);
