// Generates the word-wrap check pages with vitest, then runs the browser check against them.
// Needs a Chrome or Edge install (set CHROME_PATH if it is not found). Output goes to wrap-check/ (git-ignored).
import { spawnSync } from "node:child_process";

const env = { ...process.env, WRAP_CHECK_DIR: process.env.WRAP_CHECK_DIR ?? "wrap-check" };
const gen = spawnSync("npx", ["vitest", "run", "scripts/wrap-check.test.ts"], { stdio: "inherit", shell: true, env });
if (gen.status !== 0) process.exit(gen.status ?? 1);
const run = spawnSync("node", ["--test", "e2e/word-wrap.e2e.mjs"], { stdio: "inherit", shell: true, env });
process.exit(run.status ?? 1);
