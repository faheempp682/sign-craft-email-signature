"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Block, BlockStyle, RowBlock } from "@/lib/schema/document";
import { CLIENTS, CLIENT_IDS, type ClientId } from "@/lib/preview-clients";
import { BLOCK_LABEL, ELEMENT_PRESETS } from "@/lib/editor/blocks";
import {
  MAX_BLOCKS, copyBlocks, duplicateBlock, insertBlock, moveBlock, newBlockId, patchBlock, patchStyle, removeBlocks, renameLayer, toggleHidden, toggleLocked, type EditState,
} from "@/lib/editor/doc-ops";
import { parsePayload, type PaletteDrop } from "@/lib/editor/palette-drag";
import { DesignCanvas, MAX_ZOOM, MIN_ZOOM, type CanvasBg } from "./design-canvas";
import { addRow, createRow, getBlock, insertNested, liftToTop, patchNested, patchNestedStyle, removeNested, ROW_PRESETS, sinkIntoColumn, type BlockPath } from "@/lib/editor/row-ops";
import { DesignInspector } from "./design-inspector";
import { RowEditor } from "./row-editor";
import { LayersPanel } from "./layers-panel";
import { ContextMenu, type MenuItem } from "./context-menu";
import type { Snapshot } from "./live-preview";

type Update = (fn: (s: EditState) => EditState, key?: string) => void;
type Pane = "layers" | "canvas" | "properties";

const tbtn = "grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

export function DesignWorkspace({
  state, update, snapshot, valid, client, setClient, dark, setDark, canUndo, canRedo, onUndo, onRedo, renderContent, renderNestedContent, header, actions, signaturePanel, checkPanel, notices,
}: {
  /** Top bar, left: back link, signature name, view switch. */
  header: ReactNode;
  /** Top bar, right: save / copy / download. */
  actions: ReactNode;
  /** Right panel "Signature" tab: template, theme, autofill, disclaimer. */
  signaturePanel: ReactNode;
  /** Right panel "Check" tab: compatibility results and Gmail push. */
  checkPanel: ReactNode;
  notices: ReactNode;
  state: EditState; update: Update; snapshot: Snapshot; valid: boolean;
  client: ClientId; setClient: (c: ClientId) => void; dark: boolean; setDark: (d: boolean) => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  /** Content fields for one block (supplied by the editor so uploads, crop and GIF keep working). */
  renderContent: (index: number) => ReactNode;
  /** Content fields for a block inside a row's column, addressed by its path (see lib/editor/row-ops.ts). */
  renderNestedContent: (path: BlockPath) => ReactNode;
}) {
  const { doc, ids } = state;
  const [selected, setSelected] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1.25);
  const [bg, setBg] = useState<CanvasBg>("dots");
  const [rightTab, setRightTab] = useState<"design" | "signature" | "check">("design");
  const [pane, setPane] = useState<Pane>("canvas");
  const clip = useRef<Block[]>([]);
  const root = useRef<HTMLDivElement>(null);

  // Selection survives edits by id; drop ids that no longer exist (deleted, undone).
  // Phones and tablets: open zoomed to fit the screen instead of cropping the signature.
  useEffect(() => {
    if (window.innerWidth < 1024) setZoom(Math.max(0.4, Math.min(1.25, +((window.innerWidth - 24) / 640).toFixed(2))));
  }, []);

  const live = selected.filter((id) => ids.includes(id));
  const primaryId = live.length ? live[live.length - 1] : null;
  const primary = primaryId ? ids.indexOf(primaryId) : -1;

  // A block inside a row is selected by the row's stable id plus the path from that row (so it survives moving the row).
  const [nestedSel, setNestedSel] = useState<{ id: string; rest: number[] } | null>(null);

  // The column "Add element" adds into: the row's stable id plus [col] / [col, index, col] ... from that row. Null = add to the bottom.
  const [activeCol, setActiveCol] = useState<{ id: string; rest: number[] } | null>(null);

  const select = useCallback((id: string | null, shift: boolean) => {
    setNestedSel(null);
    setActiveCol(null);
    setSelected((cur) => (id === null ? [] : shift ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
  }, []);

  const idxs = live.map((id) => ids.indexOf(id)).filter((i) => i >= 0);

  const doDuplicate = (ix: number[] = idxs) => {
    if (!ix.length) return;
    const newIds: string[] = [];
    update((s) => {
      let next = s;
      [...ix].sort((a, b) => b - a).forEach((i) => {
        const id = newBlockId();
        newIds.push(id);
        next = duplicateBlock(next, i, id);
      });
      return next;
    });
    setSelected(newIds);
  };
  const doDelete = (ix: number[] = idxs) => {
    if (!ix.length) return;
    update((s) => removeBlocks(s, ix));
    setSelected([]);
  };
  const doCopy = (ix: number[] = idxs) => { clip.current = copyBlocks(state, ix); };
  const doPaste = () => {
    if (!clip.current.length) return;
    const after = idxs.length ? Math.max(...idxs) : ids.length - 1;
    const fresh = clip.current.map(() => newBlockId());
    update((s) => {
      let next = s;
      clip.current.forEach((b, k) => {
        const copy = structuredClone(b) as Block;
        delete copy.locked;
        next = insertBlock(next, copy, after + 1 + k, fresh[k]);
      });
      return next;
    });
    setSelected(fresh);
  };
  // Resolve the active column against the current document (undo or deleting can make it stale).
  const activeColPath: number[] | null = (() => {
    if (!activeCol) return null;
    const at = ids.indexOf(activeCol.id);
    if (at < 0) return null;
    const colPath = [at, ...activeCol.rest];
    const row = getBlock(doc.blocks, colPath.slice(0, -1));
    return row?.type === "row" && row.columns[colPath[colPath.length - 1]] ? colPath : null;
  })();
  const addTarget = activeColPath
    ? `${activeColPath.length === 2 ? "Row" : "Nested row"} ${activeColPath[0] + 1}, column ${activeColPath[activeColPath.length - 1] + 1}`
    : null;
  /** Add a block into the active column and select it. Returns false when there is no active column. */
  const addToColumn = (make: () => Block): boolean => {
    if (!activeColPath || !activeCol) return false;
    const row = getBlock(doc.blocks, activeColPath.slice(0, -1)) as RowBlock;
    const len = row.columns[activeColPath[activeColPath.length - 1]].blocks.length;
    update((s) => insertNested(s, activeColPath, make()));
    setSelected([activeCol.id]);
    setNestedSel({ id: activeCol.id, rest: [...activeCol.rest, len] });
    setRightTab("design");
    setPane("properties");
    return true;
  };

  const addPreset = (presetId: string) => {
    const preset = ELEMENT_PRESETS.find((p) => p.id === presetId);
    if (preset && addToColumn(() => preset.make())) return;
    if (!preset || ids.length >= MAX_BLOCKS) return;
    const id = newBlockId();
    const at = idxs.length ? Math.max(...idxs) + 1 : undefined;
    update((s) => insertBlock(s, preset.make(), at, id));
    setSelected([id]);
    setPane("properties");
  };

  // An element dragged from the left palette onto the canvas: into the column under the pointer, or next to the block there.
  const [paletteDragging, setPaletteDragging] = useState(false);
  const onPaletteDrop = (payload: string, t: PaletteDrop) => {
    setPaletteDragging(false);
    const p = parsePayload(payload);
    const block: Block | null = !p ? null : p.kind === "row" ? createRow(p.id) : ELEMENT_PRESETS.find((x) => x.id === p.id)?.make() ?? null;
    if (!block) return;
    const at = t.id ? ids.indexOf(t.id) : -1;
    if (t.id && at >= 0 && t.nested && t.nested.length >= 2) {
      const rest = t.nested.slice(0, -1);
      const k = t.nested[t.nested.length - 1] + (t.after ? 1 : 0);
      update((s) => insertNested(s, [at, ...rest], block, k));
      setSelected([t.id]);
      setActiveCol({ id: t.id, rest });
      setNestedSel({ id: t.id, rest: [...rest, k] });
    } else {
      if (ids.length >= MAX_BLOCKS) return;
      const id = newBlockId();
      update((s) => insertBlock(s, block, at >= 0 ? at + (t.after ? 1 : 0) : undefined, id));
      setSelected([id]);
      setNestedSel(null);
      setActiveCol(null);
    }
    setRightTab("design");
  };

  const addRowPreset = (presetId: string) => {
    if (addToColumn(() => createRow(presetId))) return;
    if (ids.length >= MAX_BLOCKS) return;
    const id = newBlockId();
    const at = idxs.length ? Math.max(...idxs) + 1 : undefined;
    update((s) => addRow(s, presetId, at, id));
    setSelected([id]);
    setNestedSel(null);
    setRightTab("design");
    setPane("properties");
  };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (!root.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); (e.shiftKey ? onRedo : onUndo)(); }
      else if (mod && k === "y") { e.preventDefault(); onRedo(); }
      else if (mod && k === "d") { e.preventDefault(); doDuplicate(); }
      else if (mod && k === "c") { if (idxs.length) { e.preventDefault(); doCopy(); } }
      else if (mod && k === "v") { e.preventDefault(); doPaste(); }
      else if (mod && k === "a") { e.preventDefault(); setSelected([...ids]); }
      else if (mod && (k === "=" || k === "+")) { e.preventDefault(); setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.1).toFixed(2))); }
      else if (mod && k === "-") { e.preventDefault(); setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(2))); }
      else if (mod && k === "0") { e.preventDefault(); setZoom(1); }
      else if ((k === "delete" || k === "backspace") && nestedPath) { e.preventDefault(); update((s) => removeNested(s, nestedPath)); setNestedSel(null); }
      else if (k === "delete" || k === "backspace") { if (idxs.length) { e.preventDefault(); doDelete(); } }
      else if (k === "escape") setSelected([]);
      else if (e.altKey && (k === "arrowup" || k === "arrowdown") && primary >= 0) { e.preventDefault(); update((s) => moveBlock(s, primary, primary + (k === "arrowup" ? -1 : 1)), "nudge"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setStyle = (patch: Partial<Record<keyof BlockStyle, unknown>>) => {
    const keys = Object.keys(patch).join(",");
    update((s) => {
      // A style edit applies to every selected block, so multi-select styling works as in a design tool.
      let next = s;
      for (const id of live) {
        const i = next.ids.indexOf(id);
        if (i >= 0) next = patchStyle(next, i, patch);
      }
      return next;
    }, `style:${primaryId}:${keys}`);
  };
  const setBlockPatch = (patch: Record<string, unknown>) => {
    if (primary < 0) return;
    update((s) => patchBlock(s, primary, patch), `block:${primaryId}:${Object.keys(patch).join(",")}`);
  };

  const block = primary >= 0 ? doc.blocks[primary] : null;
  const nestedPath: BlockPath | null = nestedSel && block?.type === "row" && primaryId === nestedSel.id ? [primary, ...nestedSel.rest] : null;
  const nestedBlock = nestedPath ? getBlock(doc.blocks, nestedPath) : undefined;
  const movable = doc.blocks.flatMap((b, i) => (i === primary || b.locked ? [] : [{ index: i, label: b.layer || BLOCK_LABEL[b.type] }]));
  const onSink = (topIndex: number, dest: readonly number[]) => update((s) => sinkIntoColumn(s, topIndex, dest));
  const moveOut = () => {
    if (!nestedPath) return;
    const id = newBlockId();
    update((s) => liftToTop(s, nestedPath, primary + 1, id));
    setSelected([id]);
    setNestedSel(null);
  };

  /* ---------- right-click menu + mobile action bar ---------- */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null } | null>(null);
  const [editReq, setEditReq] = useState<{ id: string; n: number } | null>(null);
  const styleClip = useRef<BlockStyle | null>(null);
  const INLINE = ["identity", "text", "button", "disclaimer", "contact"];
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const requestEdit = (id: string) => setEditReq({ id, n: Date.now() });
  const openMenu = (id: string | null, x: number, y: number) => {
    if (id && !live.includes(id)) setSelected([id]);
    setMenu({ x, y, id });
  };
  const menuItems = (): MenuItem[] => {
    const id = menu?.id ?? null;
    const at = id ? ids.indexOf(id) : -1;
    const b = at >= 0 ? doc.blocks[at] : null;
    const target = id ? (live.includes(id) ? idxs : [at]) : [];
    const mod = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";
    if (!b || !id) {
      return [
        { label: "Paste", hint: `${mod}V`, onClick: doPaste, disabled: !clip.current.length },
        { label: "Select all", hint: `${mod}A`, onClick: () => setSelected([...ids]) },
        { kind: "sep" },
        { kind: "heading", label: "Add row" },
        ...ROW_PRESETS.map((p): MenuItem => ({ label: `Row · ${p.label}`, onClick: () => addRowPreset(p.id), disabled: ids.length >= MAX_BLOCKS })),
        { kind: "sep" },
        { kind: "heading", label: "Add element" },
        ...ELEMENT_PRESETS.map((p): MenuItem => ({ label: p.label, onClick: () => addPreset(p.id), disabled: ids.length >= MAX_BLOCKS })),
      ];
    }
    const textual = !["avatar", "banner", "divider", "spacer"].includes(b.type);
    return [
      ...(INLINE.includes(b.type) ? [{ label: "Edit text", hint: "Double-click", onClick: () => requestEdit(id), disabled: !!b.locked } as MenuItem] : []),
      { label: "Rename layer", onClick: () => { const n = window.prompt("Layer name", b.layer ?? ""); if (n !== null) update((s) => renameLayer(s, at, n)); } },
      { kind: "sep" },
      { label: "Duplicate", hint: `${mod}D`, onClick: () => doDuplicate(target), disabled: ids.length >= MAX_BLOCKS },
      { label: "Copy", hint: `${mod}C`, onClick: () => doCopy(target) },
      { label: "Paste", hint: `${mod}V`, onClick: doPaste, disabled: !clip.current.length },
      { label: "Copy style", onClick: () => { styleClip.current = b.style ? structuredClone(b.style) : null; }, disabled: !b.style },
      { label: "Paste style", onClick: () => { const st = styleClip.current; if (st) setStyle(Object.fromEntries(Object.entries(st))); }, disabled: !styleClip.current || !!b.locked },
      { kind: "sep" },
      { label: "Move up", hint: "Alt+↑", onClick: () => update((s) => moveBlock(s, at, at - 1)), disabled: at === 0 || !!b.locked },
      { label: "Move down", hint: "Alt+↓", onClick: () => update((s) => moveBlock(s, at, at + 1)), disabled: at === ids.length - 1 || !!b.locked },
      { label: "Move to top", onClick: () => update((s) => moveBlock(s, at, 0)), disabled: at === 0 || !!b.locked },
      { label: "Move to bottom", onClick: () => update((s) => moveBlock(s, at, s.ids.length - 1)), disabled: at === ids.length - 1 || !!b.locked },
      ...(textual
        ? ([
            { kind: "sep" },
            { label: "Align left", onClick: () => setStyle({ align: "left" }) },
            { label: "Align center", onClick: () => setStyle({ align: "center" }) },
            { label: "Align right", onClick: () => setStyle({ align: "right" }) },
          ] as MenuItem[])
        : []),
      { kind: "sep" },
      { label: b.hidden ? "Show" : "Hide", onClick: () => update((s) => toggleHidden(s, at)) },
      { label: b.locked ? "Unlock" : "Lock", onClick: () => update((s) => toggleLocked(s, at)) },
      { label: "Reset design", onClick: () => update((s) => patchBlock(s, at, { style: undefined })), disabled: !b.style || !!b.locked },
      { kind: "sep" },
      { label: "Delete", hint: "Del", danger: true, onClick: () => doDelete(target), disabled: !!b.locked },
    ];
  };

  const bump = (dir: 1 | -1) => {
    if (!block) return;
    if (block.type === "avatar") setBlockPatch({ size: clamp(block.size + dir * 8, 32, 200) });
    else if (block.type === "banner") {
      const w = clamp(block.width + dir * 20, 100, 600);
      setBlockPatch({ width: w, height: clamp(Math.round((w * block.height) / block.width), 20, 300) });
    } else if (block.type === "spacer") setBlockPatch({ height: clamp(block.height + dir * 4, 4, 80) });
    else setStyle({ fontSize: clamp((block.style?.fontSize ?? 14) + dir * 2, 8, 48) });
  };
  const barBtn = "flex min-h-14 min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 px-2 text-[11px] font-medium text-muted active:bg-surface-2 disabled:opacity-35";

  const panelCls = "flex min-h-0 flex-col overflow-hidden bg-card";
  const zoomBtn = "grid h-8 min-w-8 place-items-center rounded-md px-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30";
  return (
    <div ref={root} data-testid="design-workspace" className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* ---------- top bar ---------- */}
      <header role="toolbar" aria-label="Editor tools" className="flex shrink-0 items-center gap-x-2 gap-y-1 overflow-x-auto border-b border-line bg-card px-3 py-2 [&>*]:shrink-0 lg:flex-wrap lg:overflow-visible">
        <div className="flex min-w-0 items-center gap-2">{header}</div>
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        <button type="button" className={tbtn} onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
        <button type="button" className={tbtn} onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷</button>
        <span className="mx-1 hidden h-6 w-px bg-line md:block" aria-hidden="true" />
        <div className="hidden items-center gap-0.5 md:flex">
          <button type="button" className={tbtn} onClick={() => doDuplicate()} disabled={!idxs.length || ids.length >= MAX_BLOCKS} aria-label="Duplicate" title="Duplicate (Ctrl+D)">⧉</button>
          <button type="button" className={tbtn} onClick={() => doCopy()} disabled={!idxs.length} aria-label="Copy" title="Copy (Ctrl+C)">Copy</button>
          <button type="button" className={tbtn} onClick={doPaste} aria-label="Paste" title="Paste (Ctrl+V)">Paste</button>
          <button type="button" className={tbtn} onClick={() => doDelete()} disabled={!idxs.length} aria-label="Delete selection" title="Delete (Del)">Delete</button>
        </div>
        <div className="ml-auto flex items-center gap-2 [&>*]:shrink-0">
          <label className="flex items-center gap-1 text-xs text-muted">
            <span className="sr-only md:not-sr-only">Preview</span>
            <select className="field h-9 px-2 text-sm" value={client} onChange={(e) => setClient(e.target.value as ClientId)} aria-label="Email client preview">
              {CLIENT_IDS.map((c) => (
                <option key={c} value={c}>{CLIENTS[c].label}</option>
              ))}
            </select>
          </label>
          <button type="button" className={tbtn} aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? "Light" : "Dark"}</button>
          {actions}
        </div>
      </header>
      {notices && <div className="max-h-40 shrink-0 space-y-2 overflow-y-auto px-3 pt-2 empty:hidden">{notices}</div>}

      <div role="tablist" aria-label="Workspace panels" className="flex shrink-0 gap-1 px-3 py-1 lg:hidden">
        {(["layers", "canvas", "properties"] as const).map((p) => (
          <button key={p} role="tab" aria-selected={pane === p} onClick={() => setPane(p)} className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-medium ${pane === p ? "bg-accent-soft text-accent" : "text-muted"}`}>
            {p[0].toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* ---------- three docked panes ---------- */}
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[272px_minmax(0,1fr)_336px]">
        <section aria-label="Layers and elements" className={`${panelCls} border-r border-line ${pane === "layers" ? "" : "hidden"} lg:flex`}>
          <LayersPanel
            blocks={doc.blocks}
            ids={ids}
            selected={live}
            atLimit={ids.length >= MAX_BLOCKS}
            onSelect={(id, shift) => select(id, shift)}
            onReorder={(from, to) => update((s) => moveBlock(s, from, to))}
            onRename={(i, name) => update((s) => renameLayer(s, i, name))}
            onHide={(i) => update((s) => toggleHidden(s, i))}
            onLock={(i) => update((s) => toggleLocked(s, i))}
            onDuplicate={(i) => { const id = newBlockId(); update((s) => duplicateBlock(s, i, id)); setSelected([id]); }}
            onDelete={(i) => { update((s) => removeBlocks(s, [i])); setSelected([]); }}
            onAdd={addPreset}
            onAddRow={addRowPreset}
            addTarget={addTarget}
            onPaletteDrag={setPaletteDragging}
            onClearTarget={() => setActiveCol(null)}
          />
        </section>

        <section aria-label="Canvas" className={`relative min-h-0 min-w-0 overflow-hidden ${pane === "canvas" ? "flex" : "hidden"} flex-col lg:flex`}>
          <div className="min-h-0 flex-1">
            <DesignCanvas
              snapshot={snapshot}
              ids={ids}
              blocks={doc.blocks}
              selected={live}
              client={client}
              dark={dark}
              zoom={zoom}
              bg={bg}
              onZoom={setZoom}
              onContext={openMenu}
              editRequest={editReq}
              onPaletteDrop={onPaletteDrop}
              paletteDragging={paletteDragging}
              onPick={(id, shift, hint) => {
                select(id, shift);
                // A click inside a row (a block or an empty-column placeholder) targets that column, and a real block is selected.
                if (id && !shift && hint?.nested) {
                  setActiveCol({ id, rest: hint.nested.slice(0, -1) });
                  const at = ids.indexOf(id);
                  if (at >= 0 && getBlock(doc.blocks, [at, ...hint.nested])) setNestedSel({ id, rest: hint.nested });
                }
              }}
              onResize={(id, patch) => update((s) => { const i = s.ids.indexOf(id); return i < 0 ? s : patchBlock(s, i, patch); }, `resize:${id}`)}
              onMove={(from, to) => update((s) => moveBlock(s, from, to))}
              onInlineEdit={(id, key, value) => update((s) => { const i = s.ids.indexOf(id); return i < 0 ? s : patchBlock(s, i, { [key]: value === "" ? undefined : value }); })}
            />
          </div>
          <div className={`pointer-events-none absolute inset-x-0 flex justify-center ${block ? "bottom-20 lg:bottom-4" : "bottom-4"}`}>
            <div role="group" aria-label="Canvas controls" className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-line bg-card px-1.5 py-1 shadow-lg">
              <button type="button" className={zoomBtn} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">−</button>
              <button type="button" className={`${zoomBtn} w-14 tabular-nums`} onClick={() => setZoom(1)} aria-label="Reset zoom to 100%" data-testid="zoom-value">{Math.round(zoom * 100)}%</button>
              <button type="button" className={zoomBtn} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">+</button>
              <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
              <select className="h-8 rounded-md bg-transparent px-1 text-sm text-muted" value={bg} onChange={(e) => setBg(e.target.value as CanvasBg)} aria-label="Canvas background">
                <option value="dots">Dotted</option>
                <option value="white">White</option>
                <option value="checker">Transparent</option>
                <option value="gray">Gray</option>
              </select>
            </div>
          </div>
          <button type="button" aria-label="Open layers" onClick={() => setPane("layers")} className={`absolute right-3 grid h-12 w-12 place-items-center rounded-full bg-accent text-white shadow-lg lg:hidden ${block ? "bottom-36" : "bottom-20"}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5" /></svg>
          </button>
          {block && (
            <div role="toolbar" aria-label="Selected element" data-testid="mobile-bar" className="absolute inset-x-0 bottom-0 flex overflow-x-auto border-t border-line bg-card lg:hidden">
              <button type="button" className={barBtn} disabled={!!block.locked} onClick={() => (INLINE.includes(block.type) ? requestEdit(ids[primary]) : (setRightTab("design"), setPane("properties")))}><span aria-hidden="true">✎</span>Edit</button>
              <button type="button" className={barBtn} onClick={() => { setRightTab("design"); setPane("properties"); }}><span aria-hidden="true" className="font-serif text-base">F</span>Style</button>
              <button type="button" className={barBtn} disabled={!!block.locked} onClick={() => bump(-1)}><span aria-hidden="true">A−</span>Smaller</button>
              <button type="button" className={barBtn} disabled={!!block.locked} onClick={() => bump(1)}><span aria-hidden="true">A+</span>Larger</button>
              <label className={`${barBtn} cursor-pointer`}>
                <input type="color" aria-label="Color" className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0" disabled={!!block.locked} value={(["avatar", "banner", "divider", "spacer"].includes(block.type) ? block.style?.bg : block.style?.color) ?? "#000000"} onChange={(e) => (["avatar", "banner", "divider", "spacer"].includes(block.type) ? setStyle({ bg: e.target.value.toUpperCase() }) : setStyle({ color: e.target.value.toUpperCase() }))} />
                Color
              </label>
              <button type="button" className={barBtn} disabled={primary === 0 || !!block.locked} onClick={() => update((s) => moveBlock(s, primary, primary - 1))}><span aria-hidden="true">↑</span>Up</button>
              <button type="button" className={barBtn} disabled={primary === ids.length - 1 || !!block.locked} onClick={() => update((s) => moveBlock(s, primary, primary + 1))}><span aria-hidden="true">↓</span>Down</button>
              <button type="button" className={barBtn} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(ids[primary], r.left, r.top - 8); }}><span aria-hidden="true">⋯</span>More</button>
              <button type="button" className={`${barBtn} text-red-600`} disabled={!!block.locked} onClick={() => doDelete()}><span aria-hidden="true">✕</span>Delete</button>
            </div>
          )}
          {!valid && <p className="absolute left-3 top-3 rounded-lg bg-amber-100 px-3 py-1.5 text-xs text-amber-900 shadow">Fix the highlighted fields. Showing last valid version.</p>}
        </section>

        <section aria-label="Properties" className={`${panelCls} border-l border-line ${pane === "properties" ? "" : "hidden"} lg:flex`}>
          <div role="tablist" aria-label="Right panel" className="flex shrink-0 border-b border-line">
            {([["design", "Design"], ["signature", "Signature"], ["check", "Check"]] as const).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={rightTab === t} onClick={() => setRightTab(t)} className={`flex-1 px-3 py-2.5 text-sm font-medium ${rightTab === t ? "border-b-2 border-accent text-accent" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rightTab === "design" && (
              nestedPath && nestedBlock ? (
                <div data-testid="nested-inspector">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 border-b border-line px-4 text-left text-sm font-medium text-accent hover:bg-surface-2"
                    onClick={() => setNestedSel(nestedSel && nestedSel.rest.length > 2 ? { id: nestedSel.id, rest: nestedSel.rest.slice(0, -2) } : null)}
                  >
                    <span aria-hidden="true">←</span> Back to row
                  </button>
                  <button type="button" className="flex min-h-11 w-full items-center gap-2 border-b border-line px-4 text-left text-sm text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40" disabled={ids.length >= MAX_BLOCKS || !!block?.locked} onClick={moveOut}>
                    <span aria-hidden="true">⇱</span> Move out of the row
                  </button>
                  <DesignInspector
                    block={nestedBlock}
                    index={nestedPath[nestedPath.length - 1]}
                    count={((getBlock(doc.blocks, nestedPath.slice(0, -2)) as RowBlock | undefined)?.columns[nestedPath[nestedPath.length - 2]]?.blocks.length) ?? 1}
                    setStyle={(patch) => update((s) => patchNestedStyle(s, nestedPath, patch), `nstyle:${nestedPath.join(".")}:${Object.keys(patch).join(",")}`)}
                    setBlock={(patch) => update((s) => patchNested(s, nestedPath, patch), `nblock:${nestedPath.join(".")}:${Object.keys(patch).join(",")}`)}
                    content={
                      nestedBlock.type === "row" ? (
                        <RowEditor row={nestedBlock} rowPath={nestedPath} locked={!!block?.locked} update={update} movable={movable} onSink={onSink} activeColumn={activeColPath} onActivateColumn={(cp) => nestedSel && setActiveCol({ id: nestedSel.id, rest: cp.slice(1) })} onSelectNested={(p) => setNestedSel({ id: nestedSel!.id, rest: p.slice(1) })} />
                      ) : (
                        renderNestedContent(nestedPath)
                      )
                    }
                  />
                </div>
              ) : (
                <DesignInspector
                  block={block}
                  index={primary}
                  count={doc.blocks.length}
                  setStyle={setStyle}
                  setBlock={setBlockPatch}
                  content={
                    block?.type === "row" ? (
                      <RowEditor row={block} rowPath={[primary]} locked={!!block.locked} update={update} movable={movable} onSink={onSink} activeColumn={activeColPath} onActivateColumn={(cp) => setActiveCol({ id: primaryId!, rest: cp.slice(1) })} onSelectNested={(p) => setNestedSel({ id: primaryId!, rest: p.slice(1) })} />
                    ) : primary >= 0 ? (
                      renderContent(primary)
                    ) : null
                  }
                />
              )
            )}
            {rightTab === "signature" && <div className="space-y-4 p-3">{signaturePanel}</div>}
            {rightTab === "check" && <div className="space-y-4 p-3">{checkPanel}</div>}
          </div>
        </section>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} label={menu.id ? "Element actions" : "Canvas actions"} onClose={() => setMenu(null)} />}
    </div>
  );
}
