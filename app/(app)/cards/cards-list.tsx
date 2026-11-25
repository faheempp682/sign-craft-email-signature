"use client";

import Link from "next/link";
import { useState } from "react";

export type CardSummary = { id: string; slug: string; display_name: string; title: string | null; company: string | null; published: boolean; indexable: boolean };

export function CardsList({ cards, origin, limit }: { cards: CardSummary[]; origin: string; limit: number }) {
  const [notice, setNotice] = useState("");
  const full = cards.length >= limit;

  async function copy(c: CardSummary) {
    try {
      await navigator.clipboard.writeText(`${origin}/c/${c.slug}`);
      setNotice(`Link to ${c.display_name} copied.`);
    } catch {
      setNotice("Could not copy automatically. Open the card and select its address.");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Digital card</p>
          <h1 className="text-2xl font-semibold tracking-tight">Your digital cards</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            A card is a public web page with your contact details, a Save contact button and a QR code. It is hidden until you publish it, and you can unpublish it at any time. You have {cards.length} of {limit} cards.
          </p>
        </div>
        {full ? (
          <span className="btn cursor-not-allowed opacity-50" aria-disabled="true">New card</span>
        ) : (
          <Link href="/cards/new" className="btn btn-primary">New card</Link>
        )}
      </div>

      <div aria-live="polite" className="mt-3 min-h-6 text-sm text-muted">{notice}</div>

      {cards.length === 0 ? (
        <div className="card mt-2 p-8 text-center">
          <p className="font-medium">No cards yet</p>
          <p className="mt-1 text-sm text-muted">Create one to get a link and QR code you can share or add to your signature.</p>
          <Link href="/cards/new" className="btn btn-primary mt-4">Create your first card</Link>
        </div>
      ) : (
        <ul className="card mt-2 divide-y divide-line">
          {cards.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.display_name}</p>
                <p className="truncate text-sm text-muted">
                  /c/{c.slug}{c.title || c.company ? ` · ${[c.title, c.company].filter(Boolean).join(", ")}` : ""}
                </p>
                <p className="mt-1 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${c.published ? "bg-accent-soft text-ink" : "bg-surface-2 text-muted"}`}>{c.published ? "Public" : "Private"}</span>
                  {c.published ? <span className="ml-2 text-muted">{c.indexable ? "Search engines allowed" : "Hidden from search engines"}</span> : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.published ? (
                  <button type="button" className="btn" onClick={() => copy(c)} aria-label={`Copy link to ${c.display_name}`}>Copy link</button>
                ) : null}
                <Link href={`/cards/${c.id}`} className="btn" aria-label={`Edit ${c.display_name}`}>Edit</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
