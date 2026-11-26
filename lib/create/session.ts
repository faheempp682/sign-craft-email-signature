import { getStorage, isDraftDoc, loadDraft } from "@/lib/editor/draft";
import type { SignatureDoc } from "@/lib/schema/document";
import type { Brand } from "./brand";
import { EMPTY_DETAILS, type Details, type SlotImage } from "./fill";

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

/** Whatever was saved, even half filled in (no name yet). Unknown or non-string fields are dropped, missing ones become empty. Null when nothing was saved. */
export function loadDraftDetails(): Details | null {
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
    return out;
  } catch {
    return null;
  }
}

/** Null when nothing usable was saved: the later steps need at least a name. */
export function loadDetails(): Details | null {
  const d = loadDraftDetails();
  return d && d.name.trim() ? d : null;
}

const IMAGES_KEY = "signcraft:create-images:v3";

/** The photos, logos and banners the person added, by slot number, so they are not asked again on the next template or after a refresh. */
export function saveImages(images: Record<string, SlotImage>): void {
  try {
    if (Object.keys(images).length) store()?.setItem(IMAGES_KEY, JSON.stringify(images));
    else store()?.removeItem(IMAGES_KEY);
  } catch {
    /* nothing useful to do */
  }
}

export function loadImages(): Record<string, SlotImage> {
  try {
    const raw = store()?.getItem(IMAGES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, SlotImage> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const o = v as Partial<SlotImage> | null;
      if (!/^(avatar|banner)\d+$/.test(k) || !o || typeof o.url !== "string" || !o.url.startsWith("https://")) continue;
      const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : undefined);
      out[k] = { url: o.url, fit: o.fit === "contain" ? "contain" : "cover", width: num(o.width), height: num(o.height) };
    }
    return out;
  } catch {
    return {};
  }
}

const BRAND_KEY = "signcraft:create-brand:v2";

/** The colours read from the logo, whether to use them, and which one leads. */
export function saveBrand(brand: Brand | null): void {
  try {
    if (brand && brand.palette.length) store()?.setItem(BRAND_KEY, JSON.stringify(brand));
    else store()?.removeItem(BRAND_KEY);
  } catch {
    /* nothing useful to do */
  }
}

export function loadBrand(): Brand | null {
  try {
    const raw = store()?.getItem(BRAND_KEY);
    const o = raw ? (JSON.parse(raw) as Partial<Brand>) : null;
    if (!o || !Array.isArray(o.palette)) return null;
    const palette = o.palette.filter((c): c is string => typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c)).slice(0, 4);
    if (!palette.length) return null;
    const pick = typeof o.pick === "number" && o.pick >= 0 && o.pick < palette.length ? o.pick : 0;
    return { on: o.on !== false, palette, pick };
  } catch {
    return null;
  }
}

const HANDOFF_KEY = "signcraft:create-handoff:v1";
const CUSTOM_KEY = "signcraft:create-custom:v1";

/** Set just before opening the editor from the studio, so coming back knows to pick up what was changed there. */
export function markHandoff(templateId: string): void {
  try {
    store()?.setItem(HANDOFF_KEY, templateId);
  } catch {
    /* nothing useful to do */
  }
}

/** The design as customised in the editor (kept for this tab), or null. Pass null to forget it (a different template, or start over). */
export function saveCustom(doc: SignatureDoc | null): void {
  try {
    if (doc) store()?.setItem(CUSTOM_KEY, JSON.stringify(doc));
    else store()?.removeItem(CUSTOM_KEY);
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Back from the editor: the editor keeps its work as a draft, so take that (once) when we just handed this template over.
 * Otherwise, the customised design kept earlier for this template, so a refresh does not lose it.
 */
export function loadCustom(templateId: string): SignatureDoc | null {
  try {
    if (store()?.getItem(HANDOFF_KEY) === templateId) {
      store()?.removeItem(HANDOFF_KEY);
      const storage = getStorage();
      const draft = storage ? loadDraft(storage) : null;
      if (draft && draft.doc.template_id === templateId) {
        saveCustom(draft.doc);
        return draft.doc;
      }
    }
    const raw = store()?.getItem(CUSTOM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isDraftDoc(parsed) && parsed.template_id === templateId ? parsed : null;
  } catch {
    return null;
  }
}

/** Called when a signature is finished, so the next one starts blank (it may be for a different person). */
export function clearDetails(): void {
  try {
    store()?.removeItem(KEY);
    store()?.removeItem(IMAGES_KEY);
    store()?.removeItem(BRAND_KEY);
    store()?.removeItem(CUSTOM_KEY);
    store()?.removeItem(HANDOFF_KEY);
  } catch {
    /* nothing useful to do */
  }
}
