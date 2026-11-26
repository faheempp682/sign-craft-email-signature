// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESETS } from "@/lib/presets";
import { DRAFT_KEY } from "@/lib/editor/draft";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/editor", useSearchParams: () => new URLSearchParams() }));

import { Editor } from "./editor";

const doc = structuredClone(PRESETS[0].doc);
const fetchMock = vi.fn();
/** Calls that save a signature (the Gmail panel also asks /api/google/status, which is irrelevant here). */
const saves = () => fetchMock.mock.calls.filter(([url]) => url === "/api/signatures");

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "11111111-1111-1111-1111-111111111111" }) });
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.querySelectorAll("a[data-leave]").forEach((a) => a.remove());
  vi.unstubAllGlobals();
});

/** A link outside the editor, like the sidebar's. */
function leaveLink() {
  const a = document.createElement("a");
  a.href = "/signatures";
  a.dataset.leave = "1";
  a.textContent = "Signatures";
  document.body.appendChild(a);
  return a;
}

/** Mounts the editor, opens the Form view and changes Spacing, which counts as an edit. */
async function editAndLeave(props: { saved?: { id: string; name: string; doc: typeof doc } }) {
  render(<Editor initial="classic" explicit={false} canSave {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Form" }));
  fireEvent.change(await screen.findByLabelText("Spacing"), { target: { value: "airy" } });
  fireEvent.click(leaveLink());
  await screen.findByRole("dialog");
}

const SAVED = { id: "22222222-2222-2222-2222-222222222222", name: "Mine", doc };
const labels = () => screen.getAllByRole("button").filter((b) => b.closest('[role="dialog"]')).map((b) => b.textContent?.trim()).filter((t) => t && t !== "✕");

describe("leave dialog: a saved signature", () => {
  it("offers exactly Discard changes and Save", async () => {
    await editAndLeave({ saved: SAVED });
    expect(labels().sort()).toEqual(["Discard changes", "Save"]);
    expect(push).not.toHaveBeenCalled();
  });

  it("Save sends the latest edit, then leaves", async () => {
    await editAndLeave({ saved: SAVED });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signatures"));
    const body = JSON.parse(saves()[0][1].body);
    expect(body.id).toBe(SAVED.id);
    expect(body.doc.theme.spacing).toBe("airy");
  });

  it("a failed Save stays on the page and says why", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: "Could not save. Please try again." }) });
    await editAndLeave({ saved: SAVED });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("Discard changes leaves without saving anything", async () => {
    await editAndLeave({ saved: SAVED });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(push).toHaveBeenCalledWith("/signatures");
    expect(saves()).toHaveLength(0);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull(); // a saved signature never touches the local draft
  });

  it("X and Esc close the dialog, stay put and discard nothing", async () => {
    await editAndLeave({ saved: SAVED });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(leaveLink());
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect(saves()).toHaveLength(0);
    // the edit is still there, so leaving again still asks
    fireEvent.click(leaveLink());
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});

describe("leave dialog: a new signature", () => {
  it("offers exactly Cancel and Save as draft", async () => {
    await editAndLeave({});
    expect(labels().sort()).toEqual(["Cancel", "Save as draft"]);
  });

  it("Save as draft stores the edit and leaves", async () => {
    await editAndLeave({});
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    expect(push).toHaveBeenCalledWith("/signatures");
    expect(JSON.parse(window.localStorage.getItem(DRAFT_KEY)!).doc.theme.spacing).toBe("airy");
    expect(saves()).toHaveLength(0);
  });

  it("Cancel stays and keeps the edit", async () => {
    await editAndLeave({});
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Spacing") as HTMLSelectElement).value).toBe("airy");
  });
});

describe("leave dialog: nothing to lose", () => {
  it("does not appear when nothing was edited", async () => {
    render(<Editor initial="classic" explicit={false} canSave saved={SAVED} />);
    await screen.findByRole("button", { name: "Form" });
    await act(async () => {
      fireEvent.click(leaveLink());
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
