import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Next uses the automatic JSX runtime; components rendered in tests need it too.
  esbuild: { jsx: "automatic" },
  resolve: {
    // Mirror the "@/*" alias from tsconfig.json.
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
