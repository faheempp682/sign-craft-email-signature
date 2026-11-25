import { vi } from "vitest";
import type { GoogleConfig } from "./config";
import { GMAIL_SETTINGS_SCOPE } from "./config";

/** Test support only: a fake Google (token, revoke and Gmail endpoints) and an in-memory stand-in for the service-role database. */

export const KEY = Buffer.alloc(32, 3);
export const CLIENT_ID = "client-123.apps.googleusercontent.com";

export const testConfig = (over: Partial<GoogleConfig> = {}): GoogleConfig => ({
  clientId: CLIENT_ID,
  clientSecret: "client-secret-value",
  key: KEY,
  domains: ["kimp.xyz"],
  redirectUri: "http://localhost:3000/api/google/callback",
  ...over,
});

/** An id_token with the given claims. Unsigned: our code only reads the claims (it came straight from Google's token endpoint). */
export function idToken(claims: Record<string, unknown> = {}): string {
  const body = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-sub-1",
    email: "jane@kimp.xyz",
    email_verified: true,
    hd: "kimp.xyz",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  return `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(body)).toString("base64url")}.sig`;
}

export type Raw = { sendAsEmail: string; displayName?: string; isPrimary?: boolean; isDefault?: boolean; signature?: string; verificationStatus?: string };
export type Seen = { url: string; method: string; headers: Record<string, string>; body: string };

export function fakeGoogle() {
  const s = {
    exchange: { status: 200, body: { access_token: "access-1", refresh_token: "refresh-1", id_token: idToken(), scope: `openid email ${GMAIL_SETTINGS_SCOPE}`, expires_in: 3600 } as Record<string, unknown> },
    refresh: { status: 200, body: { access_token: "access-1", expires_in: 3600 } as Record<string, unknown> },
    revoke: { status: 200, body: {} as Record<string, unknown>, throws: false },
    revoked: [] as string[],
    addresses: new Map<string, Raw>([["jane@kimp.xyz", { sendAsEmail: "jane@kimp.xyz", displayName: "Jane Doe", isPrimary: true, isDefault: true, signature: "<p>old signature</p>" }]]),
    /** Applies to every Gmail call, or just PATCH. */
    gmailFail: null as null | { status: number; body?: unknown },
    patchFail: null as null | { status: number; body?: unknown },
    networkDown: false,
    seen: [] as Seen[],
  };

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = init.body instanceof URLSearchParams ? init.body.toString() : String(init.body ?? "");
    s.seen.push({ url, method, headers, body });
    if (s.networkDown) throw new TypeError("fetch failed");

    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const form = new URLSearchParams(body);
      return form.get("grant_type") === "refresh_token" ? json(s.refresh.status, s.refresh.body) : json(s.exchange.status, s.exchange.body);
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
      if (s.revoke.throws) throw new TypeError("fetch failed");
      s.revoked.push(new URLSearchParams(body).get("token") ?? "");
      return json(s.revoke.status, s.revoke.body);
    }

    const base = "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs";
    if (url.startsWith(base)) {
      if (headers.Authorization !== "Bearer access-1") return json(401, { error: { code: 401, status: "UNAUTHENTICATED" } });
      if (s.gmailFail) return json(s.gmailFail.status, s.gmailFail.body ?? { error: { message: "failure" } });
      const rest = url.slice(base.length);
      if (rest === "") return json(200, { sendAs: [...s.addresses.values()] });
      const email = decodeURIComponent(rest.slice(1));
      const a = s.addresses.get(email);
      if (!a) return json(404, { error: { code: 404, status: "NOT_FOUND" } });
      if (method === "PATCH") {
        if (s.patchFail) return json(s.patchFail.status, s.patchFail.body ?? { error: { message: "failure" } });
        a.signature = (JSON.parse(body) as { signature: string }).signature;
      }
      return json(200, a);
    }
    throw new Error(`fakeGoogle: unexpected request ${method} ${url}`);
  });

  return { fetch: fn as unknown as typeof fetch, mock: fn, s, patches: () => s.seen.filter((x) => x.method === "PATCH") };
}

export type Row = Record<string, unknown>;

/** Minimal in-memory version of the two tables the server writes with the service role. */
export function fakeAdmin() {
  const store = { connections: new Map<string, Row>(), log: [] as Row[], failSave: false, failLog: false, failDelete: false };
  const from = (table: string) => {
    if (table === "google_connections") {
      return {
        upsert: async (row: Row) => {
          if (store.failSave) return { error: { message: "boom" } };
          store.connections.set(String(row.user_id), { ...row });
          return { error: null };
        },
        select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: store.connections.get(id) ?? null, error: null }) }) }),
        update: (vals: Row) => ({
          eq: (_c: string, id: string) => {
            const row = store.connections.get(id);
            if (row) Object.assign(row, vals);
            return Promise.resolve({ error: null });
          },
        }),
        delete: () => ({
          eq: async (_c: string, id: string) => {
            if (store.failDelete) return { error: { message: "boom" } };
            store.connections.delete(id);
            return { error: null };
          },
        }),
      };
    }
    if (table === "gmail_push_log") {
      return {
        insert: async (row: Row) => {
          if (store.failLog) return { error: { message: "boom" } };
          store.log.push(row);
          return { error: null };
        },
      };
    }
    throw new Error(`fakeAdmin: unexpected table ${table}`);
  };
  return { from, store } as { from: typeof from; store: typeof store } & Record<string, unknown>;
}
