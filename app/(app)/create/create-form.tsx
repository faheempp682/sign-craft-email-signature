"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon } from "@solar-icons/react/bold-duotone/arrow-up";
import { AddCircleIcon } from "@solar-icons/react/bold-duotone/add-circle";
import { StarsIcon } from "@solar-icons/react/bold-duotone/stars";
import { PenNewSquareIcon } from "@solar-icons/react/bold-duotone/pen-new-square";
import { GalleryIcon } from "@solar-icons/react/bold-duotone/gallery";
import { LayersIcon } from "@solar-icons/react/bold-duotone/layers";
import { STYLE_HINTS } from "@/lib/ai/design";
import type { SignatureDoc } from "@/lib/schema/document";
import { getStorage, loadDraft, saveDraft } from "@/lib/editor/draft";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  { title: "Real-estate agent", short: "Design a real-estate agent signature with a listing banner", Icon: PenNewSquareIcon, text: "Modern real-estate agent signature, deep green accent, headshot on the left, phone and website, and a banner for my latest listing." },
  { title: "Freelance writer", short: "Create a minimal, text-only signature for a writer", Icon: GalleryIcon, text: "Minimal serif signature for a freelance writer. Text only, calm and elegant, with my website and a LinkedIn link." },
  { title: "Creative agency", short: "Build a bold agency signature with logo and socials", Icon: LayersIcon, text: "Bold agency signature with a navy accent, company logo, social links for Instagram and LinkedIn, and a promo banner." },
];

const MAX = 1000;
const MAX_SHOT_BYTES = 5 * 1024 * 1024;
const SHOT_TYPES = ["image/png", "image/jpeg", "image/gif"];
const MAX_NOTE = 500;

function Mascot() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true" className="drop-shadow-md">
      <ellipse cx="48" cy="90" rx="22" ry="4" fill="currentColor" opacity="0.08" />
      <rect x="30" y="62" width="36" height="24" rx="12" fill="#1c1c1e" />
      <rect x="22" y="70" width="10" height="14" rx="5" fill="#2b2b2e" />
      <rect x="64" y="70" width="10" height="14" rx="5" fill="#2b2b2e" />
      <rect x="14" y="22" width="68" height="48" rx="22" fill="#1c1c1e" />
      <rect x="22" y="30" width="52" height="32" rx="16" fill="#0a0a0b" />
      <rect x="32" y="40" width="9" height="13" rx="4.5" fill="#2ef2b0" />
      <rect x="55" y="40" width="9" height="13" rx="4.5" fill="#2ef2b0" />
      <rect x="8" y="38" width="7" height="16" rx="3.5" fill="#2b2b2e" />
      <rect x="81" y="38" width="7" height="16" rx="3.5" fill="#2b2b2e" />
      <path d="M48 22v-8" stroke="#1c1c1e" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="12" r="3.5" fill="#f0522d" />
    </svg>
  );
}

/** Decorative crosshair markers where the guide lines meet, as in the reference. */
function Marker({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("absolute size-2.5 -translate-x-1/2 -translate-y-1/2 text-brand", className)}>
    <svg viewBox="0 0 10 10" className="size-full"><path d="M5 0v10M0 5h10" stroke="currentColor" strokeWidth="1.2" /></svg>
  </span>;
}

export function CreateForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [styles, setStyles] = useState<string[]>([]);
  const [doing, setDoing] = useState<"design" | "screenshot" | null>(null);
  const busy = doing !== null;
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const s = getStorage();
    setHasDraft(!!(s && loadDraft(s)));
    box.current?.focus();
  }, []);

  const toggle = (s: string) => setStyles((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : cur.length >= 4 ? cur : [...cur, s]));
  const canSend = prompt.trim().length >= 3 && !busy;

  /** Runs one request that returns a signature, then hands the result to the editor. Shared by the prompt and the screenshot. */
  async function generate(kind: "design" | "screenshot", send: () => Promise<Response>) {
    setDoing(kind);
    setError("");
    try {
      const res = await send();
      const data = (await res.json().catch(() => null)) as { doc?: SignatureDoc; message?: string } | null;
      if (!res.ok || !data?.doc) {
        setError(data?.message ?? "Something went wrong. Please try again.");
        return;
      }
      // Hand the design to the editor through the same draft storage the editor already restores from.
      const storage = getStorage();
      if (!storage || !saveDraft(storage, data.doc)) {
        setError("Your browser is blocking local storage, so the design could not be opened in the editor. Allow site data and try again.");
        return;
      }
      router.push("/editor?from=ai");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setDoing(null);
    }
  }

  function submit() {
    if (!canSend) return;
    void generate("design", () =>
      fetch("/api/ai/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt.trim(), styles }) }),
    );
  }

  /** Rebuild a signature from a picture. Anything typed in the box is sent along as a note ("make it navy"). */
  function readScreenshot(file: File | undefined) {
    if (!file || busy) return;
    if (!SHOT_TYPES.includes(file.type)) return setError("Upload a PNG, JPG or GIF screenshot.");
    if (file.size > MAX_SHOT_BYTES) return setError("That screenshot is over 5 MB. Crop it to just the signature and try again.");
    const note = prompt.trim().slice(0, MAX_NOTE);
    void generate("screenshot", () => {
      const form = new FormData();
      form.set("file", file);
      if (note) form.set("note", note);
      return fetch("/api/ai/vision", { method: "POST", body: form });
    });
  }

  return (
    <div className="relative mx-auto max-w-4xl">
      {/* Guide lines (desktop only, decorative) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden md:block">
        <span className="absolute inset-y-0 left-[8%] w-px bg-border" />
        <span className="absolute inset-y-0 right-[8%] w-px bg-border" />
        <span className="absolute inset-x-[-6%] top-[11rem] h-px bg-border" />
        <Marker className="left-[8%] top-[11rem]" />
        <Marker className="left-[92%] top-[11rem]" />
      </div>

      <header className="relative pb-10 pt-4 text-center md:pt-10">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          <span className="block text-muted-foreground">Let&apos;s Create</span>
          <span className="block">Something Professional</span>
        </h1>
      </header>

      <div className="relative mx-auto w-full max-w-2xl">
        <div className="absolute -top-[4.6rem] left-1/2 -translate-x-1/2 text-foreground">
          <Mascot />
        </div>

        <div
          className={cn("rounded-2xl border bg-card p-4 shadow-sm transition-colors sm:p-5", dragging ? "border-brand ring-2 ring-brand/30" : "border-border")}
          onDragOver={(e) => {
            if (busy || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            readScreenshot(e.dataTransfer.files[0]);
          }}
        >
          <label htmlFor="idea" className="sr-only">Describe your signature</label>
          <textarea
            id="idea"
            ref={box}
            value={prompt}
            maxLength={MAX}
            rows={3}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Describe the signature you want, or pick a style below…"
            className="w-full resize-none bg-transparent text-[0.95rem] leading-relaxed outline-none placeholder:text-muted-foreground"
            aria-describedby="idea-help"
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
              if (!pasted) return; // ordinary text paste
              e.preventDefault();
              readScreenshot(pasted);
            }}
          />

          <div role="group" aria-label="Style hints" className="mt-2 flex flex-wrap gap-2">
            {STYLE_HINTS.map((s) => {
              const on = styles.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggle(s)}
                  className={cn(
                    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors duration-150",
                    on ? "border-foreground bg-foreground text-background" : "border-border bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  <StarsIcon size={14} />
                  {s}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Start over"
                title="Start over"
                disabled={busy || (!prompt && styles.length === 0)}
                onClick={() => {
                  setPrompt("");
                  setStyles([]);
                  box.current?.focus();
                }}
              >
                <AddCircleIcon size={20} />
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/gif"
                className="sr-only"
                tabIndex={-1}
                aria-label="Upload a screenshot of a signature"
                onChange={(e) => {
                  readScreenshot(e.target.files?.[0]);
                  e.target.value = ""; // so choosing the same file again still fires
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()} title="Rebuild a signature from a screenshot. You can also drop or paste one here.">
                <GalleryIcon size={16} /> From a screenshot
              </Button>
              <p id="idea-help" className="hidden text-xs text-muted-foreground sm:block">
                {prompt.length}/{MAX} &middot; Ctrl+Enter
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{styles.length ? `${styles.length} style${styles.length > 1 ? "s" : ""}` : "Auto"}</span>
              <Button type="button" size="icon" onClick={submit} disabled={!canSend} aria-label="Create signature" className="size-11 rounded-xl">
                {busy ? (
                  <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-6.2-8.55" />
                  </svg>
                ) : (
                  <ArrowUpIcon size={22} />
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 min-h-6 text-center text-sm" aria-live="polite">
          {busy && (
            <p role="status" className="text-muted-foreground">
              {doing === "screenshot" ? "Reading your screenshot… this can take 10 to 20 seconds." : "Designing your signature… this usually takes a few seconds."}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-left text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          )}
          {!busy && !error && hasDraft && (
            <p className="text-muted-foreground">
              You have a draft in progress.{" "}
              <Link href="/editor" className="font-medium text-foreground underline underline-offset-2">Continue editing</Link>
            </p>
          )}
        </div>
      </div>

      <section aria-labelledby="ex-h" className="relative mt-10">
        <h2 id="ex-h" className="sr-only">Examples</h2>
        <ul className="grid overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-3 md:divide-x md:divide-border">
          {EXAMPLES.map((ex) => (
            <li key={ex.title} className="border-b border-border last:border-b-0 md:border-b-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPrompt(ex.text);
                  box.current?.focus();
                }}
                className="flex h-full w-full cursor-pointer items-center gap-4 p-5 text-left transition-colors duration-150 hover:bg-secondary"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-border bg-background text-foreground shadow-sm">
                  <ex.Icon size={24} />
                </span>
                <span className="text-sm font-medium leading-snug text-muted-foreground">{ex.short}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Prefer to start from a layout? <Link href="/signatures" className="font-medium text-foreground underline underline-offset-2">Browse templates</Link>
        </p>
      </section>
    </div>
  );
}
