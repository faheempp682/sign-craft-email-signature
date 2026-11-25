import { createClient, getUser } from "@/lib/supabase/server";
import { getSignatureLimit } from "./signature-limit";

export type SignatureUsage = { count: number; limit: number; full: boolean };

/** How many signatures the signed-in person has saved and how many they may keep. Null when signed out or Supabase is off. */
export async function getSignatureUsage(): Promise<SignatureUsage | null> {
  const supabase = await createClient();
  const user = supabase ? await getUser() : null;
  if (!supabase || !user) return null;
  const [{ count }, limit] = await Promise.all([
    supabase.from("signatures").select("id", { count: "exact", head: true }).eq("owner_id", user.id), // own rows only, as the save route counts
    getSignatureLimit(supabase),
  ]);
  const n = count ?? 0;
  return { count: n, limit, full: n >= limit };
}
