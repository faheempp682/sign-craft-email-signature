import { simulateDark, type DarkMode } from "./dark";
import { simulateGmail } from "./gmail-sanitize";
import { countMatches, declaredWidth } from "./html-tools";
import { simulateOutlookWord, type Change } from "./outlook-word";

/**
 * "Known differences": what will look different from the intended design in each client, worked out from THIS signature's HTML
 * so the person knows before testing. It is derived from the same documented rules as the simulations (see outlook-word.ts,
 * gmail-sanitize.ts, dark.ts for sources); it is a prediction, not a measurement of the real client.
 */

export type DifferenceClient = "gmail" | "outlook" | "outlook-win" | "apple-mail" | "thunderbird" | "mobile";
export type Difference = { id: string; severity: "visible" | "minor" | "note"; text: string; source?: string };

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const pick = (changes: Change[], code: string) => changes.find((c) => c.code === code)?.count ?? 0;

const SRC = {
  ms: "Microsoft, Word 2007 HTML and CSS Rendering Capabilities in Outlook 2007",
  eoa: "Email on Acid, Outlook desktop tips",
  gmail: "Google, CSS support in Gmail",
  litmus: "Litmus, Dark mode for email guide",
  msdn: "Microsoft Support, Block or unblock automatic picture downloads in email messages",
};

/** Dark-mode behaviour per client, from the Litmus chart cited in dark.ts. */
export const CLIENT_DARK_MODE: Record<DifferenceClient, DarkMode> = {
  gmail: "none",
  outlook: "partial",
  "outlook-win": "full",
  "apple-mail": "none",
  thunderbird: "none",
  mobile: "partial",
};

export function knownDifferences(html: string, client: DifferenceClient): Difference[] {
  const out: Difference[] = [];
  const add = (d: Difference) => out.push(d);
  const images = countMatches(html, /<img\b/gi);
  const width = declaredWidth(html);

  if (client === "outlook-win") {
    const { changes } = simulateOutlookWord(html);
    const radius = pick(changes, "border-radius");
    if (radius) add({ id: "radius", severity: "visible", text: `${plural(radius, "rounded corner")} will be square. Circular and arched photos become squares.`, source: SRC.ms });
    const bgImg = pick(changes, "background-image") + pick(changes, "background-image-attr");
    if (bgImg) add({ id: "bgimg", severity: "visible", text: `${plural(bgImg, "background image")} will not show. Only a plain background colour is kept.`, source: SRC.ms });
    const grad = pick(changes, "gradient");
    if (grad) add({ id: "gradient", severity: "visible", text: `${plural(grad, "gradient")} will become flat colour or disappear.`, source: SRC.ms });
    const sizeless = pick(changes, "img-css-size");
    if (sizeless) add({ id: "imgsize", severity: "visible", text: `${plural(sizeless, "image")} sized only by CSS will show at its natural size. Give every image width and height attributes.`, source: SRC.eoa });
    const pad = pick(changes, "padding-unsupported") + pick(changes, "img-margin-padding") + pick(changes, "margin-unsupported");
    if (pad) add({ id: "spacing", severity: "minor", text: `Spacing from ${plural(pad, "padding or margin rule")} on non-table elements is ignored, so gaps can shrink.`, source: SRC.ms });
    const wrap = pick(changes, "overflow-wrap");
    if (wrap) add({ id: "wrap", severity: "minor", text: "Very long unbroken text (a long email address, say) is not forced to wrap and can stretch the layout.", source: SRC.ms });
    const sizeBlock = pick(changes, "size-on-block");
    if (sizeBlock) add({ id: "blocksize", severity: "minor", text: `Width or height on ${plural(sizeBlock, "text block")} is ignored. Only tables, cells and images take a size.`, source: SRC.ms });
    const gifs = pick(changes, "animated-gif");
    if (gifs) add({ id: "gif", severity: "visible", text: `${plural(gifs, "animated GIF")} will show only a still image. Make the first frame carry the message.`, source: SRC.ms });
    const other = pick(changes, "other-unsupported") + pick(changes, "shadow") + pick(changes, "opacity") + pick(changes, "overflow") + pick(changes, "max-width") + pick(changes, "float-position");
    if (other) add({ id: "other", severity: "minor", text: `${plural(other, "other style rule")} (shadows, opacity, max-width and similar) will be ignored.`, source: SRC.ms });
    if (images) add({ id: "pictures", severity: "note", text: "Pictures are not downloaded until the reader allows it, so photos and logos show as empty boxes at first.", source: SRC.msdn });
    add({ id: "engine", severity: "note", text: "Drawn here by Chrome after the rules above are applied. Real Outlook also differs in line height, font fallback and DPI scaling. Confirm in real Outlook." });
  }

  if (client === "gmail") {
    const { changes } = simulateGmail(html);
    const n = changes.reduce((a, c) => a + c.count, 0);
    if (n) add({ id: "gmail-strip", severity: "minor", text: `Gmail removes or rewrites ${plural(n, "thing")} in this signature (${changes.map((c) => c.code).join(", ")}).`, source: SRC.gmail });
    if (images) add({ id: "gmail-images", severity: "note", text: "Images load through Google's image proxy and can stay hidden until the reader allows them.", source: SRC.gmail });
    if (html.length > 100 * 1024) add({ id: "clip", severity: "visible", text: "Gmail clips messages over about 102 KB; this signature alone is close to that.", source: SRC.gmail });
    add({ id: "gmail-web-dark", severity: "note", text: "On the web, Gmail keeps the message body light even in dark theme. The Gmail apps recolour it automatically.", source: SRC.gmail });
  }

  if (client === "outlook") {
    add({ id: "owa-engine", severity: "note", text: "Outlook on the web and the new Outlook use a browser engine, so layout is close to Chrome. Their own HTML clean-up is not simulated." });
    if (images) add({ id: "owa-images", severity: "note", text: "Remote pictures can be blocked until the reader allows them.", source: SRC.msdn });
  }

  if (client === "apple-mail") add({ id: "apple", severity: "note", text: "Apple Mail draws HTML with WebKit and changes very little. Use Render in all engines to see the real WebKit output." });
  if (client === "thunderbird") add({ id: "tb", severity: "note", text: "Thunderbird draws HTML with Gecko (the Firefox engine). Use Render in all engines to see the real Gecko output." });

  if (client === "mobile" || client === "apple-mail") {
    if (width && width > 375) add({ id: "narrow", severity: "visible", text: `The signature is ${width}px wide. A phone pane is about 375px, so it will be scaled down or scroll sideways depending on the app.` });
  }

  const dark = CLIENT_DARK_MODE[client];
  if (dark !== "none") {
    const { changes } = simulateDark(html, dark);
    const bg = pick(changes, "dark-background-darkened") + pick(changes, "dark-background-inverted");
    const tx = pick(changes, "dark-text-lightened") + pick(changes, "dark-text-inverted");
    if (bg || tx)
      add({
        id: "dark",
        severity: "minor",
        text: `In dark mode ${dark === "full" ? "this client inverts both light and dark colours" : "this client darkens light backgrounds"}: about ${plural(bg, "background")} and ${plural(tx, "text colour")} would change. Images keep their colours, so a dark logo on a transparent background can disappear.`,
        source: SRC.litmus,
      });
  } else if (client !== "outlook-win" && client !== "gmail") {
    add({ id: "dark-none", severity: "note", text: "No automatic colour change in dark mode here, so a white signature card can look bright on a dark pane.", source: SRC.litmus });
  }

  return out;
}
