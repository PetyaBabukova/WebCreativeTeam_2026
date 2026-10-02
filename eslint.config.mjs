import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
export default defineConfig([
  js.configs.recommended, ...tseslint.configs.recommended,
  { files: ["**/*.{ts,tsx}"], plugins: { "@next/next": nextPlugin }, rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules } },
  globalIgnores([".next/**", "dist/**", "coverage/**", "playwright-report/**", "test-results/**", ".tmp/**", ".npm/**", ".cache/**", "next-env.d.ts"]),
]);
