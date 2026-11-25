// Runs the client test pack generator (scripts/client-pack.test.ts) with its output directory set. Cross-platform, no extra deps.
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["vitest", "run", "scripts/client-pack.test.ts"], { stdio: "inherit", shell: true, env: { ...process.env, CLIENT_PACK_DIR: process.env.CLIENT_PACK_DIR ?? "client-pack" } });
if (r.status === 0) console.log("\nWrote client-pack/index.html. Open it in a browser and follow docs/client-testing.md.");
process.exit(r.status ?? 1);
