import { describe, expect, it } from "vitest";
import { getPreset } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { CLIENTS, CLIENT_IDS, clientHtml, previewDocument } from "./preview-clients";

const soft = renderToEmailHtml(getPreset("soft-card")!.doc);

describe("preview clients", () => {
  it("keeps the original client ids and adds the new ones", () => {
    for (const id of ["gmail", "outlook", "mobile", "outlook-win", "apple-mail", "thunderbird"]) expect(CLIENT_IDS).toContain(id);
  });
  it("labels every simulation as such and never claims a real Outlook or Gmail", () => {
    for (const id of CLIENT_IDS) {
      const c = CLIENTS[id];
      if (c.pipeline !== "none") {
        expect(c.fidelity).toBe("simulation");
        expect(c.label.toLowerCase()).toContain("sim");
        expect(c.badge).toBe("Simulation");
      } else expect(c.badge).not.toBe("Real engine"); // a Chrome frame is never a real foreign engine
    }
    expect(CLIENTS["outlook-win"].note).toMatch(/not real outlook/i);
  });
  it("Outlook Windows squares corners in its preview, Apple Mail keeps them", () => {
    expect(previewDocument(soft, "outlook-win", false)).not.toContain("border-radius");
    expect(previewDocument(soft, "apple-mail", false)).toContain("border-radius");
  });
  it("dark mode changes colours for Outlook Windows but not for Apple Mail", () => {
    expect(clientHtml(soft, "outlook-win", true)).not.toBe(clientHtml(soft, "outlook-win", false));
    expect(clientHtml(soft, "apple-mail", true)).toBe(soft);
  });
  it("keeps the old behaviour of the pane colours", () => {
    expect(previewDocument("<p>x</p>", "mobile", true)).toContain("background:#000000");
    expect(CLIENTS.mobile.width).toBe(375);
  });
});
