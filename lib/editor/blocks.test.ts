import { describe, expect, it } from "vitest";
import { SignatureDocSchema } from "@/lib/schema/document";
import { BLOCK_TYPES, cleanValue, createBlock } from "./blocks";
import { TEMPLATE_META } from "@/lib/templates";

describe("editor blocks", () => {
  it.each(BLOCK_TYPES)("new %s block is schema-valid (disclaimer text may be empty)", (type) => {
    const doc = { ...TEMPLATE_META[0].doc, blocks: [createBlock(type)] };
    expect(SignatureDocSchema.safeParse(doc).success).toBe(true);
  });

  it("blank inputs become undefined so optional fields stay valid", () => {
    expect(cleanValue("text", "")).toBeUndefined();
    expect(cleanValue("number", "")).toBeUndefined();
    expect(cleanValue("number", "80")).toBe(80);
    expect(cleanValue("text", "hi")).toBe("hi");
  });

  it("invalid edits are rejected, not rendered", () => {
    const doc = { ...TEMPLATE_META[0].doc, blocks: [{ type: "contact" as const, email: "not-an-email" }] };
    expect(SignatureDocSchema.safeParse(doc).success).toBe(false);
  });
});
