import { z } from "zod";
import { deny, requireFeature } from "@/lib/authz/guard";
import { sameOrigin } from "@/lib/authz/origin";
import { QueueFull, RateLimiter } from "@/lib/render/limits";
import { engineStatus, renderEnabled, renderMany } from "@/lib/render/engine";
import { RENDER_TARGETS, RENDER_TARGET_IDS, VIEWPORT_IDS, VIEWPORTS } from "@/lib/render/targets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { SignatureDocSchema } from "@/lib/schema/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  doc: SignatureDocSchema,
  targets: z.array(z.enum(RENDER_TARGET_IDS)).min(1).max(RENDER_TARGET_IDS.length).default([...RENDER_TARGET_IDS]),
  viewports: z.array(z.enum(VIEWPORT_IDS)).min(1).max(VIEWPORT_IDS.length).default([...VIEWPORT_IDS]),
  dark: z.boolean().default(false),
});

const MAX_BODY = 200_000;
const perMinute = Number(process.env.RENDER_RATE_PER_MINUTE) > 0 ? Number(process.env.RENDER_RATE_PER_MINUTE) : 6;
const limiter = new RateLimiter(perMinute, 60_000);

const DISABLED_MESSAGE =
  "Real-engine previews are switched off on this server. They need a long-running Node server with browsers installed and RENDER_ENABLED=true (see docs/rendered-previews.md). The in-page previews still work.";

const noStore = { "Cache-Control": "no-store" };

/** Which engines this server can draw with. The UI uses it to enable or disable the "Render in all engines" button. */
export async function GET() {
  const g = await requireFeature("render_previews");
  if (!g.ok) return g.response;
  const s = await engineStatus();
  return Response.json(
    {
      enabled: s.enabled,
      message: s.enabled ? null : DISABLED_MESSAGE,
      engines: s.engines,
      targets: RENDER_TARGET_IDS.map((id) => ({ id, label: RENDER_TARGETS[id].label, kind: RENDER_TARGETS[id].kind, engine: RENDER_TARGETS[id].engine, represents: RENDER_TARGETS[id].represents })),
      viewports: VIEWPORT_IDS.map((id) => ({ id, ...VIEWPORTS[id] })),
    },
    { headers: noStore },
  );
}

/**
 * Draws the signature in real browser engines (Chromium, WebKit, Firefox) and in labelled simulations (Gmail clean-up, Outlook
 * Word engine), and returns PNG images as base64. The server renders the HTML itself from the validated document.
 */
export async function POST(req: Request) {
  const g = await requireFeature("render_previews");
  if (!g.ok) return g.response;
  if (!sameOrigin(req)) return deny(403, "bad_origin", "Cross-site request refused.");
  if (!renderEnabled()) return Response.json({ error: "render_disabled", message: DISABLED_MESSAGE }, { status: 503, headers: noStore });

  const wait = limiter.take(g.ctx.user.id);
  if (wait) return Response.json({ error: "rate_limited", message: `Too many render requests. Try again in ${wait} seconds.` }, { status: 429, headers: { ...noStore, "Retry-After": String(wait) } });

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return deny(413, "too_large", "That request is too large.");
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY) return deny(413, "too_large", "That request is too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return deny(400, "bad_request", "Send a JSON body.");
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return deny(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const { doc, targets, viewports, dark } = parsed.data;
  if (new Set(targets).size * new Set(viewports).size > 10) return deny(400, "bad_request", "Too many renders requested.");

  try {
    const html = renderToEmailHtml(doc);
    const r = await renderMany(html, [...new Set(targets)], [...new Set(viewports)], dark);
    return Response.json(
      {
        dark,
        results: r.results.map((x) => ({
          target: x.target,
          viewport: x.viewport,
          engine: x.engine,
          kind: x.kind,
          badge: x.kind === "real" ? "Real engine" : "Simulation",
          label: x.label,
          width: x.width,
          height: x.height,
          cached: x.cached,
          mime: "image/png",
          png: x.png.toString("base64"),
        })),
        skipped: r.skipped,
      },
      { headers: noStore },
    );
  } catch (e) {
    if (e instanceof QueueFull) return Response.json({ error: "busy", message: "The render service is busy. Try again in a moment." }, { status: 503, headers: { ...noStore, "Retry-After": "5" } });
    console.error("[render] failed:", (e as Error).message); // no document content in logs
    return deny(500, "render_failed", "The preview could not be rendered.");
  }
}
