import { SignatureDocSchema, type SignatureDoc, type TemplateId } from "@/lib/schema/document";
import classic from "@/templates/classic.json";
import modern from "@/templates/modern-split.json";
import minimal from "@/templates/minimal.json";
import editorial_arch from "@/templates/editorial-arch.json";
import bold_letter from "@/templates/bold-letter.json";
import circle_accent from "@/templates/circle-accent.json";
import green_sidebar from "@/templates/green-sidebar.json";
import maroon_frame from "@/templates/maroon-frame.json";
import spectrum from "@/templates/spectrum.json";
import geometric from "@/templates/geometric.json";
import noir_agent from "@/templates/noir-agent.json";
import orange_logo from "@/templates/orange-logo.json";
import ticket from "@/templates/ticket.json";
import listing_banner from "@/templates/listing-banner.json";
import soft_card from "@/templates/soft-card.json";
import consultant_blue from "@/templates/consultant-blue.json";
import executive_navy from "@/templates/executive-navy.json";
import minimal_line from "@/templates/minimal-line.json";
import dark_luxe from "@/templates/dark-luxe.json";
import pastel_pill from "@/templates/pastel-pill.json";
import split_color from "@/templates/split-color.json";
import talent_card from "@/templates/talent-card.json";
import mountain_logo from "@/templates/mountain-logo.json";
import script_contact from "@/templates/script-contact.json";
import ringed_sales from "@/templates/ringed-sales.json";
import studio from "@/templates/studio.json";

export const TEMPLATE_META: { id: TemplateId; name: string; blurb: string; doc: SignatureDoc }[] = [
  { id: "classic", name: "Classic", blurb: "Stacked, centered on clarity. Safe everywhere.", doc: SignatureDocSchema.parse(classic) },
  { id: "modern-split", name: "Modern split", blurb: "Avatar beside details with an accent rule.", doc: SignatureDocSchema.parse(modern) },
  { id: "minimal", name: "Minimal", blurb: "Text only, serif, no images. Lightest weight.", doc: SignatureDocSchema.parse(minimal) },
  { id: "editorial-arch", name: "Editorial arch", blurb: "Beige card, arch portrait, big serif name, social strip.", doc: SignatureDocSchema.parse(editorial_arch) },
  { id: "bold-letter", name: "Bold letter", blurb: "Giant initial block, lowercase greeting, pill title.", doc: SignatureDocSchema.parse(bold_letter) },
  { id: "circle-accent", name: "Circle accent", blurb: "Greeting, round portrait with a bright dot, labelled columns.", doc: SignatureDocSchema.parse(circle_accent) },
  { id: "green-sidebar", name: "Green sidebar", blurb: "Portrait with accent edge, icon rows, socials underneath.", doc: SignatureDocSchema.parse(green_sidebar) },
  { id: "maroon-frame", name: "Maroon frame", blurb: "Dark editorial card, framed photo, small-caps details.", doc: SignatureDocSchema.parse(maroon_frame) },
  { id: "spectrum", name: "Spectrum", blurb: "Gradient edge, uppercase name with a bold accent surname.", doc: SignatureDocSchema.parse(spectrum) },
  { id: "geometric", name: "Geometric", blurb: "Tile pattern, big name, navy icon rows.", doc: SignatureDocSchema.parse(geometric) },
  { id: "noir-agent", name: "Noir agent", blurb: "High-contrast realtor card with a social footer bar.", doc: SignatureDocSchema.parse(noir_agent) },
  { id: "orange-logo", name: "Orange logo", blurb: "Compact agent line with a logo on the right.", doc: SignatureDocSchema.parse(orange_logo) },
  { id: "ticket", name: "Ticket", blurb: "Cream ticket, accent band, black barcode stub.", doc: SignatureDocSchema.parse(ticket) },
  { id: "listing-banner", name: "Listing banner", blurb: "Headshot, icon rows and a promo banner.", doc: SignatureDocSchema.parse(listing_banner) },
  { id: "soft-card", name: "Soft card", blurb: "Rounded pastel card with follow-us badges.", doc: SignatureDocSchema.parse(soft_card) },
  { id: "consultant-blue", name: "Consultant blue", blurb: "Serif name over a solid contact bar.", doc: SignatureDocSchema.parse(consultant_blue) },
  { id: "executive-navy", name: "Executive navy", blurb: "Navy side panel, gold rule, icon rows.", doc: SignatureDocSchema.parse(executive_navy) },
  { id: "minimal-line", name: "Minimal line", blurb: "Thin accent line, small portrait, inline contact.", doc: SignatureDocSchema.parse(minimal_line) },
  { id: "dark-luxe", name: "Dark luxe", blurb: "Black card, gold hairlines, serif caps name.", doc: SignatureDocSchema.parse(dark_luxe) },
  { id: "pastel-pill", name: "Pastel pill", blurb: "Soft tinted card, ringed portrait, title pill.", doc: SignatureDocSchema.parse(pastel_pill) },
  { id: "split-color", name: "Split colour", blurb: "Solid colour panel beside clean contact details.", doc: SignatureDocSchema.parse(split_color) },
  { id: "talent-card", name: "Talent card", blurb: "Full-height photo, blue title, soft social circles, Trustpilot pill and a confidentiality note.", doc: SignatureDocSchema.parse(talent_card) },
  { id: "mountain-logo", name: "Mountain logo", blurb: "Logo, name and brand-coloured socials beside a divider and labelled contact lines.", doc: SignatureDocSchema.parse(mountain_logo) },
  { id: "script-contact", name: "Script contact", blurb: "Round photo, handwritten name and icon contact lines on white.", doc: SignatureDocSchema.parse(script_contact) },
  { id: "ringed-sales", name: "Ringed sales", blurb: "Ringed portrait, labelled contacts, call button and partner badges.", doc: SignatureDocSchema.parse(ringed_sales) },
  { id: "studio", name: "Studio (composed)", blurb: "100 composed designs. Pick one from the library.", doc: SignatureDocSchema.parse(studio) },
];

export function getTemplate(id: TemplateId) {
  return TEMPLATE_META.find((t) => t.id === id)!;
}
