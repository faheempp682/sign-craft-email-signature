import { describe, expect, it } from "vitest";
import { csvCell, detectDelimiter, guardCell, parseCsv, toCsv, unguardCell } from "./csv";

describe("parseCsv", () => {
  it("reads plain rows with LF, CRLF and CR endings", () => {
    for (const nl of ["\n", "\r\n", "\r"]) {
      expect(parseCsv(`a,b${nl}1,2${nl}3,4${nl}`).records).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    }
  });

  it("handles quoted commas, doubled quotes and newlines inside quotes", () => {
    const r = parseCsv('name,note\n"Lee, Ann","said ""hi"""\n"Bob","line1\nline2"\n').records;
    expect(r[1]).toEqual(["Lee, Ann", 'said "hi"']);
    expect(r[2]).toEqual(["Bob", "line1\nline2"]);
  });

  it("strips a byte-order mark", () => {
    expect(parseCsv("﻿email,name\na@x.com,A").records[0]).toEqual(["email", "name"]);
  });

  it("detects semicolons and tabs, and not commas that sit inside quotes", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter('"a,b";c\n"1,2";3')).toBe(";");
    expect(detectDelimiter("just one column")).toBe(",");
    expect(parseCsv("a;b\n1;2").records).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps empty fields, drops blank lines, and copes with a missing final newline", () => {
    expect(parseCsv("a,b,c\n\n1,,3\n,,\n4,5,6").records).toEqual([["a", "b", "c"], ["1", "", "3"], ["", "", ""], ["4", "5", "6"]]);
    expect(parseCsv('a,b\n"",x').records[1]).toEqual(["", "x"]);
  });

  it("flags a quote that never closes", () => {
    const r = parseCsv('a,b\n1,"oops\n2,3');
    expect(r.unterminatedQuote).toBe(true);
  });

  it("does not treat a quote in the middle of a field as an opener", () => {
    expect(parseCsv('a,b\n5" pipe,x').records[1]).toEqual(['5" pipe', "x"]);
  });
});

describe("writing", () => {
  it("neutralises spreadsheet formulas and quotes special characters", () => {
    for (const bad of ["=1+1", "+44 20 7946", "-2", "@SUM(A1)", "\tcmd", "=HYPERLINK(\"http://evil\")"]) expect(guardCell(bad).startsWith("'")).toBe(true);
    expect(guardCell("Ann")).toBe("Ann");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  });

  it("round-trips through parse, undoing the guard on the way back in", () => {
    const text = toCsv(["name", "phone", "note"], [["Ann, Lee", "+1 555 0100", "a\nb"], ["=evil", "", 'q"']]);
    const back = parseCsv(text).records;
    expect(back[1][0]).toBe("Ann, Lee");
    expect(unguardCell(back[1][1])).toBe("+1 555 0100");
    expect(back[1][2]).toBe("a\nb");
    expect(back[2][0]).toBe("'=evil"); // still guarded in the raw text
    expect(unguardCell(back[2][0])).toBe("=evil");
    expect(unguardCell("'Neil")).toBe("'Neil"); // an ordinary apostrophe is left alone
  });
});
