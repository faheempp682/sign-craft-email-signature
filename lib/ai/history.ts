import { z } from "zod";
import { SignatureDocSchema } from "@/lib/schema/document";

/** What is stored for each chat message. Attached files are kept only as a name and, for images, a small thumbnail. */
export const StoredMessageSchema = z.object({
  id: z.string().min(1).max(40),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(4000),
  doc: SignatureDocSchema.optional(),
  attachments: z
    .array(z.object({ name: z.string().max(200), kind: z.enum(["image", "pdf", "text"]), thumb: z.string().max(80_000).startsWith("data:image/").optional() }))
    .max(4)
    .optional(),
});
export type StoredMessage = z.infer<typeof StoredMessageSchema>;

export const SaveChatSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  messages: z.array(StoredMessageSchema).max(200),
});

export const MAX_CHAT_BYTES = 3 * 1024 * 1024;

export const chatTitle = (messages: { role: string; text: string }[]) => {
  const first = messages.find((m) => m.role === "user" && m.text.trim())?.text.trim().replace(/\s+/g, " ") ?? "New chat";
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
};
