import { networkOf } from "./social";

export type PageDigest = {
  title: string;
  description: string;
  /** "key: value" lines from schema.org JSON-LD (Person / Organization / LocalBusiness). The most reliable data on a page. */
  structured: string[];
  emails: string[];
  phones: string[];
  /** Social profile URLs found in links (query and fragment removed). */
  social: string[];
  /** Readable body text, trimmed to fit a small model budget. */
  text: string;
};

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", copy: "(c)", reg: "(r)" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const squash = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

/* ---------- one linear pass over the HTML ----------
   Page content is controlled by whoever runs the site, so nothing here may take longer than linear time. Regexes that
   rescan the document from every "<" (comments, unclosed tags, lazy gaps) go quadratic on hostile input, so tags are
   found with indexOf and every regex only ever sees one already-isolated tag. */

type Scan = { text: string; title: string; metas: string[]; anchors: string[]; ldBlocks: string[] };

const SKIP_CONTENT = new Set(["script", "style", "noscript", "svg", "template", "iframe"]);
const BREAK = new Set(["br", "p", "div", "li", "ul", "ol", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer", "address", "nav", "main", "aside", "dd", "dt"]);
const MAX_TAG = 2000;
const MAX_TEXT = 600_000;

function scan(html: string): Scan {
  // ASCII-only lowercasing keeps every index identical to `html` (String.toLowerCase can change length).
  const lower = html.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
  const n = html.length;
  const out: string[] = [];
  let outLen = 0;
  let title = "";
  const metas: string[] = [];
  const anchors: string[] = [];
  const ldBlocks: string[] = [];
  const push = (s: string) => {
    out.push(s);
    outLen += s.length;
  };

  let i = 0;
  while (i < n && outLen < MAX_TEXT) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      push(html.slice(i));
      break;
    }
    if (lt > i) push(html.slice(i, lt));

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    const next = html.charCodeAt(lt + 1);
    const isTag = (next >= 65 && next <= 90) || (next >= 97 && next <= 122) || next === 47 || next === 33 || next === 63; // A-Z a-z / ! ?
    if (!isTag) {
      push("<"); // a literal "<" in the text, e.g. "5 < 6"
      i = lt + 1;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break; // an unterminated tag runs to the end of the page
    const tag = html.slice(lt, Math.min(gt + 1, lt + MAX_TAG));
    const closing = html.charCodeAt(lt + 1) === 47;
    const name = /^<\/?([a-z][a-z0-9-]*)/.exec(lower.slice(lt, lt + 40))?.[1] ?? "";
    i = gt + 1;

    if (!closing && SKIP_CONTENT.has(name)) {
      const close = lower.indexOf(`</${name}`, i);
      const bodyEnd = close < 0 ? n : close;
      if (name === "script" && ldBlocks.length < 6 && /type\s*=\s*["']?application\/ld\+json/i.test(tag)) ldBlocks.push(html.slice(i, Math.min(bodyEnd, i + 200_000)));
      const after = close < 0 ? -1 : lower.indexOf(">", close);
      i = after < 0 ? n : after + 1;
    } else if (!closing && name === "title") {
      const close = lower.indexOf("</title", i);
      title = html.slice(i, close < 0 ? Math.min(n, i + 500) : close);
      const after = close < 0 ? -1 : lower.indexOf(">", close);
      i = after < 0 ? Math.min(n, i + 500) : after + 1;
    } else if (name === "meta") {
      if (metas.length < 60) metas.push(tag);
    } else if (!closing && name === "a") {
      if (anchors.length < 400) anchors.push(tag);
      push(" ");
    } else {
      push(BREAK.has(name) ? "\n" : " ");
    }
  }

  return { text: out.join(""), title: squash(title), metas, anchors, ldBlocks };
}

function metaContent(metas: string[], key: string): string {
  for (const tag of metas) {
    if (new RegExp(`(?:name|property)\\s*=\\s*["']${key}["']`, "i").test(tag)) {
      const c = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
      if (c) return squash(c[1] ?? c[2] ?? "");
    }
  }
  return "";
}

/* ---------- schema.org JSON-LD ---------- */

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function flatten(node: unknown, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 4 || node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.slice(0, 50).forEach((x) => flatten(x, out, depth + 1));
    return out;
  }
  out.push(node);
  const graph = (node as Record<string, unknown>)["@graph"];
  if (graph) flatten(graph, out, depth + 1);
  return out;
}

function addressText(a: unknown): string {
  if (typeof a === "string") return a.trim();
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    return [o.streetAddress, o.addressLocality, o.addressRegion, o.postalCode, o.addressCountry].map((x) => (typeof x === "string" ? x : (x as { name?: string })?.name ?? "")).filter(Boolean).join(", ");
  }
  return "";
}

function jsonLdLines(blocks: string[]): string[] {
  const lines: string[] = [];
  for (const body of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    for (const n of flatten(data)) {
      const o = n as Record<string, unknown>;
      const types = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
      if (!types.some((t) => /^(Person|Organization|LocalBusiness|ProfessionalService|RealEstateAgent|Corporation|ProfilePage)$/i.test(t))) continue;
      const kind = types[0];
      const push = (k: string, v: string) => v && lines.length < 24 && lines.push(`${kind}.${k}: ${v.slice(0, 200)}`);
      push("name", str(o.name));
      push("jobTitle", str(o.jobTitle));
      push("worksFor", str((o.worksFor as { name?: string })?.name) || str(o.worksFor));
      push("email", str(o.email).replace(/^mailto:/i, ""));
      push("telephone", str(o.telephone));
      push("url", str(o.url));
      push("address", addressText(o.address));
      for (const s of ([] as unknown[]).concat(o.sameAs ?? []).slice(0, 8)) push("sameAs", str(s));
    }
  }
  return lines;
}

/* ---------- links ---------- */

function collectLinks(anchors: string[], baseUrl: string) {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const social = new Set<string>();
  for (const tag of anchors) {
    const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const href = decodeEntities((m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim());
    if (!href) continue;
    if (/^mailto:/i.test(href)) {
      let addr = href.slice(7).split("?")[0];
      try {
        addr = decodeURIComponent(addr);
      } catch {
        /* keep the raw text */
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim())) emails.add(addr.trim());
    } else if (/^tel:/i.test(href)) {
      let num = href.slice(4);
      try {
        num = decodeURIComponent(num);
      } catch {
        /* keep the raw text */
      }
      if (/\d{6,}/.test(num.replace(/\D/g, ""))) phones.add(num.trim());
    } else {
      try {
        const u = new URL(href, baseUrl);
        if ((u.protocol === "https:" || u.protocol === "http:") && networkOf(u.toString()) && u.pathname.length > 1) {
          social.add(`https://${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`);
        }
      } catch {
        /* skip unparseable link */
      }
    }
  }
  return { emails: [...emails].slice(0, 10), phones: [...phones].slice(0, 10), social: [...social].slice(0, 20) };
}

/* ---------- main ---------- */

/**
 * Turns a web page into a compact digest for the model. Contact details often live in the footer, so when the text
 * is too long the start and the end are kept and the middle is dropped. The default cap is roughly 2.5k tokens.
 */
export function digestPage(html: string, pageUrl: string, maxChars = 9000): PageDigest {
  const s = scan(html.slice(0, 1_500_000));
  const description = metaContent(s.metas, "description") || metaContent(s.metas, "og:description");

  let text = decodeEntities(s.text)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (text.length > maxChars) {
    const head = Math.floor(maxChars * 0.66);
    text = `${text.slice(0, head)}\n[...]\n${text.slice(-(maxChars - head))}`;
  }
  return { title: s.title, description, structured: jsonLdLines(s.ldBlocks), ...collectLinks(s.anchors, pageUrl), text };
}
