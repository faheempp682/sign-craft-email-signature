/**
 * Scale a preview document down so a signature wider than the pane fits instead of scrolling sideways, as real mobile
 * mail does (shrink-to-fit). Preview DOM only, never the exported HTML. Needs a same-origin (script-free) iframe.
 */
export function fitFrameToWidth(f: HTMLIFrameElement | null): void {
  const doc = f?.contentDocument;
  if (!f || !doc?.body) return;
  doc.body.style.zoom = "";
  const need = doc.documentElement.scrollWidth;
  const have = f.clientWidth;
  if (need > have && have > 0) doc.body.style.zoom = String(have / need);
}
