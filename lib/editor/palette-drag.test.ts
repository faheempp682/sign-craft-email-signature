import { describe, expect, it } from "vitest";
import { parsePayload } from "./palette-drag";

describe("palette drag payload", () => {
  it("parses element and row payloads and rejects anything else", () => {
    expect(parsePayload("el:text")).toEqual({ kind: "el", id: "text" });
    expect(parsePayload("row:50-50")).toEqual({ kind: "row", id: "50-50" });
    for (const bad of ["", "text", "x:text", ":text", "el"]) expect(parsePayload(bad)).toBeNull();
  });
});
