import { polishWrite } from "@/lib/polish/route";

export const runtime = "nodejs";

/** The requester withdraws an open request. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return polishWrite(req, params, {
    who: "member",
    schema: null,
    rpc: "polish_cancel",
    args: (_d, id) => ({ p_id: id }),
  });
}
