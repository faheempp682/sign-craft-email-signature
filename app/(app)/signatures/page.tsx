import { PRESETS } from "@/lib/presets";
import { SignatureDocSchema } from "@/lib/schema/document";
import { createClient, getUser } from "@/lib/supabase/server";
import { getSignatureUsage } from "@/lib/signature-usage";
import { DraftCard } from "./draft-card";
import { Gallery } from "./gallery";
import { MySignatures, type MySignature } from "./my-signatures";

export const metadata = { title: "Signatures · SignCraft" };
export const dynamic = "force-dynamic";

const STATS = [
  { value: String(PRESETS.length), label: "Templates" },
  { value: "6", label: "Target email clients" },
  { value: "0", label: "Banned CSS features used" },
];

async function loadMine(): Promise<MySignature[] | null> {
  const supabase = await createClient();
  if (!supabase) return null; // not configured: hide the section entirely
  const user = await getUser();
  if (!user) return null;
  // Own signatures only. Organization admins can also READ their employees' tagged signatures, so row-level security alone
  // no longer keeps this list to "mine".
  const { data } = await supabase.from("signatures").select("id, name, doc_json, updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false });
  // Re-validate every stored document before rendering it; skip anything that no longer matches the schema.
  return (data ?? []).flatMap((r) => {
    const doc = SignatureDocSchema.safeParse(r.doc_json);
    return doc.success ? [{ id: r.id, name: r.name, updatedAt: r.updated_at, doc: doc.data }] : [];
  });
}

export default async function SignaturesPage() {
  const [mine, usage] = await Promise.all([loadMine(), getSignatureUsage()]);
  return (
    <>
      <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-2">Library</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Signatures that never break.</h1>
          <p className="mt-3 max-w-xl text-muted">Pick a starting template from the library. Every one exports table-based, Outlook-safe HTML from a single JSON document.</p>
        </div>
      </header>

      <DraftCard />

      {mine && <MySignatures items={mine} limit={usage?.limit} />}

      <dl className="card mb-10 grid grid-cols-3 divide-x divide-line">
        {STATS.map((s) => (
          <div key={s.label} className="px-4 py-5 sm:px-6">
            <dd className="text-2xl font-semibold tracking-tight sm:text-3xl">{s.value}</dd>
            <dt className="mt-1 text-xs text-muted sm:text-sm">{s.label}</dt>
          </div>
        ))}
      </dl>

      <Gallery pickPath="/editor" />
    </>
  );
}
