import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { AutofillError, AutofillRequestSchema, extractFacts, pageSource, textSource, type AutofillResult } from "@/lib/ai/autofill";
import type { Complete } from "@/lib/ai/design";
import { FetchError, checkUrl, fetchPage, type FetchErrorCode } from "@/lib/ai/fetch-page";
import { digestPage } from "@/lib/ai/html-text";
import { matchesHost } from "@/lib/ai/social";
import { TtlCache } from "@/lib/ai/ttl-cache";
import { openAiGate, type AiGate } from "@/lib/authz/ai-gate";

export const runtime = "nodejs";

/** Extraction is a cheap, structured task (PROJECT.md section 8), so it uses Haiku regardless of the design model. */
const MODEL = process.env.ANTHROPIC_AUTOFILL_MODEL || "claude-haiku-5-5";
const MAX_OUTPUT_TOKENS = 700;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

type Cached = AutofillResult & { source: { type: "text" | "url"; host?: string; truncated: boolean } };
const cache = new TtlCache<Cached>(200, 60 * 60_000);

const FETCH_STATUS: Record<FetchErrorCode, number> = { invalid_url: 400, blocked: 422, unsupported: 422, timeout: 504, http_error: 502, network: 502, too_many_redirects: 502 };

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return json({ error: "not_configured", message: "The AI is not set up yet. Add ANTHROPIC_API_KEY=your-key to .env.local, then restart the dev server." }, 503);
  }

  // Sign-in, feature flag and per-user limits (stored in the database). A cached answer costs nothing, so it is given back below.
  const gate = await openAiGate("ai_autofill", req);
  if (!gate.ok) return gate.response;
  try {
    return await handle(req, gate);
  } finally {
    await gate.settle();
  }
}

async function handle(req: Request, gate: AiGate): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const parsed = AutofillRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
  const request = parsed.data;

  /* ---- work out the cache key (and validate the address) before spending anything ---- */
  let key: string;
  let pageUrl = "";
  if (request.type === "url") {
    try {
      const url = checkUrl(request.url);
      if (matchesHost(url.toString(), ["linkedin.com"])) {
        return json({ error: "linkedin", message: "LinkedIn does not allow automated reading of profiles. Open the profile, copy the text, and use \"Paste text\" instead." }, 422);
      }
      pageUrl = url.toString();
    } catch (e) {
      if (e instanceof FetchError) return json({ error: e.code, message: e.message }, FETCH_STATUS[e.code]);
      throw e;
    }
    key = createHash("sha256").update(`url\n${pageUrl}`).digest("hex");
  } else {
    key = createHash("sha256").update(`text\n${request.text.replace(/\s+/g, " ")}`).digest("hex");
  }

  const hit = cache.get(key);
  if (hit) return json({ ...hit, cached: true });

  /* ---- build the source the model will read ---- */
  let source;
  if (request.type === "url") {
    try {
      const page = await fetchPage(pageUrl);
      source = pageSource(digestPage(page.html, page.url), page.url, page.truncated);
    } catch (e) {
      if (e instanceof FetchError) return json({ error: e.code, message: e.message }, FETCH_STATUS[e.code]);
      throw e;
    }
  } else {
    source = textSource(request.text);
  }

  /* ---- extract ---- */
  const client = new Anthropic(); // reads the key from the environment; never sent to the browser
  const complete: Complete = async (system, messages) => {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // The instructions never change, so they are marked cacheable. (Short prompts fall under the model's minimum
      // cacheable size and are simply billed normally; the marker is harmless then.)
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort: "low" },
    });
    gate.record((res.usage?.input_tokens ?? 0) + (res.usage?.cache_creation_input_tokens ?? 0) + (res.usage?.cache_read_input_tokens ?? 0), res.usage?.output_tokens ?? 0);
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, stopReason: res.stop_reason };
  };

  try {
    const result = await extractFacts(source, complete);
    const payload: Cached = { ...result, source: { type: source.kind, host: source.host, truncated: source.truncated } };
    cache.set(key, payload);
    return json({ ...payload, cached: false });
  } catch (e) {
    if (e instanceof AutofillError) return json({ error: e.code, message: e.message }, e.status);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "auth", message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY." }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "upstream_rate_limited", message: "The AI is busy right now. Please try again in a moment." }, 429);
    if (e instanceof Anthropic.NotFoundError) return json({ error: "model", message: `Model "${MODEL}" was not found. Check ANTHROPIC_AUTOFILL_MODEL.` }, 502);
    if (e instanceof Anthropic.APIConnectionError) return json({ error: "network", message: "Could not reach the AI service. Check your connection." }, 502);
    console.error("[ai/autofill] unexpected error:", e instanceof Error ? e.message : e); // never log the pasted content
    return json({ error: "unknown", message: "Something went wrong while reading the details. Please try again." }, 502);
  }
}
