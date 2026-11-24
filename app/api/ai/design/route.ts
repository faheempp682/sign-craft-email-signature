import Anthropic from "@anthropic-ai/sdk";
import { DesignError, DesignRequestSchema, generateDesign, type Complete } from "@/lib/ai/design";

export const runtime = "nodejs";

/** Per PROJECT.md: Haiku drafts JSON specs. Override with ANTHROPIC_MODEL (e.g. a bigger model for richer designs). */
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/* Stopgap abuse guard: 10 requests / minute / IP, in memory. Real per-user limits arrive with auth + the ai_usage table. */
const hits = new Map<string, number[]>();
function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return json(
      {
        error: "not_configured",
        message: "The AI is not set up yet. Add ANTHROPIC_API_KEY=your-key to a .env.local file in the project root, then restart the dev server.",
      },
      503,
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return json({ error: "rate_limited", message: "Too many requests. Please wait a minute and try again." }, 429);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const parsed = DesignRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment; never sent to the browser
  const complete: Complete = async (system, messages) => {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages,
      output_config: { effort: "low" }, // a JSON spec needs little reasoning; keeps it fast and cheap
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, stopReason: res.stop_reason };
  };

  try {
    const { doc, reply } = await generateDesign(parsed.data, complete);
    return json({ doc, reply });
  } catch (e) {
    if (e instanceof DesignError) return json({ error: e.code, message: e.message }, e.status);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "auth", message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY." }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "upstream_rate_limited", message: "The AI is busy right now. Please try again in a moment." }, 429);
    if (e instanceof Anthropic.NotFoundError) return json({ error: "model", message: `Model "${MODEL}" was not found. Check ANTHROPIC_MODEL.` }, 502);
    if (e instanceof Anthropic.APIConnectionError) return json({ error: "network", message: "Could not reach the AI service. Check your connection." }, 502);
    console.error("[ai/design] unexpected error:", e instanceof Error ? e.message : e);
    return json({ error: "unknown", message: "Something went wrong while designing. Please try again." }, 502);
  }
}
