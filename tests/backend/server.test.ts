import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, parsePort, startServer } from "../../server/index.js";
import { appConfig, localOrigin } from "../../lib/config.js";
import { pageUrl } from "../../lib/routing.js";

const mockNext = vi.hoisted(() => vi.fn());
vi.mock("next", () => ({ default: mockNext }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); process.exitCode = 0; });

function nextApp() {
  return { prepare: vi.fn(async () => {}), close: vi.fn(async () => {}), getRequestHandler: () => async (_req: unknown, res: import("node:http").ServerResponse) => { res.end("Next page"); } };
}

describe("server lifecycle", () => {
  it("validates ports including boundaries", () => {
    expect(parsePort(undefined)).toBe(appConfig.defaultPort);
    expect(parsePort("1")).toBe(1); expect(parsePort("65535")).toBe(65535);
    for (const value of ["", "0", "65536", "-1", "3.5", "3000x", " 3000", "Infinity"]) expect(() => parsePort(value)).toThrow("Invalid PORT");
  });
  it("waits for Next prepare before binding and stops idempotently", async () => {
    const app = nextApp();
    let prepare!: () => void;
    app.prepare.mockImplementation(() => new Promise<void>((resolve) => { prepare = resolve; }));
    const starting = startServer({ port: 0, dev: false, makeNext: () => app });
    let started = false; void starting.then(() => { started = true; });
    await Promise.resolve(); expect(started).toBe(false); prepare();
    const running = await starting;
    const port = (running.server.address() as AddressInfo).port;
    expect(await (await fetch(new URL(appConfig.paths.health, localOrigin(appConfig.testHost, port)))).json()).toEqual({ status: "ok" });
    expect(await (await fetch(new URL(pageUrl("home", "bg"), localOrigin(appConfig.testHost, port)))).text()).toBe("Next page");
    const first = running.stop(); expect(running.stop()).toBe(first); await first;
    expect(app.close).toHaveBeenCalledOnce(); expect(running.server.listening).toBe(false);
  });
  it("closes Next after prepare failure", async () => {
    const app = nextApp(); app.prepare.mockRejectedValue(new Error("prepare failed"));
    await expect(startServer({ port: 0, dev: false, makeNext: () => app })).rejects.toThrow("prepare failed");
    expect(app.close).toHaveBeenCalledOnce();
  });
  it("fails safely on an occupied port", async () => {
    const occupied = createServer(); await new Promise<void>((resolve) => occupied.listen(0, appConfig.listenHost, resolve));
    const app = nextApp();
    try { await expect(startServer({ port: (occupied.address() as AddressInfo).port, dev: false, makeNext: () => app })).rejects.toThrow(); expect(app.close).toHaveBeenCalledOnce(); }
    finally { await new Promise<void>((resolve) => occupied.close(() => resolve())); }
  });
  it("rejects shutdown when Next cleanup fails", async () => {
    const app = nextApp(); app.close.mockRejectedValue(new Error("close failed"));
    const running = await startServer({ port: 0, dev: false, makeNext: () => app });
    await expect(running.stop()).rejects.toThrow("close failed");
  });
  it("enforces a deadline even if Next cleanup never finishes", async () => {
    const app = nextApp(); app.close.mockImplementation(() => new Promise(() => {}));
    const running = await startServer({ port: 0, dev: false, makeNext: () => app, shutdownMs: 20 });
    await expect(running.stop()).rejects.toThrow("Shutdown deadline exceeded");
  });
  it("main reports safe startup failure with an unsuccessful exit code", async () => {
    vi.stubEnv("PORT", "invalid"); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await main(); expect(process.exitCode).toBe(1); expect(log).toHaveBeenCalledWith("Server startup failed");
  });
  it("main installs signal handlers and exits after cleanup", async () => {
    const probe = createServer(); await new Promise<void>((r) => probe.listen(0, r));
    const port = (probe.address() as AddressInfo).port; await new Promise<void>((r) => probe.close(() => r()));
    vi.stubEnv("PORT", String(port)); vi.stubEnv("NODE_ENV", "development");
    const app = nextApp(); mockNext.mockReturnValue(app);
    const handlers: Record<string, () => void> = {};
    const originalOnce = process.once.bind(process);
    vi.spyOn(process, "once").mockImplementation(((event: string, handler: () => void) => {
      if (event === "SIGINT" || event === "SIGTERM") { handlers[event] = handler; return process; }
      return originalOnce(event, handler);
    }) as typeof process.once);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "info").mockImplementation(() => {});
    await main(); expect(mockNext).toHaveBeenCalledWith({ dev: true });
    handlers.SIGTERM();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });
});
