import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleConfig } from "./config";
import { CryptoError, decryptSecret, encryptSecret, tokenContext } from "./crypto";
import { GoogleError } from "./errors";
import { refreshAccessToken, type Identity } from "./oauth";

/**
 * Storage of the one Google connection per person. Uses the SERVICE-ROLE client because the browser-facing roles
 * cannot read or write the token column at all (see migration 0004). Only server code in this folder calls these.
 */
type Admin = Pick<SupabaseClient, "from">;

export async function saveConnection(admin: Admin, cfg: GoogleConfig, userId: string, who: Identity, scope: string, refreshToken: string): Promise<void> {
  const { error } = await admin.from("google_connections").upsert(
    {
      user_id: userId,
      google_sub: who.sub,
      google_email: who.email,
      hd: who.hd,
      scope,
      refresh_token_enc: encryptSecret(refreshToken, cfg.key, tokenContext(userId)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("[google] could not save connection:", error.message);
    throw new GoogleError("upstream", "Could not save the connection. Please try again.", 500);
  }
}

/** The stored refresh token, decrypted, or null when this person has not connected. */
export async function readRefreshToken(admin: Admin, cfg: GoogleConfig, userId: string): Promise<string | null> {
  const { data, error } = await admin.from("google_connections").select("refresh_token_enc").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("[google] could not read connection:", error.message);
    throw new GoogleError("upstream", "Could not read the connection. Please try again.", 500);
  }
  if (!data) return null;
  try {
    return decryptSecret(String(data.refresh_token_enc), cfg.key, tokenContext(userId));
  } catch (e) {
    if (e instanceof CryptoError) {
      // The encryption key changed, or the row was altered. The token is unusable, so ask for a fresh connection.
      console.error("[google] stored token cannot be decrypted for user", userId);
      throw new GoogleError("reconnect_required", "Your saved Google connection can no longer be used. Connect your Google account again.", 401);
    }
    throw e;
  }
}

export async function deleteConnection(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.from("google_connections").delete().eq("user_id", userId);
  if (error) {
    console.error("[google] could not delete connection:", error.message);
    throw new GoogleError("upstream", "Could not remove the saved connection. Please try again.", 500);
  }
}

/**
 * A fresh access token for this person. If Google says access was revoked or has expired, the dead connection is
 * deleted so the screen shows "Connect" again instead of failing repeatedly.
 */
export async function getAccessToken(admin: Admin, cfg: GoogleConfig, userId: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const refresh = await readRefreshToken(admin, cfg, userId);
  if (!refresh) throw new GoogleError("not_connected", "Connect your Google account first.", 409);
  try {
    const token = await refreshAccessToken(cfg, refresh, fetchFn);
    void Promise.resolve(admin.from("google_connections").update({ last_used_at: new Date().toISOString() }).eq("user_id", userId)).catch(() => {});
    return token;
  } catch (e) {
    if (e instanceof GoogleError && e.code === "reconnect_required") await deleteConnection(admin, userId).catch(() => {});
    throw e;
  }
}
