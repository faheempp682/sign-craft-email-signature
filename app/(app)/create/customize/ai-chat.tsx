"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpIcon } from "@solar-icons/react/linear/arrow-up";
import { PaperclipIcon } from "@solar-icons/react/linear/paperclip";
import { PenNewSquareIcon } from "@solar-icons/react/linear/pen-new-square";
import { TrashBinMinimalisticIcon } from "@solar-icons/react/linear/trash-bin-minimalistic";
import { CloseCircleIcon } from "@solar-icons/react/linear/close-circle";
import { FileTextIcon } from "@solar-icons/react/linear/file-text";
import { HistoryIcon } from "@solar-icons/react/linear/history";
import { StarsMinimalisticIcon } from "@solar-icons/react/linear/stars-minimalistic";
import { CheckCircleIcon } from "@solar-icons/react/linear/check-circle";
import type { SignatureDoc } from "@/lib/schema/document";
import type { StoredMessage } from "@/lib/ai/history";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { getStorage, saveDraft } from "@/lib/editor/draft";
import { clearDetails, saveCustom } from "@/lib/create/session";
import { ensureIdentity } from "@/lib/create/fill";
import { getPreset } from "@/lib/presets";
import { cn } from "@/lib/utils";

type UiMsg = StoredMessage & { error?: boolean };
type Pending = { key: string; file: File; kind: "image" | "pdf" | "text"; thumb?: string };
type ChatRow = { id: string; title: string; updated_at: string };

const MAX_FILES = 4;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/gif,application/pdf,.pdf,.txt,.md,.csv,.vcf,text/plain";
const SUGGESTIONS = [
  "Modern real-estate agent, deep green accent, headshot on the left",
  "Minimal serif, text only, for a freelance writer",
  "Bold agency signature with logo, socials and a promo banner",
];

const withoutKey = <T,>(o: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const kindOf = (f: File): Pending["kind"] | null =>
  f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "pdf" : /\.(txt|md|csv|vcf)$/i.test(f.name) || f.type === "text/plain" ? "text" : ["image/png", "image/jpeg", "image/gif"].includes(f.type) ? "image" : null;

/** A small preview that is stored with the chat, so saved chats still show what was attached. */
async function makeThumb(file: File): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  }
}

/** The signature as it will be sent, drawn in a sandboxed frame that grows to fit it. */
function DesignPreview({ doc }: { doc: SignatureDoc }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(140);
  const html = useMemo(() => {
    try {
      return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:20px;background:#fff">${renderToEmailHtml(doc)}</body></html>`;
    } catch {
      return `<!doctype html><body style="font:14px Arial;margin:20px">This design could not be drawn.</body>`;
    }
  }, [doc]);
  const fit = useCallback(() => {
    const d = frame.current?.contentDocument;
    if (d?.body) setHeight(Math.max(80, Math.ceil(d.documentElement.scrollHeight)));
  }, []);
  return (
    <iframe
      ref={frame}
      title="Signature design"
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={() => {
        fit();
        const d = frame.current?.contentDocument;
        Array.from(d?.images ?? []).forEach((i) => i.addEventListener("load", fit));
      }}
      style={{ height }}
      className="block w-full rounded-xl border border-border bg-white"
    />
  );
}

export function AiChat() {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [baseId, setBaseId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "off">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tplState, setTplState] = useState<Record<string, "saving" | "saved">>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const lastDocMsg = useMemo(() => [...messages].reverse().find((m) => m.doc), [messages]);
  const baseMsg = messages.find((m) => m.id === baseId && m.doc) ?? lastDocMsg;

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/chats", { cache: "no-store" });
      if (!res.ok) return setListState("off");
      const data = (await res.json()) as { chats: ChatRow[] };
      setChats(data.chats);
      setListState("ready");
    } catch {
      setListState("off");
    }
  }, []);

  useEffect(() => {
    void loadList();
    box.current?.focus();
  }, [loadList]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);
  // Grow the box with what is typed, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  /** Saves the whole conversation after every turn: the first save creates the chat, later ones replace it. */
  async function persist(all: UiMsg[]) {
    const clean: StoredMessage[] = all.filter((m) => !m.error).map((m) => ({ id: m.id, role: m.role, text: m.text, doc: m.doc, attachments: m.attachments }));
    if (!clean.length) return;
    try {
      const id = chatIdRef.current;
      const res = await fetch(id ? `/api/ai/chats/${id}` : "/api/ai/chats", { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: clean }) });
      if (!res.ok) return setSaveState("failed");
      const row = (await res.json()) as ChatRow;
      chatIdRef.current = row.id;
      setChatId(row.id);
      setSaveState("saved");
      void loadList();
    } catch {
      setSaveState("failed");
    }
  }

  async function addFiles(list: FileList | File[] | null | undefined) {
    const incoming = Array.from(list ?? []);
    if (!incoming.length) return;
    setNotice("");
    const next: Pending[] = [...files];
    for (const f of incoming) {
      const kind = kindOf(f);
      if (!kind) {
        setNotice(`"${f.name}" is not supported. Attach a PNG, JPG, GIF, PDF or text file.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        setNotice(`"${f.name}" is over 5 MB.`);
        continue;
      }
      if (next.length >= MAX_FILES) {
        setNotice(`You can attach up to ${MAX_FILES} files per message.`);
        break;
      }
      next.push({ key: uid(), file: f, kind, thumb: kind === "image" ? await makeThumb(f) : undefined });
    }
    setFiles(next);
  }

  async function send(override?: string) {
    const t = (override ?? text).trim();
    if (busy || (!t && files.length === 0)) return;
    setNotice("");
    setBusy(true);

    const userMsg: UiMsg = { id: uid(), role: "user", text: t, attachments: files.length ? files.map((p) => ({ name: p.file.name, kind: p.kind, thumb: p.thumb })) : undefined };
    const sentFiles = files;
    const history = messages
      .filter((m) => !m.error)
      .slice(-20)
      .map((m) => ({ role: m.role, text: (m.text || (m.attachments?.length ? "(attached files)" : "(design)")).slice(0, 4000) }));
    const base = baseMsg?.doc;
    const withUser = [...messages, userMsg];
    setMessages(withUser);
    setText("");
    setFiles([]);

    try {
      const form = new FormData();
      form.set("payload", JSON.stringify({ history, text: t, doc: base }));
      sentFiles.forEach((p) => form.append("files", p.file));
      const res = await fetch("/api/ai/chat", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { reply?: string; doc?: SignatureDoc | null; message?: string } | null;
      if (!res.ok || !data?.reply) {
        setMessages([...withUser, { id: uid(), role: "assistant", text: data?.message ?? "Something went wrong. Please try again.", error: true }]);
        void persist(withUser);
        return;
      }
      const reply: UiMsg = { id: uid(), role: "assistant", text: data.reply, doc: data.doc ?? undefined };
      const all = [...withUser, reply];
      setMessages(all);
      setBaseId(null); // a new design becomes the one you are refining
      void persist(all);
    } catch {
      setMessages([...withUser, { id: uid(), role: "assistant", text: "Could not reach the server. Check your connection and try again.", error: true }]);
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  /** The simple form is where a design from the chat is finished: its fields (photo, name, contact lines, socials) follow the design. */
  function openInEditor(original: SignatureDoc) {
    const doc = ensureIdentity(original); // older chat designs may have the name as plain text, which the form cannot fill
    if (getPreset(doc.template_id)) {
      clearDetails(); // a new signature starts clean: nothing left over from another one in this tab
      saveCustom(doc);
      router.push(`/create?t=${encodeURIComponent(doc.template_id)}`);
      return;
    }
    const storage = getStorage();
    if (!storage || !saveDraft(storage, doc)) return setNotice("Your browser is blocking local storage, so the design could not be opened in the editor. Allow site data and try again.");
    router.push("/editor?from=ai");
  }

  /** Keeps a design in "My templates" so it can be picked again later from the template list. */
  async function saveTemplate(m: UiMsg) {
    if (!m.doc || tplState[m.id]) return;
    setNotice("");
    setTplState((cur) => ({ ...cur, [m.id]: "saving" }));
    const askedFor = messages.find((x) => x.role === "user" && x.text.trim())?.text.trim().replace(/\s+/g, " ") ?? "";
    const name = (askedFor || "AI design").slice(0, 60);
    try {
      const res = await fetch("/api/templates/mine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, doc: m.doc, source: "ai-chat" }) });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setNotice(data?.message ?? "Could not save the template. Please try again.");
        return setTplState((cur) => withoutKey(cur, m.id));
      }
      setTplState((cur) => ({ ...cur, [m.id]: "saved" }));
    } catch {
      setNotice("Could not reach the server. Check your connection and try again.");
      setTplState((cur) => withoutKey(cur, m.id));
    }
  }

  function newChat() {
    chatIdRef.current = null;
    setChatId(null);
    setMessages([]);
    setFiles([]);
    setText("");
    setBaseId(null);
    setNotice("");
    setSaveState("idle");
    setHistoryOpen(false);
    box.current?.focus();
  }

  async function openChat(id: string) {
    if (busy) return;
    setHistoryOpen(false);
    try {
      const res = await fetch(`/api/ai/chats/${id}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { id: string; messages: StoredMessage[]; message?: string } | null;
      if (!res.ok || !data) return setNotice(data?.message ?? "Could not open that chat.");
      chatIdRef.current = data.id;
      setChatId(data.id);
      setMessages(data.messages);
      setBaseId(null);
      setFiles([]);
      setNotice("");
      setSaveState("saved");
    } catch {
      setNotice("Could not open that chat. Check your connection.");
    }
  }

  async function removeChat(id: string) {
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/ai/chats/${id}`, { method: "DELETE" });
      if (!res.ok) return setNotice("Could not delete that chat.");
      if (chatIdRef.current === id) newChat();
      void loadList();
    } catch {
      setNotice("Could not delete that chat.");
    }
  }

  const canSend = !busy && (text.trim().length > 0 || files.length > 0);
  const empty = messages.length === 0;

  return (
    <div className="flex w-full gap-8">
      {/* History */}
      <aside className={cn("w-full shrink-0 lg:block lg:w-64", historyOpen ? "block" : "hidden")} aria-label="Chat history">
        <div className="lg:sticky lg:top-2">
          <button type="button" onClick={newChat} className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:bg-secondary">
            <PenNewSquareIcon size={17} /> New chat
          </button>
          <p className="mb-1 mt-4 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your chats</p>
          {listState === "loading" && <p className="px-1 text-sm text-muted-foreground">Loading…</p>}
          {listState === "off" && <p className="px-1 text-sm text-muted-foreground">Chat history is unavailable right now, so this chat will not be saved.</p>}
          {listState === "ready" && chats.length === 0 && <p className="px-1 text-sm text-muted-foreground">Your saved chats will appear here.</p>}
          <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
            {chats.map((c) => (
              <li key={c.id} className={cn("group flex items-center rounded-lg", c.id === chatId ? "bg-secondary" : "hover:bg-secondary/60")}>
                <button type="button" onClick={() => void openChat(c.id)} className="min-w-0 flex-1 cursor-pointer truncate px-3 py-2 text-left text-sm" title={c.title} aria-current={c.id === chatId ? "true" : undefined}>
                  {c.title}
                </button>
                <button type="button" onClick={() => void removeChat(c.id)} aria-label={`Delete chat: ${c.title}`} className="mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100">
                  <TrashBinMinimalisticIcon size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Conversation */}
      <section
        className={cn("relative flex min-h-[70vh] min-w-0 flex-1 flex-col", historyOpen && "hidden lg:flex")}
        onDragOver={(e) => {
          if (busy || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        <div className="mb-2 flex items-center justify-between lg:hidden">
          <button type="button" onClick={() => setHistoryOpen(true)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm">
            <HistoryIcon size={16} /> History
          </button>
        </div>

        <div className="flex-1 pb-4" aria-live="polite">
          {empty && (
            <div className="mx-auto max-w-2xl pt-6 text-center md:pt-14">
              <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand">
                <StarsMinimalisticIcon size={26} />
              </span>
              <h1 className="text-3xl leading-tight tracking-tight sm:text-4xl">
                What should your <em className="text-brand">signature</em> look like?
              </h1>
              <p className="mx-auto mt-3 max-w-lg text-muted-foreground">Describe it, or attach a screenshot, logo or document. I will design it here, and you can keep asking for changes.</p>
              <div className="mt-6 flex flex-col items-stretch gap-2 sm:items-center">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((m) => {
              const isBase = !!m.doc && m.id === baseMsg?.id;
              return (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("min-w-0 space-y-2", m.role === "user" ? "max-w-[85%]" : "w-full")}>
                    {m.attachments && m.attachments.length > 0 && (
                      <div className={cn("flex flex-wrap gap-2", m.role === "user" && "justify-end")}>
                        {m.attachments.map((a, i) =>
                          a.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={a.thumb} alt={a.name} title={a.name} className="max-h-40 rounded-xl border border-border" />
                          ) : (
                            <span key={i} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs">
                              <FileTextIcon size={15} /> <span className="max-w-48 truncate">{a.name}</span>
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    {m.text && (
                      <div className={cn("whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed", m.role === "user" ? "bg-brand text-primary-foreground" : m.error ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" : "px-1 text-foreground")} role={m.error ? "alert" : undefined}>
                        {m.text}
                      </div>
                    )}
                    {m.doc && (
                      <div className={cn("rounded-2xl border bg-card p-3", isBase ? "border-brand" : "border-border")}>
                        <DesignPreview doc={m.doc} />
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => openInEditor(m.doc!)} className="inline-flex h-9 cursor-pointer items-center rounded-full bg-brand px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
                            Use and edit
                          </button>
                          <button type="button" disabled={!!tplState[m.id]} onClick={() => void saveTemplate(m)} className="inline-flex h-9 cursor-pointer items-center rounded-full border border-border px-4 text-sm transition-colors hover:bg-secondary disabled:cursor-default disabled:opacity-70">
                            {tplState[m.id] === "saved" ? "Saved to My templates" : tplState[m.id] === "saving" ? "Saving…" : "Save as template"}
                          </button>
                          {isBase ? (
                            <span className="inline-flex items-center gap-1 text-xs text-brand"><CheckCircleIcon size={15} /> Changes you ask for apply to this one</span>
                          ) : (
                            <button type="button" onClick={() => setBaseId(m.id)} className="inline-flex h-9 cursor-pointer items-center rounded-full border border-border px-4 text-sm transition-colors hover:bg-secondary">
                              Change this one
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {busy && (
              <div className="flex items-center gap-1.5 px-1 py-2 text-muted-foreground" role="status">
                <span className="ai-dot" /><span className="ai-dot [animation-delay:150ms]" /><span className="ai-dot [animation-delay:300ms]" />
                <span className="sr-only">Designing your signature</span>
              </div>
            )}
            <div ref={end} />
          </div>
        </div>

        {/* Composer */}
        <div className="sticky bottom-20 z-10 mx-auto w-full max-w-3xl bg-background/90 pb-2 backdrop-blur md:bottom-0">
          {notice && <p role="alert" className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{notice}</p>}
          <div className={cn("rounded-3xl border bg-card p-2 shadow-sm transition-colors focus-within:border-foreground", dragging ? "border-dashed border-brand bg-secondary" : "border-border")}>
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2 px-2 pb-2 pt-1">
                {files.map((p) => (
                  <li key={p.key} className="relative">
                    {p.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumb} alt={p.file.name} className="size-14 rounded-xl border border-border object-cover" />
                    ) : (
                      <span className="flex h-14 max-w-44 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs"><FileTextIcon size={16} /> <span className="truncate">{p.file.name}</span></span>
                    )}
                    <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x.key !== p.key))} aria-label={`Remove ${p.file.name}`} className="absolute -right-1.5 -top-1.5 grid size-5 cursor-pointer place-items-center rounded-full bg-foreground text-background">
                      <CloseCircleIcon size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {baseMsg && !empty && <p className="px-3 pb-1 text-xs text-muted-foreground">Asking for changes to the highlighted design</p>}
            <div className="flex items-end gap-1">
              <input ref={fileInput} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Attach files" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
              <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} aria-label="Attach images or documents" title="Attach images, PDF or text files" className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50">
                <PaperclipIcon size={20} />
              </button>
              <textarea
                ref={box}
                value={text}
                rows={1}
                maxLength={2000}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                onPaste={(e) => {
                  const pasted = Array.from(e.clipboardData.files);
                  if (!pasted.length) return;
                  e.preventDefault();
                  void addFiles(pasted);
                }}
                placeholder={baseMsg ? "Ask for a change, like “make the accent navy”…" : "Describe your signature, or attach an image or document…"}
                aria-label="Message"
                className="max-h-44 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-snug outline-none! placeholder:text-muted-foreground/70"
              />
              <button type="button" onClick={() => void send()} disabled={!canSend} aria-label="Send" className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40">
                <ArrowUpIcon size={19} />
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            Enter to send · Shift+Enter for a new line · drop or paste files
            {saveState === "saved" && " · Saved to your history"}
            {saveState === "failed" && " · Could not save this chat"}
          </p>
        </div>
      </section>
    </div>
  );
}
