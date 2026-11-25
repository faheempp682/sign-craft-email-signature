"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { accentPassesOnWhite, isSafeLogoUrl, type Branding } from "@/lib/org/branding";
import { BrandMark } from "@/lib/org/brand-mark";

/** White-label branding of the active organization. The preview uses the same component as the app header. */
export function BrandingForm({ orgId, orgName, initial }: { orgId: string; orgName: string; initial: Branding }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name === "SignCraft" ? "" : initial.name);
  const [logo, setLogo] = useState(initial.logo?.url ?? "");
  const [w, setW] = useState(String(initial.logo?.width ?? 160));
  const [h, setH] = useState(String(initial.logo?.height ?? 40));
  const [accent, setAccent] = useState(initial.accent ?? "");
  const [powered, setPowered] = useState(initial.poweredBy);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const preview: Branding = {
    name: name.trim() || "SignCraft",
    logo: isSafeLogoUrl(logo.trim()) && +w > 0 && +h > 0 ? { url: logo.trim(), width: +w, height: +h } : null,
    accent: accentPassesOnWhite(accent.trim()) ? accent.trim() : null,
    poweredBy: powered,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (logo.trim() && !isSafeLogoUrl(logo.trim())) err.logo = "Enter a full https:// link to the logo.";
    if (logo.trim() && !(+w >= 16 && +w <= 400 && +h >= 16 && +h <= 200)) err.size = "Width is 16 to 400 and height 16 to 200 pixels.";
    if (accent.trim() && !accentPassesOnWhite(accent.trim())) err.accent = "Use a colour like #0B5FFF with at least 4.5:1 contrast on white.";
    setErrors(err);
    setNotice("");
    if (Object.keys(err).length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/agency/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          brand_name: name.trim() || null,
          logo_url: logo.trim() || null,
          logo_width: logo.trim() ? +w : null,
          logo_height: logo.trim() ? +h : null,
          accent: accent.trim() || null,
          show_powered_by: powered,
        }),
      });
      if (!res.ok) setErrors({ form: ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? "That did not work. Please try again." });
      else {
        setNotice("Branding saved.");
        router.refresh();
      }
    } catch {
      setErrors({ form: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  const bad = (k: string) => (errors[k] ? { "aria-invalid": true, "aria-describedby": `err-${k}` } : {});
  const msg = (k: string) => errors[k] && <p id={`err-${k}`} className="mt-1 text-sm text-red-600 dark:text-red-400">{errors[k]}</p>;

  return (
    <section aria-labelledby="brand-h">
      <h2 id="brand-h" className="text-lg font-semibold">Branding for {orgName || "this organization"}</h2>
      <form onSubmit={submit} className="card mt-3 grid gap-4 p-4 sm:px-6" noValidate>
        <div>
          <label htmlFor="b-name" className="mb-1 block text-sm text-muted">Brand name</label>
          <input id="b-name" className="field w-full" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="SignCraft" />
        </div>
        <div>
          <label htmlFor="b-logo" className="mb-1 block text-sm text-muted">Logo link (https)</label>
          <input id="b-logo" className="field w-full" inputMode="url" value={logo} onChange={(e) => setLogo(e.target.value)} {...bad("logo")} />
          {msg("logo")}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="b-w" className="mb-1 block text-sm text-muted">Logo width (px)</label>
            <input id="b-w" className="field w-full" inputMode="numeric" value={w} onChange={(e) => setW(e.target.value)} {...bad("size")} />
          </div>
          <div>
            <label htmlFor="b-h" className="mb-1 block text-sm text-muted">Logo height (px)</label>
            <input id="b-h" className="field w-full" inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} {...bad("size")} />
          </div>
          <div className="col-span-2 -mt-2">{msg("size")}</div>
        </div>
        <div>
          <label htmlFor="b-accent" className="mb-1 block text-sm text-muted">Accent colour</label>
          <input id="b-accent" className="field w-full" value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="#0B5FFF" {...bad("accent")} />
          {msg("accent")}
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5" checked={powered} onChange={(e) => setPowered(e.target.checked)} />
          Show “Powered by SignCraft” (hiding it needs agency mode)
        </label>
        <div className="rounded-lg border border-line p-3" role="group" aria-label="Preview">
          <BrandMark branding={preview} />
        </div>
        {errors.form && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{errors.form}</p>}
        <div aria-live="polite" className="text-sm text-muted">{notice}</div>
        <div>
          <button type="submit" className="btn btn-primary min-h-11" disabled={busy}>{busy ? "Saving…" : "Save branding"}</button>
        </div>
      </form>
    </section>
  );
}
