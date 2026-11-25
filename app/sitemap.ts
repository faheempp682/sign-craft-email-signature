import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/site/crawl";

// Read the environment on every request, not at build time: the site switch is a deployment setting.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries();
}
