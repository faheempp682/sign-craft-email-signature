import { listDisclaimers } from "@/lib/disclaimers";
import { createClient } from "@/lib/supabase/server";
import { DisclaimersAdmin } from "./disclaimers-admin";

export const metadata = { title: "Disclaimers · Admin · SignCraft" };
export const dynamic = "force-dynamic";

export default async function DisclaimersPage() {
  const supabase = await createClient();
  if (!supabase) return null;
  try {
    return <DisclaimersAdmin items={await listDisclaimers(supabase)} />;
  } catch (e) {
    console.error("[admin/disclaimers] load failed:", (e as Error).message);
    return <p className="card p-6 text-sm">Could not load disclaimers. Has <code>supabase/migrations/0006_campaigns.sql</code> been applied?</p>;
  }
}
