import type { DarkMode } from "@/lib/render/dark";
import { prepareHtml, type Pipeline } from "@/lib/render/simulate";
import type { RenderTargetId } from "@/lib/render/targets";

export type ClientId = "gmail" | "outlook" | "outlook-win" | "apple-mail" | "thunderbird" | "mobile";

/**
 * How honest each in-page preview is. The page always draws with Chrome, so nothing in a live frame is another browser's engine.
 *  simulation     the HTML is rewritten to mimic the client's documented behaviour first (never "real Outlook" or "real Gmail").
 *  approximation  plain Chrome in a pane with that client's colours, font and width. The real engine is only available through
 *                 the render service ("Render in all engines"), see `realTarget`.
 */
export type Fidelity = "simulation" | "approximation";

type ClientStyle = {
  /** Short tab label. Simulations say so. */
  label: string;
  /** Pixel width of the preview frame. null = fill the available width. */
  width: number | null;
  font: string;
  size: string;
  light: { bg: string; ink: string };
  dark: { bg: string; ink: string };
  fidelity: Fidelity;
  /** Badge text shown next to the preview. */
  badge: string;
  /** One sentence on exactly what is real and what is not. */
  note: string;
  /** HTML rewrite applied before drawing. */
  pipeline: Pipeline;
  /** Automatic dark-mode model applied when dark is on. */
  darkMode: DarkMode;
  /** The render-service target that draws this client's real engine, when there is one. */
  realTarget: RenderTargetId | null;
};

/**
 * Message-pane look (page colour, default font, pane width) plus what we do to the HTML for each client. Pane colours and fonts
 * are approximations. See lib/render/* for the sources behind each simulation and docs/rendered-previews.md.
 */
export const CLIENTS: Record<ClientId, ClientStyle> = {
  gmail: {
    label: "Gmail (sim.)",
    width: null,
    font: "Arial, Helvetica, sans-serif",
    size: "13px",
    light: { bg: "#ffffff", ink: "#202124" },
    // Gmail on the web keeps the message body light in dark theme (Google, "CSS support in Gmail").
    dark: { bg: "#ffffff", ink: "#202124" },
    fidelity: "simulation",
    badge: "Simulation",
    note: "Chrome draws the HTML after a simulation of Gmail's clean-up. Not real Gmail.",
    pipeline: "gmail",
    darkMode: "none",
    realTarget: "gmail-sim",
  },
  outlook: {
    label: "Outlook web",
    width: null,
    font: "Calibri, 'Segoe UI', Arial, sans-serif",
    size: "14.67px", // 11pt, Outlook's default
    light: { bg: "#ffffff", ink: "#242424" },
    dark: { bg: "#292929", ink: "#ffffff" },
    fidelity: "approximation",
    badge: "Approximation in Chrome",
    note: "Outlook on the web and the new Outlook use a browser engine. Chrome in an Outlook-coloured pane; their own HTML clean-up is not simulated. Dark mode is simulated.",
    pipeline: "none",
    darkMode: "partial",
    realTarget: "chromium",
  },
  "outlook-win": {
    label: "Outlook Win (sim.)",
    width: null,
    font: "Calibri, 'Segoe UI', Arial, sans-serif",
    size: "14.67px",
    light: { bg: "#ffffff", ink: "#242424" },
    dark: { bg: "#292929", ink: "#ffffff" },
    fidelity: "simulation",
    badge: "Simulation",
    note: "Simulation of Outlook for Windows (Word engine) from documented rules. Not real Outlook: confirm in a real one.",
    pipeline: "outlook-word",
    darkMode: "full",
    realTarget: "outlook-word-sim",
  },
  "apple-mail": {
    label: "Apple Mail",
    width: null,
    font: "-apple-system, Helvetica, Arial, sans-serif",
    size: "14px",
    light: { bg: "#ffffff", ink: "#000000" },
    dark: { bg: "#1e1e1e", ink: "#ffffff" },
    fidelity: "approximation",
    badge: "Approximation in Chrome",
    note: "Apple Mail uses WebKit, but this frame is Chrome. Use Render in all engines for the real WebKit image.",
    pipeline: "none",
    darkMode: "none",
    realTarget: "webkit",
  },
  thunderbird: {
    label: "Thunderbird",
    width: null,
    font: "system-ui, Arial, sans-serif",
    size: "15px",
    light: { bg: "#ffffff", ink: "#15141a" },
    dark: { bg: "#1c1b22", ink: "#fbfbfe" },
    fidelity: "approximation",
    badge: "Approximation in Chrome",
    note: "Thunderbird uses Gecko, but this frame is Chrome. Use Render in all engines for the real Firefox/Gecko image.",
    pipeline: "none",
    darkMode: "none",
    realTarget: "firefox",
  },
  mobile: {
    label: "Mobile",
    width: 375,
    font: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    size: "16px",
    light: { bg: "#ffffff", ink: "#000000" },
    dark: { bg: "#000000", ink: "#ffffff" },
    fidelity: "approximation",
    badge: "Approximation in Chrome",
    note: "A 375px-wide pane in Chrome with a partial dark-mode simulation. Not a phone app.",
    pipeline: "none",
    darkMode: "partial",
    realTarget: "webkit",
  },
};

export const CLIENT_IDS = Object.keys(CLIENTS) as ClientId[];

/** The signature HTML as this client's preview should draw it (simulation and dark mode applied, structure unchanged). */
export function clientHtml(html: string, client: ClientId, dark: boolean): string {
  const c = CLIENTS[client];
  return prepareHtml(html, c.pipeline, dark ? c.darkMode : "none").html;
}

export function previewDocument(html: string, client: ClientId, dark: boolean): string {
  const c = CLIENTS[client];
  const t = dark ? c.dark : c.light;
  const margin = c.width ? 14 : 24;
  return `<!doctype html><html><body style="margin:${margin}px;background:${t.bg};color:${t.ink};font-family:${c.font};font-size:${c.size};">${clientHtml(html, client, dark)}</body></html>`;
}
