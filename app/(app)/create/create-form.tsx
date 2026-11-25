"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon } from "@solar-icons/react/linear/arrow-up";
import { AddCircleIcon } from "@solar-icons/react/linear/add-circle";
import { GalleryIcon } from "@solar-icons/react/linear/gallery";
import { STYLE_HINTS } from "@/lib/ai/design";
import type { SignatureDoc } from "@/lib/schema/document";
import { getStorage, loadDraft, saveDraft } from "@/lib/editor/draft";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  { title: "Real-estate agent", short: "A listing banner, headshot on the left, phone and website", text: "Modern real-estate agent signature, deep green accent, headshot on the left, phone and website, and a banner for my latest listing." },
  { title: "Freelance writer", short: "Text only, a serif, calm and elegant", text: "Minimal serif signature for a freelance writer. Text only, calm and elegant, with my website and a LinkedIn link." },
  { title: "Creative agency", short: "Navy accent, company logo, socials and a promo banner", text: "Bold agency signature with a navy accent, company logo, social links for Instagram and LinkedIn, and a promo banner." },
];

const MAX = 1000;
const MAX_SHOT_BYTES = 5 * 1024 * 1024;
const SHOT_TYPES = ["image/png", "image/jpeg", "image/gif"];
const MAX_NOTE = 500;

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
    <div className="mx-auto max-w-3xl">
      <header className="pb-8 pt-2 md:pt-6">
        <p className="mb-3 text-sm text-muted-foreground">New signature</p>
        <h1 className="text-4xl leading-[1.1] tracking-tight sm:text-5xl">
          What should your <em className="text-brand">signature</em> look like?
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">Describe it in a sentence, drop in a screenshot of one you like, or start from an example below.</p>
      </header>

      <div
        data-dropzone
        className={cn("rounded-xl border bg-card p-4 transition-colors focus-within:border-foreground sm:p-5", dragging ? "border-dashed border-brand bg-secondary" : "border-border")}
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
          rows={4}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="For example: a calm, text-only signature for an architect, with my phone and website."
          className="w-full resize-none bg-transparent text-base leading-relaxed outline-none! placeholder:text-muted-foreground/70"
          aria-describedby="idea-help"
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (!pasted) return; // ordinary text paste
            e.preventDefault();
            readScreenshot(pasted);
          }}
        />

        <div role="group" aria-label="Style hints" className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Style</span>
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
                  "h-7 cursor-pointer rounded-md border px-2.5 text-xs transition-colors duration-150",
                  on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Start over"
              title="Start over"
              disabled={busy || (!prompt && styles.length === 0)}
              onClick={() => {
                setPrompt("");
                setStyles([]);
                box.current?.focus();
              }}
            >
              <AddCircleIcon size={18} />
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
              <GalleryIcon size={15} /> From a screenshot
            </Button>
            <p id="idea-help" className="hidden text-xs text-muted-foreground sm:block">
              {prompt.length}/{MAX} &middot; Ctrl+Enter
            </p>
          </div>
          <Button type="button" onClick={submit} disabled={!canSend} aria-label="Create signature" className="h-10 px-4">
            {busy ? (
              <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-6.2-8.55" />
              </svg>
            ) : (
              <>Create <ArrowUpIcon size={18} /></>
            )}
          </Button>
        </div>
      </div>

      <div className="mt-3 min-h-6 text-sm" aria-live="polite">
        {busy && (
          <p role="status" className="text-muted-foreground">
            {doing === "screenshot" ? "Reading your screenshot… this can take 10 to 20 seconds." : "Designing your signature… this usually takes a few seconds."}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
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

      <section aria-labelledby="ex-h" className="mt-10">
        <h2 id="ex-h" className="mb-2 text-2xl tracking-tight">Or start from an example</h2>
        <ul className="divide-y divide-border border-y border-border">
          {EXAMPLES.map((ex) => (
            <li key={ex.title}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPrompt(ex.text);
                  box.current?.focus();
                }}
                className="group flex w-full cursor-pointer items-baseline justify-between gap-4 py-4 text-left"
              >
                <span>
                  <span className="block font-medium group-hover:text-brand">{ex.title}</span>
                  <span className="block text-sm text-muted-foreground">{ex.short}</span>
                </span>
                <span aria-hidden="true" className="text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-brand">&rarr;</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted-foreground">
          Prefer to start from a layout? <Link href="/signatures" className="font-medium text-foreground underline underline-offset-2">Browse templates</Link>
        </p>
      </section>
    </div>
  );
}
