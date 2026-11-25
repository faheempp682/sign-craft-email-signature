import { CommentBody } from "@/lib/polish/schemas";
import { polishWrite } from "@/lib/polish/route";

export const runtime = "nodejs";

/** Add a comment (the requester or the designer holding the request). */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return polishWrite(req, params, {
    who: "member",
    schema: CommentBody,
    rpc: "polish_comment",
    args: (d, id) => ({ p_id: id, p_body: d.body }),
    status: 201,
  });
}
