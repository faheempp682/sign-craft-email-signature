// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/campaigns" }));

import { AdminTabs } from "./admin-tabs";

afterEach(cleanup);
const labels = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("admin tabs", () => {
  it("platform admins see everything", () => {
    render(<AdminTabs platform />);
    expect(labels()).toEqual(["Features", "AI limits", "Campaigns", "Analytics", "Disclaimers", "Plans", "People"]);
  });

  it("an admin of another organization sees only the organization-level screens, never the platform settings", () => {
    render(<AdminTabs platform={false} />);
    expect(labels()).toEqual(["Campaigns", "Analytics", "Disclaimers", "Plans"]);
    for (const hidden of ["Features", "AI limits", "People"]) expect(screen.queryByRole("link", { name: hidden })).toBeNull();
  });

  it("defaults to showing everything, so existing uses are unchanged", () => {
    render(<AdminTabs />);
    expect(labels()).toContain("Features");
  });

  it("marks the current screen", () => {
    render(<AdminTabs platform={false} />);
    expect(screen.getByRole("link", { name: "Campaigns" }).getAttribute("aria-current")).toBe("page");
  });
});
