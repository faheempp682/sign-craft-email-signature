import { requireUser } from "@/lib/authz/guard";
import { MAX_CHAT_BYTES, SaveChatSchema, chatTitle } from "@/lib/ai/history";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const AUTH = { notConfigured: "Saving chats is not set up yet. Add the Supabase variables to .env.local.", unauthorized: "Sign in to see your chats." };

/** Newest first. Only the caller's own chats: row-level security enforces it. */
export async function GET() {
  const g = await requireUser(AUTH);
  if (!g.ok) return g.response;
  const { data, error } = await g.ctx.supabase.from("ai_chats").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(50);
  if (error) return json({ error: "db", message: "Could not load your chats." }, 500);
  return json({ chats: data ?? [] });
}

/** Starts a saved chat. */
export async function POST(req: Request) {
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
    .insert({ title: parsed.data.title ?? chatTitle(parsed.data.messages), messages: parsed.data.messages })
    .select("id, title, updated_at")
    .single();
  if (error) return json({ error: "db", message: "Could not save the chat." }, 500);
  return json(data, 201);
}
