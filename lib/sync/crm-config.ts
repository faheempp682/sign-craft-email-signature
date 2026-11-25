import { z } from "zod";
import { checkUrl } from "@/lib/render/safe-image";
import { validPath } from "./jsonpath";
import { CRM_TARGETS, CUSTOM_KEY, MAX_CUSTOM, type SyncSource } from "./types";

/** Where a CRM value goes: a text column of the person, or custom.<key>. Never email, status or ids. */
export const TargetSchema = z.string().refine((t) => (CRM_TARGETS as readonly string[]).includes(t) || (t.startsWith("custom.") && CUSTOM_KEY.test(t.slice(7))), "Choose a people field or custom.<name> (lower-case letters, digits, underscores).");

/** Request headers the adapter may never set (they would change what is sent where, or break the connection). */
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "content-type", "transfer-encoding", "connection", "cookie", "set-cookie", "upgrade", "te", "trailer", "proxy-authorization", "expect", "accept", "user-agent", "location"]);

/** Fixed names of the secrets in the server environment. The browser never sees or sends them. */
export const HUBSPOT_TOKEN_ENV = "HUBSPOT_ACCESS_TOKEN";
export const GENERIC_SECRET_ENV = "KIMP_CRM_SECRET";

const mappingRows = <F extends z.ZodType<string>>(from: F) =>
  z
    .array(z.object({ from, to: TargetSchema }).strict())
    .min(1, "Add at least one mapping.")
    .max(15, "At most 15 mappings.")
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.to)) ctx.addIssue({ code: "custom", message: `"${r.to}" is filled by two mappings. Each people field can have one CRM source.` });
        seen.add(r.to);
      }
      if (rows.filter((r) => r.to.startsWith("custom.")).length > MAX_CUSTOM) ctx.addIssue({ code: "custom", message: `At most ${MAX_CUSTOM} custom fields.` });
    });

export const HubspotProp = z.string().regex(/^([a-z][a-z0-9_]{0,99}|owner_name|owner_email)$/, "Use the internal property name (lower case, for example jobtitle), or owner_name / owner_email.");

export const HubspotConfig = z.object({ mapping: mappingRows(HubspotProp) }).strict();
export type HubspotConfigT = z.infer<typeof HubspotConfig>;

export const GenericConfig = z
  .object({
    base_url: z.string().trim().max(200).refine((u) => checkUrl(u) !== null && !/[?#]/.test(u), "Use an https address with no port, no credentials, no query, for example https://crm.example.com/api."),
    auth_header: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9-]{0,39}$/, "A header name such as Authorization or X-Api-Key.")
      .refine((h) => !FORBIDDEN_HEADERS.has(h.toLowerCase()), "That header cannot be set."),
    auth_prefix: z.string().max(20).regex(/^[A-Za-z0-9 _-]*$/, "Letters, digits, space, dash only. For example: Bearer ").default(""),
    path_template: z
      .string()
      .trim()
      .max(300)
      .refine((p) => p.startsWith("/") && !p.startsWith("//") && p.includes("{email}") && !/[\\\s#]|\.\.|\/\//.test(p.slice(1)), "Start with / and include {email}, for example /contacts?email={email}. No spaces, #, backslash or \"..\"."),
    mapping: mappingRows(z.string().max(200).refine(validPath, "Use a path such as $.data.phone or data.items[0].title.")),
  })
  .strict();
export type GenericConfigT = z.infer<typeof GenericConfig>;

export function parseCrmConfig(source: SyncSource, raw: unknown): { ok: true; config: HubspotConfigT | GenericConfigT } | { ok: false; message: string } {
  const r = (source === "hubspot" ? HubspotConfig : GenericConfig).safeParse(raw);
  if (r.success) return { ok: true, config: r.data };
  const i = r.error.issues[0];
  return { ok: false, message: `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}` };
}

/** Per-field policy: only known targets, only "source" or "directory". */
export const FieldPolicySchema = z.record(z.string().max(60), z.enum(["source", "directory"])).refine((o) => Object.keys(o).length <= 25, "Too many fields.");
