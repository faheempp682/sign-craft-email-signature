// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/team/health" }));
vi.mock("@/app/login/actions", () => ({ signOut: async () => {} }));

import { buildMenu } from "@/lib/nav/menu";
import { BottomNav, Footer, Sidebar, Topbar, navLabel } from "./nav";

const adminMenu = (attention = 0) => buildMenu({ role: "admin", platform: true, flags: { team_deploy: true, health_monitor: true }, attention });
afterEach(cleanup);

describe("navLabel", () => {
  it("adds the count for screen readers only when there is one", () => {
    expect(navLabel("Health")).toBe("Health");
    expect(navLabel("Health", 0)).toBe("Health");
    expect(navLabel("Health", 3)).toBe("Health, 3 need attention");
  });
});

describe("sidebar", () => {
  it("groups the links and marks the current page", () => {
    render(<Sidebar email="a@b.c" role="admin" groups={adminMenu()} />);
    for (const g of ["Create", "Team", "Admin"]) expect(screen.getAllByText(g, { selector: "p" }).length).toBe(1);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.getAttribute("aria-label"));
    expect(current).toEqual(["Signature health"]);
  });

  it("shows the attention count, announced, and caps a large one", () => {
    render(<Sidebar email="a@b.c" role="admin" groups={adminMenu(3)} />);
    expect(screen.getByRole("link", { name: "Signature health, 3 need attention" }).textContent).toBe("Signature health3");
    cleanup();
    render(<Sidebar email="a@b.c" role="admin" groups={adminMenu(12)} />);
    expect(screen.getByRole("link", { name: "Signature health, 12 need attention" }).textContent).toBe("Signature health9+");
  });

  it("shows no count when nothing needs attention", () => {
    render(<Sidebar email="a@b.c" role="admin" groups={adminMenu(0)} />);
    expect(screen.getByRole("link", { name: "Signature health" }).textContent).toBe("Signature health");
  });

  it("members see no admin area", () => {
    render(<Sidebar email="a@b.c" role="member" groups={buildMenu({ role: "member", platform: false, flags: {} })} />);
    expect(screen.queryByRole("link", { name: "Plans" })).toBeNull();
    expect(screen.getByRole("link", { name: "My signature" })).toBeTruthy();
  });
});

describe("log out", () => {
  it("is a visible button in the sidebar and in the account menu", () => {
    render(<Sidebar email="a@b.c" role="admin" groups={adminMenu()} />);
    expect(screen.getByRole("button", { name: "Log out a@b.c" })).toBeTruthy();
    cleanup();
    render(<Topbar email="a@b.c" groups={adminMenu()} />);
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
  });

  it("is hidden when nobody is signed in", () => {
    render(<Sidebar groups={buildMenu({ role: null, platform: false, flags: {} })} />);
    expect(screen.queryByRole("button", { name: /Log out/ })).toBeNull();
  });
});

describe("top bar and phone menu", () => {
  it("shows where you are, and the extra links with their count in the account menu", () => {
    render(<Topbar email="a@b.c" groups={adminMenu(120)} />);
    expect(screen.getByText("Signature health", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Signature health, 120 need attention" }).textContent).toContain("99+");
  });

  it("the phone bar has the five main tabs", () => {
    render(<BottomNav />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Create", "Signatures", "Editor", "Exporter", "Guides"]);
  });
});

describe("footer", () => {
  it("links to the guides and the legal pages", () => {
    render(<Footer />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Install guides", "Terms", "Privacy"]);
  });
});

describe("signed out", () => {
  it("offers Sign in in the sidebar and the top bar, never Log out", () => {
    const groups = buildMenu({ role: null, platform: false, flags: {} });
    render(<Sidebar groups={groups} />);
    expect(screen.getByRole("link", { name: /Sign in/ }).getAttribute("href")).toBe("/login?next=%2Fteam%2Fhealth");
    cleanup();
    render(<Topbar groups={groups} />);
    expect(screen.getByRole("link", { name: /Sign in/ })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
