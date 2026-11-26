import { describe, expect, it, vi } from "vitest";
import { DesignError, DesignRequestSchema, extractJson, generateDesign, sanitizeDoc, type Complete } from "./design";
import { SignatureDocSchema } from "@/lib/schema/document";
import { TEMPLATE_META } from "@/lib/templates";

const base = TEMPLATE_META[1].doc;
const reply = (doc: unknown, text = "Here you go.") => JSON.stringify({ reply: text, doc });
const fake = (...texts: string[]) => {
  let i = 0;
  return vi.fn<Complete>(async () => ({ text: texts[Math.min(i++, texts.length - 1)], stopReason: "end_turn" }));
};
const req = { prompt: "modern real estate agent, deep green, photo left" };

describe("request validation", () => {
  it("accepts a normal prompt and trims it", () => {
    expect(DesignRequestSchema.parse({ prompt: "  hello there  " }).prompt).toBe("hello there");
  });
  it("rejects empty, too-long and unknown style hints", () => {
    expect(DesignRequestSchema.safeParse({ prompt: "  " }).success).toBe(false);
    expect(DesignRequestSchema.safeParse({ prompt: "x".repeat(1001) }).success).toBe(false);
    expect(DesignRequestSchema.safeParse({ prompt: "valid", styles: ["Hacker"] }).success).toBe(false);
  });
});

describe("extractJson", () => {
  it("tolerates code fences and surrounding prose", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\nDone')).toEqual({ a: 1 });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("generateDesign", () => {
  it("returns a validated doc and the reply on the first try", async () => {
    const c = fake(reply(base, "A green split layout."));
    const out = await generateDesign(req, c);
    expect(SignatureDocSchema.safeParse(out.doc).success).toBe(true);
    expect(out.reply).toBe("A green split layout.");
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("retries once with the validation errors, then succeeds", async () => {
    const bad = { ...base, theme: { ...base.theme, primary: "green" } };
    const spy = fake(reply(bad), reply(base));
    const out = await generateDesign(req, spy);
    expect(out.doc.theme.primary).toBe(base.theme.primary);
    expect(spy).toHaveBeenCalledTimes(2);
    const secondTurn = spy.mock.calls[1][1];
    expect(secondTurn.at(-1)?.content).toMatch(/failed validation[\s\S]*primary/);
  });

  it("retries when the reply is not JSON at all", async () => {
    const out = await generateDesign(req, fake("I cannot do that, sorry", reply(base)));
    expect(out.doc.blocks.length).toBeGreaterThan(0);
  });

  it("gives up after two invalid attempts with a user-readable error", async () => {
    await expect(generateDesign(req, fake("nope", "still nope"))).rejects.toMatchObject({ status: 502, code: "invalid_output" });
  });

  it("maps refusal and truncation stop reasons to clear errors", async () => {
    const refuse: Complete = async () => ({ text: "", stopReason: "refusal" });
    const cut: Complete = async () => ({ text: "{", stopReason: "max_tokens" });
    await expect(generateDesign(req, refuse)).rejects.toMatchObject({ code: "refused", status: 422 });
    await expect(generateDesign(req, cut)).rejects.toBeInstanceOf(DesignError);
  });

  it("falls back to a default reply when the model omits one", async () => {
    const out = await generateDesign(req, fake(JSON.stringify({ doc: base })));
    expect(out.reply).toMatch(/click anything/i);
  });
});

describe("sanitizeDoc (the model cannot know real URLs)", () => {
  const withBlocks = (blocks: unknown[]) => SignatureDocSchema.parse({ ...base, blocks });

  it("replaces non-placeholder images with placehold.co", () => {
    const doc = withBlocks([
      { type: "avatar", src: "https://evil.example/pixel.png", size: 80 },
      { type: "banner", src: "https://tracker.example/x.gif", width: 300, height: 90 },
    ]);
    const out = sanitizeDoc(doc, "anything");
    for (const b of out.blocks) {
      expect("src" in b && b.src && new URL(b.src).hostname).toBe("placehold.co");
    }
    expect(out.blocks[1]).toMatchObject({ src: "https://placehold.co/300x90.png" });
  });

  it("keeps social links only when the host matches the network", () => {
    const doc = withBlocks([
      {
        type: "social",
        links: [
          { network: "linkedin", url: "https://www.linkedin.com/in/jane" },
          { network: "github", url: "https://evil.example/github.com" },
          { network: "twitter", url: "https://x.com/jane" },
        ],
      },
    ]);
    const out = sanitizeDoc(doc, "x");
    expect(out.blocks[0]).toMatchObject({ links: [{ network: "linkedin" }, { network: "twitter" }] });
  });

  it("drops the whole social block when no link survives", () => {
    const doc = withBlocks([{ type: "social", links: [{ network: "github", url: "https://nope.example/a" }] }, { type: "divider" }]);
    expect(sanitizeDoc(doc, "x").blocks.map((b) => b.type)).toEqual(["divider"]);
  });

  it("keeps a banner link only if the user typed that URL", () => {
    const doc = withBlocks([{ type: "banner", src: "https://placehold.co/400x100.png", href: "https://acme.com/spring", width: 400, height: 100 }]);
    expect(sanitizeDoc(doc, "banner linking to https://acme.com/spring").blocks[0]).toMatchObject({ href: "https://acme.com/spring" });
    expect((sanitizeDoc(doc, "a banner please").blocks[0] as { href?: string }).href).toBeUndefined();
  });

  it("end to end: a hostile model reply still yields a safe doc", async () => {
    const hostile = { ...base, blocks: [{ type: "identity", name: "Jane" }, { type: "avatar", src: "https://evil.example/p.png", size: 80 }, { type: "social", links: [{ network: "linkedin", url: "https://evil.example/in/jane" }] }] };
    const out = await generateDesign(req, fake(reply(hostile)));
    expect(out.doc.blocks.map((b) => b.type)).toEqual(["identity", "avatar"]);
    expect(JSON.stringify(out.doc)).not.toContain("evil.example");
  });
});
