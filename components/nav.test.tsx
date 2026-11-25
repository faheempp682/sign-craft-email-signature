// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/create" }));
vi.mock("@/app/login/actions", () => ({ signOut: async () => {} }));

import { Panel, Rail, Topbar, navLabel, type NavExtra } from "./nav";

const team = (badge?: number): NavExtra[] => [{ href: "/team", label: "Team", icon: "team", badge }];
afterEach(cleanup);

describe("navLabel", () => {
  it("adds the count for screen readers only when there is one", () => {
    expect(navLabel("Team")).toBe("Team");
    expect(navLabel("Team", 0)).toBe("Team");
    expect(navLabel("Team", 3)).toBe("Team, 3 need attention");
  });
});

describe("attention badge", () => {
  it("shows on the desktop rail, announced with the count", () => {
    render(<Rail email="a@b.c" extras={team(3)} />);
    const link = screen.getByRole("link", { name: "Team, 3 need attention" });
    expect(link.textContent).toBe("3");
  });

  it("caps a large count so it cannot overflow the icon", () => {
    render(<Rail email="a@b.c" extras={team(12)} />);
    expect(screen.getByRole("link", { name: "Team, 12 need attention" }).textContent).toBe("9+");
  });

  it("shows nothing when nothing needs attention", () => {
    render(<Rail email="a@b.c" extras={team(0)} />);
    const link = screen.getByRole("link", { name: "Team" });
    expect(link.textContent).toBe("");
  });

  it("shows in the side panel and the phone menu too", () => {
    render(<Panel extras={team(5)} />);
    expect(screen.getByRole("link", { name: "Team, 5 need attention" }).textContent).toContain("5");
    cleanup();
    render(<Topbar email="a@b.c" extras={team(120)} />);
    expect(screen.getByRole("link", { name: "Team, 120 need attention" }).textContent).toContain("99+");
  });

  it("links without a count are unchanged", () => {
    render(<Rail email="a@b.c" extras={[{ href: "/cards", label: "Digital card", icon: "cards" }]} />);
    expect(screen.getByRole("link", { name: "Digital card" })).toBeTruthy();
  });
});
