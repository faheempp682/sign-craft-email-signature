// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/agency" }));

import { OrgSwitcher } from "@/components/org-switcher";
import { BrandMark } from "@/lib/org/brand-mark";
import { resolveBranding } from "@/lib/org/branding";
import type { ActableOrg } from "@/lib/org/active";
import { PlansAdmin } from "../admin/plans/plans-admin";
import { AgencyClients } from "./agency-clients";
import { BrandingForm } from "./branding-form";

type Sent = { url: string; method: string; body: Record<string, unknown> };
let sent: Sent[];
let status = 200;

beforeEach(() => {
  sent = [];
  status = 200;
  refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : {} });
      return new Response(JSON.stringify(status === 200 ? {} : { message: "Nope." }), { status });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const org = (id: string, name: string, viaAgency = false): ActableOrg => ({ id, name, parentId: null, planId: null, role: "admin", viaAgency });

describe("OrgSwitcher", () => {
  it("renders nothing for a person with a single organization", () => {
    const { container } = render(<OrgSwitcher initial={{ orgs: [org("a", "Only")], active: "a" }} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while nothing is loaded and for an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ active: null, orgs: [] }))));
    const { container } = render(<OrgSwitcher />);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.innerHTML).toBe("");
  });

  it("offers a labelled select and switches with one POST, then refreshes", async () => {
    render(<OrgSwitcher initial={{ orgs: [org("a", "Agency"), org("c", "Acme", true)], active: "a" }} />);
    const select = screen.getByLabelText("Organization") as HTMLSelectElement;
    expect(select.value).toBe("a");
    expect(screen.getByRole("option", { name: "Client: Acme" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "c" } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent).toEqual([{ url: "/api/agency/switch", method: "POST", body: { org_id: "c" } }]);
  });

  it("shows an error and does not refresh when the server refuses", async () => {
    status = 403;
    render(<OrgSwitcher initial={{ orgs: [org("a", "Agency"), org("c", "Acme", true)], active: "a" }} />);
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "c" } });
    expect(await screen.findByText("Could not switch organization.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("loads the list itself when none is given", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ active: "a", orgs: [org("a", "Agency"), org("c", "Acme", true)] }))));
    render(<OrgSwitcher />);
    expect(await screen.findByLabelText("Organization")).toBeTruthy();
  });
});

describe("BrandMark", () => {
  it("shows the logo with explicit width and height, the name and Powered by", () => {
    const b = resolveBranding({ brand_name: "Acme", logo_url: "https://cdn.acme.com/l.png", logo_width: 120, logo_height: 40, accent: "#0B5FFF", show_powered_by: true });
    const { container } = render(<BrandMark branding={b} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("width")).toBe("120");
    expect(img.getAttribute("height")).toBe("40");
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("Powered by SignCraft")).toBeTruthy();
  });

  it("drops an unsafe logo or a low-contrast accent instead of rendering it", () => {
    const b = resolveBranding({ brand_name: "X", logo_url: "javascript:alert(1)", logo_width: 100, logo_height: 40, accent: "#FFFF00", show_powered_by: false });
    const { container } = render(<BrandMark branding={b} />);
    expect(container.querySelector("img")).toBeNull();
    expect(b.accent).toBeNull();
    expect(screen.queryByText("Powered by SignCraft")).toBeNull();
  });

  it("with no branding it is just SignCraft", () => {
    render(<BrandMark branding={resolveBranding(null)} />);
    expect(screen.getByText("SignCraft")).toBeTruthy();
    expect(screen.queryByText("Powered by SignCraft")).toBeNull();
  });
});

describe("AgencyClients", () => {
  const clients = [{ id: "c1", name: "Acme", planId: "pro", members: 3, people: 1 }];

  it("lists clients with plan and counts, and switches into one", async () => {
    render(<AgencyClients clients={clients} activeId="a" agencyId="a" activeIsClient={false} />);
    expect(screen.getByText(/Plan: pro · 3 members · 1 person/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch into Acme" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent[0]).toEqual({ url: "/api/agency/switch", method: "POST", body: { org_id: "c1" } });
  });

  it("offers Leave client only inside a client, and goes back to the agency", async () => {
    const { rerender } = render(<AgencyClients clients={clients} activeId="a" agencyId="a" activeIsClient={false} />);
    expect(screen.queryByRole("button", { name: "Leave client" })).toBeNull();
    rerender(<AgencyClients clients={clients} activeId="c1" agencyId="a" activeIsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Leave client" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ org_id: "a" });
  });

  it("creates a client, validating the name first", async () => {
    render(<AgencyClients clients={[]} activeId="a" agencyId="a" activeIsClient={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Create client" }));
    expect(await screen.findByText("Give the client a name.")).toBeTruthy();
    expect(sent).toEqual([]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "free" } });
    fireEvent.click(screen.getByRole("button", { name: "Create client" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent[0]).toEqual({ url: "/api/agency/clients", method: "POST", body: { name: "New Co", plan_id: "free" } });
  });

  it("shows the server's message when creating fails", async () => {
    status = 403;
    render(<AgencyClients clients={[]} activeId="a" agencyId="a" activeIsClient={false} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Create client" }));
    expect(await screen.findByText("Nope.")).toBeTruthy();
  });
});

describe("BrandingForm", () => {
  const initial = resolveBranding(null);

  it("rejects an http logo and a pale accent with messages under the fields, sending nothing", async () => {
    render(<BrandingForm orgId="c1" orgName="Acme" initial={initial} />);
    fireEvent.change(screen.getByLabelText("Logo link (https)"), { target: { value: "http://x.com/a.png" } });
    fireEvent.change(screen.getByLabelText("Accent colour"), { target: { value: "#FFFF00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    expect(await screen.findByText("Enter a full https:// link to the logo.")).toBeTruthy();
    expect(screen.getByText(/at least 4.5:1 contrast on white/)).toBeTruthy();
    expect(screen.getByLabelText("Accent colour").getAttribute("aria-invalid")).toBe("true");
    expect(sent).toEqual([]);
  });

  it("sends the whole branding for the organization", async () => {
    render(<BrandingForm orgId="c1" orgName="Acme" initial={initial} />);
    fireEvent.change(screen.getByLabelText("Brand name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Logo link (https)"), { target: { value: "https://cdn.acme.com/l.png" } });
    fireEvent.change(screen.getByLabelText("Accent colour"), { target: { value: "#0B5FFF" } });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent[0]).toEqual({ url: "/api/agency/branding", method: "PUT", body: { org_id: "c1", brand_name: "Acme", logo_url: "https://cdn.acme.com/l.png", logo_width: 160, logo_height: 40, accent: "#0B5FFF", show_powered_by: true } });
  });
});

describe("PlansAdmin", () => {
  const plans = [
    { id: "free", name: "Free", description: "Few AI uses.", features: { ai_autofill: true, animated_gif: false }, limits: [{ role: "member" as const, feature: "ai_autofill" as const, perMinute: 2, perDay: 5 }] },
    { id: "pro", name: "Pro", description: "More.", features: {}, limits: [] },
  ];
  const orgs = [{ id: "o1", name: "Kimp", planId: null, client: false }];

  it("says nothing is charged, shows what a plan turns on and its limits", () => {
    render(<PlansAdmin plans={plans} orgs={orgs} />);
    expect(screen.getByText("Nothing is charged")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details for Free" }));
    expect(screen.getByText("Animated GIF signatures: off")).toBeTruthy();
    expect(screen.getByText("2 a minute, 5 a day")).toBeTruthy();
  });

  it("assigns a plan with one request; Save is disabled until something changes", async () => {
    render(<PlansAdmin plans={plans} orgs={orgs} />);
    const save = screen.getByRole("button", { name: "Save plan for Kimp" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Plan for Kimp"), { target: { value: "pro" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent[0]).toEqual({ url: "/api/plans/assign", method: "PUT", body: { org_id: "o1", plan_id: "pro" } });
  });

  it("choosing No plan sends null", async () => {
    render(<PlansAdmin plans={plans} orgs={[{ ...orgs[0], planId: "pro" }]} />);
    fireEvent.change(screen.getByLabelText("Plan for Kimp"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan for Kimp" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ org_id: "o1", plan_id: null });
  });
});
