import { defineConfig } from "vitest/config";

// `vite build` -> dist/pay.js: one self-registering, dependency-free IIFE.
export default defineConfig({
  build: {
    target: "es2020",
    minify: true,
    emptyOutDir: true,
    lib: {
      entry: "src/script.ts",
      name: "Zap",
      formats: ["iife"],
      fileName: () => "pay.js",
    },
  },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
  },
});
