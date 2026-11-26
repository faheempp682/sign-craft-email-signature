import { describe, expect, it } from "vitest";
import { buildFullMenu as buildMenu, buildMenu as buildVisibleMenu, currentLink, isActive } from "./menu";

const labels = (groups: ReturnType<typeof buildMenu>, group: string) => groups.find((g) => g.label === group)?.links.map((l) => l.label);
const allOn = { team_deploy: true, directory_sync: true, crm_sync: false, health_monitor: true, agency_mode: true, digital_card: true } as const;

describe("buildMenu", () => {
  it("a platform admin sees every section their features allow", () => {
    const m = buildMenu({ role: "admin", platform: true, flags: allOn });
    expect(labels(m, "Team")).toEqual(["People", "Deploy", "Directory and CRM sync", "Signature health", "Roles and invites", "My signature"]);
    expect(labels(m, "Admin")).toEqual(["Features", "AI limits", "Disclaimers", "Plans", "Agency"]);
    expect(labels(m, "Grow")).toEqual(["Digital card", "Polish", "Campaigns", "Analytics"]);
  });

  it("an admin of another organization never sees platform settings", () => {
    const m = buildMenu({ role: "admin", platform: false, flags: allOn });
    expect(labels(m, "Admin")).toEqual(["Disclaimers", "Plans", "Agency"]);
    expect(labels(m, "Team")).not.toContain("Roles and invites");
  });

  it("leaves out sections whose feature is off", () => {
    const m = buildMenu({ role: "admin", platform: false, flags: { team_deploy: true } });
    expect(labels(m, "Team")).toEqual(["People", "Deploy", "My signature"]);
    expect(labels(m, "Admin")).toEqual(["Disclaimers", "Plans"]);
  });

  it("the sync link appears for either of its two features", () => {
    const m = buildMenu({ role: "admin", platform: false, flags: { crm_sync: true } });
    expect(labels(m, "Team")).toContain("Directory and CRM sync");
  });

  it("members get only their own signature and no admin area", () => {
    const m = buildMenu({ role: "member", platform: false, flags: allOn });
    expect(labels(m, "Team")).toEqual(["My signature"]);
    expect(m.find((g) => g.label === "Admin")).toBeUndefined();
    expect(labels(m, "Grow")).toEqual(["Digital card"]);
  });

  it("designers get Polish, signed-out visitors nothing extra", () => {
    expect(labels(buildMenu({ role: "designer", platform: false, flags: {} }), "Grow")).toEqual(["Polish"]);
    expect(buildMenu({ role: null, platform: false, flags: {} }).find((g) => g.label === "Grow")).toBeUndefined();
  });

  it("carries the attention count on the health link", () => {
    const m = buildMenu({ role: "admin", platform: false, flags: { health_monitor: true }, attention: 4 });
    expect(m.find((g) => g.label === "Team")!.links.find((l) => l.icon === "health")!.badge).toBe(4);
  });
});

describe("active link", () => {
  it("/team does not light up on its sub-pages", () => {
    expect(isActive("/team", "/team")).toBe(true);
    expect(isActive("/team/deploy", "/team")).toBe(false);
    expect(isActive("/team/deploy", "/team/deploy")).toBe(true);
  });

  it("finds the current page's group and link", () => {
    const m = buildMenu({ role: "admin", platform: true, flags: allOn });
    expect(currentLink(m, "/admin/limits")).toMatchObject({ group: "Admin", link: { label: "AI limits" } });
    expect(currentLink(m, "/nowhere")).toBeNull();
  });
});

describe("temporarily hidden menus", () => {
  it("shows only Create, plus Roles and invites under Team", () => {
    const groups = buildVisibleMenu({ role: "admin", platform: true, flags: { team_deploy: true, directory_sync: true, health_monitor: true, digital_card: true, agency_mode: true } });
    expect(groups.map((g) => g.label)).toEqual(["Create", "Team"]);
    expect(groups[1].links.map((l) => l.href)).toEqual(["/admin/users"]);
  });
});
