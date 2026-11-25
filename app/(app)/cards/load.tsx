import { headers } from "next/headers";
import { featureEnabled } from "@/lib/authz/guard";
import { siteOrigin } from "@/lib/cards/public";
import { OWNER_COLUMNS, type OwnedCard } from "@/lib/cards/schema";
import { createClient } from "@/lib/supabase/server";

export type CardsPageData =
  | { kind: "off" }
  | { kind: "disabled" }
  | { kind: "error" }
  | { kind: "ok"; cards: OwnedCard[]; origin: string; userId: string };

/** Shared loader for the owner screens: signed in, feature on, and the person's own cards (row security does the filtering). */
export async function loadCards(): Promise<CardsPageData> {
  const supabase = await createClient();
  if (!supabase) return { kind: "off" };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { kind: "off" };
  const on = await featureEnabled(supabase, "digital_card");
  if (on === null) return { kind: "error" };
  if (!on) return { kind: "disabled" };
  const { data, error } = await supabase.from("digital_cards").select(OWNER_COLUMNS).eq("owner_id", auth.user.id).order("created_at", { ascending: false });
  if (error) {
    console.error("[cards] load failed:", error.code);
    return { kind: "error" };
  }
  return { kind: "ok", cards: (data ?? []) as unknown as OwnedCard[], origin: siteOrigin(await headers()), userId: auth.user.id };
}

export function Unavailable({ data }: { data: Exclude<CardsPageData, { kind: "ok" }> }) {
  const msg =
    data.kind === "disabled"
      ? "Digital cards are not enabled for your account. Ask an admin to turn them on."
      : data.kind === "off"
        ? "Sign in to manage your digital cards."
        : "Could not load your cards. Has supabase/migrations/0007_digital_cards.sql been applied?";
  return <p className="card p-6 text-sm">{msg}</p>;
}
