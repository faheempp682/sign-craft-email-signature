/**
 * The Bunny folder a user's images live in: a readable name plus the start of their id, so two people called
 * "sam" never share a folder. Users without a usable name get their plain id.
 */
export function userFolder(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }): string {
  const meta = user.user_metadata ?? {};
  const raw = String(meta.user_name ?? meta.full_name ?? meta.name ?? (user.email ?? "").split("@")[0] ?? "");
  const slug = raw.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return slug ? `${slug}-${user.id.slice(0, 8)}` : user.id;
}
