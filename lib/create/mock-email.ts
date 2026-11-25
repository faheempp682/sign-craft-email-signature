import { CLIENTS, clientHtml, type ClientId } from "@/lib/preview-clients";

/**
 * A made-up email around the signature, so a customer sees it where it will really live: grey skeleton bars stand in for the
 * sender, the subject and a few lines of text, and the signature sits at the bottom. The pane colours, font and width, and the
 * HTML clean-up for the chosen client, come from the same table the editor's preview uses (lib/preview-clients.ts).
 */
export function mockEmailDocument(signatureHtml: string, client: ClientId, dark: boolean): string {
  const c = CLIENTS[client];
  const t = dark ? c.dark : c.light;
  const bar = dark ? "rgba(255,255,255,.16)" : "rgba(0,0,0,.08)";
  const line = (w: number, h = 10) => `<div style="height:${h}px;width:${w}%;background:${bar};border-radius:${h / 2}px;margin:0 0 10px"></div>`;
  const pad = c.width ? 16 : 28;
  return `<!doctype html><html><body style="margin:0;background:${t.bg};color:${t.ink};font-family:${c.font};font-size:${c.size};">
<div data-mock="email" style="padding:${pad}px">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">
    <div style="width:40px;height:40px;border-radius:50%;background:${bar};flex:none"></div>
    <div style="flex:1">${line(34)}${line(52, 8)}</div>
  </div>
  ${line(58, 16)}
  <div style="height:8px"></div>
  ${line(96)}${line(88)}${line(92)}${line(46)}
  <div style="height:10px"></div>
  ${line(90)}${line(64)}
  <div data-mock="signature" style="margin-top:26px">${clientHtml(signatureHtml, client, dark)}</div>
</div></body></html>`;
}
