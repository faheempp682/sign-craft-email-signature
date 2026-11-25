import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  // Next.js compiles JSX itself (tsconfig says "preserve"), so tell the test transform to handle it.
  oxc: { jsx: { runtime: "automatic" } },
  // Component tests opt in to a browser-like DOM with a "// @vitest-environment jsdom" comment.
  test: {
    environment: "node",
    // Each *.db.test.ts boots its own Postgres (PGlite, WebAssembly). With one worker per CPU core (20 here) several of them
    // die at startup with exit code 2147483651 / 134, a different set each run. 8 was stable over repeated full runs.
    maxWorkers: 8,
  },
});
