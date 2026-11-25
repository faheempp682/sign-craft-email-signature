import type { Branding } from "./branding";
import { isSafeLogoUrl } from "./branding";

/**
 * The organization's brand for the app header: logo (with explicit width and height, so nothing jumps) and name, plus
 * an optional "Powered by SignCraft". The accent colour is exposed as the CSS variable `--org-accent` on the wrapper so
 * the integrator can use it; this component only draws it as a small decorative bar, never as text colour: the accent
 * is guaranteed 4.5:1 on white, which says nothing about the dark theme.
 *
 *   <BrandMark branding={await loadBranding(supabase, activeOrgId)} />
 */
export function BrandMark({ branding, className = "" }: { branding: Branding; className?: string }) {
  const logo = branding.logo && isSafeLogoUrl(branding.logo.url) ? branding.logo : null;
  const style = branding.accent ? ({ "--org-accent": branding.accent } as React.CSSProperties) : undefined;
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`} style={style} data-testid="brand-mark">
      {logo && (
        // Logos come from any https host the admin chose, so the Next image optimizer (which needs an allow-list) is not used.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo.url} width={logo.width} height={logo.height} alt="" className="max-h-10 w-auto shrink-0 object-contain" style={{ maxWidth: "10rem" }} referrerPolicy="no-referrer" loading="lazy" />
      )}
      {branding.accent && <span aria-hidden="true" className="h-8 w-1 shrink-0 rounded-full" style={{ background: "var(--org-accent)" }} />}
      <div className="min-w-0">
        <p className="truncate text-base font-semibold">{branding.name}</p>
        {branding.poweredBy && branding.name !== "SignCraft" && <p className="text-xs text-muted">Powered by SignCraft</p>}
      </div>
    </div>
  );
}
