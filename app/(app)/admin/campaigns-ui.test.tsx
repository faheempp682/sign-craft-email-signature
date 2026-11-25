// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/admin/campaigns" }));

import { insertDisclaimer, toDisclaimerBlock } from "@/lib/disclaimers";
import type { Disclaimer } from "@/lib/disclaimers/labels";
import { summarize } from "@/lib/campaigns/stats";
import { AnalyticsView } from "./analytics/analytics-view";
import { CampaignsAdmin, phase, type CampaignRow } from "./campaigns/campaigns-admin";
import { DisclaimersAdmin } from "./disclaimers/disclaimers-admin";

type Sent = { url: string; method: string; body: Record<string, unknown> };
let sent: Sent[];
let reply: { ok: boolean; status?: number; body?: unknown };

beforeEach(() => {
  sent = [];
  reply = { ok: true, body: {} };
  refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : {} });
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.ok ? 200 : (reply.status ?? 400) });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ID = "11111111-1111-4111-8111-111111111111";
const V1 = "33333333-3333-4333-8333-333333333333";
const camp = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  id: ID,
  name: "Spring sale",
  status: "active",
  startsAt: null,
  endsAt: null,
  href: "https://acme.com/sale",
  fallbackSrc: "https://cdn.acme.com/f.png",
  fallbackAlt: "",
  variants: [{ id: V1, label: "Blue", imageUrl: "https://cdn.acme.com/a.png", altText: "", width: 400, height: 100, weight: 1 }],
  ...over,
});

describe("campaign schedule label", () => {
  const now = Date.parse("2026-06-15T12:00:00Z");
  it("says what a campaign is doing now", () => {
    expect(phase({ status: "active", startsAt: null, endsAt: null }, now).label).toBe("Running now");
    expect(phase({ status: "active", startsAt: "2026-07-01T00:00:00Z", endsAt: null }, now).label).toBe("Scheduled");
    expect(phase({ status: "active", startsAt: null, endsAt: "2026-06-01T00:00:00Z" }, now).label).toBe("Finished");
    expect(phase({ status: "paused", startsAt: null, endsAt: null }, now).label).toBe("Paused");
  });
});

describe("Campaigns screen", () => {
  it("warns when the token secret is missing", () => {
    render(<CampaignsAdmin campaigns={[]} trackingReady={false} />);
    expect(screen.getByRole("alert").textContent).toContain("CAMPAIGN_TOKEN_SECRET");
  });

  it("checks the form before sending, with errors under the fields", () => {
    render(<CampaignsAdmin campaigns={[]} trackingReady />);
    fireEvent.change(screen.getByLabelText("Where a click goes"), { target: { value: "http://acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    expect(screen.getByText("Give the campaign a name.")).toBeTruthy();
    expect(screen.getAllByText("Enter a full https:// link.").length).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("creates a campaign with an ISO schedule and refreshes", async () => {
    render(<CampaignsAdmin campaigns={[]} trackingReady />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Summer" } });
    fireEvent.change(screen.getByLabelText("Where a click goes"), { target: { value: "https://acme.com/s" } });
    fireEvent.change(screen.getByLabelText(/Usual banner image/), { target: { value: "https://cdn.acme.com/s.png" } });
    fireEvent.change(screen.getByLabelText("Starts (optional)"), { target: { value: "2026-07-01T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent[0]).toMatchObject({ url: "/api/campaigns", method: "POST", body: { name: "Summer", href: "https://acme.com/s", status: "draft", ends_at: null } });
    expect(String(sent[0].body.starts_at)).toMatch(/^2026-07-01T\d\d:\d\d:00\.000Z$/);
  });

  it("pauses a running campaign", async () => {
    render(<CampaignsAdmin campaigns={[camp()]} trackingReady />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: `/api/campaigns/${ID}`, method: "PATCH", body: { status: "paused" } });
  });

  it("shows each variant's share and saves weights", async () => {
    const two = camp({ variants: [camp().variants[0], { id: "44444444-4444-4444-8444-444444444444", label: "Red", imageUrl: "https://cdn.acme.com/b.png", altText: "", width: 400, height: 100, weight: 3 }] });
    render(<CampaignsAdmin campaigns={[two]} trackingReady />);
    expect(screen.getByText(/25% of signatures/)).toBeTruthy();
    expect(screen.getByText(/75% of signatures/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save variants" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].method).toBe("PUT");
    expect((sent[0].body.variants as { weight: number }[]).map((v) => v.weight)).toEqual([1, 3]);
  });

  it("refuses a non-https variant image and all-zero weights without calling the server", () => {
    render(<CampaignsAdmin campaigns={[camp()]} trackingReady />);
    fireEvent.change(screen.getByLabelText("Image address"), { target: { value: "ftp://x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save variants" }));
    expect(screen.getByText("Enter the full https:// address of the image.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Image address"), { target: { value: "https://ok.com/a.png" } });
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save variants" }));
    expect(screen.getByText("At least one variant needs a weight above 0.")).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it("caps variants at 8", () => {
    const many = camp({ variants: Array.from({ length: 8 }, (_, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, label: "", imageUrl: "https://a.com/x.png", altText: "", width: 400, height: 100, weight: 1 })) });
    render(<CampaignsAdmin campaigns={[many]} trackingReady />);
    expect((screen.getByRole("button", { name: "Add a variant" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("tells you which variant a signature gets, and warns about local links", async () => {
    render(<CampaignsAdmin campaigns={[camp()]} trackingReady />);
    reply = { ok: true, body: { running: true, variant: { label: "Blue", image_url: "x" }, fallback_src: "y" } };
    fireEvent.change(screen.getByLabelText("Signature id"), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByRole("button", { name: "Which variant?" }));
    expect(screen.getByText(/Enter a signature id/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Signature id"), { target: { value: "22222222-2222-4222-8222-222222222222" } });
    fireEvent.click(screen.getByRole("button", { name: "Which variant?" }));
    expect(await screen.findByText("Blue")).toBeTruthy();
    expect(sent[0]).toEqual({ url: `/api/campaigns/${ID}/preview`, method: "POST", body: { signature_id: "22222222-2222-4222-8222-222222222222" } });

    reply = { ok: true, body: { click_url: "http://localhost:3200/r/abc", image_url: "http://localhost:3200/b/abc", warning: "These links point at a local address" } };
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
    fireEvent.click(screen.getByRole("button", { name: "Copy tracked link" }));
    expect(await screen.findByDisplayValue("http://localhost:3200/r/abc")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("local address");
  });

  it("shows the server's message when a change is refused", async () => {
    reply = { ok: false, status: 403, body: { message: "You do not have permission to do that." } };
    render(<CampaignsAdmin campaigns={[camp()]} trackingReady />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("You do not have permission to do that.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks before deleting", async () => {
    render(<CampaignsAdmin campaigns={[camp()]} trackingReady />);
    fireEvent.click(screen.getByRole("button", { name: "Delete campaign" }));
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].method).toBe("DELETE");
  });
});

describe("Analytics screen", () => {
  const totals = summarize(
    [
      { campaign_id: ID, variant_id: V1, day: "2026-06-01", clicks: 4, unique_clicks: 3, image_loads: 40 },
      { campaign_id: ID, variant_id: V1, day: "2026-06-02", clicks: 1, unique_clicks: 1, image_loads: 10 },
    ],
    [{ id: ID, name: "Spring sale", variants: [{ id: V1, label: "Blue" }] }],
    "2026-06-01",
    "2026-06-03",
  );

  it("shows totals, per-variant numbers, a labelled chart and an honest note on image loads", () => {
    render(<AnalyticsView totals={totals} from="2026-06-01" to="2026-06-03" rangeError="" />);
    const sec = screen.getByRole("region", { name: "Spring sale" });
    expect(within(sec).getByRole("img", { name: "Spring sale: 5 clicks over 3 days" })).toBeTruthy();
    const row = within(sec).getByRole("row", { name: /Blue/ });
    expect(row.textContent).toContain("10%");
    expect(screen.getByText(/Image loads are not views/)).toBeTruthy();
    expect(sec.querySelectorAll("svg rect").length).toBe(3);
  });

  it("links the CSV export to the selected range and keeps the range in the form", () => {
    render(<AnalyticsView totals={totals} from="2026-06-01" to="2026-06-03" rangeError="" />);
    expect(screen.getByRole("link", { name: "Download CSV" }).getAttribute("href")).toBe("/api/campaigns/analytics?from=2026-06-01&to=2026-06-03&format=csv");
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-06-01");
  });

  it("explains a bad range", () => {
    render(<AnalyticsView totals={[]} from="2026-06-01" to="2026-06-03" rangeError="Choose a range of one year or less." />);
    expect(screen.getByRole("alert").textContent).toContain("one year or less");
  });
});

describe("Disclaimers screen and helpers", () => {
  const g: Disclaimer = { id: "g1", org_id: null, title: "Confidentiality notice", category: "confidentiality", jurisdiction: "General", body: "Confidential text.", needs_review: true };
  const own: Disclaimer = { id: "o1", org_id: "org", title: "Our notice", category: "legal", jurisdiction: "", body: "Our text.", needs_review: true };

  it("marks every starting point as needing legal review and lists the organization's own separately", () => {
    render(<DisclaimersAdmin items={[g, own]} />);
    expect(screen.getByRole("note").textContent).toContain("not legal advice");
    const art = screen.getByRole("article", { name: "Confidentiality notice" });
    expect(within(art).getByText("Needs legal review")).toBeTruthy();
    expect(screen.getByLabelText("Title", { selector: "#t-o1" })).toBeTruthy();
  });

  it("copies a starting point into the organization as still needing review", async () => {
    render(<DisclaimersAdmin items={[g]} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy to my list" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent[0]).toMatchObject({ url: "/api/disclaimers", method: "POST", body: { title: "Confidentiality notice", needs_review: true } });
  });

  it("validates the length of new text and filters by category", () => {
    render(<DisclaimersAdmin items={[g, own]} />);
    fireEvent.change(screen.getByLabelText("Title", { selector: "#nd-title" }), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText(/Text \(0/), { target: { value: "x".repeat(1501) } });
    fireEvent.click(screen.getByRole("button", { name: "Add disclaimer" }));
    expect(screen.getByText("Keep it to 1,500 characters or fewer.")).toBeTruthy();
    expect(sent).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "legal" } });
    expect(screen.queryByRole("article", { name: "Confidentiality notice" })).toBeNull();
  });

  it("insertDisclaimer appends one, and replaces an existing disclaimer block instead of adding a second", () => {
    const blocks = [{ type: "identity" as const, name: "A" }];
    const one = insertDisclaimer(blocks, g);
    expect(one).toEqual([...blocks, { type: "disclaimer", text: "Confidential text." }]);
    const two = insertDisclaimer(one, own);
    expect(two.filter((b) => b.type === "disclaimer")).toEqual([{ type: "disclaimer", text: "Our text." }]);
    expect(toDisclaimerBlock({ body: "x".repeat(2000) }).text).toHaveLength(1500);
  });
});
