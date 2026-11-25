import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { TtlCache } from "@/lib/ai/ttl-cache";
import { MAX_HINT, MAX_SCREENSHOT_BYTES, VisionError, generateFromScreenshot, prepareScreenshot, type CompleteVision, type VisionResult } from "@/lib/ai/vision";
import { openAiGate, type AiGate } from "@/lib/authz/ai-gate";

export const runtime = "nodejs";

/** Reading a picture is the one job that needs a stronger model (PROJECT.md section 8). Override with ANTHROPIC_VISION_MODEL. */
const MODEL = process.env.ANTHROPIC_VISION_MODEL || "claude-sonnet-5-5";
const MAX_OUTPUT_TOKENS = 4000;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Same picture and note, same answer: nothing is spent twice. A cached answer is also given back to the user's quota. */
const cache = new TtlCache<VisionResult>(100, 60 * 60_000);

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return json({ error: "not_configured", message: "The AI is not set up yet. Add ANTHROPIC_API_KEY=your-key to .env.local, then restart the dev server." }, 503);
  }

  // Sign-in, feature flag and per-user limits (stored in the database).
  const gate = await openAiGate("ai_vision", req);
  if (!gate.ok) return gate.response;
  try {
    return await handle(req, gate);
  } finally {
    await gate.settle();
  }
}

async function handle(req: Request, gate: AiGate): Promise<Response> {
  // Cheap early rejection before buffering the body.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_SCREENSHOT_BYTES + 64 * 1024) {
    return json({ error: "too_large", message: "That screenshot is over 5 MB. Crop it to just the signature and try again." }, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "bad_request", message: "Send the screenshot as multipart form data in a field named \"file\"." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "bad_request", message: "No screenshot was attached." }, 400);
  const rawNote = form.get("note");
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (note.length > MAX_HINT) return json({ error: "bad_request", message: `Please keep the note under ${MAX_HINT} characters.` }, 400);

  try {
    const image = await prepareScreenshot(new Uint8Array(await file.arrayBuffer()));
    const key = createHash("sha256").update(image.data).update("\n").update(note).digest("hex");
    const hit = cache.get(key);
    if (hit) return json({ ...hit, cached: true });

    const client = new Anthropic(); // reads the key from the environment; never sent to the browser
    const complete: CompleteVision = async (system, messages) => {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        // The instructions never change, so they are marked cacheable.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { effort: "medium" },
      });
      gate.record((res.usage?.input_tokens ?? 0) + (res.usage?.cache_creation_input_tokens ?? 0) + (res.usage?.cache_read_input_tokens ?? 0), res.usage?.output_tokens ?? 0);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { text, stopReason: res.stop_reason };
    };

    const result = await generateFromScreenshot(image, note || undefined, complete);
    cache.set(key, result);
    return json({ ...result, cached: false });
  } catch (e) {
    if (e instanceof VisionError) return json({ error: e.code, message: e.message }, e.status);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "auth", message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY." }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "upstream_rate_limited", message: "The AI is busy right now. Please try again in a moment." }, 429);
    if (e instanceof Anthropic.NotFoundError) return json({ error: "model", message: `Model "${MODEL}" was not found. Check ANTHROPIC_VISION_MODEL.` }, 502);
    if (e instanceof Anthropic.APIConnectionError) return json({ error: "network", message: "Could not reach the AI service. Check your connection." }, 502);
    console.error("[ai/vision] unexpected error:", e instanceof Error ? e.message : e); // never log the image or the note
    return json({ error: "unknown", message: "Something went wrong while reading the screenshot. Please try again." }, 502);
  }
}
