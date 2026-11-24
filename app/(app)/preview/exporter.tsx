"use client";

import { useMemo, useState } from "react";
import { TEMPLATE_IDS, type TemplateId } from "@/lib/schema/document";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { TEMPLATE_META, getTemplate } from "@/lib/templates";
import { copyHtmlRich, downloadHtm } from "@/lib/export-client";

export function Exporter({ initial }: { initial: TemplateId }) {
  const [id, setId] = useState<TemplateId>(initial);
  const [dark, setDark] = useState(false);
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<"html" | "json">("html");

  const doc = getTemplate(id).doc;
  const html = useMemo(() => renderToEmailHtml(doc), [doc]);
  const srcDoc = `<!doctype html><html><body style="margin:24px;background:${dark ? "#1f2937" : "#ffffff"};">${html}</body></html>`;

  async function copyRich() {
    setStatus((await copyHtmlRich(html)) ? "Copied as rich text. Paste it into your email client's signature box." : "The browser blocked clipboard access. Use Download .htm instead.");
  }

  function download() {
    downloadHtm(html, `${id}-signature.htm`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="card overflow-hidden" aria-label="Preview">
        <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
          <span>{dark ? "Dark background (approximation)" : "Light background"}</span>
          <span>Exact exporter output</span>
        </div>
        <iframe title="Signature preview" srcDoc={srcDoc} sandbox="" className="h-[420px] w-full bg-white" />
      </section>

      <aside className="space-y-4">
        <div className="card space-y-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tpl" className="text-sm font-medium">Template</label>
            <select id="tpl" value={id} onChange={(e) => setId(e.target.value as TemplateId)} className="field">
              {TEMPLATE_IDS.map((t) => (
                <option key={t} value={t}>{TEMPLATE_META.find((m) => m.id === t)!.name}</option>
              ))}
            </select>
          </div>
          <button className="btn w-full" aria-pressed={dark} onClick={() => setDark((d) => !d)}>
            {dark ? "Use light background" : "Use dark background"}
          </button>
          <button className="btn btn-primary w-full" onClick={copyRich}>Copy as rich text</button>
          <button className="btn w-full" onClick={download}>Download .htm</button>
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">{status}</p>
        </div>
      </aside>

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
