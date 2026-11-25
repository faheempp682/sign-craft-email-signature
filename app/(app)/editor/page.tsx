import { notFound } from "next/navigation";
import { z } from "zod";
import { getPreset } from "@/lib/presets";
import { SignatureDocSchema } from "@/lib/schema/document";
import { createClient, getUser } from "@/lib/supabase/server";
import { getBunnyConfig } from "@/lib/storage/bunny";
import type { AssetMap } from "@/lib/linter";
import { Editor, type SavedSignature } from "./editor";

export const metadata = { title: "Editor · SignCraft" };

async function loadSaved(id: string): Promise<SavedSignature | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  // RLS limits this to the signed-in user's own rows.
  const { data } = await supabase.from("signatures").select("id, name, doc_json").eq("id", id).maybeSingle();
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
  const { data } = await supabase.from("assets").select("url, type, size, width, height, animated, original_size").in("url", urls);
  const map: AssetMap = {};
  for (const r of data ?? []) {
    if (r.type !== "image/png" && r.type !== "image/jpeg" && r.type !== "image/gif") continue;
    map[r.url] = { type: r.type, bytes: r.size, width: r.width ?? 0, height: r.height ?? 0, animated: !!r.animated, originalBytes: r.original_size ?? undefined };
  }
  return map;
}

export default async function EditorPage({ searchParams }: { searchParams: Promise<{ t?: string; from?: string; s?: string }> }) {
  const { t, from, s } = await searchParams;
  const user = await getUser();
  const saved = s ? await loadSaved(s) : null;
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
      />
    </>
  );
}
