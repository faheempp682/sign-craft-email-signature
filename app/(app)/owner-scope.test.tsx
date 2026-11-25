import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Organization admins can read their employees' tagged signatures (migration 0009). These pages must therefore ask
 * for "my" signatures explicitly instead of relying on row-level security to narrow the list.
 */
const seen = vi.hoisted(() => ({ filters: [] as unknown[][], user: { id: "me" } as { id: string } | null }));

vi.mock("@/lib/supabase/server", () => {
  const builder = (): unknown =>
    new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
        if (prop === "maybeSingle") return async () => ({ data: null, error: null });
        return (...args: unknown[]) => {
          seen.filters.push([prop, ...args]);
          return builder();
        };
      },
    });
  return { createClient: async () => ({ from: () => builder(), rpc: async () => ({ data: true, error: null }) }), getUser: async () => seen.user };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => {} }));

import SignaturesPage from "./signatures/page";
import EditorPage from "./editor/page";

const ID = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
beforeEach(() => {
  seen.filters = [];
  seen.user = { id: "me" };
});

describe("signature lists are scoped to the signed-in owner", () => {
  it("the signatures page asks only for the caller's own rows", async () => {
    await SignaturesPage();
    expect(seen.filters).toContainEqual(["eq", "owner_id", "me"]);
  });

  it("the signatures page shows no personal list at all when signed out", async () => {
    seen.user = null;
    await SignaturesPage();
    expect(seen.filters).toHaveLength(0);
  });

  it("the editor opens a signature by id only when the caller owns it", async () => {
    await expect(EditorPage({ searchParams: Promise.resolve({ s: ID }) })).rejects.toThrow("NOT_FOUND"); // the fake finds nothing
    expect(seen.filters).toContainEqual(["eq", "id", ID]);
    expect(seen.filters).toContainEqual(["eq", "owner_id", "me"]);
  });

  it("the editor never loads a signature by id for a signed-out visitor", async () => {
    seen.user = null;
    await expect(EditorPage({ searchParams: Promise.resolve({ s: ID }) })).rejects.toThrow("NOT_FOUND");
    expect(seen.filters).toHaveLength(0);
  });
});
