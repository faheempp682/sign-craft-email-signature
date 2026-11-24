export type BunnyConfig = {
  zone: string;
  accessKey: string;
  /** Storage API host. Default is the Falkenstein (DE) region; other regions use a prefix, e.g. ny.storage.bunnycdn.com. */
  host: string;
  /** Public pull-zone base URL with no trailing slash, e.g. https://signcraft.b-cdn.net */
  cdnUrl: string;
};

export function getBunnyConfig(env: Record<string, string | undefined> = process.env): BunnyConfig | null {
  const zone = env.BUNNY_STORAGE_ZONE;
  const accessKey = env.BUNNY_STORAGE_ACCESS_KEY;
  const cdnUrl = env.BUNNY_CDN_URL?.replace(/\/+$/, "");
  if (!zone || !accessKey || !cdnUrl) return null;
  return { zone, accessKey, cdnUrl, host: env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com" };
}

/** Uploads bytes to Bunny Storage and returns the public CDN URL. Throws on any non-2xx response. */
export async function uploadToBunny(cfg: BunnyConfig, path: string, body: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`https://${cfg.host}/${encodeURIComponent(cfg.zone)}/${path}`, {
    method: "PUT",
    headers: { AccessKey: cfg.accessKey, "Content-Type": "application/octet-stream" },
    body: body as BodyInit,
  });
  if (!res.ok) throw new Error(`Bunny storage responded ${res.status}`);
  return `${cfg.cdnUrl}/${path}`;
}

/** Removes an object from Bunny Storage. A 404 counts as success (already gone). */
export async function deleteFromBunny(cfg: BunnyConfig, path: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`https://${cfg.host}/${encodeURIComponent(cfg.zone)}/${path}`, { method: "DELETE", headers: { AccessKey: cfg.accessKey } });
  if (!res.ok && res.status !== 404) throw new Error(`Bunny storage responded ${res.status}`);
}
