import type { Feature, Role } from "@/lib/authz/roles";
import { atLeast } from "@/lib/authz/roles";

export type IconKey =
  | "create" | "signatures" | "editor" | "exporter" | "guides"
  | "people" | "deploy" | "sync" | "health" | "mine" | "invite"
  | "card" | "polish" | "campaigns" | "analytics"
  | "features" | "limits" | "disclaimers" | "plans" | "agency";

export type NavLink = { href: string; label: string; icon: IconKey; /** Count that needs attention; 0 or absent shows nothing. */ badge?: number };
export type NavGroup = { label: string; links: NavLink[] };

export type MenuInput = {
  role: Role | null;
  /** Admin of the default organization: the only ones who may change installation-wide settings. */
  platform: boolean;
  flags: Partial<Record<Feature, boolean | null>>;
  /** Open signature-health findings. */
  attention?: number;
};

/**
 * Temporary: while true the sidebar shows only Create, plus "Roles and invites" under Team ("My signature" is hidden until the directory link is sorted out).
 * The Grow and Admin groups, the other Team links and the Exporter are hidden, not removed. Set to false to bring them all back.
 */
export const HIDE_UNFINISHED_MENUS = true;
/** Pages whose menu link is hidden while HIDE_UNFINISHED_MENUS is on (the page itself still works). */
const HIDDEN_WHILE_HIDING = new Set(["/preview"]);

/** Everyone gets these. Mirrors the phone tabs. */
export const MAIN_LINKS: NavLink[] = [
  { href: "/create", label: "Create", icon: "create" },
  { href: "/signatures", label: "Signatures", icon: "signatures" },
  { href: "/preview", label: "Exporter", icon: "exporter" },
  { href: "/guides", label: "Guides", icon: "guides" },
].filter((l) => !HIDE_UNFINISHED_MENUS || !HIDDEN_WHILE_HIDING.has(l.href)) as NavLink[];

const ALWAYS_SHOWN_WHILE_HIDING = new Set(["/admin/users"]);

/**
 * The one sidebar menu, worked out on the server from the role and the feature flags. Navigation only: every page and
 * API still checks the role and the feature itself.
 */
export function buildMenu(input: MenuInput): NavGroup[] {
  const groups = buildFullMenu(input);
  if (!HIDE_UNFINISHED_MENUS) return groups;
  return groups
    .filter((g) => g.label === "Create" || g.label === "Team")
    .map((g) => (g.label === "Team" ? { ...g, links: g.links.filter((l) => ALWAYS_SHOWN_WHILE_HIDING.has(l.href)) } : g))
    .filter((g) => g.links.length);
}

export function buildFullMenu({ role, platform, flags, attention = 0 }: MenuInput): NavGroup[] {
  const on = (f: Feature) => flags[f] === true;
  const admin = role === "admin";
  const groups: NavGroup[] = [{ label: "Create", links: MAIN_LINKS }];

  const team: NavLink[] = [];
  if (admin && on("team_deploy")) team.push({ href: "/team", label: "People", icon: "people" }, { href: "/team/deploy", label: "Deploy", icon: "deploy" });
  if (admin && (on("directory_sync") || on("crm_sync"))) team.push({ href: "/team/sync", label: "Directory and CRM sync", icon: "sync" });
  if (admin && on("health_monitor")) team.push({ href: "/team/health", label: "Signature health", icon: "health", badge: attention });
  if (admin && platform) team.push({ href: "/admin/users", label: "Roles and invites", icon: "invite" });
  team.push({ href: "/team/mine", label: "My signature", icon: "mine" });
  groups.push({ label: "Team", links: team });

  const grow: NavLink[] = [];
  if (on("digital_card")) grow.push({ href: "/cards", label: "Digital card", icon: "card" });
  if ((role && atLeast(role, "designer")) || on("designer_polish")) grow.push({ href: "/polish", label: "Polish", icon: "polish" });
  if (admin) grow.push({ href: "/admin/campaigns", label: "Campaigns", icon: "campaigns" }, { href: "/admin/analytics", label: "Analytics", icon: "analytics" });
  if (grow.length) groups.push({ label: "Grow", links: grow });

  if (admin) {
    const settings: NavLink[] = [];
    if (platform) settings.push({ href: "/admin/features", label: "Features", icon: "features" }, { href: "/admin/limits", label: "AI limits", icon: "limits" });
    settings.push({ href: "/admin/disclaimers", label: "Disclaimers", icon: "disclaimers" }, { href: "/admin/plans", label: "Plans", icon: "plans" });
    if (on("agency_mode")) settings.push({ href: "/agency", label: "Agency", icon: "agency" });
    groups.push({ label: "Admin", links: settings });
  }
  return groups;
}

/** "/team" matches only itself, or it would light up on every sub-page. Everything else matches its sub-paths. */
export const isActive = (path: string, href: string) => (href === "/team" ? path === "/team" : path === href || path.startsWith(`${href}/`));

/** The menu entry for the current page, if any. The longest matching link wins. */
export function currentLink(groups: NavGroup[], path: string): { group: string; link: NavLink } | null {
  let best: { group: string; link: NavLink } | null = null;
  for (const g of groups) for (const link of g.links) {
    if (isActive(path, link.href) && (!best || link.href.length > best.link.href.length)) best = { group: g.label, link };
  }
  return best;
}
