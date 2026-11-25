// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import { CardView } from "@/app/c/card-view";
import type { OwnedCard, PublicCard } from "@/lib/cards/schema";
import { CardEditor } from "./card-editor";
import { CardsList } from "./cards-list";

const pub = (o: Partial<PublicCard> = {}): PublicCard => ({
  slug: "ada", display_name: "Ada Lovelace", title: "Analyst", company: "Engines", bio: "Hello there", photo_url: null, phone: "+1 555 0100", email: "ada@example.com",
  website: "https://example.com", address: "London", social_links: [{ network: "github", url: "https://github.com/ada" }], booking_url: "https://cal.example.com/ada", accent_color: "#1d4ed8", indexable: false, ...o,
});

afterEach(cleanup);

describe("public card view", () => {
  it("shows every section with the right links", () => {
    render(<CardView card={pub()} vcardHref="/c/ada/vcard" qrSrc="data:image/svg+xml;utf8,x" cardAddress="https://s.test/c/ada" />);
    expect(screen.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Save contact/ }).getAttribute("href")).toBe("/c/ada/vcard");
    expect(screen.getByRole("link", { name: /Book a meeting/ }).getAttribute("href")).toBe("https://cal.example.com/ada");
    expect(screen.getByRole("link", { name: /Call/ }).getAttribute("href")).toBe("tel:+15550100");
    expect(screen.getByRole("link", { name: /Email/ }).getAttribute("href")).toBe("mailto:ada@example.com");
    expect(screen.getByRole("link", { name: /GitHub/ }).getAttribute("href")).toBe("https://github.com/ada");
    expect(screen.getByAltText(/QR code that opens https:\/\/s.test\/c\/ada/)).toBeTruthy();
  });

  it("never renders a link that is not https, mailto or tel (even if bad data got through)", () => {
    const evil = pub({
      website: "javascript:alert(1)", booking_url: "http://x.com", photo_url: "data:image/png;base64,AAA", email: "a@b.co,evil@x.com", phone: "javascript:1",
      social_links: [{ network: "github", url: "javascript:alert(1)" }, { network: "linkedin", url: "https://linkedin.com/in/ok" }],
    });
    const { container } = render(<CardView card={evil} vcardHref="/c/ada/vcard" qrSrc={null} cardAddress="https://s.test/c/ada" />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    for (const h of hrefs) expect(h).toMatch(/^(https:\/\/|mailto:|tel:|\/c\/)/);
    expect(hrefs.join(" ")).not.toMatch(/javascript|http:\/\//);
    expect(container.querySelector("img[src^='data:image/png']")).toBeNull();
    expect(screen.queryByRole("link", { name: /Book a meeting/ })).toBeNull();
    expect(hrefs).toContain("https://linkedin.com/in/ok");
  });

  it("opens outside links safely, and falls back to initials without a photo", () => {
    const { container } = render(<CardView card={pub()} vcardHref="/c/ada/vcard" qrSrc={null} cardAddress="x" />);
    for (const a of Array.from(container.querySelectorAll("a[target=_blank]"))) expect(a.getAttribute("rel")).toContain("noopener");
    expect(container.textContent).toContain("AL");
  });

  it("does not inject markup from fields, and ignores a hostile accent colour", () => {
    const { container } = render(<CardView card={pub({ display_name: "<img src=x onerror=alert(1)>", accent_color: "red;background:url(//evil)" })} vcardHref="/v" qrSrc={null} cardAddress="x" />);
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect(container.innerHTML).not.toMatch(/evil/);
  });
});

describe("cards list", () => {
  const cards = [
    { id: "1", slug: "ada", display_name: "Ada", title: "CTO", company: null, published: true, indexable: false },
    { id: "2", slug: "ada-two", display_name: "Ada Two", title: null, company: null, published: false, indexable: false },
  ];
  it("shows public/private state and explains it", () => {
    render(<CardsList cards={cards} origin="https://s.test" limit={5} />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Hidden from search engines")).toBeTruthy();
    expect(screen.getByText(/hidden until you publish it/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit Ada" }).getAttribute("href")).toBe("/cards/1");
    expect(screen.queryByRole("button", { name: "Copy link to Ada Two" })).toBeNull(); // only published cards have a link to copy
  });
  it("blocks creating more than the limit", () => {
    render(<CardsList cards={cards} origin="https://s.test" limit={2} />);
    expect(screen.queryByRole("link", { name: "New card" })).toBeNull();
  });
  it("invites the first card when empty", () => {
    render(<CardsList cards={[]} origin="https://s.test" limit={5} />);
    expect(screen.getByRole("link", { name: "Create your first card" }).getAttribute("href")).toBe("/cards/new");
  });
});

/* ------------------------------------------------------------------ editor */

type Sent = { url: string; method: string; body: unknown };
let sent: Sent[];
let handler: (url: string, init: RequestInit) => { status?: number; body: unknown };

beforeEach(() => {
  sent = [];
  nav.refresh.mockClear();
  nav.replace.mockClear();
  nav.push.mockClear();
  handler = (url) => (url.startsWith("/api/cards/slug") ? { body: { available: true, problem: null } } : { body: { card: { id: "11111111-1111-4111-8111-111111111111" } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      const r = handler(url, init);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const owned = (o: Partial<OwnedCard> = {}): OwnedCard => ({
  id: "11111111-1111-4111-8111-111111111111", slug: "ada", display_name: "Ada", title: null, company: null, bio: null, photo_url: null, phone: null, email: null, website: null, address: null,
  social_links: [], booking_url: null, accent_color: "#111111", published: false, indexable: false, created_at: "", updated_at: "", ...o,
});
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("card editor", () => {
  it("every input has a label and the preview updates live", async () => {
    render(<CardEditor origin="https://s.test" cardCount={0} limit={5} />);
    type("Name", "Grace Hopper");
    type("Job title", "Rear Admiral");
    const preview = screen.getByRole("complementary", { name: "Live preview" });
    await waitFor(() => expect(preview.textContent).toContain("Grace Hopper"));
    expect(preview.textContent).toContain("Rear Admiral");
    for (const el of Array.from(document.querySelectorAll("input:not([type=hidden]), textarea, select"))) {
      const id = el.getAttribute("id");
      expect(id && document.querySelector(`label[for="${id}"]`), `no label for ${id}`).toBeTruthy();
    }
  });

  it("suggests an address from the name and checks it is free", async () => {
    render(<CardEditor origin="https://s.test" cardCount={0} limit={5} />);
    type("Name", "Grace Hopper");
    expect((screen.getByLabelText("Card address") as HTMLInputElement).value).toBe("grace-hopper");
    await waitFor(() => expect(sent.some((s) => s.url.startsWith("/api/cards/slug?slug=grace-hopper"))).toBe(true));
    await waitFor(() => expect(screen.getByText(/Available\./)).toBeTruthy());
  });

  it("shows when an address is taken or reserved, and refuses to save it", async () => {
    handler = (url) => (url.startsWith("/api/cards/slug") ? { body: { available: false, problem: "That address is already taken." } } : { body: {} });
    render(<CardEditor origin="https://s.test" cardCount={0} limit={5} />);
    type("Name", "Grace");
    type("Card address", "grace-hopper");
    await waitFor(() => expect(screen.getByText("That address is already taken.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Create card" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(sent.some((s) => s.method === "POST")).toBe(false);
    type("Card address", "admin");
    await waitFor(() => expect(screen.getByText(/reserved/)).toBeTruthy());
  });

  it("shows field errors under the field and does not post invalid data", async () => {
    render(<CardEditor origin="https://s.test" cardCount={0} limit={5} />);
    type("Name", "Grace");
    type("Website", "http://insecure.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Create card" }));
    await waitFor(() => expect(screen.getByText("Must be a full https:// address.")).toBeTruthy());
    expect(screen.getByLabelText("Website").getAttribute("aria-invalid")).toBe("true");
    expect(sent.some((s) => s.method === "POST")).toBe(false);
  });

  it("creates a card with a POST and moves to its edit page", async () => {
    render(<CardEditor origin="https://s.test" cardCount={0} limit={5} />);
    type("Name", "Grace Hopper");
    type("Email", "grace@navy.example");
    await waitFor(() => expect(screen.getByText(/Available\./)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Create card" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/cards/11111111-1111-4111-8111-111111111111"));
    const post = sent.find((s) => s.method === "POST")!;
    expect(post.url).toBe("/api/cards");
    expect(post.body).toMatchObject({ slug: "grace-hopper", display_name: "Grace Hopper", email: "grace@navy.example", published: false, indexable: false });
  });

  it("publishes and unpublishes through the toggle, and says what happened", async () => {
    render(<CardEditor card={owned()} origin="https://s.test" cardCount={1} limit={5} />);
    expect(screen.getByRole("switch", { name: "Published" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("switch", { name: "Published" }));
    await waitFor(() => expect(screen.getByText("Your card is now public.")).toBeTruthy());
    expect(sent.at(-1)).toMatchObject({ url: "/api/cards/11111111-1111-4111-8111-111111111111", method: "PATCH", body: { published: true } });
    fireEvent.click(screen.getByRole("switch", { name: "Published" }));
    await waitFor(() => expect(screen.getByText("Your card is no longer public.")).toBeTruthy());
    expect(sent.at(-1)?.body).toEqual({ published: false });
  });

  it("explains what becomes public and that search engines are off by default", () => {
    render(<CardEditor card={owned()} origin="https://s.test" cardCount={1} limit={5} />);
    expect(screen.getByText("What becomes public when you publish")).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Allow search engines/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("delete asks first, then removes the card", async () => {
    render(<CardEditor card={owned()} origin="https://s.test" cardCount={1} limit={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
    expect(sent.some((s) => s.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/cards"));
    expect(sent.at(-1)).toMatchObject({ method: "DELETE", url: "/api/cards/11111111-1111-4111-8111-111111111111" });
  });

  it("shows the server's message when saving fails", async () => {
    handler = (url, init) => (init.method === "PUT" ? { status: 409, body: { message: "That address is already taken. Choose another." } } : { body: { available: true } });
    render(<CardEditor card={owned()} origin="https://s.test" cardCount={1} limit={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already taken"));
  });

  it("blocks creating a sixth card", () => {
    render(<CardEditor origin="https://s.test" cardCount={5} limit={5} />);
    expect(screen.getByText(/already have 5 cards/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create card" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("copies the link", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CardEditor card={owned()} origin="https://s.test" cardCount={1} limit={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://s.test/c/ada"));
  });

  it("adds and removes social links", () => {
    render(<CardEditor card={owned()} origin="https://s.test" cardCount={1} limit={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a social link" }));
    type("LinkedIn address", "https://linkedin.com/in/ada");
    fireEvent.click(screen.getByRole("button", { name: "Remove LinkedIn link" }));
    expect(screen.queryByLabelText("LinkedIn address")).toBeNull();
  });
});
