import { SOCIAL_NETWORKS } from "@/lib/schema/document";

export type Network = (typeof SOCIAL_NETWORKS)[number];

/** Which hostnames count as each social network. Shared by design generation and autofill. */
export const NETWORK_HOSTS: Record<Network, string[]> = {
  linkedin: ["linkedin.com"],
  twitter: ["twitter.com", "x.com"],
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  github: ["github.com"],
  tiktok: ["tiktok.com"],
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export const matchesHost = (url: string, hosts: string[]): boolean => {
  const h = hostOf(url);
  return !!h && hosts.some((x) => h === x || h.endsWith(`.${x}`));
};

/** The network a URL belongs to, or null. */
export function networkOf(url: string): Network | null {
  for (const n of SOCIAL_NETWORKS) if (matchesHost(url, NETWORK_HOSTS[n])) return n;
  return null;
}
