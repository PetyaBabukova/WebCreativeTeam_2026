import type { NextConfig } from "next";
import { canonicalRedirects } from "./lib/routing";
const config: NextConfig = {
  poweredByHeader: false,
  experimental: { globalNotFound: true },
  async redirects() { return canonicalRedirects; },
};
export default config;
