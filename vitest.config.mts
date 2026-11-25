import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  // Next.js compiles JSX itself (tsconfig says "preserve"), so tell the test transform to handle it.
  oxc: { jsx: { runtime: "automatic" } },
  // Component tests opt in to a browser-like DOM with a "// @vitest-environment jsdom" comment.
  test: { environment: "node" },
});
