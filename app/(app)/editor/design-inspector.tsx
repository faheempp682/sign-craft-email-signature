"use client";

import type { ReactNode } from "react";
import { SAFE_FONTS, GRADIENT_DIRECTIONS, type Block, type BlockStyle } from "@/lib/schema/document";
import { BLOCK_LABEL } from "@/lib/editor/blocks";
import { STYLE_SUPPORT, styleWarnings } from "@/lib/renderer/block-style";

/* ---------- small controls ---------- */

const lab = "text-xs font-medium text-muted";
const seg = (on: boolean) =>
  `grid h-9 min-w-9 place-items-center rounded-lg border px-2 text-sm font-medium transition-colors ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-2 hover:text-ink"}`;

/** Tells the user when a property is design-only or only partly honoured by email clients. */
function SupportNote({ k }: { k: keyof BlockStyle }) {
  const s = STYLE_SUPPORT[k];
  if (s.level === "full") return null;
  return (
    <p className={`text-[11px] ${s.level === "none" ? "text-amber-700 dark:text-amber-400" : "text-muted"}`} data-support={s.level}>
      {s.level === "none" ? "Design only. " : "Partial support. "}
      {s.note}
    </p>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-4 py-4" aria-label={title}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function Num({ label, value, onChange, min = 0, max = 100, step = 1, suffix = "px" }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={lab}>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          className="field h-9 w-full px-2 text-sm"
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          placeholder="auto"
          onChange={(e) => {
            if (e.target.value === "") return onChange(undefined);
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
        />
        <span className="text-[11px] text-muted">{suffix}</span>
      </span>
    </label>
  );
}

export function Color({ label, value, onChange, fallback = "#000000" }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; fallback?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={lab}>{label}</span>
      <span className="flex items-center gap-1">
        <input aria-label={label} type="color" className="field h-9 w-11 cursor-pointer p-1" value={value ?? fallback} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <button type="button" className="text-[11px] text-muted underline underline-offset-2 disabled:opacity-30" disabled={!value} onClick={() => onChange(undefined)}>
          {value ? "Reset" : "Default"}
        </button>
      </span>
    </div>
  );
}

/* ---------- inspector ---------- */

const TEXTY = new Set<Block["type"]>(["identity", "contact", "social", "text", "button", "disclaimer", "icontext"]);
const BOXED = new Set<Block["type"]>(["identity", "contact", "social", "text", "disclaimer", "avatar", "banner", "icontext"]);

export function DesignInspector({
  block,
  index,
  count,
  setStyle,
  setBlock,
  content,
}: {
  block: Block | null;
  index: number;
  count: number;
  setStyle: (patch: Partial<Record<keyof BlockStyle, unknown>>) => void;
  setBlock: (patch: Record<string, unknown>) => void;
  /** The block's content fields (text, upload/crop, links), supplied by the editor so uploads keep working. */
  content: ReactNode;
}) {
  if (!block) {
    return (
      <div className="p-4 text-sm text-muted" data-testid="inspector-empty">
        <p className="font-medium text-ink">Nothing selected</p>
        <p className="mt-1">Click any element on the canvas or in Layers to edit its content and design.</p>
      </div>
    );
  }
  const s: BlockStyle = block.style ?? {};
  const disabled = !!block.locked;
  const warns = styleWarnings(block.style);
  const g = s.gradient;
  const type = block.type;

  return (
    <fieldset disabled={disabled} className="min-w-0" data-testid="inspector" aria-label={`${BLOCK_LABEL[type]} properties`}>
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold">{block.layer || BLOCK_LABEL[type]}</p>
        <p className="text-xs text-muted">
          {BLOCK_LABEL[type]} · layer {index + 1} of {count}
          {disabled && " · locked (unlock it in Layers to edit)"}
        </p>
      </div>

      <Section title="Content">
        <div className="space-y-4">{content}</div>
      </Section>

      {type === "avatar" && (
        <Section title="Image">
          <div className="flex gap-1" role="group" aria-label="Image shape">
            {(["circle", "rounded", "square", "arch"] as const).map((sh) => (
              <button key={sh} type="button" aria-pressed={block.shape === sh} className={seg(block.shape === sh)} onClick={() => setBlock({ shape: sh })}>
                {sh === "circle" ? "Circle" : sh[0].toUpperCase() + sh.slice(1)}
              </button>
            ))}
          </div>
          <Num label="Size (square)" value={block.size} min={32} max={200} onChange={(v) => v !== undefined && setBlock({ size: v })} />
          <p className="text-[11px] text-muted">Rounded shapes show square in Outlook desktop.</p>
        </Section>
      )}
      {type === "banner" && (
        <Section title="Banner">
          <div className="grid grid-cols-2 gap-3">
            <Num label="Width" value={block.width} min={100} max={600} onChange={(v) => v !== undefined && setBlock({ width: v })} />
            <Num label="Height" value={block.height} min={20} max={300} onChange={(v) => v !== undefined && setBlock({ height: v })} />
          </div>
        </Section>
      )}
      {type === "icontext" && (
        <Section title="Icon">
          <Color label="Icon color" value={block.iconColor} fallback="#4F46E5" onChange={(v) => setBlock({ iconColor: v })} />
          <p className="text-[11px] text-muted">{block.src ? "Your own icon is used as uploaded; the color applies to built-in icons." : "Icons sit on a colored circle. Outlook desktop shows a square."}</p>
        </Section>
      )}
      {type === "spacer" && (
        <Section title="Spacing">
          <Num label="Height" value={block.height} min={4} max={80} onChange={(v) => v !== undefined && setBlock({ height: v })} />
        </Section>
      )}

      {TEXTY.has(type) && (
        <Section title="Text">
          <label className="flex flex-col gap-1">
            <span className={lab}>Font</span>
            <select className="field h-9 px-2 text-sm" value={s.fontFamily ?? ""} onChange={(e) => setStyle({ fontFamily: e.target.value || undefined })}>
              <option value="">Signature font</option>
              {SAFE_FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Num label="Size" value={s.fontSize} min={8} max={48} onChange={(v) => setStyle({ fontSize: v })} />
            <Num label="Line height" value={s.lineHeight} min={8} max={80} onChange={(v) => setStyle({ lineHeight: v })} />
            <Num label="Letter spacing" value={s.letterSpacing} min={-2} max={10} step={0.5} onChange={(v) => setStyle({ letterSpacing: v })} />
            <Color label="Text color" value={s.color} onChange={(v) => setStyle({ color: v })} />
          </div>
          <SupportNote k="letterSpacing" />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Text style">
            <button type="button" aria-label="Bold" aria-pressed={s.fontWeight === "bold"} className={`${seg(s.fontWeight === "bold")} font-bold`} onClick={() => setStyle({ fontWeight: s.fontWeight === "bold" ? undefined : "bold" })}>B</button>
            <button type="button" aria-label="Italic" aria-pressed={!!s.italic} className={`${seg(!!s.italic)} italic`} onClick={() => setStyle({ italic: s.italic ? undefined : true })}>I</button>
            <button type="button" aria-label="Underline" aria-pressed={!!s.underline} className={`${seg(!!s.underline)} underline`} onClick={() => setStyle({ underline: s.underline ? undefined : true })}>U</button>
            <button type="button" aria-label="Strikethrough" aria-pressed={!!s.strike} className={`${seg(!!s.strike)} line-through`} onClick={() => setStyle({ strike: s.strike ? undefined : true })}>S</button>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Alignment">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={s.align === a} className={seg(s.align === a)} onClick={() => setStyle({ align: s.align === a ? undefined : a })}>
                {a[0].toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className={lab}>Capitalisation</span>
            <select className="field h-9 px-2 text-sm" value={s.textTransform ?? "none"} onChange={(e) => setStyle({ textTransform: e.target.value === "none" ? undefined : e.target.value })}>
              <option value="none">As typed</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize Each Word</option>
            </select>
          </label>
          <SupportNote k="textTransform" />
        </Section>
      )}

      {BOXED.has(type) && (
        <Section title="Background & border">
          <div className="grid grid-cols-2 gap-3">
            <Color label="Background" value={s.bg} fallback="#FFFFFF" onChange={(v) => setStyle({ bg: v })} />
            <Color label="Border color" value={s.borderColor} onChange={(v) => setStyle({ borderColor: v })} />
            <Num label="Border width" value={s.borderWidth} max={8} onChange={(v) => setStyle({ borderWidth: v })} />
            <Num label="Corner radius" value={s.borderRadius} max={60} onChange={(v) => setStyle({ borderRadius: v })} />
          </div>
          <SupportNote k="borderRadius" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!g} onChange={(e) => setStyle({ gradient: e.target.checked ? { from: s.bg ?? "#4F46E5", to: "#06B6D4", direction: "to-right", opacity: 1 } : undefined })} />
            Gradient background
          </label>
          {g && (
            <div className="space-y-3 rounded-lg border border-line p-3" data-testid="gradient-controls">
              <div className="grid grid-cols-2 gap-3">
                <Color label="Start" value={g.from} onChange={(v) => v && setStyle({ gradient: { ...g, from: v } })} />
                <Color label="End" value={g.to} onChange={(v) => v && setStyle({ gradient: { ...g, to: v } })} />
              </div>
              <label className="flex flex-col gap-1">
                <span className={lab}>Direction</span>
                <select className="field h-9 px-2 text-sm" value={g.direction} onChange={(e) => setStyle({ gradient: { ...g, direction: e.target.value } })}>
                  {GRADIENT_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>{d.replace("to-", "to ")}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={lab}>Gradient opacity {Math.round(g.opacity * 100)}%</span>
                <input type="range" min={0} max={1} step={0.05} value={g.opacity} onChange={(e) => setStyle({ gradient: { ...g, opacity: Number(e.target.value) } })} />
              </label>
              <SupportNote k="gradient" />
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className={lab}>Element opacity {Math.round((s.opacity ?? 1) * 100)}%</span>
            <input type="range" min={0.1} max={1} step={0.05} value={s.opacity ?? 1} onChange={(e) => setStyle({ opacity: Number(e.target.value) >= 1 ? undefined : Number(e.target.value) })} />
          </label>
          <SupportNote k="opacity" />
        </Section>
      )}

      {type !== "spacer" && (
        <Section title="Spacing">
          <div className="grid grid-cols-2 gap-3">
            <Num label="Padding top" value={s.paddingTop} max={60} onChange={(v) => setStyle({ paddingTop: v })} />
            <Num label="Padding right" value={s.paddingRight} max={60} onChange={(v) => setStyle({ paddingRight: v })} />
            <Num label="Padding bottom" value={s.paddingBottom} max={60} onChange={(v) => setStyle({ paddingBottom: v })} />
            <Num label="Padding left" value={s.paddingLeft} max={60} onChange={(v) => setStyle({ paddingLeft: v })} />
            <Num label="Space above" value={s.marginTop} max={60} onChange={(v) => setStyle({ marginTop: v })} />
            <Num label="Space below" value={s.marginBottom} max={60} onChange={(v) => setStyle({ marginBottom: v })} />
          </div>
        </Section>
      )}

      <Section title="Visibility & export">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!block.hidden} onChange={(e) => setBlock({ hidden: e.target.checked ? undefined : true })} />
          Show in signature
        </label>
        {warns.length ? (
          <ul className="space-y-1 text-[11px] text-muted" aria-label="Email support for the properties you set">
            {warns.map((w) => (
              <li key={w.key}>
                <strong className="font-semibold text-ink">{w.key}</strong>: {w.support.level === "none" ? "design only" : "partial"}. {w.support.note}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted">Everything set here is fully supported by email clients.</p>
        )}
        {block.style && (
          <button type="button" className="btn text-xs" onClick={() => setBlock({ style: undefined })}>
            Reset design
          </button>
        )}
      </Section>
    </fieldset>
  );
}
