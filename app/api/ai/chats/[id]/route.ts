import { z } from "zod";
import { requireUser } from "@/lib/authz/guard";
import { MAX_CHAT_BYTES, SaveChatSchema, StoredMessageSchema, chatTitle } from "@/lib/ai/history";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const AUTH = { notConfigured: "Saving chats is not set up yet.", unauthorized: "Sign in to see your chats." };
const idOk = (id: string) => z.string().uuid().safeParse(id).success;

type Ctx = { params: Promise<{ id: string }> };

/** One whole chat. A stored message that no longer matches the current schema is dropped rather than breaking the chat. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!idOk(id)) return json({ error: "bad_request", message: "Invalid chat id." }, 400);
  const g = await requireUser(AUTH);
  if (!g.ok) return g.response;
  const { data, error } = await g.ctx.supabase.from("ai_chats").select("id, title, messages, updated_at").eq("id", id).maybeSingle();
  if (error) return json({ error: "db", message: "Could not load that chat." }, 500);
  if (!data) return json({ error: "not_found", message: "That chat no longer exists." }, 404);
  const messages = (Array.isArray(data.messages) ? data.messages : []).flatMap((m: unknown) => {
    const r = StoredMessageSchema.safeParse(m);
    return r.success ? [r.data] : [];
  });
  return json({ id: data.id, title: data.title, updated_at: data.updated_at, messages });
}

/** Replaces the messages (the browser sends the whole conversation after every turn). */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!idOk(id)) return json({ error: "bad_request", message: "Invalid chat id." }, 400);
  const g = await requireUser(AUTH);
  if (!g.ok) return g.response;

  const text = await req.text();
  if (text.length > MAX_CHAT_BYTES) return json({ error: "too_large", message: "This chat is too large to save. Start a new chat." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const parsed = SaveChatSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request", message: "That chat could not be saved." }, 400);

  const { data, error } = await g.ctx.supabase
    .from("ai_chats")
    .update({ title: parsed.data.title ?? chatTitle(parsed.data.messages), messages: parsed.data.messages })
    .eq("id", id)
    .select("id, title, updated_at")
    .maybeSingle();
  if (error) return json({ error: "db", message: "Could not save the chat." }, 500);
  if (!data) return json({ error: "not_found", message: "That chat no longer exists." }, 404);
  return json(data);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!idOk(id)) return json({ error: "bad_request", message: "Invalid chat id." }, 400);
  const g = await requireUser(AUTH);
  if (!g.ok) return g.response;
  const { data, error } = await g.ctx.supabase.from("ai_chats").delete().eq("id", id).select("id");
  if (error) return json({ error: "db", message: "Could not delete the chat." }, 500);
  if (!data?.length) return json({ error: "not_found", message: "That chat no longer exists." }, 404);
  return json({ ok: true });
}
