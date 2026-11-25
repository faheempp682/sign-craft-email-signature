import { describe, expect, it } from "vitest";
import { socialDisplay, socialIconUrl } from "./shared";

const b = (display?: "icon" | "icon-text" | "text") => ({ type: "social" as const, display, links: [{ network: "linkedin" as const, url: "https://linkedin.com/in/jane" }] });

describe("social display", () => {
  it("icon: image only", () => {
    const h = socialDisplay(b("icon"), { text: "#000" });
    expect(h).toContain(`src="${socialIconUrl("linkedin")}"`);
    expect(h).not.toContain(">LinkedIn<");
  });
  it("text: name only", () => {
    const h = socialDisplay(b("text"), { text: "#000" });
    expect(h).toContain(">LinkedIn<");
    expect(h).not.toContain("<img");
  });
  it("icon-text: both", () => {
    const h = socialDisplay(b("icon-text"), { text: "#000" });
    expect(h).toContain("<img");
    expect(h).toContain(">LinkedIn<");
  });
});
