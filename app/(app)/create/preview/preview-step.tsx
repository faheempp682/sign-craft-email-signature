"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SignaturePreview } from "@/components/signature-preview";
import { SignaturePreviewDialog } from "@/components/signature-preview-dialog";
import { applyDetailsPreview, applyImages, type Details, type SlotImage } from "@/lib/create/fill";
import { applyBrand, type Brand } from "@/lib/create/brand";
import { loadBrand, loadDetails, loadImages } from "@/lib/create/session";
import { PRESETS, getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { cn } from "@/lib/utils";

const PAGE = 12;
/** Each ticked template is a live preview frame; this keeps the page light. */
const MAX_PICKED = 8;

export function PreviewStep({ initialId }: { initialId: string }) {
  const router = useRouter();
  const [details, setDetails] = useState<Details | null | undefined>(undefined); // undefined = not read yet
  const [brand, setBrand] = useState<Brand | null>(null); // colours read from their logo in the studio
  const [images, setImages] = useState<Record<string, SlotImage>>({}); // photos or logos added in the studio
  const [picked, setPicked] = useState<string[]>([initialId]); // in the order they were ticked
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState("");
  const newest = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    const d = loadDetails();
    if (!d) router.replace(`/create?t=${encodeURIComponent(initialId)}`); // opened in a new tab: ask again
    setDetails(d);
    setImages(loadImages());
    setBrand(loadBrand());
  }, [initialId, router]);

  // Their brand colours apply only while a logo or photo of theirs is in place, the same as in the studio.
  const activeBrand = Object.keys(images).some((k) => k.startsWith("avatar")) ? brand : null;

  // The one they chose first, then the rest in library order.
  const list = useMemo(() => [...PRESETS.filter((p) => p.id === initialId), ...PRESETS.filter((p) => p.id !== initialId)], [initialId]);
  const cache = useMemo(() => (details ? new Map<string, string>() : null), [details]);
  const htmlFor = (id: string): string => {
    if (!details || !cache) return "";
    const key = `${id}|${JSON.stringify(images)}|${JSON.stringify(activeBrand)}`; // a new image must not reuse an older render
    let html = cache.get(key);
    if (html === undefined) {
      const p = getPreset(id);
      html = p ? renderToEmailHtml(applyDetailsPreview(applyImages(applyBrand(p.doc, activeBrand), images), details)) : ""; // the template's sample fills whatever they left blank
      cache.set(key, html);
    }
    return html;
  };

  // A newly ticked template appears at the bottom of the right-hand list; bring it into view.
  const lastPicked = picked[picked.length - 1];
  useEffect(() => {
    if (picked.length > 1) newest.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    // only when something was added
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.length]);

  if (!details) return <p className="py-10 text-center text-muted">Loading your details…</p>;

  const toggle = (id: string) => {
    setError("");
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_PICKED) {
        setError(`You can compare up to ${MAX_PICKED} at a time. Untick one to add another.`);
        return cur;
      }
      return [...cur, id];
    });
  };

  /** Back to the simple form with this template open. Their details, photos and colours are kept in the session. */
  function choose(id: string) {
    if (!getPreset(id)) return;
    router.push(`/create?t=${encodeURIComponent(id)}`);
  }

  const previewing = previewId ? getPreset(previewId) : undefined;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="eyebrow mb-2">Step 3 of 3</p>
          <h1 className="text-3xl font-semibold tracking-tight">Compare and choose.</h1>
          <p className="mt-3 text-muted">
            Tick the templates you like and they appear on the right with your details. Use <strong className="font-medium text-ink">Preview</strong> to see one at the bottom of an email in Gmail, Outlook and more.
          </p>
        </div>
        <Link href={`/create?t=${encodeURIComponent(initialId)}`} className="btn shrink-0">&larr; Back to editing</Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <aside aria-label="Templates" className="order-2 lg:sticky lg:top-4 lg:order-1 lg:max-h-[calc(100vh-13rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Templates ({picked.length} ticked)</h2>
          <ul className="space-y-3">
            {list.slice(0, shown).map((p) => {
              const on = picked.includes(p.id);
              return (
                <li key={p.id} data-template={p.id} className={cn("relative overflow-hidden rounded-xl border bg-card transition-all duration-150", on ? "border-line shadow-md" : "border-line hover:border-ink/40")}>
                  <label className="block cursor-pointer">
                    <SignaturePreview title={`${p.name} with your details`} html={htmlFor(p.id)} height={120} className="border-b border-line" />
                    <span className="block px-3 py-2.5">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block text-xs text-muted">{p.category}</span>
                    </span>
                    {/* A round badge in the top corner: empty ring until ticked, then the brand colour with a check. */}
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(p.id)}
                      aria-label={`Compare ${p.name}`}
                      className="peer absolute right-2.5 top-2.5 z-10 size-6 cursor-pointer appearance-none rounded-full border-2 border-white bg-white/80 shadow-sm ring-1 ring-black/15 transition-colors duration-150 checked:border-white checked:bg-brand checked:ring-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    />
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute right-2.5 top-2.5 z-20 size-6 scale-50 text-white opacity-0 transition duration-150 peer-checked:scale-100 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 12.5l3.2 3.2L17 8.8" />
                    </svg>
                  </label>
                </li>
              );
            })}
          </ul>
          {shown < list.length && (
            <button type="button" className="btn mt-4 w-full" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({list.length - shown} left)
            </button>
          )}
        </aside>

        <section aria-label="Your picks" className="order-1 lg:order-2">
          {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          {picked.length === 0 ? (
            <div className="card p-8 text-center text-muted">Tick a template on the left and it will show here with your details.</div>
          ) : (
            <ul className="space-y-5">
              {picked.map((id) => {
                const p = getPreset(id);
                if (!p) return null;
                return (
                  <li key={id} ref={id === lastPicked ? newest : undefined} data-picked={id} className="card overflow-hidden">
                    <SignaturePreview title={`${p.name} with your details (picked)`} html={htmlFor(id)} height={260} lazy={false} className="border-b border-line" />
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold">{p.name}</h2>
                        <p className="text-sm text-muted">{p.category}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn" onClick={() => toggle(id)} aria-label={`Remove ${p.name}`}>Remove</button>
                        <button type="button" className="btn" onClick={() => setPreviewId(id)} aria-label={`Preview ${p.name} in an email`}>Preview</button>
                        <button type="button" className="btn btn-primary min-h-11" onClick={() => choose(id)} aria-label={`Choose ${p.name}`}>Choose</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-5 text-sm text-muted">
            Still not what you wanted?{" "}
            <Link href="/create/customize" className="font-medium text-ink underline underline-offset-2">Customize with AI</Link>
          </p>
        </section>
      </div>

      {previewing && (
        <SignaturePreviewDialog
          open
          onOpenChange={(o) => !o && setPreviewId(null)}
          name={previewing.name}
          html={htmlFor(previewing.id)}
          onChoose={() => choose(previewing.id)}
        />
      )}
    </div>
  );
}
