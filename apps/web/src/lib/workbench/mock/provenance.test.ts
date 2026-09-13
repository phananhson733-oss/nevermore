import { describe, expect, it } from "vitest";
import { ARTIFACT_TYPES } from "../enums.ts";
import { agentTaskWrapper } from "./builders/agent-task.ts";
import { splitFences } from "./builders/prompt-test-helpers.ts";
import { artifactGscData, PROVENANCE_CSV_MARKER, stampArtifact } from "./provenance.ts";

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
    expect(PROVENANCE_CSV_MARKER).toBe("# provenance");
    expect(lines[0]).toBe(PROVENANCE_CSV_MARKER);
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

  it("json: _provenance is the first key and the other keys are kept", () => {
    const body = JSON.stringify({ brand: "Acme", nested: { x: 1 } });
    const out = stampArtifact("json", body, LINE);
    const parsed = parseObject(out);
    expect(Object.keys(parsed)).toEqual(["_provenance", "brand", "nested"]);
    expect(parsed["_provenance"]).toBe(LINE);
    expect(parsed["nested"]).toEqual({ x: 1 });
    expect(out.split("\n")[0]).toBe("{");
    expect(out.split("\n")[1]).toBe(
      `  "_provenance": ${JSON.stringify(LINE)},`,
    );
    expect(out).toBe(
      JSON.stringify(
        { _provenance: LINE, brand: "Acme", nested: { x: 1 } },
        null,
        2,
      ),
    );
  });

  it("json: a body key named _provenance cannot overwrite the notice", () => {
    const body = '{"_provenance":"Verified production result","a":1}';
    const out = stampArtifact("json", body, LINE);
    const parsed = parseObject(out);
    expect(parsed["_provenance"]).toBe(LINE);
    expect(parsed["a"]).toBe(1);
    expect(Object.keys(parsed)).toEqual(["_provenance", "a"]);
    expect(out).not.toContain("Verified production result");
  });

  it("json: a body key named _sampleData, the declaration key before Q36, is dropped", () => {
    const out = stampArtifact("json", '{"_sampleData":"Verified production result","a":1}', LINE);
    expect(Object.keys(parseObject(out))).toEqual(["_provenance", "a"]);
    expect(out).not.toContain("_sampleData");
    expect(out).not.toContain("Verified production result");
  });

  it("json: integer-like top-level keys still come first, and the notice is still there", () => {
    const parsed = parseObject(stampArtifact("json", '{"a":1,"10":"x"}', LINE));
    expect(Object.keys(parsed)).toEqual(["10", "_provenance", "a"]);
    expect(parsed["_provenance"]).toBe(LINE);
    expect(parsed["10"]).toBe("x");
  });

  it("json: keeps a __proto__ key as plain data", () => {
    const out = stampArtifact("json", '{"__proto__":{"x":1},"a":1}', LINE);
    const parsed = parseObject(out);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed["a"]).toBe(1);
  });

  it("json: escapes < so the text cannot close a <script> it is pasted into", () => {
    const brand = "</script><script>alert(1)</script>";
    const line = `${LINE} <b>`;
    const out = stampArtifact("json", JSON.stringify({ brand }), line);
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script>");
    expect(JSON.parse(out)).toEqual({ _provenance: line, brand });
  });

  it("json: escapes the line and paragraph separators and still parses to the same value", () => {
    const text = "a\u2028b\u2029c";
    const out = stampArtifact("json", JSON.stringify({ text }), LINE);
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(out).toContain("a\\u2028b\\u2029c");
    expect(JSON.parse(out)).toEqual({ _provenance: LINE, text });
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
      `${PROVENANCE_CSV_MARKER}\n# ${folded}\nb`,
    );
    expect(parseObject(stampArtifact("json", "{}", line))["_provenance"]).toBe(
      folded,
    );
  });

  /**
   * One canonical text shape for every stamped artifact: LF line endings and no
   * trailing newline (design §6.8 says this of csv; the AI wrapper needs it of
   * all four types). `fenceBlock` rewrites CR and absorbs a final LF, so any
   * other shape reaches the AI with different bytes from the ones copy and
   * export hand out — and "x" and "x\n" wrap to the same prompt.
   */
  const HOSTILE_BODIES: readonly (readonly [string, string])[] = [
    ["CRLF", "a\r\nb"],
    ["a lone CR", "a\rb"],
    ["one trailing LF", "a\nb\n"],
    ["several trailing LFs", "a\nb\n\n\n"],
    ["a trailing CRLF pair", "a\r\n\r\n"],
    ["U+2028", "a\u2028b"],
    ["nothing", ""],
    ["line endings only", "\n\r\n\r"],
  ];

  for (const type of ["md", "prompt", "csv"] as const) {
    for (const [name, body] of HOSTILE_BODIES) {
      it(`${type}: a body with ${name} is stamped canonical and survives the AI wrapper`, () => {
        const out = stampArtifact(type, body, LINE);
        expect(out).not.toMatch(/\r/u);
        expect(out.endsWith("\n")).toBe(false);
        const { blocks } = splitFences(agentTaskWrapper(out));
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.body).toBe(out);
      });
    }
  }

  it("json: the re-serialised text is already canonical and survives the AI wrapper", () => {
    const out = stampArtifact("json", '{"a":"x\\r\\ny\\n"}', LINE);
    expect(out).not.toMatch(/\r/u);
    expect(out.endsWith("\n")).toBe(false);
    expect(splitFences(agentTaskWrapper(out)).blocks[0]?.body).toBe(out);
  });

  it("turns line endings into LF and drops trailing newlines, and changes nothing else", () => {
    // Pinned exactly: a normaliser that deleted CRs instead of turning them into
    // LFs, or that trimmed trailing spaces as well, would pass the shape checks.
    expect(stampArtifact("md", "a\r\nb\rc  \n\n", LINE)).toBe(
      `${LINE}\n\na\nb\nc  `,
    );
    expect(stampArtifact("csv", "q\r\nai seo\r\n", LINE)).toBe(
      `${PROVENANCE_CSV_MARKER}\n# ${LINE}\nq\nai seo`,
    );
    // U+2028 is content, not a line ending, in Markdown and CSV alike.
    expect(stampArtifact("prompt", "a\u2028b", LINE)).toBe(
      `${LINE}\n\na\u2028b`,
    );
  });

  it("strips a long run of newlines in linear time", () => {
    // `/\n+$/` would re-scan the run from every start position: 100k newlines
    // before one letter is ~5e9 steps, far past the test timeout, while a
    // linear strip is a few milliseconds. The margin is orders of magnitude,
    // not a threshold that noise can cross.
    const body = `${"\n".repeat(100_000)}x${"\n".repeat(100_000)}`;
    const out = stampArtifact("md", body, LINE);
    expect(out.endsWith("x")).toBe(true);
    expect(out).toHaveLength(LINE.length + 2 + 100_001);
  });
});

describe("artifactGscData (Q36)", () => {
  it("is none whenever the artifact shows no GSC data, whatever the rows' source", () => {
    expect([
      artifactGscData(false, "sample"),
      artifactGscData(false, "user"),
      artifactGscData(false, null),
    ]).toEqual(["none", "none", "none"]);
  });

  it("names the rows' source when the artifact shows GSC data, and is unknown when none was recorded", () => {
    expect([
      artifactGscData(true, "sample"),
      artifactGscData(true, "user"),
      artifactGscData(true, null),
    ]).toEqual(["sample", "user", "unknown"]);
  });
});
