import { defaultDeps, handleBanner } from "@/lib/campaigns/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public. The banner image for the campaign a signed token names (see docs/campaigns-and-analytics.md). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleBanner(req, (await params).token, defaultDeps());
}

export const HEAD = GET;
