import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mustFailClosed, updateSession } from "./middleware";

afterEach(() => vi.unstubAllEnvs());

describe("mustFailClosed: a server without Supabase must not serve the private app", () => {
  it("in production, private routes fail closed", () => {
    expect(mustFailClosed("/create", { NODE_ENV: "production" })).toBe(true);
    expect(mustFailClosed("/admin/users", { NODE_ENV: "production" })).toBe(true);
    expect(mustFailClosed("/api/upload", { NODE_ENV: "production" })).toBe(true);
  });
  it("public routes are left alone", () => {
    expect(mustFailClosed("/login", { NODE_ENV: "production" })).toBe(false);
    expect(mustFailClosed("/c/someone", { NODE_ENV: "production" })).toBe(false);
  });
  it("development keeps the login-free local editor", () => {
    expect(mustFailClosed("/create", { NODE_ENV: "development" })).toBe(false);
    expect(mustFailClosed("/create", {})).toBe(false);
  });
  it("a deployment can opt in to the login-free editor on purpose", () => {
    expect(mustFailClosed("/create", { NODE_ENV: "production", ALLOW_LOCAL_MODE: "true" })).toBe(false);
  });
});

describe("updateSession without Supabase variables", () => {
  const req = (path: string) => new NextRequest(`http://localhost${path}`);

  it("production: private pages and APIs answer 503 instead of opening up", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    for (const path of ["/create", "/editor", "/admin/users", "/api/upload"]) {
      const res = await updateSession(req(path));
      expect(res.status, path).toBe(503);
      expect(await res.json()).toMatchObject({ error: "not_configured" });
    }
  });

  it("development: the local-only editor still opens", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const res = await updateSession(req("/create"));
    expect(res.status).toBe(200);
  });
});
