import { describe, expect, it, vi } from "vitest";
import { DwdError } from "@/lib/google-dwd/token";
import { GoogleError } from "@/lib/google/errors";
import { classifyLive, type Baseline } from "./classify";
import { continueRun, HARD_CAP, type Candidate, type Result, type Store } from "./checker";
import { isEmptySignature, normalizeText, signatureHash, textFingerprint } from "./fingerprint";
import { buildMessage, sendWebhook, type PostTransport } from "./webhook";
import { expectedFrom, healthStatus } from "./service";
import { maskWebhook } from "./route";

const SENT = `<table><tr><td><b>Ada Lovelace</b><br>Engineer &amp; Mathematician</td></tr><tr><td><a href="https://example.com">example.com</a> | +44&nbsp;20&nbsp;7946&nbsp;0000</td></tr></table>`;
/** What Gmail MIGHT store: same words, different markup. (This is an assumption; real Gmail is not observed.) */
const REFORMATTED = `<div dir="ltr"><table style="x"><tbody><tr><td><b>Ada Lovelace</b><br />Engineer &amp; Mathematician</td></tr><tr><td><a href='https://example.com' target="_blank">example.com</a> | +44 20 7946 0000</td></tr></tbody></table></div>`;
const EDITED = SENT.replace("Engineer", "Chief Engineer");
const none: Baseline = { hash: null, fp: null, verified: false };
const expectedFp = textFingerprint(SENT);

describe("normalising text", () => {
  it("strips tags, decodes entities, collapses whitespace, ignores style and comments", () => {
    expect(normalizeText("<style>p{color:red}</style><!-- c --><p>A&nbsp;&amp;&#65;&#x42;</p>\n\n<p> b </p>")).toBe("A &AB b");
  });
  it("inline formatting does not split a word, block tags separate words", () => {
    expect(normalizeText("<b>Ad</b>a")).toBe("Ada");
    expect(normalizeText("<td>A</td><td>B</td>")).toBe("A B");
  });
  it("treats a signature with only an image as not empty, and whitespace-only markup as empty", () => {
    expect(isEmptySignature('<img src="https://x/y.png">')).toBe(false);
    expect(isEmptySignature("<div><br></div> \n")).toBe(true);
    expect(isEmptySignature("")).toBe(true);
  });
  it("different words give different fingerprints; the same words give the same", () => {
    expect(textFingerprint(SENT)).toBe(textFingerprint(REFORMATTED));
    expect(textFingerprint(SENT)).not.toBe(textFingerprint(EDITED));
  });
});

describe("classifyLive", () => {
  it("first check, text equals the approved text: ok, baseline recorded and verified", () => {
    const v = classifyLive({ live: REFORMATTED, expectedFp, baseline: none });
    expect(v.status).toBe("ok");
    expect(v.baseline).toEqual({ hash: signatureHash(REFORMATTED), fp: expectedFp, verified: true });
    expect(v.reformatted).toBe(false);
  });
  it("Gmail re-stored the markup after the baseline: ok and counted as reformatted, never edited", () => {
    const base = { hash: signatureHash(SENT), fp: expectedFp, verified: true };
    const v = classifyLive({ live: REFORMATTED, expectedFp, baseline: base });
    expect(v.status).toBe("ok");
    expect(v.reformatted).toBe(true);
  });
  it("a changed word is edited, even on the first check (the baseline cannot hide it)", () => {
    const first = classifyLive({ live: EDITED, expectedFp, baseline: none });
    expect(first.status).toBe("edited");
    expect(first.baseline.verified).toBe(false);
    // the edited text became the baseline; the next check must still say edited
    const again = classifyLive({ live: EDITED, expectedFp, baseline: first.baseline });
    expect(again.status).toBe("edited");
  });
  it("an empty signature is removed; Gmail returning nothing is not confused with ok", () => {
    expect(classifyLive({ live: "", expectedFp, baseline: none }).status).toBe("removed");
    expect(classifyLive({ live: "<div><br></div>", expectedFp: null, baseline: { hash: "a".repeat(64), fp: "b".repeat(64), verified: true } }).status).toBe("removed");
  });
  it("fixing it makes it ok again and upgrades an unverified baseline", () => {
    const bad = classifyLive({ live: EDITED, expectedFp, baseline: none });
    const fixed = classifyLive({ live: SENT, expectedFp, baseline: bad.baseline });
    expect(fixed.status).toBe("ok");
    expect(fixed.baseline.verified).toBe(true);
  });
  it("without an expected text: first check records an unverified baseline, later checks compare to it", () => {
    const first = classifyLive({ live: SENT, expectedFp: null, baseline: none });
    expect(first.status).toBe("ok");
    expect(first.baseline.verified).toBe(false);
    expect(classifyLive({ live: SENT, expectedFp: null, baseline: first.baseline })).toMatchObject({ status: "ok", reformatted: false });
    expect(classifyLive({ live: REFORMATTED, expectedFp: null, baseline: first.baseline })).toMatchObject({ status: "ok", reformatted: true });
    expect(classifyLive({ live: EDITED, expectedFp: null, baseline: first.baseline }).status).toBe("edited");
  });
});

/* ------------------------------------------------------------------------ checker */

const cand = (i: number): Candidate => ({ person_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, email: `p${i}@example.com`, full_name: `P${i}`, item_id: `i${i}`, version_id: null, new_hash: null, baseline_hash: null, baseline_fp: null, baseline_verified: false });

function memStore(all: Candidate[]) {
  const results: Result[] = [];
  const finished: { status: string; capped: boolean; cursor: string | null; note: string }[] = [];
  const store: Store = {
    async candidates(after, limit) {
      return all.filter((c) => after === null || c.person_id > after).slice(0, limit);
    },
    async record(_r, rs) {
      results.push(...rs);
    },
    async finish(_r, status, capped, cursor, note) {
      finished.push({ status, capped, cursor, note });
    },
  };
  return { store, results, finished };
}
const run = { id: "r1", cursor: null, checked: 0 };
const nosleep = async () => {};
const exp = (m: Record<string, string | null> = {}) => async (b: Candidate[]) => new Map(b.map((c) => [c.person_id, m[c.person_id] ?? expectedFp]));

describe("continueRun", () => {
  it("checks everyone, classifies, finishes", async () => {
    const all = [cand(1), cand(2), cand(3)];
    const m = memStore(all);
    const live: Record<string, string> = { "p1@example.com": SENT, "p2@example.com": EDITED, "p3@example.com": "" };
    const p = await continueRun(run, { store: m.store, mailbox: { read: async (e) => live[e], write: async () => {} }, expected: exp(), cap: 1000, budgetMs: 10_000, sleep: nosleep });
    expect(p).toMatchObject({ done: true, checked: 3, capped: false });
    expect(m.results.map((r) => r.status)).toEqual(["ok", "edited", "removed"]);
    expect(m.finished).toEqual([{ status: "completed", capped: false, cursor: null, note: "" }]);
  });

  it("an outage is unreachable with a reason, never edited or removed, and other people are still checked", async () => {
    const m = memStore([cand(1), cand(2)]);
    const mailbox = {
      read: async (e: string) => {
        if (e === "p1@example.com") throw new GoogleError("rate_limited", "x", 429);
        return SENT;
      },
      write: async () => {},
    };
    const p = await continueRun(run, { store: m.store, mailbox, expected: exp(), cap: 1000, budgetMs: 10_000, sleep: nosleep });
    expect(p.done).toBe(true);
    expect(m.results[0].status).toBe("unreachable");
    expect(m.results[0].reason).toMatch(/limiting/i);
    expect(m.results[1].status).toBe("ok");
  });

  it("backs off on 429 and 5xx and then succeeds", async () => {
    const m = memStore([cand(1)]);
    let calls = 0;
    const sleeps: number[] = [];
    const mailbox = {
      read: async () => {
        if (++calls < 3) throw new GoogleError(calls === 1 ? "rate_limited" : "upstream", "x", 503);
        return SENT;
      },
      write: async () => {},
    };
    await continueRun(run, { store: m.store, mailbox, expected: exp(), cap: 1000, budgetMs: 10_000, sleep: async (ms) => void sleeps.push(ms), random: () => 0 });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
    expect(m.results[0].status).toBe("ok");
  });

  it("a setup problem stops the run as failed instead of recording everyone as unreachable one batch at a time", async () => {
    const m = memStore(Array.from({ length: 60 }, (_, i) => cand(i + 1)));
    const mailbox = { read: async () => { throw new DwdError("not_authorized", "Google refused: not authorised."); }, write: async () => {} };
    const p = await continueRun(run, { store: m.store, mailbox, expected: exp(), cap: 1000, budgetMs: 10_000, sleep: nosleep });
    expect(p).toMatchObject({ done: true, failed: true });
    expect(m.results.length).toBeLessThanOrEqual(25);
    expect(m.results.every((r) => r.status === "unreachable")).toBe(true);
    expect(m.finished[0]).toMatchObject({ status: "failed" });
    expect(m.finished[0].note).toMatch(/not authorised/);
  });

  it("stops at the time budget without finishing; resuming from the saved cursor does not repeat anyone", async () => {
    const all = Array.from({ length: 60 }, (_, i) => cand(i + 1));
    const m = memStore(all);
    let t = 0;
    const seen: string[] = [];
    const mailbox = { read: async (e: string) => { seen.push(e); return SENT; }, write: async () => {} };
    const deps = { store: m.store, mailbox, expected: exp(), cap: 1000, sleep: nosleep };
    // clock: the first call is the start, then +10ms per check of the budget; budget 15ms allows exactly one batch
    const p1 = await continueRun(run, { ...deps, budgetMs: 15, now: () => (t += 10) });
    expect(p1.done).toBe(false);
    expect(m.finished).toHaveLength(0);
    const cursor = m.results[m.results.length - 1].person_id;
    const p2 = await continueRun({ id: "r1", cursor, checked: p1.checked }, { ...deps, budgetMs: 10_000 });
    expect(p2.done).toBe(true);
    expect(p2.checked).toBe(60);
    expect(new Set(seen).size).toBe(60);
    expect(seen).toHaveLength(60);
  });

  it("bounded concurrency", async () => {
    const m = memStore(Array.from({ length: 25 }, (_, i) => cand(i + 1)));
    let inFlight = 0;
    let peak = 0;
    const mailbox = {
      read: async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return SENT;
      },
      write: async () => {},
    };
    await continueRun(run, { store: m.store, mailbox, expected: exp(), cap: 1000, budgetMs: 10_000, sleep: nosleep });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it("never exceeds the cap, never above the hard cap of 1000, and says it stopped", async () => {
    const all = Array.from({ length: 60 }, (_, i) => cand(i + 1));
    const m = memStore(all);
    const mailbox = { read: async () => SENT, write: async () => {} };
    const p = await continueRun(run, { store: m.store, mailbox, expected: exp(), cap: 30, budgetMs: 10_000, sleep: nosleep });
    expect(p).toMatchObject({ done: true, checked: 30, capped: true });
    expect(m.finished[0]).toMatchObject({ status: "completed", capped: true, cursor: all[29].person_id });
    // a configured cap above the hard cap is clamped
    const big = memStore(Array.from({ length: HARD_CAP + 5 }, (_, i) => cand(i + 1)));
    const p2 = await continueRun(run, { store: big.store, mailbox, expected: exp(), cap: 50_000, budgetMs: 60_000, sleep: nosleep });
    expect(p2.checked).toBe(HARD_CAP);
    expect(p2.capped).toBe(true);
  });

  it("passes the stored baseline in and the new baseline out", async () => {
    const c = { ...cand(1), baseline_hash: signatureHash(SENT), baseline_fp: expectedFp, baseline_verified: true };
    const m = memStore([c]);
    await continueRun(run, { store: m.store, mailbox: { read: async () => REFORMATTED, write: async () => {} }, expected: exp(), cap: 10, budgetMs: 1000, sleep: nosleep });
    expect(m.results[0]).toMatchObject({ status: "ok", reformatted: true, baseline_hash: signatureHash(SENT) });
  });

  it("writes nothing to Gmail", async () => {
    const m = memStore([cand(1)]);
    const write = vi.fn();
    await continueRun(run, { store: m.store, mailbox: { read: async () => EDITED, write }, expected: exp(), cap: 10, budgetMs: 1000, sleep: nosleep });
    expect(write).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ webhook */

const publicResolve = async () => ["93.184.216.34"];
const okTransport = (calls: { address: string; body: string; host: string }[] = []): PostTransport => async (r) => {
  calls.push({ address: r.address, body: r.body, host: r.url.hostname });
  return { status: 200 };
};

describe("webhook", () => {
  it("posts Slack-compatible JSON to the address that was checked", async () => {
    const calls: { address: string; body: string; host: string }[] = [];
    const d = await sendWebhook("https://hooks.example.com/services/T/B/x", "hello", { resolve: publicResolve, transport: okTransport(calls) });
    expect(d).toEqual({ ok: true });
    expect(JSON.parse(calls[0].body)).toEqual({ text: "hello" });
    expect(calls[0].address).toBe("93.184.216.34");
  });
  it("refuses http, credentials, odd ports, internal names and private or loopback or metadata addresses, without calling out", async () => {
    const transport = vi.fn();
    for (const u of ["http://hooks.example.com/x", "https://user:pw@hooks.example.com/x", "https://hooks.example.com:8443/x", "https://localhost/x", "https://svc.internal/x", "https://169.254.169.254/latest", "https://10.0.0.5/x", "https://[::1]/x", "not a url"]) {
      const d = await sendWebhook(u, "x", { resolve: publicResolve, transport });
      expect(d.ok, u).toBe(false);
    }
    // a public-looking name that resolves to a private address, or to a mix
    expect((await sendWebhook("https://evil.example.com/x", "x", { resolve: async () => ["192.168.1.10"], transport })).ok).toBe(false);
    expect((await sendWebhook("https://evil.example.com/x", "x", { resolve: async () => ["93.184.216.34", "127.0.0.1"], transport })).ok).toBe(false);
    expect((await sendWebhook("https://evil.example.com/x", "x", { resolve: async () => [], transport })).ok).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
  it("a failure is returned, never thrown (timeout, 500, redirect, network)", async () => {
    const t = (r: { status: number } | { error: string }): PostTransport => async () => r;
    for (const r of [{ error: "timeout" }, { status: 500 }, { status: 302 }, { error: "network error" }]) {
      const d = await sendWebhook("https://hooks.example.com/x", "x", { resolve: publicResolve, transport: t(r) });
      expect(d.ok).toBe(false);
    }
    const boom: PostTransport = async () => { throw new Error("secret https://hooks.example.com/x"); };
    const d = await sendWebhook("https://hooks.example.com/x", "x", { resolve: publicResolve, transport: boom });
    expect(d).toEqual({ ok: false, reason: "The webhook could not be called." });
  });
  it("one message with counts and a link; names only when given, and escaped", () => {
    const m = buildMessage({ edited: 3, removed: 1, link: "https://app.example.com/team/health" });
    expect(m).toBe("SignCraft signature health: 4 new findings (3 edited, 1 removed). Review: https://app.example.com/team/health");
    expect(buildMessage({ edited: 1, removed: 0, link: "https://a/b" })).toContain("1 new finding (1 edited)");
    const n = buildMessage({ edited: 1, removed: 0, link: "https://a/b", names: ["Ada <!channel> & co (edited)"] });
    expect(n).toContain("Ada &lt;!channel&gt; &amp; co");
    expect(n).not.toContain("<!channel>");
    expect(m).not.toMatch(/@|Ada/);
  });
});

/* ------------------------------------------------------------------------ service bits */

describe("healthStatus and maskWebhook", () => {
  it("names the missing variables and never values", () => {
    const s = healthStatus({});
    expect(s.configured).toBe(false);
    expect(s.missing).toEqual(["GOOGLE_SERVICE_ACCOUNT_JSON"]);
    expect(s.unattended_missing).toEqual(["HEALTH_CRON_SECRET (at least 32 characters)", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(healthStatus({ HEALTH_CRON_SECRET: "short" }).unattended_ready).toBe(false);
  });
  it("hides the secret part of a webhook address", () => {
    expect(maskWebhook("https://hooks.slack.com/services/T000/B000/SECRETSECRET")).toBe("https://hooks.slack.com/…");
    expect(maskWebhook(null)).toBeNull();
  });
});

describe("expectedFrom", () => {
  it("falls back to null (use the baseline) when the data cannot be loaded", async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
    const c = { ...cand(1), version_id: "v1", new_hash: "a".repeat(64) };
    const out = await expectedFrom(failing as never, "org")([c]);
    expect(out.get(c.person_id)).toBeNull();
  });
  it("does not even query for people without a planned version", async () => {
    const from = vi.fn();
    const out = await expectedFrom({ from } as never, "org")([cand(1)]);
    expect(from).not.toHaveBeenCalled();
    expect(out.get(cand(1).person_id)).toBeNull();
  });
});

/* ------------------------------------------------------- expected text, rebuilt for real */

const DOC = {
  version: 1,
  template_id: "classic",
  theme: { primary: "#1E3A8A", text: "#111827", muted: "#6B7280", bg: "#FFFFFF", accent2: "#F4C542", font: "Arial", spacing: "normal" },
  blocks: [{ type: "identity", name: "Template Name", title: "T" }],
};
const snapshot = { name: "T", doc: DOC, lock: { editable: [] }, field_map: { "0.name": "full_name" } };
const PERSON = { id: "00000000-0000-0000-0000-000000000001", email: "p1@example.com", full_name: "Ada Lovelace", first_name: "", last_name: "", title: "", department: "", phone: "", mobile: "", location: "", custom: {} };
const VERSION = { id: "10000000-0000-0000-0000-000000000001", person_id: PERSON.id, template_snapshot: snapshot, values_json: {} };

function fakeClient(person: Record<string, unknown>) {
  return {
    from: (table: string) => ({ select: () => ({ eq: () => ({ in: async () => ({ data: table === "people" ? [person] : [VERSION], error: null }) }) }) }),
  };
}

describe("expectedFrom with a real render", () => {
  it("uses the rebuilt text only when it hashes to exactly what was deployed", async () => {
    const { renderVersion } = await import("@/lib/team/render");
    const sent = renderVersion(VERSION, PERSON);
    expect(sent.ok).toBe(true);
    const html = (sent as { html: string }).html;
    const c = { ...cand(1), person_id: PERSON.id, version_id: VERSION.id, new_hash: signatureHash(html) };
    const same = await expectedFrom(fakeClient(PERSON) as never, "org")([c]);
    expect(same.get(PERSON.id)).toBe(textFingerprint(html));
    expect(normalizeText(html)).toContain("Ada Lovelace");
    // the directory entry changed after the deployment: the rebuild is no longer what was sent, so it must NOT be trusted
    const changed = await expectedFrom(fakeClient({ ...PERSON, full_name: "Ada King" }) as never, "org")([c]);
    expect(changed.get(PERSON.id)).toBeNull();
  });
});
