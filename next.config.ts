import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second dev server (e.g. browser tests) run without sharing, and corrupting, the main `.next` folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
