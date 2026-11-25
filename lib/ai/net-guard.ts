import { isIP } from "node:net";

/**
 * SSRF defence: decides whether an IP address is a normal public internet address. Anything that could reach the
 * server's own machine, its private network, cloud metadata services (169.254.169.254) or other internal systems
 * is refused. Unparseable input is refused too.
 */
export function isPublicAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0]; // strip IPv6 brackets and zone id
  const kind = isIP(bare);
  if (kind === 4) return isPublicV4(bare);
  if (kind === 6) return isPublicV6(bare);
  return false;
}

/* ---------------- IPv4 ---------------- */

const v4ToInt = (ip: string): number => ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);

/** [network address, prefix length] for every IPv4 block that is not publicly routable. */
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast
];

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([net, bits]) => {
    const size = 2 ** (32 - bits);
    const start = v4ToInt(net);
    return n >= start && n < start + size;
  });
}

/* ---------------- IPv6 ---------------- */

/** Expands any valid IPv6 text form into 8 groups of 16 bits. Handles "::" and a trailing dotted IPv4. */
function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[2]);
    text = `${dotted[1]}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPublicV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return false;
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

  const allZeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroTo(8)) return false; // :: unspecified
  if (allZeroTo(7) && g[7] === 1) return false; // ::1 loopback
  if (allZeroTo(5) && g[5] === 0xffff) return isPublicV4(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d (IPv4-mapped)
  if (allZeroTo(6)) return false; // ::a.b.c.d (deprecated IPv4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b) return false; // 64:ff9b::/96 NAT64: can reach IPv4 internals
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // 100::/64 discard
  if (g[0] === 0x2001 && g[1] === 0) return false; // 2001::/32 Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false; // documentation
  if (g[0] === 0x2002) return false; // 2002::/16 6to4 (embeds an IPv4 address)
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 deprecated site-local
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}
