import { describe, expect, it } from "vitest";
import { SourceError } from "../adapter.ts";
import { parseCsv } from "./parse.ts";

describe("parseCsv", () => {
  it("splits a simple grid into headers and data rows", () => {
    const result = parseCsv("keyword,volume\nseo tools,1200\nlink building,800\n");
    expect(result.headers).toEqual(["keyword", "volume"]);
    expect(result.rows).toEqual([
      ["seo tools", "1200"],
      ["link building", "800"],
    ]);
  });

  it("keeps commas inside a quoted field", () => {
    const result = parseCsv('a,"b,c",d\n1,"2,3",4\n');
    expect(result.headers).toEqual(["a", "b,c", "d"]);
    expect(result.rows).toEqual([["1", "2,3", "4"]]);
  });

  it("keeps a newline embedded in a quoted field", () => {
    const result = parseCsv('kw,note\n"multi\nline","x"\n');
    expect(result.rows).toEqual([["multi\nline", "x"]]);
  });

  it('unescapes doubled "" quotes inside a quoted field', () => {
    const result = parseCsv('kw,note\n"he said ""hi""",y\n');
    expect(result.rows).toEqual([['he said "hi"', "y"]]);
  });

  it("handles CRLF line endings and a trailing empty field", () => {
    const result = parseCsv("a,b\r\n1,\r\n");
    expect(result.headers).toEqual(["a", "b"]);
    expect(result.rows).toEqual([["1", ""]]);
  });

  it("skips fully blank lines but keeps all-empty delimited rows", () => {
    const result = parseCsv("a,b\n\n1,2\n,\n");
    expect(result.rows).toEqual([
      ["1", "2"],
      ["", ""],
    ]);
  });

  it("parses a final row without a trailing newline", () => {
    const result = parseCsv("a,b\n1,2");
    expect(result.rows).toEqual([["1", "2"]]);
  });

  it("returns empty headers and rows for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });

  it("throws INVALID_CONFIGURATION past the data-row cap", () => {
    const text = "h\n" + "x\n".repeat(5);
    try {
      parseCsv(text, { maxDataRows: 3 });
      throw new Error("expected parseCsv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceError);
      expect((error as SourceError).code).toBe("INVALID_CONFIGURATION");
    }
  });
});
