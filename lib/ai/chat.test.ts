import { describe, expect, it } from "vitest";
import { ChatError, buildChatMessages, generateChat, type ChatAttachment, type ChatMsg, type CompleteChat } from "./chat";

const doc = {
  version: 1,
  template_id: "classic",
  theme: { primary: "#1d4ed8", text: "#111827", muted: "#6B7280", font: "Arial", spacing: "normal" },
  blocks: [{ type: "identity", name: "Your Name", title: "Your Title", company: "Your Company" }],
};
const payload = (over: Partial<Parameters<typeof generateChat>[0]> = {}) => ({ history: [], text: "make a signature", ...over });
const reply = (body: unknown, stopReason: string | null = "end_turn"): CompleteChat => async () => ({ text: JSON.stringify(body), stopReason });

describe("generateChat", () => {
  it("returns a validated design", async () => {
    const r = await generateChat(payload(), [], reply({ reply: "Here you go.", doc }));
    expect(r.doc?.blocks[0]).toMatchObject({ type: "identity", name: "Your Name" });
    expect(r.reply).toBe("Here you go.");
  });

  it("returns a plain answer when the model sends no design", async () => {
    const r = await generateChat(payload({ text: "hi" }), [], reply({ reply: "What is your name?", doc: null }));
    expect(r).toEqual({ reply: "What is your name?", doc: null });
  });

  it("retries once with the validation error, then succeeds", async () => {
    const seen: ChatMsg[][] = [];
    let n = 0;
    const complete: CompleteChat = async (_s, messages) => {
      seen.push([...messages]);
      return { text: JSON.stringify(n++ === 0 ? { reply: "x", doc: { version: 1 } } : { reply: "Fixed.", doc }), stopReason: "end_turn" };
    };
    const r = await generateChat(payload(), [], complete);
    expect(r.reply).toBe("Fixed.");
    expect(seen).toHaveLength(2);
    expect(String(seen[1].at(-1)?.content)).toContain("failed validation");
  });

  it("gives up after two invalid replies", async () => {
    await expect(generateChat(payload(), [], reply({ reply: "x", doc: { version: 1 } }))).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("maps refusals and truncation to clear errors", async () => {
    await expect(generateChat(payload(), [], reply({}, "refusal"))).rejects.toMatchObject({ code: "refused", status: 422 });
    await expect(generateChat(payload(), [], reply({}, "max_tokens"))).rejects.toMatchObject({ code: "truncated" });
  });

  it("rejects an invalid design to refine before calling the model", async () => {
    let called = false;
    const complete: CompleteChat = async () => ((called = true), { text: "", stopReason: null });
    await expect(generateChat(payload({ doc: { nope: true } }), [], complete)).rejects.toBeInstanceOf(ChatError);
    expect(called).toBe(false);
  });

  it("replaces images with placeholders and drops social links that point at the wrong site", async () => {
    const d = {
      ...doc,
      blocks: [
        { type: "avatar", src: "https://evil.example/a.png", alt: "me", shape: "circle", size: 80 },
        { type: "social", links: [{ network: "linkedin", url: "https://evil.example/in/me" }] },
        ...doc.blocks,
      ],
    };
    const r = await generateChat(payload(), [], reply({ reply: "ok", doc: d }));
    const avatar = r.doc?.blocks.find((b) => b.type === "avatar");
    expect(avatar && "src" in avatar && avatar.src).toMatch(/^https:\/\/placehold\.co\//);
    expect(r.doc?.blocks.some((b) => b.type === "social")).toBe(false);
  });
});

describe("buildChatMessages", () => {
  it("opens with the user, includes the current design, and puts attachments before the text", () => {
    const files: ChatAttachment[] = [
      { kind: "text", name: "brand.txt", text: "Acme, navy" },
      { kind: "pdf", name: "guide.pdf", data: Buffer.from("%PDF-1.4") },
    ];
    const msgs = buildChatMessages(
      { history: [{ role: "assistant", text: "Hello" }, { role: "user", text: "hi" }, { role: "assistant", text: "Designed" }], text: "make it navy" },
      doc as never,
      files,
    );
    expect(msgs[0].role).toBe("user");
    expect(msgs).toHaveLength(3);
    const last = msgs.at(-1)!.content as { type: string; text?: string }[];
    expect(last.map((b) => b.type)).toEqual(["text", "document", "text"]);
    expect(last.at(-1)?.text).toContain("<current_design>");
    expect(last.at(-1)?.text).toContain("make it navy");
  });
});
