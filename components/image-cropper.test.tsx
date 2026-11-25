// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ render: [] as { rect: { x: number; y: number; w: number; h: number }; out: { w: number; h: number } }[], closed: 0, loadError: "" }));

vi.mock("@/lib/editor/crop-canvas", () => ({
  CropLoadError: class extends Error {},
  loadCropSource: async (file: File) => {
    if (calls.loadError) throw new (class extends Error {})(calls.loadError);
    return { drawable: {}, width: 2000, height: 1000, type: file.type, name: file.name, close: () => { calls.closed++; } };
  },
  renderCrop: async (_s: unknown, rect: { x: number; y: number; w: number; h: number }, out: { w: number; h: number }) => {
    calls.render.push({ rect, out });
    return new File(["x"], "cropped.png", { type: "image/png" });
  },
}));

import { ImageCropper } from "./image-cropper";

const file = new File(["x"], "photo.png", { type: "image/png" });

function setup(props: Partial<React.ComponentProps<typeof ImageCropper>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<ImageCropper file={file} aspect={1} shape="circle" purpose="avatar" onConfirm={onConfirm} onCancel={onCancel} {...props} />);
  return { onConfirm, onCancel, ...utils };
}
const area = () => screen.findByTestId("crop-area");

beforeEach(() => {
  calls.render = [];
  calls.closed = 0;
  calls.loadError = "";
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

describe("ImageCropper", () => {
  it("is a labelled modal dialog that locks page scroll and focuses the crop area when ready", async () => {
    setup({ title: "Crop photo" });
    const dlg = screen.getByRole("dialog", { name: "Crop photo" });
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
    const a = await area();
    await waitFor(() => expect(document.activeElement).toBe(a));
    expect(a.getAttribute("aria-label")).toMatch(/Crop area/);
  });

  it("labels every control", async () => {
    setup();
    await area();
    expect(screen.getByRole("slider", { name: "Zoom" })).toBeTruthy();
    for (const n of ["Zoom in", "Zoom out"]) expect(screen.getByRole("button", { name: n })).toBeTruthy();
    for (const n of ["Cancel", "Reset", "Crop and upload"]) expect(screen.getByRole("button", { name: n })).toBeTruthy();
  });

  it("previews the block's shape with a matching mask", async () => {
    const { unmount } = setup({ shape: "circle" });
    expect((await screen.findByTestId("crop-mask")).style.borderRadius).toBe("50%");
    unmount();
    setup({ shape: "square" });
    expect(((await screen.findAllByTestId("crop-mask"))[0] as HTMLElement).style.borderRadius).toMatch(/^0/);
  });

  it("zooms with + and - and shows it to assistive technology", async () => {
    setup();
    const a = await area();
    fireEvent.keyDown(a, { key: "+" });
    fireEvent.keyDown(a, { key: "+" });
    expect(a.getAttribute("aria-label")).toMatch(/Zoom 132 percent/);
    fireEvent.keyDown(a, { key: "-" });
    expect(a.getAttribute("aria-label")).toMatch(/Zoom 115 percent/);
    // cannot go below 100 percent
    for (let i = 0; i < 5; i++) fireEvent.keyDown(a, { key: "-" });
    expect(a.getAttribute("aria-label")).toMatch(/Zoom 100 percent/);
  });

  it("arrow keys pan the visible region, and Enter outputs exactly that region", async () => {
    const { onConfirm } = setup();
    const a = await area();
    // image 2000x1000, square crop: base region is 1000x1000 centred at x=1000 (x from 500)
    fireEvent.keyDown(a, { key: "ArrowRight" }); // +5% of 1000 = +50
    fireEvent.keyDown(a, { key: "ArrowRight", shiftKey: true }); // +25% = +250
    fireEvent.keyDown(a, { key: "Enter" });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(calls.render).toHaveLength(1);
    expect(calls.render[0].rect.x).toBeCloseTo(500 + 300, 6);
    expect(calls.render[0].rect.w).toBeCloseTo(1000, 6);
    expect(calls.render[0].out).toEqual({ w: 400, h: 400 }); // LIMITS.maxSide.avatar
    expect(onConfirm.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it("arrow keys stop at the image edge", async () => {
    const { onConfirm } = setup();
    const a = await area();
    for (let i = 0; i < 40; i++) fireEvent.keyDown(a, { key: "ArrowLeft", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Crop and upload" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(calls.render[0].rect.x).toBe(0);
  });

  it("Escape cancels without producing a file", async () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.keyDown(await area(), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(calls.render).toHaveLength(0);
  });

  it("Enter on the Cancel button cancels instead of confirming", async () => {
    const { onConfirm, onCancel } = setup();
    await area();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.keyDown(cancel, { key: "Enter" });
    fireEvent.click(cancel);
    await new Promise((r) => setTimeout(r, 30));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps Tab focus inside the dialog", async () => {
    setup();
    await area();
    const confirmBtn = screen.getByRole("button", { name: "Crop and upload" });
    confirmBtn.focus();
    fireEvent.keyDown(confirmBtn, { key: "Tab" });
    expect(document.activeElement).not.toBe(confirmBtn);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    // Shift+Tab from the first control wraps to the last
    (await area()).focus();
    fireEvent.keyDown(await area(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);
  });

  it("slider and Reset work, and Reset returns to the centred full crop", async () => {
    const { onConfirm } = setup();
    const a = await area();
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "2" } });
    expect(a.getAttribute("aria-label")).toMatch(/Zoom 200 percent/);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(a.getAttribute("aria-label")).toMatch(/Zoom 100 percent/);
    fireEvent.click(screen.getByRole("button", { name: "Crop and upload" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(calls.render[0].rect).toEqual({ x: 500, y: 0, w: 1000, h: 1000 });
  });

  it("uses the requested aspect for banners and caps the output at the banner limit", async () => {
    const { onConfirm } = setup({ aspect: 4, shape: "square", purpose: "banner" });
    await area();
    fireEvent.click(screen.getByRole("button", { name: "Crop and upload" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    const r = calls.render[0];
    expect(r.rect.w / r.rect.h).toBeCloseTo(4, 6);
    expect(r.rect).toEqual({ x: 0, y: 250, w: 2000, h: 500 });
    expect(r.out).toEqual({ w: 1200, h: 300 });
  });

  it("offers the whole image only when asked to", async () => {
    const onUseOriginal = vi.fn();
    setup({ onUseOriginal });
    await area();
    fireEvent.click(screen.getByRole("button", { name: "Use the whole image" }));
    expect(onUseOriginal).toHaveBeenCalledTimes(1);
  });

  it("shows a readable error for a file that cannot be opened, and disables confirm", async () => {
    calls.loadError = "That file could not be opened as an image.";
    setup();
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be opened/);
    expect((screen.getByRole("button", { name: "Crop and upload" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("restores the page scroll and releases the image when it closes", async () => {
    const { unmount } = setup();
    await area();
    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(calls.closed).toBe(1);
  });
});
