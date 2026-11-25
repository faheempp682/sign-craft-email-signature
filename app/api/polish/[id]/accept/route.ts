import { AcceptBody } from "@/lib/polish/schemas";
import { polishWrite } from "@/lib/polish/route";

export const runtime = "nodejs";

/** The requester accepts the delivery: saved as a new signature, or replacing the original after explicit confirmation. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return polishWrite(req, params, {
    who: "member",
    schema: AcceptBody,
    rpc: "polish_accept",
    args: (d, id) => ({ p_id: id, p_mode: d.mode, p_name: d.name ?? null, p_confirm_replace: d.confirmReplace === true }),
  });
}
