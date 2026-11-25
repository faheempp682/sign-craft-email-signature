import { polishWrite } from "@/lib/polish/route";

export const runtime = "nodejs";

/** Claim an open request (designers and admins). Race-safe: the database lets exactly one designer win. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return polishWrite(req, params, {
    who: "designer",
    schema: null,
    rpc: "polish_claim",
    args: (_d, id) => ({ p_id: id }),
  });
}
