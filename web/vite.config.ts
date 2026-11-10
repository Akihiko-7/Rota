import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { target: "es2022", sourcemap: true },
  // The e2e tests don't need file watching (and some machines run out of watchers).
  server: process.env.E2E === "1" ? { watch: null } : {},
  test: { include: ["src/**/*.test.ts"] },
});
