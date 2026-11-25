import { z } from "zod";
import { SignatureDocSchema } from "@/lib/schema/document";

const note = (max: number, what: string) => z.string().trim().min(1, `Write ${what}.`).max(max, `Keep it under ${max} characters.`);

export const CreateBody = z.object({
  signatureId: z.string().uuid("Choose a saved signature."),
  note: note(1000, "a note for the designer"),
  origin: z.enum(["ai", "manual"]),
});

export const DeliverBody = z.object({
  doc: SignatureDocSchema,
  changeNote: note(1000, "a short change note"),
});

export const CommentBody = z.object({ body: note(2000, "a comment") });

export const AcceptBody = z
  .object({
    mode: z.enum(["new", "replace"]),
    name: z.string().trim().max(80, "Keep the name under 80 characters.").optional(),
    confirmReplace: z.boolean().optional(),
  })
  .refine((b) => b.mode !== "replace" || b.confirmReplace === true, { message: "Confirm that you want to replace the original signature.", path: ["confirmReplace"] });

export const DeclineBody = z.object({
  reason: note(1000, "a reason"),
  reopen: z.boolean(),
});

export const IdParam = z.string().uuid("Invalid request id.");
