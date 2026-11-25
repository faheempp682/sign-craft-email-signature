// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GifMaker } from "./gif-maker";

type Sent = { frames: string[]; options: { delays: number[]; loop: number; width: number; height: number } };
let sent: Sent[];
let reply: () => Response;

const img = (name: string, size = 1000) => new File([new Uint8Array(size)], name, { type: "image/png" });
const gifBytes = (n: number) => new Response(new Uint8Array(n), { status: 200, headers: { "content-type": "image/gif", "x-gif-colours": "256" } });

beforeEach(() => {
  sent = [];
  reply = () => gifBytes(120 * 1024);
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:fake/${++n}`, revokeObjectURL: () => undefined }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const fd = init.body as FormData;
      sent.push({ frames: fd.getAll("frames").map((f) => (f as File).name), options: JSON.parse(String(fd.get("options"))) });
      return reply();
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

function setup(props: Partial<React.ComponentProps<typeof GifMaker>> = {}) {
  const onUse = vi.fn(async () => undefined);
  const onClose = vi.fn();
  render(<GifMaker width={400} height={100} onUse={onUse} onClose={onClose} {...props} />);
  return { onUse, onClose };
}
const addFrames = (...files: File[]) => fireEvent.change(screen.getByLabelText("Add frame images"), { target: { files } });
const build = async () => {
  fireEvent.click(screen.getByRole("button", { name: /build preview|rebuild preview/i }));
  await waitFor(() => expect(screen.queryByText("Building…")).toBeNull());
};

describe("GifMaker", () => {
  it("is a labelled dialog and always explains that Outlook shows only the first frame", () => {
    setup();
    expect(screen.getByRole("dialog", { name: /animated gif banner/i })).toBeTruthy();
    expect(screen.getByTestId("outlook-note").textContent).toMatch(/Outlook on Windows shows only the first frame/);
  });

  it("needs at least two frames before it can build", () => {
    setup();
    const btn = () => screen.getByRole("button", { name: /build preview/i }) as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    addFrames(img("a.png"));
    expect(btn().disabled).toBe(true);
    addFrames(img("b.png"));
    expect(btn().disabled).toBe(false);
  });

  it("allows at most 6 frames and tells the person why the rest were dropped", () => {
    setup();
    addFrames(...Array.from({ length: 8 }, (_, i) => img(`f${i}.png`)));
    expect(screen.getAllByTestId("gif-frame")).toHaveLength(6);
    expect(screen.getByRole("status").textContent).toMatch(/at most 6 frames/);
    expect(screen.queryByLabelText("Add frame images")).toBeNull();
  });

  it("rejects non-image and oversized files with a message", () => {
    setup();
    addFrames(new File(["x"], "doc.pdf", { type: "application/pdf" }));
    expect(screen.getByRole("status").textContent).toMatch(/PNG, JPEG or GIF/);
    addFrames(img("huge.png", 2 * 1024 * 1024 + 1));
    expect(screen.getByRole("status").textContent).toMatch(/under 2 MB/);
    expect(screen.queryAllByTestId("gif-frame")).toHaveLength(0);
  });

  it("sends frames in the order shown, with each delay, loop count and size", async () => {
    setup();
    addFrames(img("a.png"), img("b.png"), img("c.png"));
    // move frame 3 up: order becomes a, c, b
    fireEvent.click(screen.getByRole("button", { name: "Move frame 3 up" }));
    fireEvent.change(screen.getByLabelText("Frame 1 delay in milliseconds"), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText("Repeat"), { target: { value: "3" } });
    await build();
    expect(sent).toHaveLength(1);
    expect(sent[0].frames).toEqual(["a.png", "c.png", "b.png"]);
    expect(sent[0].options).toEqual({ delays: [2500, 1000, 1000], loop: 3, width: 400, height: 100 });
  });

  it("clamps delays into the allowed range", () => {
    setup();
    addFrames(img("a.png"), img("b.png"));
    const d = screen.getByLabelText("Frame 2 delay in milliseconds") as HTMLInputElement;
    fireEvent.change(d, { target: { value: "5" } });
    expect(d.value).toBe("100");
    fireEvent.change(d, { target: { value: "999999" } });
    expect(d.value).toBe("10000");
  });

  it("removes a frame and keeps the others in order", () => {
    setup();
    addFrames(img("a.png"), img("b.png"), img("c.png"));
    fireEvent.click(screen.getByRole("button", { name: "Remove frame 2" }));
    const rows = screen.getAllByTestId("gif-frame");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText(/c\.png/)).toBeTruthy();
  });

  it("labels frame 1 as the one Outlook shows", () => {
    setup();
    addFrames(img("a.png"), img("b.png"));
    expect(within(screen.getAllByTestId("gif-frame")[0]).getByText(/shown in Outlook/)).toBeTruthy();
    expect(within(screen.getAllByTestId("gif-frame")[1]).queryByText(/shown in Outlook/)).toBeNull();
  });

  it.each([
    [120 * 1024, "ok", /Within the guideline/],
    [500 * 1024, "warning", /Over the 300 KB guideline/],
  ])("shows a size meter for %i bytes", async (bytes, _level, text) => {
    reply = () => gifBytes(bytes);
    const { onUse } = setup();
    addFrames(img("a.png"), img("b.png"));
    await build();
    const meter = within(screen.getByTestId("size-meter"));
    expect(meter.getByRole("meter", { name: "GIF file size" })).toBeTruthy();
    expect(meter.getByText(text)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use this GIF" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Use this GIF" }));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    const f = (onUse.mock.calls[0] as unknown as [File])[0];
    expect(f.type).toBe("image/gif");
    expect(f.size).toBe(bytes);
  });

  it("blocks using a GIF over 1 MB", async () => {
    reply = () => gifBytes(1100 * 1024);
    const { onUse } = setup();
    addFrames(img("a.png"), img("b.png"));
    await build();
    expect(screen.getByText(/Over 1 MB/)).toBeTruthy();
    const use = screen.getByRole("button", { name: "Use this GIF" }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    fireEvent.click(use);
    expect(onUse).not.toHaveBeenCalled();
  });

  it("marks the preview stale when settings change, and will not use a stale GIF", async () => {
    setup();
    addFrames(img("a.png"), img("b.png"));
    await build();
    const use = () => screen.getByRole("button", { name: "Use this GIF" }) as HTMLButtonElement;
    expect(use().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Repeat"), { target: { value: "1" } });
    expect(screen.getByText(/Settings changed since this preview/)).toBeTruthy();
    expect(use().disabled).toBe(true);
  });

  it("explains when animated GIFs are switched off for the person (403 feature_disabled)", async () => {
    reply = () => Response.json({ error: "feature_disabled", message: "x" }, { status: 403 });
    setup();
    addFrames(img("a.png"), img("b.png"));
    await build();
    expect((await screen.findByRole("alert")).textContent).toMatch(/not enabled for your account/);
    expect((screen.getByRole("button", { name: /build preview/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows server errors without losing the frames", async () => {
    reply = () => Response.json({ error: "unreadable", message: "Frame 2 could not be read as an image. It may be damaged." }, { status: 422 });
    setup();
    addFrames(img("a.png"), img("b.png"));
    await build();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Frame 2 could not be read/);
    expect(screen.getAllByTestId("gif-frame")).toHaveLength(2);
  });

  it("shows an upload failure from the parent and stays open", async () => {
    const onUse = vi.fn(async () => { throw new Error("The image host rejected the upload."); });
    const { onClose } = setup({ onUse });
    addFrames(img("a.png"), img("b.png"));
    await build();
    fireEvent.click(screen.getByRole("button", { name: "Use this GIF" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/host rejected/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape closes it", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
