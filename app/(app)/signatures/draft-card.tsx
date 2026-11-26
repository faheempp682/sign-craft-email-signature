"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { markHandoff } from "@/lib/create/session";
import { SignaturePreview } from "@/components/signature-preview";
import { clearDraft, getStorage, loadDraft, type Draft } from "@/lib/editor/draft";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { SignatureDocSchema } from "@/lib/schema/document";

/** The unsaved draft kept on this device (localStorage), so "Save as draft" has somewhere visible to land. */
export function DraftCard() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    const storage = getStorage();
    const d = storage ? loadDraft(storage) : null;
    setDraft(d);
    // A draft can be saved mid-edit with invalid values, so only preview it when it validates.
    const parsed = d ? SignatureDocSchema.safeParse(d.doc) : null;
    setHtml(parsed?.success ? renderToEmailHtml(parsed.data) : null);
  }, []);

  if (!draft) return null;

  /** Opens the simple form with the draft's design: the studio picks the draft up when it was handed over for this template. */
  function edit() {
    if (!draft) return;
    markHandoff(draft.doc.template_id);
    router.push(`/create?t=${encodeURIComponent(draft.doc.template_id)}`);
  }

  function discard() {
    if (!window.confirm("Discard this draft? This cannot be undone.")) return;
    const storage = getStorage();
    if (storage) clearDraft(storage);
    setDraft(null);
  }

  return (
    <section aria-labelledby="draft-h" className="mb-12">
      <h2 id="draft-h" className="mb-5 text-lg font-semibold">Draft in progress</h2>
      <div className="card overflow-hidden md:flex">
        {html && <SignaturePreview title="Draft preview" html={html} height={200} className="border-b border-line md:w-1/2 md:border-b-0 md:border-r" />}
        <div className="flex flex-1 flex-col justify-between gap-4 p-5">
          <p className="text-sm text-muted">Not saved to your account yet. Last changed {new Date(draft.savedAt).toLocaleString()}. Kept on this device only.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={edit}>Edit</button>            <button className="btn" onClick={discard}>Discard</button>
          </div>
        </div>
      </div>
    </section>
  );
}
