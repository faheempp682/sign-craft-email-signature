import { describe, expect, it } from "vitest";
import { isEmailAllowed, safeNext, signUpError } from "./auth-utils";

describe("signUpError", () => {
  it("explains the invite-only refusal in plain words", () => {
    expect(signUpError("Database error saving new user")).toMatch(/invitation only/i);
  });
  it("passes every other message through", () => {
    expect(signUpError("Password should be at least 6 characters.")).toBe("Password should be at least 6 characters.");
  });
});

describe("safeNext: where a person lands after signing in", () => {
  it("keeps same-site paths, with their query string", () => {
    expect(safeNext("/editor")).toBe("/editor");
    expect(safeNext("/editor?t=classic&x=1")).toBe("/editor?t=classic&x=1");
    expect(safeNext("/admin/users#top")).toBe("/admin/users#top");
  });

  it("falls back for anything missing or not a string", () => {
    expect(safeNext(undefined)).toBe("/create");
    expect(safeNext(null)).toBe("/create");
    expect(safeNext("")).toBe("/create");
    expect(safeNext(["/a"])).toBe("/create");
    expect(safeNext("/x", "/home")).toBe("/x");
    expect(safeNext("evil", "/home")).toBe("/home");
  });

  it.each([
    "https://evil.com",
    "http://evil.com/x",
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "evil.com",
    // Browsers delete tabs and line breaks anywhere in a URL, so "/<TAB>/evil.com" is "//evil.com" to them.
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\u0000/evil.com",
    "/\u007f/evil.com",
    "/ /evil.com",
  ])("refuses %j", (value) => {
    expect(safeNext(value)).toBe("/create");
  });
});

describe("isEmailAllowed", () => {
  it("allows everyone when no allowlist is set", () => {
    expect(isEmailAllowed("a@anything.com", "")).toBe(true);
  });
  it("allows only listed domains, ignoring case and spaces", () => {
    expect(isEmailAllowed("Jane@KIMP.xyz", " kimp.xyz , example.com ")).toBe(true);
    expect(isEmailAllowed("jane@evil.com", "kimp.xyz")).toBe(false);
    expect(isEmailAllowed("jane@sub.kimp.xyz", "kimp.xyz")).toBe(false);
    expect(isEmailAllowed("no-at-sign", "kimp.xyz")).toBe(false);
  });
});
