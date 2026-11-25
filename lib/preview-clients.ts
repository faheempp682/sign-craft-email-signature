export type ClientId = "gmail" | "outlook" | "mobile";

type ClientStyle = {
  label: string;
  /** Pixel width of the preview frame. null = fill the available width. */
  width: number | null;
  font: string;
  size: string;
  light: { bg: string; ink: string };
  dark: { bg: string; ink: string };
};

/**
 * Approximations of each client's message pane (page colour, default font, pane width). They are NOT the clients'
 * real rendering engines, so Outlook desktop's Word engine quirks will not show here. Always send a real test email.
 */
export const CLIENTS: Record<ClientId, ClientStyle> = {
  gmail: {
    label: "Gmail",
    width: null,
    font: "Arial, Helvetica, sans-serif",
    size: "13px",
    light: { bg: "#ffffff", ink: "#202124" },
    dark: { bg: "#202124", ink: "#e8eaed" },
  },
  outlook: {
    label: "Outlook",
    width: null,
    font: "Calibri, 'Segoe UI', Arial, sans-serif",
    size: "14.67px", // 11pt, Outlook's default
    light: { bg: "#ffffff", ink: "#242424" },
    dark: { bg: "#292929", ink: "#ffffff" },
  },
  mobile: {
    label: "Mobile",
    width: 375,
    font: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    size: "16px",
    light: { bg: "#ffffff", ink: "#000000" },
    dark: { bg: "#000000", ink: "#ffffff" },
  },
};

export const CLIENT_IDS = Object.keys(CLIENTS) as ClientId[];

export function previewDocument(html: string, client: ClientId, dark: boolean): string {
  const c = CLIENTS[client];
  const t = dark ? c.dark : c.light;
  const margin = c.width ? 14 : 24;
  return `<!doctype html><html><body style="margin:${margin}px;background:${t.bg};color:${t.ink};font-family:${c.font};font-size:${c.size};">${html}</body></html>`;
}
