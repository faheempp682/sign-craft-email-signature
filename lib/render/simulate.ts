import { simulateDark, type DarkMode } from "./dark";
import { simulateGmail } from "./gmail-sanitize";
import { declaredWidth } from "./html-tools";
import { simulateOutlookWord, type Change } from "./outlook-word";
import type { RenderTarget, ViewportId } from "./targets";
import { VIEWPORTS } from "./targets";

export type Pipeline = "none" | "gmail" | "outlook-word";

/** Runs a client simulation (or nothing) and then the dark-mode model. Pure, so it runs in the browser and on the server. */
export function prepareHtml(html: string, pipeline: Pipeline, dark: DarkMode): { html: string; changes: Change[] } {
  const first = pipeline === "gmail" ? simulateGmail(html) : pipeline === "outlook-word" ? simulateOutlookWord(html) : { html, changes: [] as Change[] };
  const second = simulateDark(first.html, dark);
  return { html: second.html, changes: [...first.changes, ...second.changes] };
}

const esc = (s: string) => s.replace(/"/g, "&quot;");

/**
 * The complete page the render service draws. A Content-Security-Policy meta tag blocks everything except inline styles and
 * images, as a second layer behind the route interception and the disabled JavaScript in engine.ts.
 */
export function buildRenderDocument(html: string, target: RenderTarget, viewport: ViewportId, dark: boolean): { doc: string; changes: Change[] } {
  const vp = VIEWPORTS[viewport];
  const prepared = prepareHtml(html, target.pipeline, dark ? target.dark : "none");
  const t = dark ? target.pane.dark : target.pane.light;
  const margin = viewport === "phone" ? 14 : 24;
  const width = declaredWidth(prepared.html);
  const inner = vp.width - margin * 2;
  const zoom = vp.fit && width && width > inner ? Math.max(0.2, inner / width) : 1;
  const csp = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'";
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><style>html{overflow-x:hidden}</style></head><body style="margin:${margin}px;background:${t.bg};color:${t.ink};font-family:${esc(target.pane.font)};font-size:${target.pane.size};"><div style="${zoom < 1 ? `zoom:${zoom.toFixed(4)};` : ""}">${prepared.html}</div></body></html>`;
  return { doc, changes: prepared.changes };
}
