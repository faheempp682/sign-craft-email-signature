import Anthropic from "@anthropic-ai/sdk";
import { ChatError, ChatPayloadSchema, MAX_DOC_CHARS, MAX_FILES, MAX_FILE_BYTES, generateChat, type ChatAttachment, type CompleteChat } from "@/lib/ai/chat";
import { VisionError, prepareScreenshot } from "@/lib/ai/vision";
import { openAiGate, type AiGate } from "@/lib/authz/ai-gate";

export const runtime = "nodejs";

/** Chat designs, reads images and PDFs and edits earlier work, so it uses the stronger design model. */
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const TEXT_EXT = /\.(txt|md|csv|vcf)$/i;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return json({ error: "not_configured", message: "The AI is not set up yet. Add ANTHROPIC_API_KEY=your-key to .env.local, then restart the dev server." }, 503);
  }
  const gate = await openAiGate("ai_design", req);
  if (!gate.ok) return gate.response;
  try {
    return await handle(req, gate);
  } finally {
    await gate.settle();
  }
}

/** Checks the real content of each upload (never the browser's claim) and turns it into something safe to send. */
async function prepare(file: File): Promise<ChatAttachment> {
  if (file.size === 0) throw new VisionError(`"${file.name}" is empty.`, 400, "bad_image");
  if (file.size > MAX_FILE_BYTES) throw new VisionError(`"${file.name}" is over 5 MB.`, 413, "too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return { kind: "pdf", name: file.name, data: Buffer.from(bytes) };
  if (TEXT_EXT.test(file.name) || file.type.startsWith("text/")) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\0/g, "").slice(0, MAX_DOC_CHARS);
    return { kind: "text", name: file.name, text };
  }
  return { kind: "image", name: file.name, image: await prepareScreenshot(bytes) }; // throws VisionError for anything that is not a PNG, JPG or GIF
}

async function handle(req: Request, gate: AiGate): Promise<Response> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILES * MAX_FILE_BYTES + 256 * 1024) {
    return json({ error: "too_large", message: "Those files are too large. Keep each under 5 MB." }, 413);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "bad_request", message: "Send the message as multipart form data." }, 400);
  }

  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return json({ error: "bad_request", message: "The message could not be read." }, 400);
  }
  const parsed = ChatPayloadSchema.safeParse(payloadRaw);
  if (!parsed.success) return json({ error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid message." }, 400);

  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length > MAX_FILES) return json({ error: "bad_request", message: `Attach at most ${MAX_FILES} files per message.` }, 400);
  if (!parsed.data.text && uploads.length === 0) return json({ error: "bad_request", message: "Write a message or attach a file." }, 400);

  try {
    const files = await Promise.all(uploads.map(prepare));
    const client = new Anthropic(); // reads the key from the environment; never sent to the browser
    const complete: CompleteChat = async (system, messages) => {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: messages as Anthropic.MessageParam[],
        output_config: { effort: "low" },
      });
      gate.record((res.usage?.input_tokens ?? 0) + (res.usage?.cache_creation_input_tokens ?? 0) + (res.usage?.cache_read_input_tokens ?? 0), res.usage?.output_tokens ?? 0);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { text, stopReason: res.stop_reason };
    };
    return json(await generateChat(parsed.data, files, complete));
  } catch (e) {
    if (e instanceof ChatError || e instanceof VisionError) return json({ error: e.code, message: e.message }, e.status);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "auth", message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY." }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "upstream_rate_limited", message: "The AI is busy right now. Please try again in a moment." }, 429);
    if (e instanceof Anthropic.NotFoundError) return json({ error: "model", message: `Model "${MODEL}" was not found. Check ANTHROPIC_MODEL.` }, 502);
    if (e instanceof Anthropic.APIConnectionError) return json({ error: "network", message: "Could not reach the AI service. Check your connection." }, 502);
    console.error("[ai/chat] unexpected error:", e instanceof Error ? e.message : e); // never log messages or files
    return json({ error: "unknown", message: "Something went wrong. Please try again." }, 502);
  }
}
