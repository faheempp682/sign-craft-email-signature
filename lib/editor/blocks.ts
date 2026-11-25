import type { Block } from "@/lib/schema/document";

export const BLOCK_TYPES = ["identity", "contact", "avatar", "social", "banner", "divider", "disclaimer"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABEL: Record<BlockType, string> = {
  identity: "Name & title",
  contact: "Contact details",
  avatar: "Photo / logo",
  social: "Social links",
  banner: "Banner",
  divider: "Divider",
  disclaimer: "Disclaimer",
};

export function createBlock(type: BlockType): Block {
  switch (type) {
    case "identity":
      return { type, name: "Your Name", title: "Your title" };
    case "contact":
      return { type };
    case "avatar":
      return { type, src: "https://placehold.co/160x160.png", alt: "", shape: "circle", size: 80 };
    case "social":
      return { type, links: [{ network: "linkedin", url: "https://linkedin.com/in/" }] };
    case "banner":
      return { type, src: "https://placehold.co/400x100.png", alt: "", width: 400, height: 100 };
    case "divider":
      return { type };
    case "disclaimer":
      return { type, text: "" };
  }
}

export type FieldSpec = {
  key: string;
  label: string;
  kind: "text" | "textarea" | "number" | "select" | "toggle";
  options?: readonly string[];
  hint?: string;
  /** Shows an "Upload image" button that stores the file on the CDN and fills this field with its URL. */
  upload?: boolean;
};

export const FIELDS: Record<Exclude<BlockType, "social" | "divider">, FieldSpec[]> = {
  identity: [
    { key: "name", label: "Name", kind: "text" },
    { key: "title", label: "Job title", kind: "text" },
    { key: "company", label: "Company", kind: "text" },
  ],
  contact: [
    { key: "phone", label: "Phone", kind: "text" },
    { key: "email", label: "Email", kind: "text" },
    { key: "website", label: "Website", kind: "text" },
    { key: "address", label: "Address", kind: "text" },
  ],
  avatar: [
    { key: "src", label: "Image URL", kind: "text", upload: true, hint: "Public https PNG/JPG/GIF. Upload one, or paste a URL." },
    { key: "alt", label: "Alt text", kind: "text" },
    { key: "shape", label: "Shape", kind: "select", options: ["circle", "rounded", "square", "arch"] },
    { key: "size", label: "Size (px)", kind: "number" },
  ],
  banner: [
    { key: "src", label: "Image URL", kind: "text", upload: true, hint: "Public https PNG/JPG/GIF. Upload one, or paste a URL." },
    { key: "alt", label: "Alt text", kind: "text" },
    { key: "href", label: "Link (optional)", kind: "text" },
    { key: "width", label: "Width (px)", kind: "number" },
    { key: "height", label: "Height (px)", kind: "number" },
    { key: "track", label: "Track clicks on this banner", kind: "toggle", hint: "Counts clicks in Admin > Analytics. Needs a saved signature and click tracking set up by an admin." },
  ],
  disclaimer: [{ key: "text", label: "Text", kind: "textarea" }],
};

/** Blank text inputs become `undefined` so optional schema fields stay valid. */
export function cleanValue(kind: FieldSpec["kind"], raw: string): string | number | boolean | undefined {
  if (kind === "toggle") return raw === "true" ? true : undefined;
  if (kind === "number") return raw === "" ? undefined : Number(raw);
  return raw === "" ? undefined : raw;
}
