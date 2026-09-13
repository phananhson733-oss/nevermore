import { describe, expect, it } from "vitest";
import { ARTIFACT_EXT, ARTIFACT_MIME, downloadName } from "./artifact-file.ts";
import { ARTIFACT_TYPES } from "./enums.ts";
import type { Artifact } from "./types.ts";

const ARTIFACT: Artifact = {
  id: "a1",
  at: "2026-09-11 14:00",
  module: "keywordLibrary",
  type: "csv",
  engine: "both",
  title: "Keyword library",
  content: "q\ngeo audit\n",
  filename: "keywords.csv",
};

describe("artifact file tables", () => {
  // The compile-time half of this is the `satisfies Record<ArtifactType, …>` on
  // each table, which makes a fifth artifact type an error in both. This is the
  // runtime half, and it is not the same table read twice: `ARTIFACT_TYPES`
  // lives in `enums.ts` and is written out there, so a type added to the domain
  // and to that list but not to these tables fails here as well.
  it.each([
    ["MIME", ARTIFACT_MIME],
    ["extension", ARTIFACT_EXT],
  ])("covers every artifact type exactly once (%s)", (_label, table) => {
    expect(Object.keys(table).sort()).toEqual([...ARTIFACT_TYPES].sort());
  });

  it("gives every type a charset and a distinct media type", () => {
    const types = Object.values(ARTIFACT_MIME);
    for (const mime of types) expect(mime).toContain(";charset=utf-8");
    // `prompt` is plain text and `md` is markdown: collapsing them would hand
    // the browser the wrong type for one of the two.
    expect(new Set(types).size).toBe(types.length);
  });

  it("uses a text extension for every type, `prompt` as .txt", () => {
    expect(ARTIFACT_EXT).toEqual({
      csv: "csv",
      md: "md",
      json: "json",
      prompt: "txt",
    });
  });
});

describe("downloadName", () => {
  it("sanitises a hostile name that reached it anyway and forces the type's extension", () => {
    // Defence in depth for a stored envelope the reducer never saw: nothing
    // outside `[\p{L}\p{N}_ .()-]` reaches the save dialog (dots are allowed,
    // slashes and angle brackets are not), leading dots are dropped so the
    // file is not hidden, and `.csv` becomes `.md`.
    expect(
      downloadName({ ...ARTIFACT, type: "md", filename: "../../report<1>.csv" }),
    ).toBe("_.._report_1_.md");
  });

  it("prefers the stored filename over the title", () => {
    expect(downloadName(ARTIFACT)).toBe("keywords.csv");
  });

  it.each([
    [{ type: "csv", title: "Keyword library" }, "Keyword library.csv"],
    [{ type: "prompt", title: "Discover prompts" }, "Discover prompts.txt"],
    [{ type: "json", title: "Answer plan.json" }, "Answer plan.json"],
    [{ type: "md", title: "Release 1.2" }, "Release 1.2.md"],
    [{ type: "md", title: "brief.txt", filename: "brief.TXT" }, "brief.md"],
    [{ type: "csv", title: "关键词库" }, "关键词库.csv"],
    [{ type: "md", title: "報告/草稿：v2" }, "報告_草稿_v2.md"],
    [{ type: "csv", title: "///" }, "___.csv"],
    [{ type: "csv", title: "   " }, "artifact.csv"],
    [{ type: "md", title: ".env" }, "env.md"],
    [{ type: "md", title: ".." }, "artifact.md"],
    [{ type: "csv", title: "x".repeat(150) }, `${"x".repeat(100)}.csv`],
    // The 100th code unit would split "𠮷" in half; the cut backs off instead.
    [{ type: "csv", title: `${"x".repeat(99)}𠮷y` }, `${"x".repeat(99)}.csv`],
  ] as const)("names %j as %s", (patch, expected) => {
    expect(downloadName({ ...ARTIFACT, filename: undefined, ...patch })).toBe(
      expected,
    );
  });
});
