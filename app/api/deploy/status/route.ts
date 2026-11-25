import { deployStatus } from "@/lib/deploy/config";
import { deployAdmin, noStore } from "@/lib/deploy/route";

export const runtime = "nodejs";

/** Whether Gmail deployment is set up on this server, and what to do if not. Never returns the key. */
export async function GET(req: Request) {
  const a = await deployAdmin(req, null);
  if (!a.ok) return a.response;
  return Response.json(deployStatus(), { headers: noStore });
}
