import { STATE_COOKIE, STATE_TTL_MS } from "./state";

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** HttpOnly so scripts cannot read it; limited to /api/google; Lax so it comes back when Google redirects the browser here. */
export function stateCookie(value: string, secure: boolean): string {
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(STATE_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;
}

export const clearStateCookie = (secure: boolean): string => `${STATE_COOKIE}=; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

/** Back to a page in the app with a short outcome code in the address, which the page shows and then removes. */
export function backTo(origin: string, next: string, code: string, extraHeaders: Record<string, string> = {}): Response {
  const u = new URL(next, origin);
  u.searchParams.set("gmail", code);
  return new Response(null, { status: 302, headers: { Location: u.toString(), "Cache-Control": "no-store", ...extraHeaders } });
}
