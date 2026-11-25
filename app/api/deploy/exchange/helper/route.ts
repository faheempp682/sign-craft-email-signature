import { directoryExportScript } from "@/lib/deploy/exchange";
import { deployAdmin, noStore } from "@/lib/deploy/route";

export const runtime = "nodejs";

/** The read-only PowerShell helper that exports directory attributes to a CSV the people import accepts. Static text. */
export async function GET(req: Request) {
  const a = await deployAdmin(req, null);
  if (!a.ok) return a.response;
  return Response.json({ generated_not_run: true, script: directoryExportScript() }, { headers: noStore });
}
