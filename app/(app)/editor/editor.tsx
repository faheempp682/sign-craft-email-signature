"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SAFE_FONTS, SOCIAL_NETWORKS, SignatureDocSchema, TEMPLATE_IDS, type Block, type SignatureDoc, type TemplateId } from "@/lib/schema/document";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { TEMPLATE_META } from "@/lib/templates";
import { getPreset } from "@/lib/presets";
import { BLOCK_LABEL, BLOCK_TYPES, FIELDS, cleanValue, createBlock, type BlockType, type FieldSpec } from "@/lib/editor/blocks";
import { clearDraft, getStorage, loadDraft, saveDraft, type Draft } from "@/lib/editor/draft";
import { pickFieldKey } from "@/lib/editor/preview-map";
import { copyHtmlRich, downloadHtm } from "@/lib/export-client";
import { GmailPush } from "@/components/gmail-push";
import { fitBanner, toAssetInfo, uploadImage } from "@/lib/editor/upload";
import { canCrop } from "@/lib/editor/crop";
import { ImageCropper } from "@/components/image-cropper";
import { GifMaker } from "@/components/gif-maker";
import type { UploadPurpose } from "@/lib/storage/rules";
import type { AssetInfo } from "@/lib/storage/rules";
import { LivePreview, type PickHint, type Snapshot } from "./live-preview";
import { CompatPanel } from "./compat-panel";
import { AutofillPanel } from "./autofill-panel";
import type { ApplyResult } from "@/lib/ai/apply-facts";
import { applyAllFixes, lintDoc, scoreOf, type AssetMap, type Issue } from "@/lib/linter";
import { CLIENTS, CLIENT_IDS, type ClientId } from "@/lib/preview-clients";
import { exportHtml } from "@/lib/editor/export-html";
import { insertDisclaimer } from "@/lib/disclaimers";
import { DisclaimerPicker } from "@/components/disclaimer-picker";
import { PolishDeliverBanner } from "@/app/(app)/polish/deliver-banner";

const MAX_BLOCKS = 30;
const AUTOSAVE_MS = 400;

const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const UP = icon("M6 15l6-6 6 6");
const DOWN = icon("M6 9l6 6 6-6");
const TRASH = icon("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3");
const GRIP = icon("M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01");

const iconBtn = "grid h-11 w-11 place-items-center rounded-[10px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

/* ---------- state: the JSON doc plus editor-only stable ids (never serialised into the doc) ---------- */

type State = { doc: SignatureDoc; ids: string[] };
let seq = 0;
const newId = () => `b${++seq}`;
const fromDoc = (doc: SignatureDoc): State => ({ doc, ids: doc.blocks.map(() => newId()) });
const fromTemplate = (id: string): State => fromDoc(structuredClone((getPreset(id) ?? getPreset("classic")!).doc));

type Errors = Record<string, string>;

function collectErrors(doc: SignatureDoc): Errors {
  const r = SignatureDocSchema.safeParse(doc);
  if (r.success) return {};
  const errors: Errors = {};
  for (const issue of r.error.issues) errors[issue.path.join(".")] ??= issue.message;
  return errors;
}

/** What the cropper needs to know about the image slot it is filling. */
type CropSpec = { aspect: number; shape?: string; purpose: UploadPurpose };
/** The animated GIF maker is offered on banner images. `enabled` false means the animated_gif flag is off for this person. */
type GifSpec = { enabled: boolean; width: number; height: number };

/** The files people picked, kept for the session so "Re-crop" can start from the original. Newest last; bounded so it cannot grow without limit. */
const ORIGINALS = new Map<string, File>();
const MAX_ORIGINALS = 6;
function rememberOriginal(key: string, file: File) {
  ORIGINALS.delete(key);
  ORIGINALS.set(key, file);
  while (ORIGINALS.size > MAX_ORIGINALS) ORIGINALS.delete(ORIGINALS.keys().next().value as string);
}

function Field({ spec, value, error, id, onChange, onUpload, crop, gif }: { spec: FieldSpec; value: unknown; error?: string; id: string; onChange: (v: string) => void; onUpload?: (file: File) => Promise<string | void>; crop?: CropSpec; gif?: GifSpec }) {
  const v = value === undefined || value === null ? "" : String(value);
  const [busy, setBusy] = useState(false);
  const [upErr, setUpErr] = useState("");
  const [upNote, setUpNote] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [hasOriginal, setHasOriginal] = useState(() => ORIGINALS.has(id));
  /** Picking a still image opens the cropper first; GIFs (which may be animated) go straight to the upload. */
  function pick(file: File | undefined) {
    if (!file || !onUpload) return;
    if (crop && canCrop(file)) {
      rememberOriginal(id, file);
      setHasOriginal(true);
      setCropFile(file);
      return;
    }
    void send(file);
  }
  async function send(file: File | undefined) {
    if (!file || !onUpload) return;
    setBusy(true);
    setUpErr("");
    setUpNote("");
    try {
      setUpNote((await onUpload(file)) || "");
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : "The upload failed.");
    } finally {
      setBusy(false);
    }
  }
  if (spec.kind === "toggle") {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
          <input id={id} type="checkbox" data-field={spec.key} className="size-5" checked={v === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "")} aria-describedby={spec.hint ? `${id}-hint` : undefined} />
          {spec.label}
        </label>
        {spec.hint && <p id={`${id}-hint`} className="text-xs text-muted">{spec.hint}</p>}
      </div>
    );
  }
  const common = { id, value: v, "data-field": spec.key, "aria-invalid": !!error, "aria-describedby": error ? `${id}-err` : undefined, className: "field w-full" };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{spec.label}</label>
      {spec.kind === "select" ? (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          {spec.options!.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : spec.kind === "textarea" ? (
        <textarea {...common} rows={4} onChange={(e) => onChange(e.target.value)} className="field w-full py-2" />
      ) : (
        <input {...common} type={spec.kind === "number" ? "number" : "text"} onChange={(e) => onChange(e.target.value)} />
      )}
      {onUpload && (
        <div className="space-y-2">
          <label className={`btn w-full cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy ? "Uploading…" : "Upload image"}
            <input type="file" accept="image/png,image/jpeg,image/gif" className="sr-only" disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {crop && hasOriginal && !busy && (
            <button type="button" className="btn w-full" onClick={() => { const o = ORIGINALS.get(id); if (o) setCropFile(o); else setHasOriginal(false); }}>Re-crop last image</button>
          )}
          {gif && gif.enabled && (
            <button type="button" className="btn w-full" disabled={busy} onClick={() => setGifOpen(true)}>Make animated GIF</button>
          )}
          {gif && !gif.enabled && <p className="text-xs text-muted">Animated GIFs are not enabled for your account. Ask an admin to turn them on.</p>}
          <p role="status" aria-live="polite" className="mt-1.5 min-h-4 text-xs text-red-600 dark:text-red-400">{upErr}</p>
          {upNote && <p data-testid="upload-note" className="text-xs text-muted">{upNote}</p>}
        </div>
      )}
      {cropFile && crop && (
        <ImageCropper
          file={cropFile}
          aspect={crop.aspect}
          shape={crop.shape}
          purpose={crop.purpose}
          title={crop.purpose === "banner" ? "Crop banner" : "Crop photo or logo"}
          onCancel={() => setCropFile(null)}
          onConfirm={(cropped) => { setCropFile(null); void send(cropped); }}
          onUseOriginal={() => { const f = cropFile; setCropFile(null); void send(f); }}
        />
      )}
      {gifOpen && gif && onUpload && (
        <GifMaker
          width={gif.width}
          height={gif.height}
          onClose={() => setGifOpen(false)}
          onUse={async (file) => {
            setUpErr("");
            setUpNote((await onUpload(file)) || "");
            setGifOpen(false);
          }}
        />
      )}
      {spec.hint && !error && <p className="text-xs text-muted">{spec.hint}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

/** Crop settings for an image slot: a photo or logo is cropped square, a banner to its own shape. */
function cropFor(block: Block): CropSpec | undefined {
  if (block.type === "avatar") return { aspect: 1, shape: block.shape, purpose: "avatar" };
  if (block.type === "banner") {
    const aspect = Number(block.width) / Number(block.height);
    return { aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 4, shape: "square", purpose: "banner" };
  }
  return undefined;
}

/* ---------- one sortable block card ---------- */

function BlockCard({
  id, index, count, block, errors, isOpen, canUpload, gifEnabled, onAsset, onToggle, onMove, onRemove, onPatch,
}: {
  id: string; index: number; count: number; block: Block; errors: Errors; isOpen: boolean; canUpload: boolean; gifEnabled: boolean; onAsset: (url: string, info: AssetInfo) => void;
  onToggle: () => void; onMove: (dir: -1 | 1) => void; onRemove: () => void; onPatch: (patch: Record<string, unknown>) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const label = BLOCK_LABEL[block.type];
  const hasError = Object.keys(errors).some((k) => k.startsWith(`blocks.${index}.`));
  return (
    <li
      ref={setNodeRef}
      data-block-card={id}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: "relative" }}
      className={`card ${hasError ? "border-red-500" : ""} ${isDragging ? "opacity-90 shadow-lg" : ""} ${isOpen ? "ring-2 ring-accent" : ""}`}
    >
      <div className="flex items-center gap-1 pr-1">
        <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag to reorder ${label}`} className={`${iconBtn} cursor-grab touch-none active:cursor-grabbing`}>
          {GRIP}
        </button>
        <button className="min-h-11 flex-1 text-left text-sm font-medium" aria-expanded={isOpen} aria-controls={`blk-${id}`} onClick={onToggle}>
          {label}
          {hasError && <span className="ml-2 text-xs font-normal text-red-600 dark:text-red-400">needs attention</span>}
        </button>
        <button className={iconBtn} aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)}>{UP}</button>
        <button className={iconBtn} aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(1)}>{DOWN}</button>
        <button className={iconBtn} aria-label={`Remove ${label}`} onClick={onRemove}>{TRASH}</button>
      </div>
      {isOpen && (
        <div id={`blk-${id}`} className="space-y-4 border-t border-line p-4">
          {block.type === "divider" && <p className="text-sm text-muted">A thin accent-colored line. Nothing to edit.</p>}
          {block.type === "social" ? (
            <SocialEditor block={block} index={index} errors={errors} onChange={(links) => onPatch({ links })} />
          ) : block.type !== "divider" ? (
            FIELDS[block.type].map((spec) => (
              <Field
                key={spec.key}
                id={`f-${id}-${spec.key}`}
                spec={spec}
                value={(block as Record<string, unknown>)[spec.key]}
                error={errors[`blocks.${index}.${spec.key}`]}
                onChange={(v) => onPatch({ [spec.key]: cleanValue(spec.kind, v) })}
                crop={canUpload && spec.upload ? cropFor(block) : undefined}
                gif={canUpload && spec.upload && block.type === "banner" ? { enabled: gifEnabled, width: Number(block.width) || 400, height: Number(block.height) || 100 } : undefined}
                onUpload={
                  canUpload && spec.upload
                    ? async (file) => {
                        const r = await uploadImage(file, block.type === "banner" ? "banner" : "avatar");
                        onAsset(r.url, toAssetInfo(r));
                        onPatch({ [spec.key]: r.url, ...(block.type === "banner" ? fitBanner(r.width, r.height) : {}) });
                        return r.notes.join(" ");
                      }
                    : undefined
                }
              />
            ))
          ) : null}
        </div>
      )}
    </li>
  );
}

/* ---------- editor ---------- */

export type SavedSignature = { id: string; name: string; doc: SignatureDoc };

export function Editor({ initial, explicit, aiNotice = false, saved, canSave = false, canUpload = false, gifEnabled = true, assetInfo, polishId }: {
  initial: string; explicit: boolean; aiNotice?: boolean; saved?: SavedSignature; canSave?: boolean; canUpload?: boolean; gifEnabled?: boolean; assetInfo?: AssetMap;
  /** A designer polishing someone's request (?polish=<id>): shows the Deliver banner. */
  polishId?: string;
}) {
  const [showAiNotice, setShowAiNotice] = useState(aiNotice);
  const [ready, setReady] = useState(false); // false until localStorage has been consulted (avoids a hydration flash)
  const [state, setState] = useState<State>(() => (saved ? fromDoc(saved.doc) : fromTemplate(initial)));
  // A signature opened from the account never touches the generic local draft (and vice versa).
  const localDrafts = !saved;
  const [savedId, setSavedId] = useState<string | null>(saved?.id ?? null);
  const [sigName, setSigName] = useState(saved?.name ?? "");
  const [savedSnap, setSavedSnap] = useState<{ doc: string; name: string } | null>(saved ? { doc: JSON.stringify(saved.doc), name: saved.name } : null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const [restorable, setRestorable] = useState<Draft | null>(null);
  const [saveNote, setSaveNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; key?: string; n: number } | null>(null);
  const [status, setStatus] = useState("");
  const [dark, setDark] = useState(false);
  const [client, setClient] = useState<ClientId>("gmail");
  // What the upload step recorded about each image (size, animation, dimensions). Lives beside the document, never inside it.
  const [assets, setAssets] = useState<AssetMap>(assetInfo ?? {});
  const [addType, setAddType] = useState<BlockType>("identity");

  // Refs are updated synchronously (not in an effect) so the pagehide flush and preview clicks never see stale state.
  const stateRef = useRef(state);
  const dirtyRef = useRef(dirty);
  const savedDocRef = useRef<SignatureDoc | null>(saved?.doc ?? null); // what "Start over" returns to once the signature is saved

  const replace = useCallback((next: State, isDirty: boolean) => {
    stateRef.current = next;
    dirtyRef.current = isDirty;
    setState(next);
    setDirty(isDirty);
    // Once the user starts editing, "?t=template" has done its job: drop it so a refresh resumes this draft.
    if (isDirty && window.location.search) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);

  const update = useCallback((fn: (s: State) => State) => replace(fn(stateRef.current), true), [replace]);

  /* --- draft: restore on mount --- */
  useEffect(() => {
    const storage = localDrafts ? getStorage() : null;
    const draft = storage ? loadDraft(storage) : null;
    if (draft) {
      if (explicit) {
        // The user asked for a specific template: start from it, but let them get their draft back.
        setRestorable(draft);
      } else {
        replace(fromDoc(draft.doc), false);
        setSaveNote("Draft restored from this device.");
      }
    }
    setReady(true);
  }, [explicit, replace, localDrafts]);

  /* --- draft: debounced autosave, only once the user has actually edited --- */
  useEffect(() => {
    if (!ready || !dirty || !localDrafts) return;
    const t = setTimeout(() => {
      const storage = getStorage();
      setSaveNote(storage && saveDraft(storage, state.doc) ? "Draft saved on this device." : "Could not save the draft (browser storage unavailable).");
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [state.doc, dirty, ready, localDrafts]);

  /* --- draft: flush if the tab closes or refreshes inside the debounce window --- */
  useEffect(() => {
    const flush = () => {
      const storage = getStorage();
      if (storage && dirtyRef.current && localDrafts) saveDraft(storage, stateRef.current.doc);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [localDrafts]);

  /* --- validation + render snapshot (keeps the last valid render while the user is mid-edit) --- */
  const errors = useMemo(() => collectErrors(state.doc), [state.doc]);
  const valid = Object.keys(errors).length === 0;
  const current = useMemo<Snapshot | null>(() => {
    const r = SignatureDocSchema.safeParse(state.doc);
    return r.success ? { html: renderToEmailHtml(r.data), parsed: r.data, ids: state.ids } : null;
  }, [state]);
  const [lastValid, setLastValid] = useState<Snapshot | null>(current);
  if (current && current !== lastValid) setLastValid(current);
  const snapshot = current ?? lastValid;
  // Lint only a fully valid document; while a field is mid-edit and invalid the panel says so instead.
  const issues = useMemo(() => (current ? lintDoc(current.parsed, assets) : null), [current, assets]);

  /* --- click-to-edit: preview click -> open block, focus + select the matching field --- */
  const onPick = useCallback((id: string, hint: PickHint | null) => {
    const { doc, ids } = stateRef.current;
    const i = ids.indexOf(id);
    if (i < 0) return;
    setOpen(id);
    setFocusReq({ id, key: hint ? pickFieldKey(doc.blocks[i], hint.text, hint.offset) : undefined, n: Date.now() });
  }, []);

  const onFix = (issue: Issue) => update((s) => ({ ...s, doc: issue.fix!(s.doc) }));
  // Autofill may add blocks, so each block's stable id is carried over by its old position and new blocks get fresh ids.
  const onAutofill = (r: ApplyResult) => update((s) => ({ doc: r.doc, ids: r.order.map((o) => (o === null ? newId() : s.ids[o])) }));
  const onFixAll = () => update((s) => ({ ...s, doc: applyAllFixes(s.doc, assets) }));
  const onShowBlock = (index: number) => {
    const id = stateRef.current.ids[index];
    if (!id) return;
    setOpen(id);
    setFocusReq({ id, n: Date.now() });
  };

  useEffect(() => {
    if (!focusReq) return;
    const raf = requestAnimationFrame(() => {
      const card = document.querySelector(`[data-block-card="${focusReq.id}"]`);
      if (!card) return;
      const el = (focusReq.key ? card.querySelector(`[data-field="${focusReq.key}"]`) : null) ?? card.querySelector("input,select,textarea");
      if (!(el instanceof HTMLElement)) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
      if (el instanceof HTMLInputElement && el.type === "text") el.select();
      if (el instanceof HTMLTextAreaElement) el.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusReq]);

  /* --- block operations --- */
  const setBlock = (i: number, patch: Record<string, unknown>) =>
    update((s) => ({ ...s, doc: { ...s.doc, blocks: s.doc.blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as Block) : b)) } }));

  const reorder = (from: number, to: number) =>
    update((s) => {
      if (from === to || to < 0 || to >= s.ids.length) return s;
      return { doc: { ...s.doc, blocks: arrayMove(s.doc.blocks, from, to) }, ids: arrayMove(s.ids, from, to) };
    });

  const remove = (i: number) => {
    update((s) => ({ doc: { ...s.doc, blocks: s.doc.blocks.filter((_, j) => j !== i) }, ids: s.ids.filter((_, j) => j !== i) }));
    setOpen(null);
  };

  const add = () => {
    if (state.ids.length >= MAX_BLOCKS) return;
    const id = newId();
    update((s) => ({ doc: { ...s.doc, blocks: [...s.doc.blocks, createBlock(addType)] }, ids: [...s.ids, id] }));
    setOpen(id);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    reorder(state.ids.indexOf(String(e.active.id)), state.ids.indexOf(String(e.over.id)));
  };

  const setTheme = (patch: Partial<SignatureDoc["theme"]>) => update((s) => ({ ...s, doc: { ...s.doc, theme: { ...s.doc.theme, ...patch } } }));

  function startOver() {
    const savedDoc = savedDocRef.current;
    if (!window.confirm(savedDoc ? "Discard your unsaved changes and go back to the last saved version?" : "Discard this draft and start again from the template?")) return;
    if (savedDoc) {
      replace(fromDoc(structuredClone(savedDoc)), false);
      setOpen(null);
      setSaveNote("Reverted to the saved version.");
      return;
    }
    const storage = getStorage();
    if (storage) clearDraft(storage);
    replace(fromTemplate(initial), false);
    setOpen(null);
    setRestorable(null);
    setSaveNote("Draft cleared.");
  }

  async function onSave() {
    if (!current || saving) return;
    const sentDoc = stateRef.current.doc;
    const name = sigName.trim() || "Untitled signature";
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/signatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: savedId ?? undefined, name, doc: current.parsed }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok || !data?.id) {
        setSaveMsg(res.status === 401 ? "Your session expired. Sign in again, then save." : (data?.message ?? "Could not save. Please try again."));
        return;
      }
      setSavedId(data.id);
      setSigName(name);
      setSavedSnap({ doc: JSON.stringify(sentDoc), name });
      savedDocRef.current = structuredClone(sentDoc);
      setSaveMsg("Saved to your account.");
      // Put the id in the URL so a refresh reopens this signature instead of the generic local draft.
      window.history.replaceState(window.history.state, "", `/editor?s=${data.id}`);
    } catch {
      setSaveMsg("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function restoreDraft() {
    if (!restorable) return;
    replace(fromDoc(restorable.doc), false);
    setRestorable(null);
    setSaveNote("Draft restored from this device.");
  }

  async function onCopy() {
    if (!current) return;
    const out = await exportHtml(current.parsed, current.html, savedId);
    if (!out.ok) return setStatus(out.message);
    setStatus((await copyHtmlRich(out.html)) ? "Copied as rich text. Paste it into your email client's signature box." : "The browser blocked clipboard access. Use Download .htm instead.");
  }

  async function onDownload() {
    if (!current) return;
    const out = await exportHtml(current.parsed, current.html, savedId);
    if (!out.ok) return setStatus(out.message);
    downloadHtm(out.html, `${doc.template_id}-signature.htm`);
  }

  /** Adds a legal disclaimer from a template, or replaces the one the signature already has (a signature has one). */
  const onInsertDisclaimer = (body: string) =>
    update((s) => {
      const blocks = insertDisclaimer(s.doc.blocks, { body });
      return { doc: { ...s.doc, blocks }, ids: blocks.length > s.ids.length ? [...s.ids, newId()] : s.ids };
    });

  if (!ready || !snapshot) {
    return <div className="card h-96 animate-pulse" aria-busy="true" aria-label="Loading editor" />;
  }

  const { doc, ids } = state;
  const theme = doc.theme;
  const unsaved = !savedSnap || savedSnap.doc !== JSON.stringify(doc) || savedSnap.name !== (sigName.trim() || "Untitled signature");

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      {/* ---------- controls ---------- */}
      <div className="min-w-0 space-y-5">
        {polishId && <PolishDeliverBanner requestId={polishId} doc={valid && current ? current.parsed : null} />}
        {showAiNotice && (
          <div role="status" data-testid="ai-notice" className="card flex items-start justify-between gap-3 border-accent bg-accent-soft p-4 text-sm">
            <p>
              <strong className="font-semibold">Here is your AI draft.</strong> Replace any placeholder details (name, email, images), then click anything in the preview to fine-tune it.
            </p>
            <button className="btn shrink-0" onClick={() => setShowAiNotice(false)}>Got it</button>
          </div>
        )}
        {restorable && (
          <div role="status" className="card flex flex-wrap items-center justify-between gap-3 border-accent p-4 text-sm">
            <span>You have an unsaved draft from {new Date(restorable.savedAt).toLocaleString()}.</span>
            <span className="flex gap-2">
              <button className="btn btn-primary" onClick={restoreDraft}>Restore draft</button>
              <button className="btn" onClick={() => setRestorable(null)}>Keep template</button>
            </span>
          </div>
        )}

        <section className="card space-y-3 p-5" aria-label="Save">
          {canSave ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sig-name" className="text-sm font-medium">Signature name</label>
                <input id="sig-name" className="field" maxLength={80} placeholder="e.g. Jane – Sales" value={sigName} onChange={(e) => setSigName(e.target.value)} />
              </div>
              <div className="flex items-center gap-3">
                <button className="btn btn-primary" onClick={onSave} disabled={!valid || saving || !unsaved}>
                  {saving ? "Saving…" : savedId ? "Save changes" : "Save signature"}
                </button>
                <p role="status" aria-live="polite" data-testid="account-save-note" className="text-sm text-muted">
                  {saveMsg || (!valid ? "Fix the highlighted fields to save." : unsaved ? (savedId ? "Unsaved changes." : "Not saved to your account yet.") : "All changes saved.")}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Saving to an account is not set up yet. Your edits stay on this device.</p>
          )}
        </section>

        <AutofillPanel doc={doc} onApply={onAutofill} />

        <section className="card space-y-4 p-5" aria-label="Template and theme">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tpl" className="text-sm font-medium">Template layout</label>
            <select id="tpl" className="field" value={doc.template_id} onChange={(e) => update((s) => ({ ...s, doc: { ...s.doc, template_id: e.target.value as TemplateId } }))}>
              {TEMPLATE_IDS.map((t) => <option key={t} value={t}>{TEMPLATE_META.find((m) => m.id === t)!.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {([["primary", "Accent color"], ["text", "Text color"]] as const).map(([k, label]) => (
              <div key={k} className="flex flex-col gap-1.5">
                <label htmlFor={`c-${k}`} className="text-sm font-medium">{label}</label>
                <input id={`c-${k}`} type="color" value={theme[k]} onChange={(e) => setTheme({ [k]: e.target.value })} className="field w-full cursor-pointer p-1" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="font" className="text-sm font-medium">Font</label>
              <select id="font" className="field" value={theme.font} onChange={(e) => setTheme({ font: e.target.value as typeof theme.font })}>
                {SAFE_FONTS.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="spacing" className="text-sm font-medium">Spacing</label>
              <select id="spacing" className="field" value={theme.spacing} onChange={(e) => setTheme({ spacing: e.target.value as typeof theme.spacing })}>
                {["compact", "normal", "airy"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section aria-label="Blocks" className="space-y-3">
          <h2 className="text-sm font-semibold">Blocks</h2>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="space-y-3">
                {doc.blocks.map((b, i) => (
                  <BlockCard
                    key={ids[i]}
                    id={ids[i]}
                    index={i}
                    count={doc.blocks.length}
                    block={b}
                    errors={errors}
                    isOpen={open === ids[i]}
                    canUpload={canUpload}
                    gifEnabled={gifEnabled}
                    onAsset={(url, info) => setAssets((a) => ({ ...a, [url]: info }))}
                    onToggle={() => setOpen(open === ids[i] ? null : ids[i])}
                    onMove={(dir) => reorder(i, i + dir)}
                    onRemove={() => remove(i)}
                    onPatch={(patch) => setBlock(i, patch)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <div className="flex gap-2">
            <label htmlFor="add-type" className="sr-only">Block type to add</label>
            <select id="add-type" className="field flex-1" value={addType} onChange={(e) => setAddType(e.target.value as BlockType)}>
              {BLOCK_TYPES.map((t) => <option key={t} value={t}>{BLOCK_LABEL[t]}</option>)}
            </select>
            <button className="btn" onClick={add} disabled={doc.blocks.length >= MAX_BLOCKS}>Add block</button>
          </div>
        </section>

        <DisclaimerPicker hasDisclaimer={doc.blocks.some((b) => b.type === "disclaimer")} onInsert={onInsertDisclaimer} />

        {issues ? (
          <CompatPanel issues={issues} onFix={onFix} onFixAll={onFixAll} onSelect={onShowBlock} doc={current?.parsed} />
        ) : (
          <p className="card p-5 text-sm text-muted">Fix the highlighted fields to run the compatibility check.</p>
        )}

        <div className="flex items-center justify-between gap-3 text-sm text-muted">
          <p role="status" aria-live="polite" data-testid="save-note">{saveNote || (localDrafts ? "Edits are saved on this device as you type." : "")}</p>
          <button className="btn" onClick={startOver}>Start over</button>
        </div>
      </div>

      {/* ---------- live preview ---------- */}
      <div className="min-w-0 lg:sticky lg:top-8 lg:self-start">
        <section className="card overflow-hidden" aria-label="Live preview">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-muted">
            <div role="group" aria-label="Email client" className="flex flex-wrap gap-1">
              {CLIENT_IDS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={client === c}
                  onClick={() => setClient(c)}
                  className={`min-h-11 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${client === c ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
                >
                  {CLIENTS[c].label}
                </button>
              ))}
            </div>
            <button className="min-h-11 px-2 font-medium text-accent" aria-pressed={dark} onClick={() => setDark((d) => !d)}>
              {dark ? "Switch to light mode" : "Switch to dark mode"}
            </button>
          </div>
          <LivePreview snapshot={snapshot} dark={dark} client={client} selectedId={open} onPick={onPick} />
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            {valid ? "Click any text or image to edit it." : "Fix the highlighted fields. Showing last valid version."}
            {issues && <> <a href="#compat-h" className="font-medium text-accent underline underline-offset-4">Compatibility {scoreOf(issues)}/100</a></>}
          </p>
        </section>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="btn btn-primary" onClick={onCopy} disabled={!valid}>Copy as rich text</button>
          <button className="btn" disabled={!valid} onClick={onDownload}>Download .htm</button>
        </div>
        <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-muted">{status}</p>
        <GmailPush doc={valid && current ? current.parsed : null} returnTo="/editor" />
      </div>
    </div>
  );
}

type Link = { network: (typeof SOCIAL_NETWORKS)[number]; url: string };

function SocialEditor({ block, index, errors, onChange }: { block: Extract<Block, { type: "social" }>; index: number; errors: Errors; onChange: (links: Link[]) => void }) {
  const links = block.links as Link[];
  const set = (j: number, patch: Partial<Link>) => onChange(links.map((l, k) => (k === j ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-4">
      {links.map((l, j) => {
        const err = errors[`blocks.${index}.links.${j}.url`];
        const id = `f-${index}-link-${j}`;
        return (
          <div key={j} className="flex items-start gap-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-n`} className="text-sm font-medium">Network</label>
              <select id={`${id}-n`} className="field" value={l.network} onChange={(e) => set(j, { network: e.target.value as Link["network"] })}>
                {SOCIAL_NETWORKS.map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor={id} className="text-sm font-medium">URL</label>
              <input id={id} className="field w-full" value={l.url} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} onChange={(e) => set(j, { url: e.target.value })} />
              {err && <p id={`${id}-err`} className="text-xs text-red-600 dark:text-red-400">{err}</p>}
            </div>
            <button className={`${iconBtn} mt-6`} aria-label={`Remove ${l.network} link`} onClick={() => onChange(links.filter((_, k) => k !== j))}>{TRASH}</button>
          </div>
        );
      })}
      {links.length < 8 && <button className="btn" onClick={() => onChange([...links, { network: "twitter", url: "https://" }])}>Add link</button>}
    </div>
  );
}
