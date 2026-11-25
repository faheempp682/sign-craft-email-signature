import { polishWrite } from "@/lib/polish/route";

export const runtime = "nodejs";

/** Give a claimed request back to the queue (the holder, or an admin). */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return polishWrite(req, params, {
    who: "designer",
    schema: null,
    rpc: "polish_release",
    args: (_d, id) => ({ p_id: id }),
  });
}
