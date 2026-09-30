import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import next from "next";
import { createApp } from "./app.js";
import { appConfig } from "../lib/config.js";

export function parsePort(value: string | undefined): number {
  if (value === undefined) return appConfig.defaultPort;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error("Invalid PORT");
  return Number(value);
}

type NextApplication = {
  prepare: () => Promise<void>;
  close: () => Promise<void>;
  getRequestHandler: () => (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
// Next's CommonJS factory is callable at runtime; its re-exported declarations
// are resolved as a namespace by NodeNext. Keep that interop at this boundary.
const createNext = next as unknown as (options: { dev: boolean }) => NextApplication;

export async function startServer(options: {
  port: number;
  dev: boolean;
  makeNext?: (dev: boolean) => NextApplication;
  shutdownMs?: number;
}): Promise<{ server: Server; stop: () => Promise<void> }> {
  const app = (options.makeNext ?? ((dev) => createNext({ dev })))(options.dev);
  let ready = false;
  const handler = app.getRequestHandler();
  const server = createServer(createApp(async (req, res) => { await handler(req, res); }, () => ready));
  try {
    await app.prepare();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, appConfig.listenHost, () => { server.off("error", reject); ready = true; resolve(); });
    });
  } catch (error) {
    await app.close();
    throw error;
  }
  let stopping: Promise<void> | undefined;
  function stop() {
    if (stopping) return stopping;
    ready = false;
    stopping = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { server.closeAllConnections(); reject(new Error("Shutdown deadline exceeded")); }, options.shutdownMs ?? 5000);
      server.close((error) => {
        void app.close().then(() => { clearTimeout(timer); if (error) reject(error); else resolve(); }, (closeError: unknown) => { clearTimeout(timer); reject(closeError); });
      });
      server.closeIdleConnections();
    });
    return stopping;
  }
  return { server, stop };
}

export async function main() {
  try {
    const { stop } = await startServer({ port: parsePort(process.env.PORT), dev: process.env.NODE_ENV === "development" });
    console.info("WebCreativeTeam server ready");
    const onSignal = () => { void stop().then(() => process.exit(0), () => process.exit(1)); };
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  } catch (error) {
    // Keep arbitrary framework/configuration error text out of production logs.
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    console.error(code === "EADDRINUSE" || code === "EACCES" ? `Server startup failed: ${code}` : "Server startup failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
