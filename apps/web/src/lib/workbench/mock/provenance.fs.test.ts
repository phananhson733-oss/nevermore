/**
 * Q23 says an artifact is stamped in one place. Nothing in the type system says
 * so: `stampArtifact` is an ordinary export, and any view that imports it gets a
 * second wording of the §6.8 provenance declaration — one of which will be a
 * claim about measurement that is not true. Until this sweep the invariant lived
 * in a comment in `hooks/useAddArtifact.ts`, and an enumerated invariant like
 * that rots as tasks are added: T6-T11 all build artifacts.
 *
 * So the allowlist is checked against the file system rather than against a
 * list someone remembered to update, the way `store/client-import-graph.test.ts`,
 * `routes.fs.test.ts`, `mock/labels-zh.test.ts` and `shell/sidebar-width.test.ts`
 * already do for their own invariants.
 *
 * Comments are stripped before matching: `mock/builders/profile.ts` names
 * `stampArtifact` in its file header to say that bodies are unstamped, and that
 * sentence is the opposite of a second stamping site. String literals are not
 * stripped, so a file that only mentions the name inside a string is reported —
 * fail closed, and there is none today.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MOCK_DIR = dirname(fileURLToPath(import.meta.url));
/** `apps/web/src`: mock -> workbench -> lib -> src. */
const SRC_DIR = resolve(MOCK_DIR, "../../..");

/**
 * Every non-test file allowed to name `stampArtifact`, and why each one is not a
 * second wording:
 * - `mock/provenance.ts` declares it.
 * - `hooks/useAddArtifact.ts` is the one stamping site (Q23). Its line comes from
 *   `workbench.provenance.artifact`.
 * - `mock/demo-artifacts.ts` seeds the sample site's basket, which is not one of
 *   the four artifact actions. It does not spell a line either: `DemoDeps.
 *   provenanceLine` is injected by the caller and must keep coming from that same
 *   `workbench.provenance.artifact` key, so the demo artifacts and the operator's
 *   own carry identical wording.
 *
 * A fourth entry here is a decision, not a formality: adding one means two places
 * can word the declaration, and the reason has to be written down beside it.
 */
const ALLOWED: readonly string[] = [
  "components/workbench/hooks/useAddArtifact.ts",
  "lib/workbench/mock/demo-artifacts.ts",
  "lib/workbench/mock/provenance.ts",
];

const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".next",
]);
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** A whole-line comment, including the ` * ` continuation lines a block comment leaves behind. */
const LINE_COMMENT = /^[ \t]*\/\/.*$/gm;
const NAME = /\bstampArtifact\b/;

/** Source with comments removed. Only whole-line `//`, so a `https://` inside a string cannot eat code after it. */
function withoutComments(source: string): string {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

function namesStampArtifact(source: string): boolean {
  return NAME.test(withoutComments(source));
}

/** Every non-test `.ts`/`.tsx` under `apps/web/src`, as paths relative to it. */
function sourceFiles(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      continue;
    }
    found.push(relative(SRC_DIR, full));
  }
  return found;
}

describe("stampArtifact has exactly one calling site (Q23)", () => {
  it("sees an import and a call, and ignores a mention in a comment", () => {
    expect(namesStampArtifact('import { stampArtifact } from "./provenance.ts";')).toBe(true);
    expect(namesStampArtifact('const text = stampArtifact("md", body, line);')).toBe(true);
    expect(namesStampArtifact("/**\n * the line `stampArtifact` folds in\n */\nconst a = 1;")).toBe(false);
    expect(namesStampArtifact("// stampArtifact is called elsewhere\nconst a = 1;")).toBe(false);
    // Not defeated by a near-miss name either.
    expect(namesStampArtifact("const x = useAddArtifact();")).toBe(false);
  });

  it("does not count the header comment in mock/builders/profile.ts", () => {
    // A real file rather than a synthetic string: this one names `stampArtifact`
    // in prose today, and the raw text is checked too so the control cannot rot
    // into a file that simply stopped mentioning it.
    const source = readFileSync(resolve(SRC_DIR, "lib/workbench/mock/builders/profile.ts"), "utf8");
    expect(NAME.test(source)).toBe(true);
    expect(namesStampArtifact(source)).toBe(false);
  });

  it("is named by exactly three non-test files", () => {
    const files = sourceFiles(SRC_DIR);
    // A sweep that matched nothing would agree with an empty allowlist.
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain("lib/workbench/mock/provenance.ts");

    const callers = files
      .filter((file) => namesStampArtifact(readFileSync(resolve(SRC_DIR, file), "utf8")))
      .sort();
    expect(callers).toEqual([...ALLOWED].sort());
    // The count as well as the set: a fourth file is a fourth entry here, and
    // this number has to be changed on purpose.
    expect(callers).toHaveLength(3);
  });
});
