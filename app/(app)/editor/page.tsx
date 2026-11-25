import { notFound } from "next/navigation";
import { z } from "zod";
import { getPreset } from "@/lib/presets";
import { SignatureDocSchema } from "@/lib/schema/document";
import { featureEnabled } from "@/lib/authz/guard";
import { createClient, getUser } from "@/lib/supabase/server";
import { getBunnyConfig } from "@/lib/storage/bunny";
import type { AssetMap } from "@/lib/linter";
import { pickFacts } from "@/lib/editor/upload";
import { Editor, type SavedSignature } from "./editor";

export const metadata = { title: "Editor · SignCraft" };

async function loadSaved(id: string, ownerId: string | undefined): Promise<SavedSignature | null> {
  if (!ownerId || !z.string().uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  // Own rows only. RLS also lets an organization admin read employees' tagged signatures, but the editor saves as the
  // owner, so opening someone else's here would only fail later at Save.
  const { data } = await supabase.from("signatures").select("id, name, doc_json").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  if (!data) return null;
  const doc = SignatureDocSchema.safeParse(data.doc_json);
  return doc.success ? { id: data.id, name: data.name, doc: doc.data } : null;
}

/** Upload facts for the images in a saved signature, so the compatibility check still knows their size on later visits. */
async function loadAssetInfo(saved: SavedSignature | null): Promise<AssetMap> {
  if (!saved) return {};
  const urls = saved.doc.blocks.flatMap((b) => (b.type === "avatar" || b.type === "banner" ? [b.src] : []));
  if (urls.length === 0) return {};
  const supabase = await createClient();
  if (!supabase) return {};
  // `facts` exists once migration 0013 is applied; without it, fall back to the columns every database has.
  const base = "url, type, size, width, height, animated, original_size";
  let res: { data: unknown[] | null; error: unknown } = await supabase.from("assets").select(`${base}, facts`).in("url", urls);
  if (res.error) res = await supabase.from("assets").select(base).in("url", urls);
  const map: AssetMap = {};
  for (const r of (res.data ?? []) as unknown as { url: string; type: string; size: number; width: number | null; height: number | null; animated: boolean | null; original_size: number | null; facts?: Record<string, unknown> | null }[]) {
    if (r.type !== "image/png" && r.type !== "image/jpeg" && r.type !== "image/gif") continue;
    map[r.url] = { type: r.type, bytes: r.size, width: r.width ?? 0, height: r.height ?? 0, animated: !!r.animated, originalBytes: r.original_size ?? undefined, ...(r.facts && typeof r.facts === "object" ? pickFacts(r.facts) : {}) };
  }
  return map;
}

export default async function EditorPage({ searchParams }: { searchParams: Promise<{ t?: string; from?: string; s?: string; polish?: string }> }) {
  const { t, from, s, polish } = await searchParams;
  const user = await getUser();
  const polishId = polish && z.string().uuid().safeParse(polish).success ? polish : undefined;
  // Animated GIFs are enabled per account; when the check cannot be made, say "off" rather than offering a tool that will fail.
  const supabase = user ? await createClient() : null;
  const gifEnabled = supabase ? (await featureEnabled(supabase, "animated_gif")) === true : true;
  const saved = s ? await loadSaved(s, user?.id) : null;
  if (s && !saved) notFound();

  // An explicit ?t= means "start from this template". Without it the editor resumes the saved draft.
  const explicit = !saved && !!t && !!getPreset(t);
  const initial = saved ? saved.doc.template_id : explicit ? t! : "classic";
  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Editor</p>
        <h1 className="text-3xl font-semibold tracking-tight">Build your signature.</h1>
        <p className="mt-3 max-w-xl text-muted">Click anything in the preview to edit it, or use the blocks on the left. The preview is the exact HTML you will paste into your email client.</p>
      </header>
      <Editor
        key={saved?.id ?? initial}
        initial={initial}
        explicit={explicit}
        aiNotice={from === "ai" && !explicit && !saved}
        saved={saved ?? undefined}
        canSave={!!user}
        canUpload={!!user && !!getBunnyConfig()}
        assetInfo={await loadAssetInfo(saved)}
        gifEnabled={gifEnabled}
        polishId={polishId}
      />
    </>
  );
}
