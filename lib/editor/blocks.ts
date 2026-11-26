import { ICON_NAMES, type Block } from "@/lib/schema/document";

export const BLOCK_TYPES = ["identity", "contact", "avatar", "social", "banner", "divider", "disclaimer", "text", "button", "spacer", "icontext"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABEL: Record<Block["type"], string> = {
  row: "Row & columns",
  identity: "Name & title",
  contact: "Contact details",
  avatar: "Photo / logo",
  social: "Social links",
  banner: "Banner",
  divider: "Divider",
  disclaimer: "Disclaimer",
  text: "Text",
  button: "Button / CTA",
  spacer: "Spacing",
  icontext: "Icon + text",
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
    case "text":
      return { type, text: "Your text", variant: "body" };
    case "button":
      return { type, label: "Book a call", href: "https://example.com/" };
    case "spacer":
      return { type, height: 12 };
    case "icontext":
      return { type, icon: "phone", text: "+1 555 0100", size: 20 };
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

export const FIELDS: Record<Exclude<BlockType, "social" | "divider" | "spacer">, FieldSpec[]> = {
  identity: [
    { key: "name", label: "Name", kind: "text" },
    { key: "title", label: "Job title", kind: "text" },
    { key: "company", label: "Company", kind: "text" },
  ],
  contact: [
    { key: "phone", label: "Phone", kind: "text" },
    { key: "email", label: "Email", kind: "text" },
    { key: "website", label: "Website", kind: "text", hint: "Where the link goes, e.g. example.com or https://example.com/page" },
    { key: "websiteLabel", label: "Website link text (optional)", kind: "text", hint: "Friendly text shown instead of the address, e.g. Visit our site" },
    { key: "address", label: "Address", kind: "text" },
    { key: "addressHref", label: "Address link (optional)", kind: "text", hint: "e.g. a Google Maps link. Leave blank for plain text." },
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
  text: [
    { key: "text", label: "Text", kind: "textarea" },
    { key: "variant", label: "Style", kind: "select", options: ["body", "heading"] },
    { key: "href", label: "Link (optional)", kind: "text", hint: "Make this text clickable, e.g. https://yoursite.com/book" },
  ],
  button: [
    { key: "label", label: "Button label", kind: "text" },
    { key: "href", label: "Link", kind: "text" },
  ],
  icontext: [
    { key: "icon", label: "Icon", kind: "select", options: ICON_NAMES },
    { key: "text", label: "Text", kind: "textarea" },
    { key: "href", label: "Link (optional)", kind: "text", hint: "https://, mailto: or tel:" },
    { key: "src", label: "Your own icon (optional)", kind: "text", upload: true, hint: "Replaces the built-in icon. Square PNG works best." },
    { key: "size", label: "Icon size (px)", kind: "number" },
  ],
};

/** Blank text inputs become `undefined` so optional schema fields stay valid. */
export function cleanValue(kind: FieldSpec["kind"], raw: string): string | number | boolean | undefined {
  if (kind === "toggle") return raw === "true" ? true : undefined;
  if (kind === "number") return raw === "" ? undefined : Number(raw);
  return raw === "" ? undefined : raw;
}

/** The "Add element" palette. Phone / email / website are single-field contact blocks, so every element is one real block in the document. */
export type ElementPreset = { id: string; label: string; make: () => Block };
export const ELEMENT_PRESETS: ElementPreset[] = [
  { id: "text", label: "Text", make: () => createBlock("text") },
  { id: "heading", label: "Heading", make: () => ({ type: "text", text: "Heading", variant: "heading", layer: "Heading" }) },
  { id: "logo", label: "Logo", make: () => ({ type: "avatar", src: "https://placehold.co/160x160.png", alt: "Company logo", shape: "square", size: 64, layer: "Logo" }) },
  { id: "profile", label: "Profile image", make: () => ({ ...(createBlock("avatar") as Extract<Block, { type: "avatar" }>), layer: "Profile image" }) },
  { id: "contact", label: "Contact info", make: () => ({ type: "contact", phone: "+1 555 0100", email: "you@example.com", layer: "Contact info" }) },
  { id: "phone", label: "Phone", make: () => ({ type: "contact", phone: "+1 555 0100", layer: "Phone" }) },
  { id: "email", label: "Email", make: () => ({ type: "contact", email: "you@example.com", layer: "Email" }) },
  { id: "website", label: "Website", make: () => ({ type: "contact", website: "example.com", layer: "Website" }) },
  { id: "social", label: "Social icons", make: () => createBlock("social") },
  { id: "divider", label: "Divider", make: () => createBlock("divider") },
  { id: "banner", label: "Banner", make: () => createBlock("banner") },
  { id: "button", label: "Button / CTA", make: () => createBlock("button") },
  { id: "icontext", label: "Icon + text", make: () => ({ ...(createBlock("icontext") as Extract<Block, { type: "icontext" }>), layer: "Icon + text" }) },
  { id: "spacing", label: "Custom spacing", make: () => createBlock("spacer") },
  { id: "disclaimer", label: "Disclaimer", make: () => ({ type: "disclaimer", text: "This email is confidential.", layer: "Disclaimer" }) },
];
