"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SignaturePreview } from "@/components/signature-preview";
import { SignaturePreviewDialog } from "@/components/signature-preview-dialog";
import { ImageCropper } from "@/components/image-cropper";
import { applyBrand, paletteFromImage, type Brand } from "@/lib/create/brand";
import { applyDetails, applyDetailsPreview, applyExtras, applyImages, EMPTY_DETAILS, extractDetails, extractExtras, extraFields, imageSlots, patchDetails, sampleDetails, validateDetails, validateExtras, type Details, type Extra, type ImageSlot, type SlotImage } from "@/lib/create/fill";
import { canCrop } from "@/lib/editor/crop";
import { uploadImage } from "@/lib/editor/upload";
import { clearDetails, loadBrand, loadCustom, loadDraftDetails, loadImages, markHandoff, saveBrand, saveCustom, saveDetails, saveImages } from "@/lib/create/session";
import { getStorage, saveDraft } from "@/lib/editor/draft";
import { exportHtml } from "@/lib/editor/export-html";
import { copyHtmlRich, downloadHtm } from "@/lib/export-client";
import { PRESETS, getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import type { Block, SignatureDoc } from "@/lib/schema/document";
import { Gallery } from "../signatures/gallery";
import { ImageLibrary } from "../editor/image-library";
import { ABOUT, BUTTON, COMMON_SOCIAL, NOTE, REACH, SOCIAL, type Spec } from "./details/details-form";

/** Which kinds of block a template contains, looking inside rows. The form only asks for what the template can show. */
function blockTypes(blocks: Block[], out = new Set<Block["type"]>()): Set<Block["type"]> {
  for (const b of blocks) {
    out.add(b.type);
    if (b.type === "row") for (const c of b.columns) blockTypes(c.blocks, out);
  }
  return out;
}

/**
 * Template picker with a built-in editor. Choosing a template grows it into a large live preview and slides a form in on the
 * right; typing updates the signature as you go. "Advanced edit" hands the filled design to the canvas editor.
 */
const ICONS = {
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8",
  copy: "M9 9h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6",
  check: "M20 6L9 17l-5-5",
} as const;

/** A 18px outline icon from a single SVG path; decorative, the button text carries the meaning. */
function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={d} />
    </svg>
  );
}

export function CreateStudio({ header, canUpload = false, initialId, editId, editName, startDoc }: { header: ReactNode; canUpload?: boolean; /** A saved signature being edited: Save updates it instead of making a new one. */ editId?: string; /** Its current name, kept on Save. */ editName?: string; /** Its design: the form opens filled in from this, exactly as when coming back from the advanced editor. */ startDoc?: SignatureDoc; /** Open this template straight away (coming back from the compare step). */ initialId?: string }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(initialId ?? null);
  const [d, setD] = useState<Details>(EMPTY_DETAILS);
  const [errors, setErrors] = useState<Partial<Record<keyof Details, string>>>({});
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [previewing, setPreviewing] = useState(false);
  /** Uploaded photos or logos by slot index. Slots not in here show the template's sample. */
  const [images, setImages] = useState<Record<string, SlotImage>>({});
  /** Colours read from the logo. Null until a logo is added (or when it has none, like a black-and-white one). */
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandNote, setBrandNote] = useState("");
  const [crop, setCrop] = useState<{ slot: ImageSlot; file: File } | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [imageError, setImageError] = useState("");
  /** Which image slot has its "upload or paste a link" panel open, and the link being typed. */
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  /**
   * The design as changed in the advanced editor, when they come back from it. The preview and form then follow that design
   * (every block they added or styled), and the form only changes the fields it covers. Null: a fresh copy of the template.
   */
  const [custom, setCustom] = useState<SignatureDoc | null>(null);
  /** What the person typed into the fields made from the design's own lines (hours, a second phone, a tagline...), by line position. */
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [extraErrors, setExtraErrors] = useState<Record<string, string>>({});

  /** Loads the picture first: that proves the link works, and gives its shape so a banner can match it. */
  async function applyImageUrl(slot: ImageSlot) {
    const t = urlDraft.trim();
    let ok = false;
    try {
      ok = new URL(t).protocol === "https:";
    } catch {
      /* not a link */
    }
    if (!ok) return setImageError("Enter a full image link starting with https://");
    setImageError("");
    setUploading(slot.index);
    if (slot.kind === "avatar") void readBrand(t);
    const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const probe = new window.Image();
      probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
      probe.onerror = () => resolve(null);
      probe.src = t;
    });
    setUploading(null);
    if (!size) return setImageError("That link did not load as an image. Check it and try again.");
    setImages((cur) => ({ ...cur, [slot.key]: { url: t, fit: "cover", ...size } }));
    setSavedId(null);
    setNote("");
    setUrlDraft("");
    setOpenSlot(null);
  }

  const preset = id ? getPreset(id) : undefined;
  /** The last template opened, so going back to the list still shows their images on that one card. */
  const [lastId, setLastId] = useState<string | null>(initialId ?? null);
  useEffect(() => {
    if (id) setLastId(id);
  }, [id]);

  // Pick up whatever they had already (details even half filled in, and uploaded images), so nothing is asked twice.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = loadDraftDetails();
    if (saved) setD(saved);
    setImages(loadImages());
    setBrand(loadBrand());
    // Back from the advanced editor: show what they changed there, not the template as it was.
    const edited = startDoc ?? (initialId ? loadCustom(initialId) : null);
    if (startDoc) saveCustom(startDoc);
    if (edited) {
      setCustom(edited);
      setExtras(extractExtras(edited));
      const next = { ...EMPTY_DETAILS, ...extractDetails(edited) };
      setD(next);
      saveDetails(next);
      // Images that differ from the template's own samples are theirs, so the image rows show them.
      const sample = getPreset(edited.template_id);
      const base = new Map((sample ? imageSlots(sample.doc) : []).map((s) => [s.key, s.src]));
      const theirs: Record<string, SlotImage> = {};
      for (const s of imageSlots(edited)) if (base.get(s.key) !== s.src) theirs[s.key] = { url: s.src, fit: "cover" };
      // A saved signature starts from its own pictures only, never ones left over from another signature in this tab.
      setImages((cur) => (startDoc ? theirs : { ...cur, ...theirs }));
    }
    setRestored(true);
    // runs once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Every added image is kept straight away, and carries over to the next template's photo slots.
  useEffect(() => {
    if (restored) saveImages(images);
  }, [images, restored]);
  // A logo is already in place but no colours were kept (older session): read them from its address.
  const firstAvatar = images.avatar0?.url;
  useEffect(() => {
    if (restored && firstAvatar && !brand) void paletteFromImage(firstAvatar).then((palette) => palette.length && setBrand((cur) => cur ?? { on: true, palette, pick: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, firstAvatar]);
  useEffect(() => {
    if (restored) saveBrand(brand);
  }, [brand, restored]);

  /** A new logo: read its colours and switch the match on, so the change is visible straight away. */
  async function readBrand(source: Blob | string) {
    const palette = await paletteFromImage(source);
    if (palette.length) {
      setBrand({ on: true, palette, pick: 0 });
      setBrandNote("");
    } else {
      setBrand(null); // never keep the previous image's colours for a new image
      setBrandNote("No brand colour found in that image (it may be black and white), so the template keeps its own colours.");
    }
  }

  // The open template lives in the address (/create?t=...), so Back from the editor or the compare step reopens it.
  // replaceState, not a push: switching templates must not pile up history entries, and nothing needs fetching.
  useEffect(() => {
    const url = editId ? `/create?s=${editId}` : id ? `/create?t=${encodeURIComponent(id)}` : "/create";
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, "", url);
  }, [id]);

  const pick = (next: string) => {
    setCustom(null);
    saveCustom(null);
    setId(next);
    setImageError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** The brand match only applies while a logo or photo of theirs is in place. */
  const hasLogo = Object.keys(images).some((k) => k.startsWith("avatar"));
  const activeBrand = hasLogo && !custom ? brand : null; // the editor's own colours win once they have customised the design
  /** The design the form edits: their editor version when they came back from it, otherwise the template. */
  const baseDoc = custom ?? preset?.doc;
  /** Images to put onto their editor version: only the ones changed here, so the fit or size they set in the editor stays. */
  const customImages = useMemo(() => {
    if (!custom) return images;
    const now = new Map(imageSlots(custom).map((s) => [s.key, s.src]));
    return Object.fromEntries(Object.entries(images).filter(([k, v]) => now.has(k) && now.get(k) !== v.url));
  }, [custom, images]);
  /** The finished design from the form: on their editor version the fields are patched in place, on a template the sample copy is cleared. */
  const filledDoc = (): SignatureDoc | null => {
    if (!preset) return null;
    return custom ? applyExtras(patchDetails(applyImages(custom, customImages), d), extras) : applyDetails(applyImages(applyBrand(preset.doc, activeBrand), images), d);
  };
  /** One field for each line the design itself contains (hours, a second phone, a tagline...), so nothing in it is left uneditable here. */
  const extraList = useMemo(() => (custom ? extraFields(custom) : []), [custom]);

  const types = useMemo(() => (baseDoc ? blockTypes(baseDoc.blocks) : new Set<Block["type"]>()), [baseDoc]);
  // Until something is typed, the template's own sample shows; each field the person fills replaces its sample.
  const html = useMemo(() => (!preset ? "" : renderToEmailHtml(custom ? applyExtras(patchDetails(applyImages(custom, customImages), d), extras) : applyDetailsPreview(applyImages(applyBrand(preset.doc, activeBrand), images), d))), [preset, custom, customImages, d, images, activeBrand, extras]);
  const samples = useMemo(() => (baseDoc ? sampleDetails(baseDoc) : {}), [baseDoc]);
  /** The networks every template offers, plus any other network this template's own social block uses. */
  const socialSpecs = useMemo(() => {
    const own = new Set<string>();
    const walk = (blocks: Block[]) => blocks.forEach((b) => (b.type === "row" ? b.columns.forEach((c) => walk(c.blocks)) : b.type === "social" && b.links.forEach((l) => own.add(l.network))));
    if (baseDoc) walk(baseDoc.blocks);
    return SOCIAL.filter((x) => COMMON_SOCIAL.includes(x.key) || own.has(x.key));
  }, [baseDoc]);
  const slots = useMemo(() => (baseDoc ? imageSlots(baseDoc) : []), [baseDoc]);

  async function sendImage(slot: ImageSlot, file: File) {
    setUploading(slot.index);
    setImageError("");
    try {
      const r = await uploadImage(file, slot.kind === "banner" ? "banner" : "avatar");
      setImages((cur) => ({ ...cur, [slot.key]: { url: r.url, fit: "cover", width: r.width || undefined, height: r.height || undefined } }));
      setSavedId(null);
      setNote("");
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "The upload failed. Please try again.");
    } finally {
      setUploading(null);
    }
  }

  function chooseImage(slot: ImageSlot, file: File | undefined) {
    if (!file) return;
    if (slot.kind === "avatar") void readBrand(file); // colours first, from the file itself: the theme changes the moment a logo is picked, not after the upload
    if (canCrop(file)) setCrop({ slot, file }); // still images are cropped to the slot's shape first; GIFs go straight up
    else void sendImage(slot, file);
  }

  function update(key: keyof Details, value: string) {
    const next = { ...d, [key]: value };
    setD(next);
    saveDetails(next);
    setSavedId(null); // changed since the last save: the next Save makes a new signature
    setNote("");
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function updateExtra(key: string, value: string) {
    const next = { ...extras, [key]: value };
    setExtras(next);
    if (custom) saveCustom(applyExtras(custom, next)); // kept for this tab, so a refresh does not lose it
    setSavedId(null);
    setNote("");
    if (extraErrors[key]) setExtraErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)));
  }

  /** The finished signature (the template's sample copy removed), or null after pointing at what is wrong. */
  function finished() {
    if (!preset) return null;
    const found = validateDetails(d);
    const foundExtras = custom ? validateExtras(custom, extras) : {};
    setErrors(found);
    setExtraErrors(foundExtras);
    if (Object.keys(found).length || Object.keys(foundExtras).length) {
      const first = Object.keys(found)[0];
      document.getElementById(first ? `s-${first}` : `s-x-${Object.keys(foundExtras)[0]}`)?.focus();
      return null;
    }
    return filledDoc();
  }

  /** Keeps a copy in their account. Returns an error message, or "" when saved. */
  async function persist(doc: NonNullable<ReturnType<typeof filledDoc>>): Promise<string> {
    if (!preset) return "";
    try {
      const res = await fetch("/api/signatures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: savedId ?? editId, name: (editId && editName ? editName : `${d.name.trim()} · ${preset.name}`).slice(0, 100), doc }) });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (res.ok && data?.id) {
        setSavedId(data.id);
        return "";
      }
      return res.status === 401 ? "Your session expired. Sign in again, then save." : (data?.message ?? "Could not save. Please try again.");
    } catch {
      return "Could not reach the server, so it was not saved.";
    }
  }

  async function save() {
    const doc = finished();
    if (!doc || !preset || saving) return;
    setSaving(true);
    setNote("");
    try {
      setNote((await persist(doc)) || "Saved to your signatures.");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    const doc = finished();
    if (!doc || !preset) return;
    setNote("");
    const out = await exportHtml(doc, renderToEmailHtml(doc), savedId);
    if (!out.ok) return setNote(out.message);
    setNote((await copyHtmlRich(out.html)) ? "Copied. Paste it into your email signature box." : "The browser blocked copying. Use Download instead.");
  }

  async function download() {
    const doc = finished();
    if (!doc || !preset) return;
    const out = await exportHtml(doc, renderToEmailHtml(doc), savedId);
    if (!out.ok) return setNote(out.message);
    downloadHtm(out.html, `${preset.id}-signature.htm`);
    setNote("Downloaded.");
  }

  function advancedEdit() {
    if (!preset) return;
    if (!finished()) return; // same checks as saving: points at anything invalid
    // The editor gets the template's whole skeleton: what they typed replaces the sample, and every other element (contact lines,
    // social links, footer, banner) stays as editable dummy content instead of vanishing.
    const doc = custom ? applyExtras(patchDetails(applyImages(custom, customImages), d), extras) : applyDetailsPreview(applyImages(applyBrand(preset.doc, activeBrand), images), d);
    const storage = getStorage();
    if (!storage || !saveDraft(storage, doc)) {
      setError("Your browser is blocking local storage, so the signature could not be opened in the editor. Allow site data and try again.");
      return;
    }
    markHandoff(preset.id); // so coming back picks up what they change in the editor
    router.push("/editor?from=create");
  }

  const field = (s: Spec) => (
    <div key={s.key}>
      <label htmlFor={`s-${s.key}`} className="mb-1 block text-sm font-medium">
        {s.label}
        {!s.required && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      <input
        id={`s-${s.key}`}
        className="field w-full"
        type={s.type ?? "text"}
        autoComplete={s.autoComplete}
        placeholder={samples[s.key] || s.placeholder}
        value={d[s.key]}
        maxLength={s.key === "name" || s.key === "title" || s.key === "company" ? 100 : 200}
        aria-invalid={!!errors[s.key]}
        aria-describedby={errors[s.key] ? `se-${s.key}` : undefined}
        onChange={(e) => update(s.key, e.target.value)}
      />
      {errors[s.key] && <p id={`se-${s.key}`} className="mt-1 text-sm text-red-600 dark:text-red-400">{errors[s.key]}</p>}
    </div>
  );

  const imageGroup = () => (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{slots.length > 1 ? "Images" : slots[0]?.kind === "banner" ? "Banner" : "Photo or logo"}</legend>
      {slots.map((s) => {
        const img = images[s.key];
        const url = img?.url;
        const busy = uploading === s.index;
        const avatars = slots.filter((x) => x.kind === "avatar");
        const label = s.kind === "banner" ? "Banner" : avatars.length > 1 ? `Photo or logo ${avatars.indexOf(s) + 1}` : "Photo or logo";
        return (
          <div key={s.index} className="rounded-xl border border-line p-3">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url ?? s.src} alt="" className={`shrink-0 border border-line bg-surface-2 ${s.kind === "banner" ? "h-14 w-24 rounded-md" : `size-14 ${s.shape === "circle" ? "rounded-full" : s.shape === "square" ? "rounded-none" : "rounded-lg"}`} ${img?.fit === "contain" ? "object-contain" : "object-cover"}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted">{busy ? "Loading…" : url ? "Your image" : s.kind === "banner" ? "Dummy banner. Left out of your signature unless you add one." : "Sample image. Add your own."}</p>
              </div>
              <button type="button" className="btn shrink-0" aria-expanded={openSlot === s.index} disabled={busy} onClick={() => { setOpenSlot(openSlot === s.index ? null : s.index); setUrlDraft(""); setImageError(""); }}>
                {openSlot === s.index ? "Close" : url ? "Change" : "Add"}
              </button>
            </div>
            {img && s.kind === "avatar" && (
              <div role="group" aria-label={`${label} fit`} className="mt-3 flex gap-1.5">
                {([["cover", "Fill the frame"], ["contain", "Show whole image"]] as const).map(([fit, text]) => (
                  <button
                    key={fit}
                    type="button"
                    aria-pressed={(img.fit ?? "cover") === fit}
                    onClick={() => setImages((cur) => ({ ...cur, [s.key]: { ...img, fit } }))}
                    className={`min-h-9 flex-1 cursor-pointer rounded-lg border px-2 text-xs font-medium transition-colors duration-150 ${(img.fit ?? "cover") === fit ? "border-ink bg-ink text-white" : "border-line text-muted hover:text-ink"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
            {openSlot === s.index && (
              <div className="studio-fields mt-3 space-y-3 border-t border-line pt-3">
                {canUpload && (
                  <label className={`btn w-full cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
                    {busy ? "Uploading…" : "Upload a file"}
                    <input type="file" accept="image/png,image/jpeg,image/gif" className="sr-only" disabled={busy} aria-label={`Upload ${label.toLowerCase()}`} onChange={(e) => { chooseImage(s, e.target.files?.[0]); e.target.value = ""; setOpenSlot(null); }} />
                  </label>
                )}
                {canUpload && (
                  <ImageLibrary
                    current={url ?? ""}
                    onPick={(picked, info) => {
                      if (s.kind === "avatar") void readBrand(picked);
                      setImages((cur) => ({ ...cur, [s.key]: { url: picked, fit: "cover", width: info.width || undefined, height: info.height || undefined } }));
                      setImageError("");
                      setSavedId(null);
                      setNote("");
                      setOpenSlot(null);
                    }}
                  />
                )}
                {canUpload && <p className="text-center text-xs text-muted">or</p>}
                <div>
                  <label htmlFor={`img-url-${s.index}`} className="mb-1 block text-sm font-medium">Image link</label>
                  <div className="flex gap-2">
                    <input
                      id={`img-url-${s.index}`}
                      className="field min-w-0 flex-1"
                      type="url"
                      inputMode="url"
                      placeholder="https://example.com/me.png"
                      value={urlDraft}
                      onChange={(e) => setUrlDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyImageUrl(s); } }}
                    />
                    <button type="button" className="btn btn-primary shrink-0" onClick={() => void applyImageUrl(s)}>Use</button>
                  </div>
                </div>
                {url && (
                  <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => { setImages((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => k !== s.key))); setOpenSlot(null); }}>
                    Remove my image and go back to the sample
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {activeBrand && (
        <div className="studio-fields rounded-2xl border border-line bg-surface-2/40 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p id="brand-t" className="text-sm font-semibold">Match colours to my logo</p>
              <p className="mt-0.5 text-xs text-muted">Recolours the template from your logo.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={activeBrand.on}
              aria-labelledby="brand-t"
              onClick={() => { setBrand({ ...activeBrand, on: !activeBrand.on }); setSavedId(null); setNote(""); }}
              className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${activeBrand.on ? "bg-ink" : "bg-line"}`}
            >
              <span className={`absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ${activeBrand.on ? "translate-x-5" : ""}`} />
            </button>
          </div>
          {activeBrand.on && (
            <div role="group" aria-label="Brand colour" className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-line pt-4">
              <span className="text-xs font-medium text-muted">Main colour</span>
              {activeBrand.palette.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use ${c} as the main colour`}
                  aria-pressed={activeBrand.pick === i}
                  onClick={() => { setBrand({ ...activeBrand, pick: i }); setSavedId(null); setNote(""); }}
                  style={{ backgroundColor: c }}
                  className={`size-8 cursor-pointer rounded-full border border-black/10 transition-transform duration-150 ${activeBrand.pick === i ? "scale-110 ring-2 ring-ink ring-offset-2" : "hover:scale-105"}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {brandNote && !activeBrand && <p className="text-xs text-muted">{brandNote}</p>}
      {imageError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{imageError}</p>}
    </fieldset>
  );

  const extraField = (x: Extra) => (
    <div key={x.key}>
      <label htmlFor={`s-x-${x.key}`} className="mb-1 block text-sm font-medium">
        {x.label}
        <span className="ml-1 font-normal text-muted">(optional)</span>
      </label>
      <input
        id={`s-x-${x.key}`}
        className="field w-full"
        type={x.kind === "email" ? "email" : x.kind === "phone" ? "tel" : "text"}
        value={extras[x.key] ?? ""}
        maxLength={x.kind === "text" ? 600 : 200}
        aria-invalid={!!extraErrors[x.key]}
        aria-describedby={extraErrors[x.key] ? `sxe-${x.key}` : undefined}
        onChange={(e) => updateExtra(x.key, e.target.value)}
      />
      {extraErrors[x.key] && <p id={`sxe-${x.key}`} className="mt-1 text-sm text-red-600 dark:text-red-400">{extraErrors[x.key]}</p>}
    </div>
  );

  /** A group of fields made from the design's own lines. Nothing is shown for an empty list. */
  const extraGroup = (title: string, list: Extra[]) =>
    list.length > 0 && (
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{title}</legend>
        {list.map(extraField)}
      </fieldset>
    );

  const group = (title: string, specs: Spec[]) => (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{title}</legend>
      {specs.map(field)}
    </fieldset>
  );

  return (
    <>
      {/* Kept mounted (just hidden) so filters, search and scroll position are still there when they come back. */}
      <div hidden={!!preset}>
        {header}
        <Gallery pickLabel="Choose" onPick={pick} mineId={lastId} mineImages={images} mineBrand={hasLogo ? brand : null} />
      </div>

      {preset && (
        <div>
          <button type="button" className="btn btn-primary mb-4 inline-flex min-h-11 items-center gap-2" onClick={() => { setId(null); window.scrollTo({ top: 0 }); }}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
            All templates
          </button>
          <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
            <section aria-label="Live preview" className="studio-stage card min-w-0 self-start overflow-hidden lg:sticky lg:top-4">
              <SignaturePreview key={preset.id} title={`${preset.name} with your details`} html={html} height={420} lazy={false} className="border-b border-line" />
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{preset.name}</h2>
                  <p className="text-sm text-muted">{preset.category}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <span className="sr-only sm:not-sr-only">Template</span>
                  <select className="field max-w-48" value={preset.id} onChange={(e) => { setCustom(null); saveCustom(null); setId(e.target.value); setImageError(""); setSavedId(null); setNote(""); }} aria-label="Switch template">
                    {PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/50 p-4">
                <button type="button" className="btn btn-primary min-h-11" onClick={() => void save()} disabled={saving}>
                  <Icon d={savedId && !saving ? ICONS.check : ICONS.save} />
                  {saving ? "Saving…" : savedId ? "Saved" : "Save"}
                </button>
                <button type="button" className="btn min-h-11" onClick={() => void copy()}>
                  <Icon d={ICONS.copy} />
                  Copy
                </button>
                <button type="button" className="btn min-h-11" onClick={() => void download()}>
                  <Icon d={ICONS.download} />
                  Download
                </button>
                <button type="button" className="btn min-h-11" onClick={() => setPreviewing(true)}>
                  <Icon d={ICONS.mail} />
                  Email preview
                </button>
                <p role="status" className="ml-auto text-sm text-muted">{note}</p>
              </div>
            </section>

            <aside aria-label="Your details" className="studio-panel card self-start p-5">
              <h2 className="text-xl font-semibold tracking-tight">Your details</h2>
              <p className="mt-1 text-sm text-muted">The signature updates as you type. Only your name is required.</p>
              {/* Keyed by template so switching theme re-animates the fields that apply to it. */}
              <div key={preset.id} className="studio-fields mt-5 space-y-6">
                {slots.length > 0 && imageGroup()}
                {group("About you", types.has("identity") ? ABOUT : ABOUT.slice(0, 1))}
                {types.has("contact") && group("How to reach you", REACH)}
                {extraGroup("How to reach you", extraList.filter((x) => ["email", "phone", "website", "address"].includes(x.kind)))}
                {extraGroup("More in your design", extraList.filter((x) => !["email", "phone", "website", "address"].includes(x.kind)))}
                {types.has("social") && group("Social links", socialSpecs)}
                {types.has("disclaimer") && group("Footer line", NOTE)}
                {types.has("button") && group("Button", BUTTON)}
              </div>

              {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="mt-6 space-y-3 border-t border-line pt-5">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn btn-primary min-h-11" onClick={() => void save()} disabled={saving}>
                    <Icon d={savedId && !saving ? ICONS.check : ICONS.save} />
                    {saving ? "Saving…" : savedId ? "Saved" : "Save"}
                  </button>
                  <button type="button" className="btn min-h-11" onClick={() => void copy()}>
                    <Icon d={ICONS.copy} />
                    Copy
                  </button>
                </div>
                {note && <p role="status" className="text-center text-sm text-muted">{note}</p>}
                <button type="button" className="mx-auto block text-sm font-medium text-ink underline underline-offset-2 hover:text-brand" onClick={advancedEdit}>
                  Advanced edit
                </button>
                <button
                  type="button"
                  className="mx-auto block text-xs text-muted hover:text-ink"
                  onClick={() => {
                    clearDetails(); // for a different person: nothing of the last signature is kept
                    setCustom(null);
                    setD(EMPTY_DETAILS);
                    setImages({});
                    setBrand(null);
                    setBrandNote("");
                    setErrors({});
                    setSavedId(null);
                    setNote("Cleared. Starting fresh.");
                  }}
                >
                  Start over with blank details
                </button>
                <p className="text-center text-sm text-muted">
                  Opens the full editor with your details filled in.{" "}
                  <Link href={`/create/preview?t=${encodeURIComponent(preset.id)}`} className="font-medium text-ink underline underline-offset-2" onClick={(e) => {
                    const found = validateDetails(d);
                    setErrors(found);
                    if (Object.keys(found).length) {
                      e.preventDefault();
                      document.getElementById(`s-${Object.keys(found)[0]}`)?.focus();
                    }
                  }}>
                    Compare more templates
                  </Link>
                </p>
              </div>
            </aside>
          </div>
          {crop && (
            <ImageCropper
              file={crop.file}
              aspect={crop.slot.aspect}
          adjustHeight={crop.slot.kind === "banner"}
              shape={crop.slot.shape}
              purpose={crop.slot.kind === "banner" ? "banner" : "avatar"}
              title={crop.slot.kind === "banner" ? "Crop banner" : "Crop photo or logo"}
              onCancel={() => setCrop(null)}
              onConfirm={(cropped) => { const s = crop.slot; setCrop(null); void sendImage(s, cropped); }}
              onUseOriginal={() => { const { slot, file } = crop; setCrop(null); void sendImage(slot, file); }}
            />
          )}
          {previewing && (
            <SignaturePreviewDialog
              open
              onOpenChange={(o) => !o && setPreviewing(false)}
              name={preset.name}
              html={html}
              keepLabel="Keep editing"
              chooseLabel="Advanced edit"
              onChoose={() => {
                setPreviewing(false);
                advancedEdit();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
