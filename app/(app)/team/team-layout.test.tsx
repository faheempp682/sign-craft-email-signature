// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "admin" as string | null, flags: {} as Record<string, boolean | null>, path: "/team" }));

vi.mock("@/lib/authz/guard", () => ({
  currentRole: async () => state.role,
  featureEnabled: async (_c: unknown, f: string) => state.flags[f] ?? false,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));

import TeamLayout from "./layout";

const renderLayout = async () => render(await TeamLayout({ children: <p>page body</p> }));
const labels = () => screen.queryAllByRole("link").map((a) => a.textContent);

beforeEach(() => {
  state.role = "admin";
  state.flags = { team_deploy: true, directory_sync: true, crm_sync: false, health_monitor: true };
  state.path = "/team";
});
afterEach(cleanup);

describe("team section bar", () => {
  it("shows every section the admin's features allow, and always a way to their own signature", async () => {
    await renderLayout();
    expect(labels()).toEqual(["People", "Deploy", "Directory and CRM sync", "Signature health", "My signature"]);
    expect(screen.getByText("page body")).toBeTruthy();
  });

  it("leaves out sections whose feature is off", async () => {
    state.flags = { team_deploy: true, directory_sync: false, crm_sync: false, health_monitor: false };
    await renderLayout();
    expect(labels()).toEqual(["People", "Deploy", "My signature"]);
  });

  it("the sync section appears for either of its two features", async () => {
    state.flags = { team_deploy: true, directory_sync: false, crm_sync: true, health_monitor: false };
    await renderLayout();
    expect(labels()).toContain("Directory and CRM sync");
  });

  it("shows nothing but the page for members, designers and signed-out visitors (no navigation to hidden areas)", async () => {
    for (const role of ["member", "designer", null]) {
      cleanup();
      state.role = role;
      await renderLayout();
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.getByText("page body")).toBeTruthy();
    }
  });

  it("marks only the current section, and /team does not light up on its sub-pages", async () => {
    state.path = "/team/deploy";
    await renderLayout();
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent);
    expect(current).toEqual(["Deploy"]);
  });
});
