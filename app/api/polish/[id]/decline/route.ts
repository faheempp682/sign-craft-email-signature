import { DeclineBody } from "@/lib/polish/schemas";
import { polishWrite } from "@/lib/polish/route";

export const runtime = "nodejs";

/** The requester declines the delivery with a reason, reopening the request or closing it. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return polishWrite(req, params, {
    who: "member",
    schema: DeclineBody,
    rpc: "polish_decline",
    args: (d, id) => ({ p_id: id, p_reason: d.reason, p_reopen: d.reopen }),
  });
}
