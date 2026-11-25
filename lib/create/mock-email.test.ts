import { describe, expect, it } from "vitest";
import { CLIENT_IDS, CLIENTS } from "@/lib/preview-clients";
import { PRESETS } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { applyDetails, EMPTY_DETAILS } from "./fill";
import { mockEmailDocument } from "./mock-email";

const sig = renderToEmailHtml(applyDetails(PRESETS[0].doc, { ...EMPTY_DETAILS, name: "Zed Quill", email: "zed@quill.example" }));

describe("mock email around a signature", () => {
  it.each(CLIENT_IDS)("%s: skeleton lines first, the signature last, in that client's pane", (client) => {
    const doc = mockEmailDocument(sig, client, false);
    expect(doc).toContain('data-mock="email"');
    expect(doc.indexOf("border-radius")).toBeLessThan(doc.indexOf('data-mock="signature"')); // skeleton above the signature
    expect(doc.slice(doc.indexOf('data-mock="signature"'))).toContain("Zed Quill");
    expect(doc).toContain(CLIENTS[client].light.bg);
    expect(doc).not.toMatch(/<script/i);
  });

  it("uses the dark pane colours in dark mode and keeps the skeleton visible", () => {
    const light = mockEmailDocument(sig, "outlook", false);
    const dark = mockEmailDocument(sig, "outlook", true);
    expect(dark).toContain(CLIENTS.outlook.dark.bg);
    expect(dark).not.toBe(light);
    expect(dark).toContain("rgba(255,255,255,.16)");
  });

  it("the Gmail pane applies Gmail's clean-up to the signature, not to the skeleton", () => {
    const g = mockEmailDocument(sig, "gmail", false);
    expect(g).toContain('data-mock="signature"');
    expect(g).toContain("Zed Quill");
  });
});
