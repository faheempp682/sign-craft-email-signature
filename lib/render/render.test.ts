import { describe, expect, it } from "vitest";
import { PRESETS, getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { simulateDark } from "./dark";
import { knownDifferences } from "./differences";
import { simulateGmail } from "./gmail-sanitize";
import { declaredWidth, parseStyle, rewriteTags } from "./html-tools";
import { ByteCache, Gate, QueueFull, RateLimiter } from "./limits";
import { simulateOutlookWord } from "./outlook-word";
import { checkUrl, fetchImage, isPrivateAddress } from "./safe-image";
import { buildRenderDocument } from "./simulate";
import { RENDER_TARGETS } from "./targets";
import { pngSize } from "./engine";

const html = (id: string) => renderToEmailHtml(getPreset(id)!.doc);
const word = (s: string) => simulateOutlookWord(s).html;

describe("html-tools", () => {
  it("rewrites tags and keeps everything else byte for byte", () => {
    const src = `<table width="10"><tr><td style="a:b;c:d">x &amp; y</td></tr></table><img src="https://a/b.png" alt="">`;
    expect(rewriteTags(src, () => {})).toBe(src);
  });
  it("splits style declarations without breaking on ; inside url() or quotes", () => {
    expect(parseStyle(`background:url("data:image/png;base64,AAA");font-family:'A;B', serif;color:red`).map((d) => d.prop)).toEqual(["background", "font-family", "color"]);
  });
  it("finds the widest declared table width", () => {
    expect(declaredWidth(`<table width="380"></table><table style="width:620px"></table>`)).toBe(620);
  });
});

describe("Outlook Word simulation", () => {
  it("drops border-radius, box-shadow, max-width and overflow-wrap (not in Word's supported list)", () => {
    const out = word(`<table style="border-radius:12px;box-shadow:0 0 4px red;max-width:600px;overflow-wrap:anywhere;color:#111"><tr><td>x</td></tr></table>`);
    expect(out).toContain("color:#111");
    for (const gone of ["border-radius", "box-shadow", "max-width", "overflow-wrap"]) expect(out).not.toContain(gone);
  });
  it("keeps padding and width on table cells but drops them on div, p and span", () => {
    const out = word(`<td style="padding:8px;width:40px;"><div style="padding:8px;width:40px;margin:4px;">a</div><span style="margin:4px;padding:2px">b</span></td>`);
    expect(out).toContain(`<td style="padding:8px;width:40px;">`);
    expect(out).toContain(`<div style="margin:4px;">`);
    expect(out).not.toMatch(/<span[^>]*(margin|padding)/);
  });
  it("keeps only the colour of the background shorthand and drops gradients and background images", () => {
    const out = word(`<td style="background:#ff0000 url(https://x/y.png) no-repeat"></td><td style="background-image:linear-gradient(red,blue)"></td><td background="https://x/y.png"></td>`);
    expect(out).toContain("background-color:#ff0000");
    expect(out).not.toMatch(/url\(|gradient|background=/);
  });
  it("ignores CSS width/height on an image that has no width and height attributes, but honours attributes", () => {
    expect(word(`<img src="https://x/a.png" style="width:80px;height:80px;display:block">`)).not.toMatch(/width:80px/);
    expect(word(`<img src="https://x/a.png" width="80" height="80" style="width:80px;height:80px;display:block">`)).toContain("width:80px");
  });
  it("keeps only uppercase text-transform", () => {
    expect(word(`<div style="text-transform:uppercase">a</div>`)).toContain("uppercase");
    expect(word(`<div style="text-transform:capitalize">a</div>`)).not.toContain("capitalize");
  });
  it("reports animated GIFs instead of silently passing them", () => {
    expect(simulateOutlookWord(`<img src="https://x/a.gif" width="1" height="1">`).changes.find((c) => c.code === "animated-gif")?.count).toBe(1);
  });
  it("squares the rounded corners of a real template and reports how many", () => {
    const r = simulateOutlookWord(html("soft-card"));
    expect(r.html).not.toContain("border-radius");
    expect(r.changes.find((c) => c.code === "border-radius")!.count).toBeGreaterThan(0);
  });
  it("never changes the number of tables or cells, only styles", () => {
    for (const id of ["classic", "studio-003", "studio-009", "editorial-arch"]) {
      const src = html(id);
      const out = word(src);
      expect((out.match(/<td\b/g) ?? []).length).toBe((src.match(/<td\b/g) ?? []).length);
      expect((out.match(/<table\b/g) ?? []).length).toBe((src.match(/<table\b/g) ?? []).length);
    }
  });
});

describe("Gmail simulation", () => {
  it("removes the properties Google lists as unsupported and keeps border-radius", () => {
    const out = simulateGmail(`<div style="position:absolute;z-index:3;box-shadow:0 0 1px red;transform:rotate(1deg);--x:1;border-radius:8px;color:red;flex:1;gap:4px">a</div>`).html;
    for (const gone of ["position", "z-index", "box-shadow", "transform", "--x", "flex:1", "gap"]) expect(out).not.toContain(gone);
    expect(out).toContain("border-radius:8px");
    expect(out).toContain("color:red");
  });
  it("strips negative margins, scripts and style blocks, rewrites white-space:pre and data urls", () => {
    const r = simulateGmail(`<style>p{color:red}</style><script>alert(1)</script><p style="margin-left:-10px;white-space:pre;background:url(data:image/png;base64,AA)">x</p>`).html;
    expect(r).not.toMatch(/<style|<script|alert|-10px/);
    expect(r).toContain("pre-wrap");
    expect(r).toContain("url('')");
  });
  it("discards the whole style attribute when it uses a space-separated colour function", () => {
    expect(simulateGmail(`<p style="color:oklch(0.5 0.1 200);margin:0">x</p>`).html).toBe("<p>x</p>");
  });
});

describe("dark mode simulation", () => {
  const sig = `<table bgcolor="#FFFFFF" style="background-color:#FFFFFF;color:#111111"><tr><td style="color:#111111">a</td></tr></table><table bgcolor="#101010" style="background-color:#101010"><tr><td style="color:#ffffff">b</td></tr></table>`;
  it("none leaves the HTML untouched", () => expect(simulateDark(sig, "none").html).toBe(sig));
  it("partial darkens a light background and lightens dark text on it, but leaves a dark card and its light text", () => {
    const out = simulateDark(sig, "partial").html;
    expect(out).not.toContain("#FFFFFF");
    expect(out).not.toMatch(/color:#111111/);
    expect(out).toContain("#101010");
    expect(out).toContain("color:#ffffff");
  });
  it("full also inverts the dark card and its text", () => {
    const out = simulateDark(sig, "full").html;
    expect(out).not.toContain("#101010");
    expect(out).not.toMatch(/color:#ffffff/);
  });
  it("does not touch images", () => {
    expect(simulateDark(`<img src="https://x/a.png" width="10" height="10" style="border:0">`, "full").html).toContain(`src="https://x/a.png"`);
  });
});

describe("known differences", () => {
  it("reports squared corners for Outlook Windows only when the signature has rounded corners", () => {
    expect(knownDifferences(html("soft-card"), "outlook-win").some((d) => d.id === "radius")).toBe(true);
    const flat = `<table width="400"><tr><td style="color:#111">hi</td></tr></table>`;
    expect(knownDifferences(flat, "outlook-win").some((d) => d.id === "radius")).toBe(false);
  });
  it("warns about width on phones", () => {
    expect(knownDifferences(`<table width="620"></table>`, "mobile").some((d) => d.id === "narrow")).toBe(true);
  });
  it("cites a source for every Outlook Windows rule", () => {
    for (const d of knownDifferences(html("soft-card"), "outlook-win").filter((x) => x.severity !== "note")) expect(d.source).toBeTruthy();
  });
});

describe("render document", () => {
  it("carries a CSP that blocks scripts, frames and remote styles, and labels simulations", () => {
    const { doc } = buildRenderDocument(`<p>x</p><script>alert(1)</script>`, RENDER_TARGETS["outlook-word-sim"], "desktop", false);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("img-src https: data:");
    expect(RENDER_TARGETS["outlook-word-sim"].kind).toBe("simulation");
    expect(RENDER_TARGETS["gmail-sim"].kind).toBe("simulation");
    expect(RENDER_TARGETS.webkit.kind).toBe("real");
  });
  it("zooms a wide signature to fit the phone pane", () => {
    const { doc } = buildRenderDocument(`<table width="620"><tr><td>x</td></tr></table>`, RENDER_TARGETS.webkit, "phone", false);
    expect(doc).toMatch(/zoom:0\.5\d+/);
  });
  it("reads PNG sizes", () => {
    const b = Buffer.alloc(24);
    b.writeUInt32BE(0x89504e47, 0);
    b.writeUInt32BE(300, 16);
    b.writeUInt32BE(120, 20);
    expect(pngSize(b)).toEqual({ width: 300, height: 120 });
  });
});

describe("every template survives every pipeline", () => {
  it("does not throw and keeps text", () => {
    for (const p of PRESETS) {
      const src = renderToEmailHtml(p.doc);
      const name = p.doc.blocks.find((b) => b.type === "identity");
      for (const out of [simulateOutlookWord(src).html, simulateGmail(src).html, simulateDark(src, "full").html, simulateDark(src, "partial").html]) {
        if (name && name.type === "identity") expect(out.toLowerCase()).toContain(name.name.toLowerCase().split(" ")[0].replace(/&/g, "&amp;"));
      }
    }
  });
});

describe("safe image fetching", () => {
  it("treats private, loopback, link-local and mapped addresses as private", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("only accepts plain https URLs", () => {
    expect(checkUrl("https://placehold.co/1.png")).not.toBeNull();
    for (const u of ["http://placehold.co/1.png", "file:///etc/passwd", "https://user:pw@x.com/a", "https://x.com:8443/a", "https://localhost/a", "https://db.internal/a", "javascript:alert(1)", "nope"]) expect(checkUrl(u), u).toBeNull();
  });
  it("refuses a host that resolves to a private address, without connecting", async () => {
    const r = await fetchImage("https://evil.example/a.png", async () => ["10.0.0.7"]);
    expect(r).toEqual({ ok: false, reason: "private address" });
  });
  it("refuses when any one of several resolved addresses is private", async () => {
    expect((await fetchImage("https://evil.example/a.png", async () => ["8.8.8.8", "127.0.0.1"])).ok).toBe(false);
  });
  it("refuses a literal private IP", async () => {
    expect((await fetchImage("https://169.254.169.254/latest/meta-data")).ok).toBe(false);
  });
});

describe("limits", () => {
  it("rate limiter allows N per window then reports a wait, and recovers", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect(rl.take("u")).toBe(0);
    expect(rl.take("u")).toBe(0);
    expect(rl.take("u")).toBeGreaterThan(0);
    expect(rl.take("other")).toBe(0);
    t = 1500;
    expect(rl.take("u")).toBe(0);
  });
  it("gate caps concurrency and rejects when the queue is full", async () => {
    const gate = new Gate(1, 1);
    let running = 0;
    let peak = 0;
    const job = () => gate.run(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 20)); running--; });
    const a = job();
    const b = job();
    await expect(job()).rejects.toBeInstanceOf(QueueFull);
    await Promise.all([a, b]);
    expect(peak).toBe(1);
  });
  it("cache evicts oldest past the byte budget and expires by age", () => {
    let t = 0;
    const c = new ByteCache<{ bytes: number }>(100, 1000, () => t);
    c.set("a", { bytes: 60 });
    c.set("b", { bytes: 60 });
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeDefined();
    t = 2000;
    expect(c.get("b")).toBeUndefined();
  });
});
