import { EMPTY_DETAILS, type Details } from "./fill";

/** The details survive moving between the create screens (and a refresh), but not closing the tab. */
const KEY = "signcraft:create-details:v1";

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveDetails(d: Details): boolean {
  try {
    store()?.setItem(KEY, JSON.stringify(d));
    return !!store();
  } catch {
    return false;
  }
}

/** Null when nothing usable was saved. Unknown or non-string fields are dropped, missing ones become empty. */
export function loadDetails(): Details | null {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const out = { ...EMPTY_DETAILS };
    for (const k of Object.keys(EMPTY_DETAILS) as (keyof Details)[]) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === "string") out[k] = v.slice(0, 300);
    }
    return out.name.trim() ? out : null;
  } catch {
    return null;
  }
}

/** Called when a signature is finished, so the next one starts blank (it may be for a different person). */
export function clearDetails(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* nothing useful to do */
  }
}
