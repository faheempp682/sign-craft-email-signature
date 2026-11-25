import { DeliverBody } from "@/lib/polish/schemas";
import { polishWrite } from "@/lib/polish/route";

export const runtime = "nodejs";

/** The designer holding the request delivers the polished document with a short change note. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return polishWrite(req, params, {
    who: "designer",
    schema: DeliverBody,
    rpc: "polish_deliver",
    args: (d, id) => ({ p_id: id, p_doc: d.doc, p_change_note: d.changeNote }),
  });
}
