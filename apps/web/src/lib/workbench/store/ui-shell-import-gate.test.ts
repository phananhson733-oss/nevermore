/**
 * `components/workbench/ui/` imports nothing from `components/workbench/shell/`
 * (Q35): the shell composes the shared ui pieces, never the reverse. Every
 * non-test module under ui/ is read, not only the ones a client entry reaches,
 * and each direct edge out of it, static or dynamic, is resolved. An `import()`
 * or `require()` there whose argument is not a literal fails the gate too: its
 * target cannot be read, which is not the same as no edge. A test module is told
 * by its suffix (`.test.ts`, `.test.tsx`), so a module named like
 * `Probe.test.helpers.ts` is production code and is read.
 *
 * The edges come from `import-graph-walker.ts`, the reader the client import
 * graph gates in `client-import-graph.test.ts` use; the reader's own limits are
 * listed there.
 *
 * Blind spots:
 * - the `ui/` gate reads direct edges only, so a `ui/` module that reaches the
 *   shell through a module outside both directories is not seen.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  directLocalEdges,
  isInside,
  nonLiteralLoadsIn,
  scriptModulesUnder,
  SRC_DIR,
  srcPath,
} from "./import-graph-walker.ts";

const STORE_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = resolve(SRC_DIR, "components/workbench/ui");
const SHELL_DIR = resolve(SRC_DIR, "components/workbench/shell");
const UI_FIXTURE = resolve(STORE_DIR, "__fixtures__/ui-with-shell-import.tsx");
/**
 * 22 non-test modules under ui/ on 2026-09-14. The floor sits below that, so a
 * moved directory fails here instead of passing on an empty walk.
 */
const MIN_UI_MODULES = 18;

/** The direct edges out of `files` whose target sits under `components/workbench/shell/` (Q35). */
function edgesIntoShell(files: readonly string[]): readonly string[] {
  return directLocalEdges(files)
    .filter(({ target }) => isInside(SHELL_DIR, target))
    .map(({ line }) => line);
}

/**
 * Everything in `files` that breaks Q35: each direct edge into shell/, and each
 * `import()` / `require()` whose argument is not a literal. The walk cannot say
 * where such a call points, so it fails instead of counting as no edge.
 */
function shellGateViolations(files: readonly string[]): readonly string[] {
  return [
    ...edgesIntoShell(files),
    ...nonLiteralLoadsIn(files).map((at) => `${at} (target is not a literal)`),
  ];
}

// Q35: the shell composes the shared ui pieces; a ui piece importing the shell
// turns that dependency around.
describe("components/workbench/ui imports nothing from shell (Q35)", () => {
  const uiModules = scriptModulesUnder(UI_DIR);

  it("reads every non-test module under ui/ and the edges out of them", () => {
    expect(uiModules.length).toBeGreaterThanOrEqual(MIN_UI_MODULES);
    expect(uiModules.map(srcPath)).toContain(
      "components/workbench/ui/ConfirmDialog.tsx",
    );
    // A real edge between two ui modules, so an empty edge list cannot pass the gate below.
    expect(directLocalEdges(uiModules).map(({ line }) => line)).toContain(
      "components/workbench/ui/ConfirmDialog.tsx -> components/workbench/ui/Dialog.tsx",
    );
  });

  it("catches a ui-shaped module that imports the shell, statically or dynamically (control)", () => {
    const fixture = srcPath(UI_FIXTURE);
    expect(shellGateViolations([UI_FIXTURE])).toEqual([
      `${fixture} -> components/workbench/shell/workbench-nav.ts`,
      `${fixture} ~> components/workbench/shell/CommandPalette.tsx`,
    ]);
  });

  it("has no static or dynamic edge from a ui/ module into shell/, and no loader whose target cannot be read", () => {
    expect(shellGateViolations(uiModules)).toEqual([]);
  });

  // A tree made on disk per run and walked by the real `scriptModulesUnder`: a
  // committed `X.test.ts` would be collected by vitest as a suite with no tests.
  // The shell imports use the `@/` alias, which resolves to the real shell/ from
  // any directory, so nothing in the walk takes a parameter for the test.
  describe("over a directory tree the gate has to walk (control)", () => {
    const TREE: Readonly<Record<string, string>> = {
      "top.ts": "export const top = 1;\n",
      "notes.md": 'import "@/components/workbench/shell/Sidebar.tsx";\n',
      "X.test.ts": 'import "@/components/workbench/shell/Sidebar.tsx";\n',
      "Y.test.helpers.ts":
        'export { WORKBENCH_NAV } from "@/components/workbench/shell/workbench-nav.ts";\n',
      "nested/Panel.tsx": [
        'import { top } from "../top.ts";',
        'import { WORKBENCH_NAV } from "@/components/workbench/shell/workbench-nav.ts";',
        "export const panel = [top, WORKBENCH_NAV];",
        "",
      ].join("\n"),
      "nested/deeper/Concat.ts":
        'export const load = () => import("@/components/workbench/shell/" + "workbench-nav.ts");\n',
      "nested/deeper/Template.ts":
        "export const load = (name: string) => import(`@/components/workbench/shell/${name}.ts`);\n",
    };
    let root = "";
    /** How the gate names a file of the tree: relative to src/, like every other file. */
    const shown = (path: string): string => srcPath(join(root, path));

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "q35-ui-gate-"));
      for (const [path, text] of Object.entries(TREE)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it("enumerates top-level and nested scripts, keeps a .test.helpers.ts module, and leaves out the test module and the non-script", () => {
      const found = scriptModulesUnder(root).map((file) => relative(root, file));
      expect(found.toSorted()).toEqual([
        "Y.test.helpers.ts",
        join("nested", "Panel.tsx"),
        join("nested", "deeper", "Concat.ts"),
        join("nested", "deeper", "Template.ts"),
        "top.ts",
      ]);
    });

    it("reports the nested and the helper shell edges and both unreadable loaders, and nothing from the test module", () => {
      expect(shellGateViolations(scriptModulesUnder(root)).toSorted()).toEqual(
        [
          `${shown("Y.test.helpers.ts")} -> components/workbench/shell/workbench-nav.ts`,
          `${shown("nested/Panel.tsx")} -> components/workbench/shell/workbench-nav.ts`,
          `${shown("nested/deeper/Concat.ts")}:1:27 import("@/components/workbench/shell/" + "workbench-nav.ts") (target is not a literal)`,
          `${shown("nested/deeper/Template.ts")}:1:39 import(\`@/components/workbench/shell/\${name}.ts\`) (target is not a literal)`,
        ].toSorted(),
      );
    });

    it.each([
      [
        "string concatenation",
        "nested/deeper/Concat.ts",
        '1:27 import("@/components/workbench/shell/" + "workbench-nav.ts")',
      ],
      [
        "an interpolated template",
        "nested/deeper/Template.ts",
        "1:39 import(`@/components/workbench/shell/${name}.ts`)",
      ],
    ])("fails on an import() built by %s instead of reading it as no edge", (_how, path, call) => {
      const file = join(root, path);
      expect(edgesIntoShell([file])).toEqual([]);
      expect(shellGateViolations([file])).toEqual([
        `${shown(path)}:${call} (target is not a literal)`,
      ]);
    });
  });
});
