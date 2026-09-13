import { describe, expect, it } from "vitest";
import { ARTIFACT_TYPES } from "../enums.ts";
import { SAMPLE_CSV_MARKER, stampArtifact } from "./provenance.ts";

const LINE = "Sample data: generated locally at 2026-09-13 10:00";

function parseObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

describe("stampArtifact", () => {
  it("csv: marker line, then the notice as a comment, then the body", () => {
    const out = stampArtifact("csv", "a,b\n1,2", LINE);
    const lines = out.split("\n");
    expect(SAMPLE_CSV_MARKER).toBe("# sample-data");
    expect(lines[0]).toBe(SAMPLE_CSV_MARKER);
    expect(lines[1]).toBe(`# ${LINE}`);
    expect(lines.slice(2).join("\n")).toBe("a,b\n1,2");
  });

  it("md: the notice, a blank line, then the body", () => {
    const out = stampArtifact("md", "# Title\nbody", LINE);
    expect(out).toBe(`${LINE}\n\n# Title\nbody`);
    expect(out.split("\n")[0]).toBe(LINE);
  });

  it("prompt: the notice, a blank line, then the body", () => {
    const out = stampArtifact("prompt", "# 任务\n做事", LINE);
    expect(out).toBe(`${LINE}\n\n# 任务\n做事`);
    expect(out.split("\n")[0]).toBe(LINE);
  });

  it("json: _sampleData is the first key and the other keys are kept", () => {
    const body = JSON.stringify({ brand: "Acme", nested: { x: 1 } });
    const out = stampArtifact("json", body, LINE);
    const parsed = parseObject(out);
    expect(Object.keys(parsed)).toEqual(["_sampleData", "brand", "nested"]);
    expect(parsed["_sampleData"]).toBe(LINE);
    expect(parsed["nested"]).toEqual({ x: 1 });
    expect(out.split("\n")[0]).toBe("{");
    expect(out.split("\n")[1]).toBe(`  "_sampleData": ${JSON.stringify(LINE)},`);
    expect(out).toBe(
      JSON.stringify(
        { _sampleData: LINE, brand: "Acme", nested: { x: 1 } },
        null,
        2,
      ),
    );
  });

  it("json: a body key named _sampleData cannot overwrite the notice", () => {
    const body = '{"_sampleData":"Verified production result","a":1}';
    const out = stampArtifact("json", body, LINE);
    const parsed = parseObject(out);
    expect(parsed["_sampleData"]).toBe(LINE);
    expect(parsed["a"]).toBe(1);
    expect(Object.keys(parsed)).toEqual(["_sampleData", "a"]);
    expect(out).not.toContain("Verified production result");
  });

  it("json: integer-like top-level keys still come first, and the notice is still there", () => {
    const parsed = parseObject(stampArtifact("json", '{"a":1,"10":"x"}', LINE));
    expect(Object.keys(parsed)).toEqual(["10", "_sampleData", "a"]);
    expect(parsed["_sampleData"]).toBe(LINE);
    expect(parsed["10"]).toBe("x");
  });

  it("json: keeps a __proto__ key as plain data", () => {
    const out = stampArtifact("json", '{"__proto__":{"x":1},"a":1}', LINE);
    const parsed = parseObject(out);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed["a"]).toBe(1);
  });

  for (const body of ["[1,2]", "null", "42", '"text"', "true"]) {
    it(`json: rejects a non-object body ${body}`, () => {
      expect(() => stampArtifact("json", body, LINE)).toThrow(/JSON object/);
    });
  }

  it("json: rejects text that is not JSON", () => {
    expect(() => stampArtifact("json", "not json", LINE)).toThrow();
  });

  for (const type of ARTIFACT_TYPES) {
    it(`${type}: refuses a notice that folds to nothing`, () => {
      for (const line of ["", "   ", "\n\r\n", " \t "]) {
        expect(() => stampArtifact(type, "{}", line)).toThrow(
          "stampArtifact: provenance line is empty",
        );
      }
    });
  }

  it("folds a multi-line notice onto one line", () => {
    const line = "  first\nsecond\r\nthird  ";
    const folded = "first second third";
    expect(stampArtifact("md", "b", line)).toBe(`${folded}\n\nb`);
    expect(stampArtifact("prompt", "b", line).split("\n")[0]).toBe(folded);
    expect(stampArtifact("csv", "b", line)).toBe(
      `${SAMPLE_CSV_MARKER}\n# ${folded}\nb`,
    );
    expect(parseObject(stampArtifact("json", "{}", line))["_sampleData"]).toBe(
      folded,
    );
  });
});
