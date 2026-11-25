import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second dev server (e.g. browser tests) run without sharing, and corrupting, the main `.next` folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The rendered-previews service drives real browsers at runtime; bundling the driver would break it (and bloat the build).
  serverExternalPackages: ["playwright-core"],
};

export default nextConfig;
