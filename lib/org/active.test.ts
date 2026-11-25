import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/authz/db-harness";
import { listActableOrgs, pickAgencyOrg, resolveActiveOrg, switcherVisible, type ActableOrg } from "./active";

/**
 * resolveActiveOrg against the real database: a tiny stand-in for the Supabase client runs each query AS the caller
 * in PGlite, so the memberships query and the is_org_admin / is_org_member checks go through the real functions and RLS.
 */

let t: TestDb;
let n = 0;

type Filter = [string, unknown];
function clientFor(userId: string) {
  const run = <T>(sql: string, params: unknown[]) => t.as(userId, async () => (await t.db.query<T>(sql, params)).rows);
  return {
    from(table: string) {
      const filters: Filter[] = [];
      let cols = "*";
      const b = {
        select(c: string) {
          cols = c;
          return b;
        },
        eq(k: string, v: unknown) {
          filters.push([k, v]);
          return b;
        },
        then(ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) {
          const where = filters.length ? " where " + filters.map(([k], i) => `${k} = $${i + 1}`).join(" and ") : "";
          return run(`select ${cols} from public.${table}${where} order by created_at, org_id`, filters.map(([, v]) => v)).then((data) => ({ data, error: null })).then(ok, bad);
        },
      };
      return b;
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args);
      const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
      try {
        if (fn === "my_orgs") return { data: await run(`select * from ${call}`, keys.map((k) => args[k])), error: null };
        const r = await run<{ v: unknown }>(`select ${call} as v`, keys.map((k) => args[k]));
        return { data: r[0].v, error: null };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    },
  } as never;
}

const person = async (org: string | null, role: "member" | "admin" = "member") => {
  const id = await t.addUser(`a${++n}@example.com`);
  await t.db.query("delete from public.memberships where user_id = $1", [id]);
  if (org) await t.db.query("insert into public.memberships (org_id, user_id, role) values ($1,$2,$3)", [org, id, role]);
  return id;
};
const org = async (name: string, parent: string | null = null) => (await t.db.query<{ id: string }>("insert into public.organizations (name, parent_id) values ($1,$2) returning id", [name, parent])).rows[0].id;

let agency: string, c1: string, c2: string, solo: string, other: string;
let aAdmin: string, aMember: string, c1Admin: string, soloAdmin: string, otherAdmin: string, twoOrgs: string;

beforeAll(async () => {
  t = await createTestDb();
  agency = await org("Agency");
  c1 = await org("C1", agency);
  c2 = await org("C2", agency);
  solo = await org("Solo");
  other = await org("Other");
  aAdmin = await person(agency, "admin");
  aMember = await person(agency, "member");
  c1Admin = await person(c1, "admin");
  soloAdmin = await person(solo, "admin");
  otherAdmin = await person(other, "admin");
  twoOrgs = await person(solo, "admin");
  await t.db.query("insert into public.memberships (org_id, user_id, role) values ($1,$2,'admin')", [other, twoOrgs]);
}, 60_000);
afterAll(async () => {
  await t.db.close();
});

const admin = (user: string, o: { requested?: string; cookie?: string } = {}) => resolveActiveOrg(clientFor(user), user, { admin: true, ...o });
const member = (user: string, o: { requested?: string; cookie?: string } = {}) => resolveActiveOrg(clientFor(user), user, { admin: false, ...o });

describe("resolveActiveOrg: nothing remembered, nothing requested (exactly today's behaviour)", () => {
  it("a person in one organization gets that organization, as an admin or a member", async () => {
    expect(await admin(soloAdmin)).toBe(solo);
    expect(await member(soloAdmin)).toBe(solo);
    expect(await member(aMember)).toBe(agency);
  });

  it("a plain member administers nothing; a person with no membership gets null", async () => {
    expect(await admin(aMember)).toBeNull();
    expect(await admin(await person(null))).toBeNull();
    expect(await member(await person(null))).toBeNull();
  });

  it("an agency admin's default is the agency itself, not a client", async () => {
    expect(await admin(aAdmin)).toBe(agency);
  });

  it("with several own organizations the default is one of them, as before (the old query had no order either)", async () => {
    expect([solo, other]).toContain(await admin(twoOrgs));
  });
});

describe("resolveActiveOrg: the cookie is a request, never a grant", () => {
  it("an agency admin may work inside a client", async () => {
    expect(await admin(aAdmin, { cookie: c1 })).toBe(c1);
    expect(await member(aAdmin, { cookie: c2 })).toBe(c2);
  });

  it("a person with several organizations may pick any of them", async () => {
    expect(await admin(twoOrgs, { cookie: other })).toBe(other);
  });

  it("a cookie for an organization they may not act in is ignored, silently", async () => {
    expect(await admin(soloAdmin, { cookie: other })).toBe(solo); // somebody else's organization
    expect(await admin(soloAdmin, { cookie: c1 })).toBe(solo); // a client of somebody else's agency
    expect(await admin(c1Admin, { cookie: agency })).toBe(c1); // a client cannot step up into its agency
    expect(await admin(c1Admin, { cookie: c2 })).toBe(c1); // nor sideways
    expect(await admin(aMember, { cookie: c1 })).toBeNull(); // a plain agency member is no admin anywhere
    expect(await member(aMember, { cookie: c1 })).toBe(agency); // and is not a member of the client
    expect(await member(soloAdmin, { cookie: "00000000-0000-4000-8000-000000000000" })).toBe(solo); // an id that does not exist
  });

  it("a person with no organizations gets nothing, whatever the cookie says", async () => {
    expect(await admin(await person(null), { cookie: c1 })).toBeNull();
  });
});

describe("resolveActiveOrg: an explicit request is never redirected", () => {
  it("is honoured when allowed (own, or a client for the agency's admin)", async () => {
    expect(await admin(aAdmin, { requested: c2 })).toBe(c2);
    expect(await admin(twoOrgs, { requested: other })).toBe(other);
  });

  it("is refused (null), not replaced by a default, when not allowed", async () => {
    expect(await admin(c1Admin, { requested: c2 })).toBeNull();
    expect(await admin(c1Admin, { requested: agency })).toBeNull();
    expect(await admin(soloAdmin, { requested: other })).toBeNull();
    expect(await admin(aMember, { requested: c1 })).toBeNull();
    expect(await admin(soloAdmin, { requested: "not-a-uuid" })).toBeNull();
  });

  it("wins over the cookie", async () => {
    expect(await admin(aAdmin, { requested: c2, cookie: c1 })).toBe(c2);
    expect(await admin(aAdmin, { requested: "00000000-0000-4000-8000-000000000000", cookie: c1 })).toBeNull();
  });
});

describe("listActableOrgs and the switcher rule", () => {
  it("an agency admin lists the agency and its clients; a person in one organization lists one", async () => {
    const list = await listActableOrgs(clientFor(aAdmin));
    expect(list.map((o) => o.id).sort()).toEqual([agency, c1, c2].sort());
    expect(list.find((o) => o.id === c1)).toMatchObject({ viaAgency: true, role: "admin", parentId: agency });
    const one = await listActableOrgs(clientFor(soloAdmin));
    expect(one).toHaveLength(1);
    expect(switcherVisible(one)).toBe(false);
    expect(switcherVisible(list)).toBe(true);
  });

  it("fails closed: an error gives an empty list", async () => {
    expect(await listActableOrgs({ rpc: async () => ({ data: null, error: { message: "x" } }) } as never)).toEqual([]);
    expect(await listActableOrgs({ rpc: async () => { throw new Error("boom"); } } as never)).toEqual([]);
  });
});

describe("pickAgencyOrg", () => {
  const o = (id: string, parentId: string | null, viaAgency = false, role: ActableOrg["role"] = "admin"): ActableOrg => ({ id, name: id, parentId, planId: null, role, viaAgency });
  const list = [o("A", null), o("C1", "A", true), o("Z", null)];
  it("picks the active top-level organization, the parent of an active client, or the first top-level admin org", () => {
    expect(pickAgencyOrg(list, "Z")).toBe("Z");
    expect(pickAgencyOrg(list, "C1")).toBe("A");
    expect(pickAgencyOrg(list, null)).toBe("A");
    expect(pickAgencyOrg([o("M", null, false, "member")], null)).toBeNull();
    expect(pickAgencyOrg([o("C1", "A", true)], "C1")).toBeNull(); // cannot name an agency they do not administer directly
  });
});
