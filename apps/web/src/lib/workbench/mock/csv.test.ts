import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv.ts";

describe("csvCell", () => {
  it("neutralises formula-leading strings", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\tx")).toBe("'\tx");
  });

  it("keeps numbers as numbers, so a negative number is not a formula", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("neutralises a numeric-looking string that starts with a minus", () => {
    expect(csvCell("-5")).toBe("'-5");
  });

  it("quotes cells containing a comma, quote, CR or LF and doubles quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\rb")).toBe('"a\rb"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("applies the formula prefix before quoting", () => {
    expect(csvCell("\rx")).toBe("\"'\rx\"");
    expect(csvCell("=a,b")).toBe("\"'=a,b\"");
  });

  it("writes non-finite numbers and missing values as empty cells", () => {
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  it("writes booleans as yes / no", () => {
    expect(csvCell(true)).toBe("yes");
    expect(csvCell(false)).toBe("no");
  });
});

describe("toCsv", () => {
  it("joins rows with LF and has no trailing newline or BOM", () => {
    const csv = toCsv(["a", "b"], [
      ["x", 1],
      ["y", true],
    ]);
    expect(csv).toBe("a,b\nx,1\ny,yes");
    expect(csv.endsWith("\n")).toBe(false);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv).not.toContain("\r\n");
  });

  it("escapes the header like any other row", () => {
    expect(toCsv(["name, full", "=h"], [])).toBe("\"name, full\",'=h");
  });

  it("keeps multi-line cells inside one quoted field", () => {
    expect(toCsv(["note"], [["line1\nline2"]])).toBe('note\n"line1\nline2"');
  });
});
