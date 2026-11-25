/**
 * A deliberately tiny JSON path: `$.data.contact.phone`, `data.items[0].title`, `$.fields["job-title"]`.
 * No wildcards, filters, recursion or functions, so a path can never do more than walk down one branch.
 */

export type Segment = string | number;
const MAX_SEGMENTS = 8;
const KEY = /^[A-Za-z0-9_$-]{1,60}$/;

export function parsePath(raw: string): Segment[] | null {
  let s = raw.trim();
  if (!s || s.length > 200) return null;
  if (s.startsWith("$")) s = s.slice(1);
  if (s.startsWith(".")) s = s.slice(1);
  const out: Segment[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "[") {
      const close = s.indexOf("]", i);
      if (close < 0) return null;
      const inner = s.slice(i + 1, close);
      const q = /^(["'])(.{1,60})\1$/.exec(inner);
      if (/^\d{1,4}$/.test(inner)) out.push(Number(inner));
      else if (q && KEY.test(q[2])) out.push(q[2]);
      else return null;
      i = close + 1;
      if (s[i] === ".") i++;
      else if (i < s.length && s[i] !== "[") return null;
    } else {
      let j = i;
      while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
      const key = s.slice(i, j);
      if (!KEY.test(key)) return null;
      out.push(key);
      i = j;
      if (s[i] === ".") i++;
      if (i >= s.length && s.endsWith(".")) return null;
    }
    if (out.length > MAX_SEGMENTS) return null;
  }
  return out.length ? out : null;
}

export const validPath = (raw: string) => parsePath(raw) !== null;

export type Pick = { found: true; value: string } | { found: false; reason: string };

/** Walks the path using OWN properties only (so "__proto__" or "constructor" never reach the prototype chain). */
export function pickPath(json: unknown, raw: string): Pick {
  const path = parsePath(raw);
  if (!path) return { found: false, reason: "That is not a valid path." };
  let cur: unknown = json;
  for (const seg of path) {
    if (typeof seg === "number") {
      if (!Array.isArray(cur) || seg >= cur.length) return { found: false, reason: "Not found in the answer." };
      cur = cur[seg];
    } else {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !Object.hasOwn(cur, seg)) return { found: false, reason: "Not found in the answer." };
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  if (cur === null || cur === undefined) return { found: true, value: "" };
  if (typeof cur === "string") return { found: true, value: cur };
  if (typeof cur === "number" && Number.isFinite(cur)) return { found: true, value: String(cur) };
  if (typeof cur === "boolean") return { found: true, value: String(cur) };
  return { found: false, reason: "That path points at a list or an object, not a single value." };
}

/** Up to `limit` leaf paths of an answer with a short sample, to help an admin write the mapping. Values are cut to 40 characters. */
export function listPaths(json: unknown, limit = 60): { path: string; sample: string }[] {
  const out: { path: string; sample: string }[] = [];
  const walk = (v: unknown, p: string, depth: number) => {
    if (out.length >= limit || depth > MAX_SEGMENTS) return;
    if (Array.isArray(v)) v.slice(0, 3).forEach((x, i) => walk(x, `${p}[${i}]`, depth + 1));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (!KEY.test(k)) continue;
        walk(x, `${p}.${k}`, depth + 1);
      }
    } else if (v !== null && v !== undefined) out.push({ path: p, sample: String(v).slice(0, 40) });
  };
  walk(json, "$", 0);
  return out;
}
