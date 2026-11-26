"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TEMPLATE_IDS, type TemplateId } from "@/lib/schema/document";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { TEMPLATE_META, getTemplate } from "@/lib/templates";
import { copyHtmlRich, downloadHtm } from "@/lib/export-client";
import { darkVariantHtml } from "@/lib/dark";
import { CLIENTS, CLIENT_IDS, previewDocument, type ClientId } from "@/lib/preview-clients";
import { fitFrameToWidth } from "@/lib/preview-fit";
import { GmailPush } from "@/components/gmail-push";
import { knownDifferences } from "@/lib/render/differences";
import { ClientBadge } from "./render-ui";
import { RenderAll } from "./render-all";
import { Select } from "@/components/ui/select";

export function Exporter({ initial }: { initial: TemplateId }) {
  const [id, setId] = useState<TemplateId>(initial);
  const [dark, setDark] = useState(false);
  const [client, setClient] = useState<ClientId>("gmail");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<"html" | "json">("html");

  const doc = getTemplate(id).doc;
  const html = useMemo(() => renderToEmailHtml(doc), [doc]);
  const srcDoc = previewDocument(html, client, dark);
  const differences = useMemo(() => knownDifferences(html, client), [html, client]);
  const frameWidth = CLIENTS[client].width;

  async function copyRich() {
    setStatus((await copyHtmlRich(html)) ? "Copied as rich text. Paste it into your email client's signature box." : "The browser blocked clipboard access. Use Download .htm instead.");
  }

  function download() {
    downloadHtm(html, `${id}-signature.htm`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="card overflow-hidden" aria-label="Preview">
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
          <span>{CLIENTS[client].label} {dark ? "dark" : "light"}</span>
        </div>
        <ClientBadge client={client} />
        <div className="bg-surface-2 p-0 sm:p-4">
          <iframe
            title={`Signature preview, ${CLIENTS[client].label}`}
            srcDoc={srcDoc}
            onLoad={(e) => fitFrameToWidth(e.currentTarget)}
            sandbox="allow-same-origin"
            style={{ width: frameWidth ?? "100%" }}
            className="mx-auto block h-[420px] max-w-full border-line bg-white sm:rounded-lg sm:border"
          />
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          The frame above is always Chrome. Only the images from Render in all engines come from real WebKit and Firefox. Always send yourself a test email. <Link href="/guides" className="font-medium text-accent underline underline-offset-4">Install guides</Link>
        </p>
      </section>

      <aside className="space-y-4">
        <div className="card space-y-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tpl" className="text-sm font-medium">Template</label>
            <Select id="tpl" value={id} onChange={(e) => setId(e.target.value as TemplateId)} className="field">
              {TEMPLATE_IDS.map((t) => (
                <option key={t} value={t}>{TEMPLATE_META.find((m) => m.id === t)!.name}</option>
              ))}
            </Select>
          </div>
          <button className="btn w-full" aria-pressed={dark} onClick={() => setDark((d) => !d)}>
            {dark ? "Switch to light mode" : "Switch to dark mode"}
          </button>
          <button className="btn btn-primary w-full" onClick={copyRich}>Copy as rich text</button>
          <button className="btn w-full" onClick={download}>Download .htm</button>
          <button className="btn w-full" onClick={() => downloadHtm(darkVariantHtml(doc).html, `${id}-dark-variant.htm`)}>Download dark-mode variant</button>
          <p className="text-xs text-muted">A copy with colours adjusted to stay readable on dark backgrounds. Mail apps decide for themselves how to show dark mode, so test it.</p>
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">{status}</p>
        </div>
        <GmailPush doc={doc} returnTo="/preview" />
      </aside>

      <section className="card lg:col-span-2" aria-label="Known differences" data-testid="known-differences">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Known differences in {CLIENTS[client].label}</h2>
          <p className="text-xs text-muted">Worked out from this signature&apos;s HTML and documented client behaviour. A prediction, not a test in the real client.</p>
        </div>
        {differences.length ? (
          <ul className="divide-y divide-line">
            {differences.map((d) => (
              <li key={d.id} className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="eyebrow w-16 shrink-0">{d.severity === "visible" ? "Visible" : d.severity === "minor" ? "Minor" : "Note"}</span>
                <span className="min-w-0 flex-1">{d.text}{d.source && <span className="block text-xs text-muted">Source: {d.source}</span>}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">Nothing in this signature is known to differ here.</p>
        )}
      </section>

      <RenderAll doc={doc} dark={dark} filename={id} />

      <section className="card overflow-hidden lg:col-span-2" aria-label="Source">
        <div role="tablist" className="flex gap-1 border-b border-line p-2">
          {(["html", "json"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-11 rounded-lg px-4 text-sm font-medium ${tab === t ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2"}`}>
              {t === "html" ? "Email HTML" : "JSON document"}
            </button>
          ))}
        </div>
        <pre className="max-h-96 overflow-auto bg-surface-2 p-5 font-mono text-xs leading-relaxed">{tab === "html" ? html : JSON.stringify(doc, null, 2)}</pre>
      </section>
    </div>
  );
}
