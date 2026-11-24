import { describe, expect, it } from "vitest";
import { DRAFT_KEY, clearDraft, isDraftDoc, loadDraft, saveDraft, type StorageLike } from "./draft";
import { TEMPLATE_META } from "@/lib/templates";
import { pickFieldKey } from "./preview-map";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const doc = TEMPLATE_META[1].doc;

describe("draft storage", () => {
  it("round-trips a document", () => {
    const s = memoryStorage();
    expect(saveDraft(s, doc, 123)).toBe(true);
    expect(loadDraft(s)).toEqual({ savedAt: 123, doc });
  });

  it("restores a mid-edit draft that is not yet schema-valid", () => {
    const s = memoryStorage();
    const mid = { ...doc, blocks: [{ type: "contact" as const, email: "half-typed@" }] };
    saveDraft(s, mid);
    expect(loadDraft(s)?.doc.blocks[0]).toEqual({ type: "contact", email: "half-typed@" });
  });

  it("ignores corrupt, foreign or wrong-version data instead of throwing", () => {
    const s = memoryStorage();
    for (const raw of ["not json", "null", "[]", JSON.stringify({ savedAt: 1, doc: { version: 2 } }), JSON.stringify({ doc })]) {
      s.setItem(DRAFT_KEY, raw);
      expect(loadDraft(s)).toBeNull();
    }
  });

  it("rejects unknown block types and oversized block lists", () => {
    expect(isDraftDoc({ ...doc, blocks: [{ type: "script" }] })).toBe(false);
    expect(isDraftDoc({ ...doc, blocks: Array.from({ length: 31 }, () => ({ type: "divider" })) })).toBe(false);
  });

  it("survives storage that throws (private mode / quota)", () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(saveDraft(broken, doc)).toBe(false);
    expect(loadDraft(broken)).toBeNull();
    expect(() => clearDraft(broken)).not.toThrow();
  });

  it("clearDraft removes it", () => {
    const s = memoryStorage();
    saveDraft(s, doc);
    clearDraft(s);
    expect(loadDraft(s)).toBeNull();
  });
});

describe("pickFieldKey", () => {
  const identity = { type: "identity" as const, name: "Jane Doe", title: "Senior Designer", company: "Acme Inc." };
  it("matches the clicked text to its field", () => {
    expect(pickFieldKey(identity, "Jane Doe")).toBe("name");
  });
  it("splits a 'title · company' line by click offset", () => {
    const line = "Senior Designer · Acme Inc.";
    expect(pickFieldKey(identity, line, 3)).toBe("title");
    expect(pickFieldKey(identity, line, line.length - 2)).toBe("company");
  });
  it("handles website labels shown without protocol", () => {
    expect(pickFieldKey({ type: "contact", website: "https://acme.com/" }, "acme.com")).toBe("website");
  });
  it("falls back to the first field for images / empty text, and nothing for divider/social", () => {
    expect(pickFieldKey({ type: "avatar", src: "https://x.com/a.png", alt: "", shape: "circle", size: 80 }, "")).toBe("src");
    expect(pickFieldKey({ type: "divider" }, "x")).toBeUndefined();
  });
});
