import { describe, expect, it } from "vitest";
import { MAX_CSV_ROWS } from "./csv";
import { autoMap, dryRun, normalizePerson, previewCsv, validateMapping } from "./people";

const none = new Set<string>();
const MESSY =
  "﻿E-mail;Full Name;Job Title;Dept;Mobile Phone;Badge No\r\n" +
  'ann@example.com;"Lee, Ann";Engineer;Sales;+44 20 7946 0000;7\r\n' +
  "ANN@example.com;Ann Again;Dup;Sales;;8\r\n" +
  "not-an-email;Bad Mail;x;y;;\r\n" +
  ";No Email;x;y;;\r\n" +
  "bob@example.com;;Chef;Ops;;9\r\n" +
  `cy@example.com;${"X".repeat(130)};T;;;\r\n` +
  'dee@example.com;"Dee\nTwo Lines";=SUM(A1);Ops;;1\r\n';

describe("autoMap", () => {
  it("recognises common header names, each target once", () => {
    const m = autoMap(["E-mail", "Full Name", "Job Title", "Dept", "Mobile Phone", "Badge No", "Name"]);
    expect(m[0]).toBe("email");
    expect(m[1]).toBe("full_name");
    expect(m[2]).toBe("title");
    expect(m[3]).toBe("department");
    expect(m[5]).toBe("");
    expect(m[6]).toBe(""); // "Name" is not matched twice
  });
  it("maps first and last name", () => {
    const m = autoMap(["Email Address", "First Name", "Surname", "Telephone", "Cell"]);
    expect(Object.values(m)).toEqual(["email", "first_name", "last_name", "phone", "mobile"]);
  });
});

describe("validateMapping", () => {
  it("requires an email and a name, and refuses duplicates and bad custom keys", () => {
    expect(validateMapping({ 0: "full_name" }, 1)).toMatch(/email/);
    expect(validateMapping({ 0: "email" }, 1)).toMatch(/name/);
    expect(validateMapping({ 0: "email", 1: "email", 2: "full_name" }, 3)).toMatch(/two columns/);
    expect(validateMapping({ 0: "email", 1: "full_name", 2: "custom:Bad Key" }, 3)).toMatch(/valid custom/);
    expect(validateMapping({ 0: "email", 1: "full_name", 9: "title" }, 3)).toMatch(/does not exist/);
    expect(validateMapping({ 0: "email", 1: "last_name", 2: "custom:badge" }, 3)).toBeNull();
  });
});

describe("normalizePerson", () => {
  it("lower-cases the email, builds the name from first and last, and limits custom fields", () => {
    const r = normalizePerson({ email: " Ann@X.com ", first_name: "Ann", last_name: "Lee" });
    expect(r).toMatchObject({ ok: true, person: { email: "ann@x.com", full_name: "Ann Lee" } });
    expect(normalizePerson({ email: "a@x.com" })).toMatchObject({ ok: false, field: "full_name" });
    expect(normalizePerson({ email: "nope", full_name: "A" })).toMatchObject({ ok: false, field: "email" });
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"]));
    expect(normalizePerson({ email: "a@x.com", full_name: "A", custom: many })).toMatchObject({ ok: false });
  });
});

describe("dryRun on a deliberately messy file", () => {
  const mapping = { ...autoMap(["E-mail", "Full Name", "Job Title", "Dept", "Mobile Phone", "Badge No"]), 5: "custom:badge" };
  const r = dryRun(MESSY, mapping, new Set(["bob@example.com"]));

  it("detects the delimiter and the header", () => {
    expect(r.fatal).toBeNull();
    expect(r.delimiter).toBe(";");
    expect(r.headers[0]).toBe("E-mail");
    expect(r.totalRows).toBe(7);
  });

  it("accepts good rows and tells creates from updates", () => {
    const byEmail = Object.fromEntries(r.valid.map((v) => [v.person.email, v]));
    expect(byEmail["ann@example.com"].action).toBe("create");
    expect(byEmail["ann@example.com"].person.full_name).toBe("Lee, Ann");
    expect(byEmail["ann@example.com"].person.custom).toEqual({ badge: "7" });
    expect(byEmail["dee@example.com"].person.full_name).toBe("Dee\nTwo Lines");
    expect(byEmail["dee@example.com"].person.title).toBe("=SUM(A1)"); // stored as text, never evaluated
  });

  it("reports row-level errors with spreadsheet row numbers (header is row 1)", () => {
    const e = (row: number) => r.errors.filter((x) => x.row === row).map((x) => `${x.field}:${x.message}`);
    expect(e(3)[0]).toMatch(/^email:Duplicate of row 2/);
    expect(e(4)[0]).toMatch(/^email:Enter a valid email/);
    expect(e(5)[0]).toMatch(/^email:/);
    expect(e(6)[0]).toMatch(/^full_name:A name is required/);
    expect(e(7)[0]).toMatch(/^full_name:/);
    expect(r.rowsWithErrors).toBe(5);
    expect(r.valid.map((v) => v.row)).toEqual([2, 8]);
    expect(r.valid.length + r.rowsWithErrors).toBe(r.totalRows);
  });

  it("marks existing people as updates", () => {
    const upd = dryRun("email,name\nbob@example.com,Bob\nnew@example.com,New", { 0: "email", 1: "full_name" }, new Set(["bob@example.com"]));
    expect(upd.updates).toBe(1);
    expect(upd.creates).toBe(1);
  });
});

describe("dryRun limits and refusals", () => {
  const map = { 0: "email", 1: "full_name" };
  it("refuses an empty file, a header only, and a bad mapping", () => {
    expect(dryRun("", map, none).fatal).toMatch(/empty/);
    expect(dryRun("email,name\n", map, none).fatal).toMatch(/no people/);
    expect(dryRun("email,name\na@x.com,A", { 0: "email" }, none).fatal).toMatch(/name/);
  });
  it("refuses more than 5000 rows and more than 2 MB", () => {
    const big = "email,name\n" + Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `p${i}@x.com,P`).join("\n");
    expect(dryRun(big, map, none).fatal).toMatch(/5000/);
    expect(previewCsv(big).fatal).toMatch(/5000/);
    const ok = "email,name\n" + Array.from({ length: MAX_CSV_ROWS }, (_, i) => `p${i}@x.com,P`).join("\n");
    expect(dryRun(ok, map, none).valid).toHaveLength(MAX_CSV_ROWS);
    expect(dryRun("email,name\n" + "x".repeat(2 * 1024 * 1024), map, none).fatal).toMatch(/2 MB/);
  });
  it("reports an unclosed quote and a row with too many values", () => {
    expect(dryRun('email,name\na@x.com,"oops', map, none).fatal).toMatch(/never closed/);
    const r = dryRun("email,name\na@x.com,A,extra,more\nb@x.com,B", map, none);
    expect(r.errors[0].message).toMatch(/values/);
    expect(r.valid).toHaveLength(1);
  });
  it("undoes the export guard so a re-import keeps phone numbers", () => {
    const r = dryRun("email,name,phone\na@x.com,A,'+1 555 0100", { 0: "email", 1: "full_name", 2: "phone" }, none);
    expect(r.valid[0].person.phone).toBe("+1 555 0100");
  });
  it("never fetches or runs anything: a hostile cell is plain text", () => {
    const r = dryRun('email,name,title\na@x.com,"<script>alert(1)</script>",=cmd|calc', { 0: "email", 1: "full_name", 2: "title" }, none);
    expect(r.valid[0].person.full_name).toBe("<script>alert(1)</script>");
  });
});
