// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/presets";
import { DRAFT_KEY } from "@/lib/editor/draft";
import { clearDetails, loadCustom, markHandoff, saveCustom } from "./session";

const doc = PRESETS[0].doc;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("editor hand-off", () => {
  it("picks up the editor's draft once, right after handing the template over, and keeps it for a refresh", () => {
    const edited = { ...doc, theme: { ...doc.theme, primary: "#123456" } };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 1, doc: edited }));
    markHandoff(doc.template_id);
    expect(loadCustom(doc.template_id)?.theme.primary).toBe("#123456");
    window.localStorage.clear(); // the editor draft is gone, but the studio kept its copy
    expect(loadCustom(doc.template_id)?.theme.primary).toBe("#123456");
  });

  it("ignores a stale draft when nothing was handed over, and one for a different template", () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 1, doc }));
    expect(loadCustom(doc.template_id)).toBeNull();
    markHandoff("some-other-template");
    expect(loadCustom(doc.template_id)).toBeNull();
  });

  it("forgets the customised design when asked, and on start over", () => {
    saveCustom(doc);
    expect(loadCustom(doc.template_id)).not.toBeNull();
    saveCustom(null);
    expect(loadCustom(doc.template_id)).toBeNull();
    saveCustom(doc);
    clearDetails();
    expect(loadCustom(doc.template_id)).toBeNull();
  });
});
