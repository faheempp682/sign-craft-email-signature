import { describe, expect, it } from "vitest";
import { GenericConfig, HubspotConfig, parseCrmConfig } from "./crm-config";
import { buildUrl, fetchGenericAll, fetchGenericOne, genericMissing, testGeneric } from "./generic-crm";
import { fetchHubspot, hubspotMissing } from "./hubspot";
import { listPaths, parsePath, pickPath } from "./jsonpath";
import { safeGetJson, type Transport, type TransportRequest, type TransportResult } from "./safe-fetch";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("json path", () => {
  const doc = { data: { items: [{ phone: "123", n: 5, ok: true, none: null }], "job-title": "CTO" }, list: [1, 2] };
  it("walks dotted, indexed and quoted paths", () => {
    expect(pickPath(doc, "$.data.items[0].phone")).toEqual({ found: true, value: "123" });
    expect(pickPath(doc, "data.items[0].n")).toEqual({ found: true, value: "5" });
    expect(pickPath(doc, '$.data["job-title"]')).toEqual({ found: true, value: "CTO" });
    expect(pickPath(doc, "$.data.items[0].none")).toEqual({ found: true, value: "" });
    expect(pickPath(doc, "$.nope.x").found).toBe(false);
    expect(pickPath(doc, "$.list").found).toBe(false); // a list is not a single value
  });
  it("can never reach the prototype chain", () => {
    for (const p of ["$.__proto__", "$.constructor.name", "$.data.constructor", "$.list.length", "$.toString"]) expect(pickPath(doc, p).found).toBe(false);
  });
  it("rejects wildcards, filters, long and odd paths", () => {
    for (const p of ["", "$..x", "$.a[*]", "$.a[?(@.x)]", "$.a b", "$.a.", "a[0", "$.a.b.c.d.e.f.g.h.i", "x".repeat(300)]) expect(parsePath(p)).toBeNull();
  });
  it("lists leaf paths with short samples", () => {
    const l = listPaths({ a: { b: "x".repeat(100) }, c: [1] });
    expect(l[0]).toEqual({ path: "$.a.b", sample: "x".repeat(40) });
    expect(l[1]).toEqual({ path: "$.c[0]", sample: "1" });
  });
});

describe("CRM config validation", () => {
  const good = { base_url: "https://crm.example.com/api", auth_header: "Authorization", auth_prefix: "Bearer ", path_template: "/contacts?email={email}", mapping: [{ from: "$.phone", to: "phone" }] };
  it("accepts a sound config", () => expect(GenericConfig.safeParse(good).success).toBe(true));
  it.each([
    ["http base", { base_url: "http://crm.example.com" }],
    ["private base", { base_url: "https://localhost" }],
    ["credentials in base", { base_url: "https://u:p@crm.example.com" }],
    ["port in base", { base_url: "https://crm.example.com:8443" }],
    ["query in base", { base_url: "https://crm.example.com?x=1" }],
    ["forbidden header", { auth_header: "Host" }],
    ["header with newline", { auth_header: "X-Key\r\nX-Evil: 1" }],
    ["no placeholder", { path_template: "/contacts" }],
    ["scheme-relative path", { path_template: "//evil.com/{email}" }],
    ["dotdot", { path_template: "/a/../{email}" }],
    ["path without slash", { path_template: "@evil.com/{email}" }],
    ["unknown target", { mapping: [{ from: "$.a", to: "email" }] }],
    ["status target", { mapping: [{ from: "$.a", to: "status" }] }],
    ["two sources one target", { mapping: [{ from: "$.a", to: "phone" }, { from: "$.b", to: "phone" }] }],
    ["bad path", { mapping: [{ from: "$..a", to: "phone" }] }],
    ["extra key", { secret: "x" }],
  ])("rejects %s", (_n, patch) => expect(GenericConfig.safeParse({ ...good, ...patch }).success).toBe(false));
  it("HubSpot properties are internal names or owner_*", () => {
    expect(HubspotConfig.safeParse({ mapping: [{ from: "jobtitle", to: "title" }, { from: "owner_email", to: "custom.owner" }] }).success).toBe(true);
    expect(HubspotConfig.safeParse({ mapping: [{ from: "Job Title", to: "title" }] }).success).toBe(false);
    expect(parseCrmConfig("hubspot", { mapping: [] }).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------------ SSRF */

const PUBLIC = async () => ["93.184.216.34"];
const okTransport = (body: unknown = { a: 1 }, seen: TransportRequest[] = []): Transport => async (r) => {
  seen.push(r);
  return { status: 200, headers: { "content-type": "application/json; charset=utf-8" }, body: Buffer.from(JSON.stringify(body)) };
};

describe("safeGetJson (SSRF defence)", () => {
  it("connects to the address it checked, with the headers it was given", async () => {
    const seen: TransportRequest[] = [];
    const r = await safeGetJson("https://crm.example.com/x?email=a%40b.co", { resolve: PUBLIC, transport: okTransport({ a: 1 }, seen), headers: { "X-Key": "k" } });
    expect(r).toMatchObject({ ok: true, json: { a: 1 } });
    expect(seen[0]).toMatchObject({ address: "93.184.216.34", headers: { "X-Key": "k" }, maxBytes: 1048576 });
  });

  it.each(["http://crm.example.com/x", "https://localhost/x", "https://crm.example.com:8443/x", "https://u:p@crm.example.com/x", "https://foo.internal/x", "ftp://crm.example.com", "not a url"])("refuses %s before any lookup", async (u) => {
    let looked = false;
    const r = await safeGetJson(u, { resolve: async () => ((looked = true), ["93.184.216.34"]), transport: okTransport() });
    expect(r.ok).toBe(false);
    expect(looked).toBe(false);
  });

  it.each(["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.16.0.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1"])("refuses a host that resolves to %s", async (ip) => {
    let called = false;
    const r = await safeGetJson("https://crm.example.com/x", { resolve: async () => [ip], transport: async () => ((called = true), { error: "x" }) });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/private or internal/) });
    expect(called).toBe(false);
  });

  it("refuses when ANY resolved address is private (DNS answers with a mix)", async () => {
    const r = await safeGetJson("https://crm.example.com/x", { resolve: async () => ["93.184.216.34", "10.0.0.1"], transport: okTransport() });
    expect(r.ok).toBe(false);
  });

  it("refuses an IP-literal URL pointing inside", async () => {
    expect((await safeGetJson("https://127.0.0.1/x", { resolve: PUBLIC, transport: okTransport() })).ok).toBe(false);
    expect((await safeGetJson("https://[::1]/x", { resolve: PUBLIC, transport: okTransport() })).ok).toBe(false);
  });

  it("follows a same-host redirect and re-checks it; refuses other hosts and private targets", async () => {
    let hop = 0;
    const redirecting = (location: string): Transport => async (): Promise<TransportResult> => (hop++ === 0 ? { status: 302, headers: { location }, body: Buffer.alloc(0) } : { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}") });
    expect((await safeGetJson("https://crm.example.com/a", { resolve: PUBLIC, transport: redirecting("/b") })).ok).toBe(true);
    hop = 0;
    expect(await safeGetJson("https://crm.example.com/a", { resolve: PUBLIC, transport: redirecting("https://other.example.com/b") })).toMatchObject({ ok: false, reason: expect.stringMatching(/different host/) });
    hop = 0;
    expect((await safeGetJson("https://crm.example.com/a", { resolve: PUBLIC, transport: redirecting("http://crm.example.com/b") })).ok).toBe(false);
    hop = 0;
    expect((await safeGetJson("https://crm.example.com/a", { resolve: PUBLIC, transport: redirecting("https://169.254.169.254/latest") })).ok).toBe(false);
    // DNS rebinding on the second hop
    hop = 0;
    let lookups = 0;
    const rebind = await safeGetJson("https://crm.example.com/a", { resolve: async () => (lookups++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]), transport: redirecting("/b") });
    expect(rebind.ok).toBe(false);
  });

  it("stops redirect loops", async () => {
    const loop: Transport = async () => ({ status: 301, headers: { location: "/again" }, body: Buffer.alloc(0) });
    expect(await safeGetJson("https://crm.example.com/a", { resolve: PUBLIC, transport: loop })).toMatchObject({ ok: false, reason: "Too many redirects." });
  });

  it("refuses non-JSON, errors, oversized and broken answers", async () => {
    const t = (r: object): Transport => async () => r as never;
    expect((await safeGetJson("https://c.example.com/", { resolve: PUBLIC, transport: t({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html>") }) })).ok).toBe(false);
    expect((await safeGetJson("https://c.example.com/", { resolve: PUBLIC, transport: t({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{nope") }) })).ok).toBe(false);
    expect(await safeGetJson("https://c.example.com/", { resolve: PUBLIC, transport: t({ status: 500, headers: {}, body: Buffer.alloc(0) }) })).toMatchObject({ reason: "The server answered 500." });
    expect(await safeGetJson("https://c.example.com/", { resolve: PUBLIC, transport: t({ error: "too large" }) })).toMatchObject({ reason: expect.stringMatching(/1 MB/) });
    expect(await safeGetJson("https://c.example.com/", { resolve: PUBLIC, transport: t({ error: "timeout" }) })).toMatchObject({ reason: expect.stringMatching(/8 seconds/) });
    expect((await safeGetJson("https://nx.example.com/", { resolve: async () => { throw new Error("ENOTFOUND"); }, transport: okTransport() })).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ generic adapter */

describe("generic REST adapter", () => {
  const cfg = GenericConfig.parse({
    base_url: "https://crm.kimp.test/api/", auth_header: "X-Api-Key", auth_prefix: "", path_template: "/people?email={email}",
    mapping: [{ from: "$.data.phone", to: "phone" }, { from: "$.data.role", to: "title" }, { from: "$.data.cal", to: "custom.booking" }, { from: "$.data.typo", to: "location" }, { from: "$.data.long", to: "department" }],
  });
  const env = { KIMP_CRM_SECRET: "topsecret-value" };
  const answer = { data: { phone: "+1 555", role: "  CTO\n", cal: "https://cal.test/ada", long: "x".repeat(200) } };

  it("builds the URL on the base origin with the email encoded", () => {
    expect(buildUrl(cfg, "a+b@x.com")).toBe("https://crm.kimp.test/api/people?email=a%2Bb%40x.com");
    expect(buildUrl(cfg, "x@y.com/../../etc")).toContain("%2F..%2F..%2Fetc");
  });

  it("sends the secret from the environment in the configured header, and shows exactly what is mapped", async () => {
    const seen: TransportRequest[] = [];
    const r = await testGeneric(cfg, "ada@x.com", { env, resolve: PUBLIC, transport: okTransport(answer, seen) });
    expect(seen[0].headers).toEqual({ "X-Api-Key": "topsecret-value" });
    expect(seen[0].url.toString()).toBe("https://crm.kimp.test/api/people?email=ada%40x.com");
    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.rows.find((x) => x.to === "title")).toMatchObject({ found: true, value: "CTO" });
    expect(r.rows.find((x) => x.to === "location")).toMatchObject({ found: false });
    expect(r.rows.find((x) => x.to === "department")?.note).toMatch(/Ignored/);
    expect(JSON.stringify(r)).not.toContain("topsecret");
    expect(r.paths.map((p) => p.path)).toContain("$.data.phone");
  });

  it("a mapping path that is missing, or a value that is too long, leaves the field alone (key absent)", async () => {
    const r = await fetchGenericOne(cfg, "ada@x.com", { env, resolve: PUBLIC, transport: okTransport(answer) });
    expect(r.kind === "found" && r.values).toEqual({ phone: "+1 555", title: "CTO", "custom.booking": "https://cal.test/ada" });
  });

  it("404 means 'not in the CRM'; 401/403 abort with a clear message that does not contain the secret", async () => {
    const st = (status: number): Transport => async () => ({ status, headers: { "content-type": "application/json" }, body: Buffer.from("{}") });
    expect(await fetchGenericOne(cfg, "a@x.com", { env, resolve: PUBLIC, transport: st(404) })).toEqual({ kind: "not_found" });
    const e = await fetchGenericOne(cfg, "a@x.com", { env, resolve: PUBLIC, transport: st(401) }).catch((x) => x);
    expect(e).toMatchObject({ code: "not_authorized" });
    expect(e.message).not.toContain("topsecret");
    await expect(fetchGenericOne(cfg, "a@x.com", { env: {}, resolve: PUBLIC, transport: st(200) })).rejects.toMatchObject({ code: "not_configured" });
  });

  it("an internal address is a hard stop with a clear reason", async () => {
    await expect(fetchGenericOne(cfg, "a@x.com", { env, resolve: async () => ["10.1.2.3"], transport: okTransport() })).rejects.toMatchObject({ code: "blocked" });
  });

  it("genericMissing names the variable only", () => {
    expect(genericMissing({})).toEqual(["KIMP_CRM_SECRET"]);
    expect(genericMissing({ KIMP_CRM_SECRET: "a\r\nb" })).toEqual(["KIMP_CRM_SECRET"]);
    expect(genericMissing(env)).toEqual([]);
  });

  it("looks everybody up, skips the unknown, and aborts when the CRM mostly fails", async () => {
    const emails = ["a@x.com", "b@x.com", "c@x.com"];
    const t: Transport = async (r): Promise<TransportResult> => (r.url.search.includes("b%40") ? { status: 404, headers: {}, body: Buffer.alloc(0) } : { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(answer)) });
    const all = await fetchGenericAll(cfg, emails, { env, resolve: PUBLIC, transport: t });
    expect([...all.records.keys()].sort()).toEqual(["a@x.com", "c@x.com"]);
    const many = Array.from({ length: 30 }, (_, i) => `p${i}@x.com`);
    await expect(fetchGenericAll(cfg, many, { env, resolve: PUBLIC, transport: async () => ({ status: 500, headers: {}, body: Buffer.alloc(0) }) })).rejects.toMatchObject({ code: "upstream" });
  });
});

/* ------------------------------------------------------------------------ HubSpot */

describe("HubSpot (fake CRM API)", () => {
  const cfg = HubspotConfig.parse({ mapping: [{ from: "phone", to: "phone" }, { from: "jobtitle", to: "title" }, { from: "booking_link", to: "custom.booking" }, { from: "owner_name", to: "custom.owner" }] });
  const env = { HUBSPOT_ACCESS_TOKEN: "pat-na1-secret" };

  function fake(handlers: { contacts?: (body: { properties: string[]; idProperty: string; inputs: { id: string }[] }) => Response; owners?: Response[] } = {}) {
    const calls: { url: string; method: string; auth: string | null; body?: unknown }[] = [];
    let o = 0;
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body });
      if (u.includes("/crm/v3/owners")) return handlers.owners?.[o++] ?? json({ results: [] });
      return handlers.contacts ? handlers.contacts(body) : json({ results: [] });
    }) as typeof fetch;
    return { fetchFn, calls };
  }

  it("reports a missing token by name", () => {
    expect(hubspotMissing({})).toEqual(["HUBSPOT_ACCESS_TOKEN"]);
    expect(hubspotMissing(env)).toEqual([]);
  });

  it("batch-reads contacts by email (100 at a time), resolves owners and maps properties", async () => {
    const f = fake({
      contacts: (b) => json({ status: "COMPLETE", results: b.inputs.filter((i) => i.id !== "none@x.com").map((i) => ({ id: "1", properties: { email: i.id.toUpperCase(), phone: "+1 555", jobtitle: "Head of X", booking_link: "https://meet/x", hubspot_owner_id: "77" } })) }, 207),
      owners: [json({ results: [{ id: "77", email: "owner@acme.com", firstName: "Olga", lastName: "Owner" }], paging: { next: { after: "c2" } } }), json({ results: [{ id: "78", email: "z@acme.com", firstName: "Z", lastName: "Z" }] })],
    });
    const emails = Array.from({ length: 150 }, (_, i) => `p${i}@x.com`);
    emails.push("none@x.com");
    const r = await fetchHubspot(cfg, emails, { env, fetchFn: f.fetchFn });
    const reads = f.calls.filter((c) => c.url.endsWith("/batch/read"));
    expect(reads).toHaveLength(2);
    expect((reads[0].body as { inputs: unknown[] }).inputs).toHaveLength(100);
    expect(reads[0].body).toMatchObject({ idProperty: "email", properties: expect.arrayContaining(["email", "phone", "jobtitle", "booking_link", "hubspot_owner_id"]) });
    expect(reads[0].auth).toBe("Bearer pat-na1-secret");
    expect(f.calls.filter((c) => c.url.includes("/owners"))).toHaveLength(2);
    expect(f.calls[1].url).toContain("after=c2");
    expect(r.records.size).toBe(150);
    expect(r.records.get("p1@x.com")).toEqual({ phone: "+1 555", title: "Head of X", "custom.booking": "https://meet/x", "custom.owner": "Olga Owner" });
    expect(r.records.has("none@x.com")).toBe(false);
  });

  it("does not fetch owners unless an owner field is mapped", async () => {
    const f = fake({ contacts: () => json({ results: [] }) });
    await fetchHubspot(HubspotConfig.parse({ mapping: [{ from: "phone", to: "phone" }] }), ["a@x.com"], { env, fetchFn: f.fetchFn });
    expect(f.calls.some((c) => c.url.includes("owners"))).toBe(false);
  });

  it("explains 401, 403 and rate limits", async () => {
    const st = (status: number) => fake({ contacts: () => json({ message: "x" }, status) }).fetchFn;
    await expect(fetchHubspot(cfg, ["a@x.com"], { env: { HUBSPOT_ACCESS_TOKEN: "t" }, fetchFn: st(401) })).rejects.toThrow(/rejected the access token/);
    await expect(fetchHubspot(HubspotConfig.parse({ mapping: [{ from: "phone", to: "phone" }] }), ["a@x.com"], { env, fetchFn: st(403) })).rejects.toThrow(/crm\.objects\.contacts\.read/);
    await expect(fetchHubspot(cfg, ["a@x.com"], { env: {} })).rejects.toMatchObject({ code: "not_configured" });
  });

  it("an over-long CRM value is left out (never turned into a blank that could erase)", async () => {
    const f = fake({ contacts: () => json({ results: [{ properties: { email: "a@x.com", phone: "1".repeat(100), jobtitle: "ok" } }] }) });
    const r = await fetchHubspot(HubspotConfig.parse({ mapping: [{ from: "phone", to: "phone" }, { from: "jobtitle", to: "title" }] }), ["a@x.com"], { env, fetchFn: f.fetchFn });
    expect(r.records.get("a@x.com")).toEqual({ title: "ok" });
    expect(r.warnings).toHaveLength(1);
  });
});
