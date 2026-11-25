import { defaultDeps, handleClick } from "@/lib/campaigns/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public. Logs a click and redirects to the https target stored with the campaign or signed into the token. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleClick(req, (await params).token, defaultDeps());
}

export const HEAD = GET;
