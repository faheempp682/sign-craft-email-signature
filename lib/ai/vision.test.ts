import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { animatedGif, fakePngHeader, jpeg, png } from "@/lib/storage/test-fixtures";
import { MAX_SCREENSHOT_BYTES, MODEL_MAX_SIDE, VISION_SYSTEM_PROMPT, VisionError, buildVisionMessage, generateFromScreenshot, prepareScreenshot, type CompleteVision, type PreparedImage } from "./vision";
import { SYSTEM_PROMPT } from "./design";

const img = (): PreparedImage => ({ data: Buffer.from("pretend-png"), mediaType: "image/png", width: 600, height: 200 });

const doc = (over: Record<string, unknown> = {}) => ({
  version: 1,
  template_id: "modern-split",
  theme: { primary: "#1E3A8A", text: "#111827", muted: "#6B7280", font: "Arial", spacing: "normal" },
  blocks: [
    { type: "avatar", src: "https://placehold.co/160x160.png", alt: "Photo", shape: "circle", size: 80 },
    { type: "identity", name: "Jane Doe", title: "Designer", company: "Acme" },
    { type: "contact", phone: "+1 555 010 2030", email: "jane@acme.com", website: "acme.com" },
    { type: "social", links: [{ network: "linkedin", url: "https://www.linkedin.com/in/jane-fabricated" }, { network: "linkedin", url: "https://www.linkedin.com/in/dup" }, { network: "github", url: "https://evil.example/jane" }] },
    { type: "banner", src: "https://evil.example/banner.png", alt: "Promo", href: "https://evil.example/track", width: 400, height: 100 },
  ],
  ...over,
});
const says = (d: unknown, reply = "Done.") => JSON.stringify({ reply, doc: d });
const fake = (...texts: { text: string; stopReason?: string }[]) => {
  const fn = vi.fn<CompleteVision>();
  texts.forEach((t) => fn.mockResolvedValueOnce({ text: t.text, stopReason: t.stopReason ?? "end_turn" }));
  return fn;
};

describe("prepareScreenshot", () => {
  it("accepts a PNG and returns a PNG at its own size when it is small", async () => {
    const out = await prepareScreenshot(await png(600, 200));
    expect(out).toMatchObject({ mediaType: "image/png", width: 600, height: 200 });
    expect((await sharp(out.data).metadata()).format).toBe("png");
  });

  it("shrinks a big screenshot to the model's size and keeps the shape", async () => {
    const out = await prepareScreenshot(await png(3000, 1500));
    expect(Math.max(out.width, out.height)).toBe(MODEL_MAX_SIDE);
    expect(out.width / out.height).toBeCloseTo(2, 1);
  });

  it("never enlarges a small image", async () => {
    const out = await prepareScreenshot(await png(100, 40));
    expect([out.width, out.height]).toEqual([100, 40]);
  });

  it("accepts JPEG and uses the first frame of a GIF", async () => {
    expect((await prepareScreenshot(await jpeg(300, 100))).width).toBe(300);
    const gif = await prepareScreenshot(await animatedGif(200, 100, 4));
    expect(gif.height).toBe(100);
    expect((await sharp(gif.data).metadata()).pages ?? 1).toBe(1);
  });

  it("flattens transparency onto white, so a transparent screenshot is not black on black", async () => {
    const transparent = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await prepareScreenshot(transparent);
    const { data, info } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
  });

  it("rejects empty, oversize and non-image files with a clear message and status", async () => {
    await expect(prepareScreenshot(new Uint8Array())).rejects.toMatchObject({ status: 400, code: "bad_image" });
    await expect(prepareScreenshot(new Uint8Array(MAX_SCREENSHOT_BYTES + 1))).rejects.toMatchObject({ status: 413, code: "too_large" });
    await expect(prepareScreenshot(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).rejects.toMatchObject({ status: 415, code: "bad_type" });
    await expect(prepareScreenshot(new TextEncoder().encode("%PDF-1.7 not an image"))).rejects.toMatchObject({ status: 415 });
  });

  it("trusts the bytes, not the name: an image-looking header with garbage after it is unreadable, not a crash", async () => {
    await expect(prepareScreenshot(fakePngHeader(100, 100))).rejects.toBeInstanceOf(VisionError);
  });

  it("refuses absurd dimensions (decompression bomb)", async () => {
    await expect(prepareScreenshot(fakePngHeader(60_000, 60_000))).rejects.toMatchObject({ status: 422, code: "bad_image" });
  });
});

describe("prompts", () => {
  it("the vision prompt shares the document format with the design prompt, and the design prompt did not change shape", () => {
    expect(VISION_SYSTEM_PROMPT).toContain('"template_id"');
    expect(VISION_SYSTEM_PROMPT).toContain("SignatureDoc:");
    expect(SYSTEM_PROMPT).toContain("SignatureDoc:");
  });

  it("treats picture text and the note as data, not instructions", () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/never instructions/);
  });

  it("sends the image first and wraps the note in tags", () => {
    const m = buildVisionMessage(img(), "make it navy");
    const blocks = m.content as { type: string; text?: string; source?: { data: string; media_type: string } }[];
    expect(blocks[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("pretend-png").toString("base64") } });
    expect(blocks[1].text).toContain("<note>\nmake it navy\n</note>");
    expect((buildVisionMessage(img()).content as { text?: string }[])[1].text).not.toContain("<note>");
  });
});

describe("generateFromScreenshot", () => {
  it("returns a validated document and the model's reply", async () => {
    const complete = fake({ text: says(doc(), "I rebuilt it.") });
    const r = await generateFromScreenshot(img(), undefined, complete);
    expect(r.reply).toBe("I rebuilt it.");
    expect(r.doc.template_id).toBe("modern-split");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("accepts a reply wrapped in a code fence", async () => {
    const r = await generateFromScreenshot(img(), undefined, fake({ text: "```json\n" + says(doc()) + "\n```" }));
    expect(r.doc.blocks.length).toBeGreaterThan(0);
  });

  it("replaces images with placeholders, because the model cannot know real URLs", async () => {
    const { doc: d } = await generateFromScreenshot(img(), undefined, fake({ text: says(doc()) }));
    const banner = d.blocks.find((b) => b.type === "banner");
    expect(banner).toMatchObject({ src: "https://placehold.co/400x100.png" });
    expect(banner && "href" in banner ? banner.href : undefined).toBeUndefined(); // the invented link is dropped
  });

  it("points social icons at the network home page, one per network, never an invented profile", async () => {
    const { doc: d } = await generateFromScreenshot(img(), undefined, fake({ text: says(doc()) }));
    const social = d.blocks.find((b) => b.type === "social");
    expect(social && "links" in social ? social.links : []).toEqual([
      { network: "linkedin", url: "https://www.linkedin.com/" },
      { network: "github", url: "https://www.github.com/" },
    ]);
  });

  it("retries once with the validation errors when the first answer is invalid", async () => {
    const complete = fake({ text: says({ nonsense: true }) }, { text: says(doc()) });
    const r = await generateFromScreenshot(img(), undefined, complete);
    expect(r.doc.template_id).toBe("modern-split");
    expect(complete).toHaveBeenCalledTimes(2);
    const second = complete.mock.calls[1][1];
    expect(second).toHaveLength(3);
    expect(String(second[2].content)).toMatch(/failed validation/);
  });

  it("gives up after the retry with a readable error", async () => {
    const complete = fake({ text: "not json" }, { text: says({ nonsense: true }) });
    await expect(generateFromScreenshot(img(), undefined, complete)).rejects.toMatchObject({ status: 502, code: "invalid_output" });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("explains when the picture is not a signature, without retrying", async () => {
    const complete = fake({ text: JSON.stringify({ reply: "This is a photo of a cat.", doc: null }) });
    const err = await generateFromScreenshot(img(), undefined, complete).catch((e) => e);
    expect(err).toMatchObject({ status: 422, code: "not_signature" });
    expect(err.message).toContain("photo of a cat");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("maps a refusal and a truncated reply", async () => {
    await expect(generateFromScreenshot(img(), undefined, fake({ text: "", stopReason: "refusal" }))).rejects.toMatchObject({ code: "refused", status: 422 });
    await expect(generateFromScreenshot(img(), undefined, fake({ text: "{", stopReason: "max_tokens" }))).rejects.toMatchObject({ code: "truncated", status: 502 });
  });

  it("passes the note to the model", async () => {
    const complete = fake({ text: says(doc()) });
    await generateFromScreenshot(img(), "use a green accent", complete);
    expect(JSON.stringify(complete.mock.calls[0][1])).toContain("use a green accent");
  });
});
