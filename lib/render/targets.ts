/**
 * What the render service can produce. Safe to import from the browser (no Node imports).
 *
 * "real"        the signature HTML, untouched, drawn by that real browser engine.
 * "simulation"  the signature HTML rewritten to mimic a client, then drawn by Chromium. Never real Outlook or real Gmail.
 */

export const ENGINES = ["chromium", "webkit", "firefox"] as const;
export type EngineId = (typeof ENGINES)[number];

export const RENDER_TARGET_IDS = ["chromium", "webkit", "firefox", "gmail-sim", "outlook-word-sim"] as const;
export type RenderTargetId = (typeof RENDER_TARGET_IDS)[number];

export type DarkModel = "none" | "partial" | "full";

export type RenderTarget = {
  id: RenderTargetId;
  /** Shown above the image. */
  label: string;
  engine: EngineId;
  kind: "real" | "simulation";
  /** Which real clients this stands for, and how closely. */
  represents: string;
  /** How the HTML is changed before drawing. */
  pipeline: "none" | "gmail" | "outlook-word";
  /** Dark-mode model applied when dark is requested. */
  dark: DarkModel;
  /** Pane (message area) look: approximate, not a copy of any client's chrome. */
  pane: { font: string; size: string; light: { bg: string; ink: string }; dark: { bg: string; ink: string } };
};

const ARIAL = "Arial, Helvetica, sans-serif";

export const RENDER_TARGETS: Record<RenderTargetId, RenderTarget> = {
  chromium: {
    id: "chromium",
    label: "Chromium (Blink)",
    engine: "chromium",
    kind: "real",
    represents: "The engine behind Gmail on the web and Outlook.com, Chrome and Edge. Those clients clean up the HTML first, so see the Gmail simulation too.",
    pipeline: "none",
    dark: "none",
    pane: { font: ARIAL, size: "13px", light: { bg: "#ffffff", ink: "#202124" }, dark: { bg: "#202124", ink: "#e8eaed" } },
  },
  webkit: {
    id: "webkit",
    label: "WebKit",
    engine: "webkit",
    kind: "real",
    represents: "The engine Apple Mail on macOS and Mail on iPhone and iPad use.",
    pipeline: "none",
    dark: "none",
    pane: { font: "-apple-system, Helvetica, Arial, sans-serif", size: "14px", light: { bg: "#ffffff", ink: "#000000" }, dark: { bg: "#1e1e1e", ink: "#ffffff" } },
  },
  firefox: {
    id: "firefox",
    label: "Firefox (Gecko)",
    engine: "firefox",
    kind: "real",
    represents: "The engine Thunderbird uses.",
    pipeline: "none",
    dark: "none",
    pane: { font: "system-ui, Arial, sans-serif", size: "15px", light: { bg: "#ffffff", ink: "#15141a" }, dark: { bg: "#1c1b22", ink: "#fbfbfe" } },
  },
  "gmail-sim": {
    id: "gmail-sim",
    label: "Gmail clean-up (simulation)",
    engine: "chromium",
    kind: "simulation",
    represents: "Chromium drawing the HTML after a simulation of what Gmail strips or rewrites. Not real Gmail.",
    pipeline: "gmail",
    dark: "none",
    pane: { font: ARIAL, size: "13px", light: { bg: "#ffffff", ink: "#202124" }, dark: { bg: "#ffffff", ink: "#202124" } },
  },
  "outlook-word-sim": {
    id: "outlook-word-sim",
    label: "Outlook for Windows (simulation)",
    engine: "chromium",
    kind: "simulation",
    represents: "Chromium drawing the HTML after a simulation of Microsoft Word's rendering rules. Not real Outlook.",
    pipeline: "outlook-word",
    dark: "full",
    pane: { font: "Calibri, 'Segoe UI', Arial, sans-serif", size: "14.67px", light: { bg: "#ffffff", ink: "#242424" }, dark: { bg: "#292929", ink: "#ffffff" } },
  },
};

export const VIEWPORT_IDS = ["desktop", "phone"] as const;
export type ViewportId = (typeof VIEWPORT_IDS)[number];
export const VIEWPORTS: Record<ViewportId, { label: string; width: number; scale: number; fit: boolean }> = {
  desktop: { label: "Desktop 680px", width: 680, scale: 1, fit: false },
  // On a phone the pane is narrow, so the signature is zoomed out to fit. Real apps differ (some scale, some scroll sideways).
  phone: { label: "Phone 375px", width: 375, scale: 2, fit: true },
};

export const MAX_RENDER_HEIGHT = 1600;
