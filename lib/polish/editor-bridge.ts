import { clearDraft, loadDraft, saveDraft, type StorageLike } from "@/lib/editor/draft";
import type { SignatureDoc } from "@/lib/schema/document";

/** Where a designer goes to work on the copy. The editor reads `polish` and shows the "Deliver to requester" banner. */
export const editorUrl = (requestId: string) => `/editor?polish=${encodeURIComponent(requestId)}`;

/** True when the editor already holds a local draft that is not this very document, so overwriting it would lose work. */
export function wouldOverwriteDraft(storage: StorageLike, doc: SignatureDoc): boolean {
  const existing = loadDraft(storage);
  return !!existing && JSON.stringify(existing.doc) !== JSON.stringify(doc);
}

/**
 * Put the designer's working copy where the editor looks for its draft (lib/editor/draft.ts), so /editor opens on it.
 * This only touches the designer's own browser storage. The requester's saved signature is never involved.
 */
export function stageWorkCopy(storage: StorageLike, doc: SignatureDoc, now = Date.now()): boolean {
  return saveDraft(storage, doc, now);
}

/** The designer's current editor draft, for "deliver what I have in the editor". */
export function readEditorDraft(storage: StorageLike): SignatureDoc | null {
  return loadDraft(storage)?.doc ?? null;
}

export { clearDraft };
