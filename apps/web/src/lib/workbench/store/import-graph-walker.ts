/**
 * Test support for the import-graph gates in this directory,
 * `client-import-graph.test.ts` and `ui-shell-import-gate.test.ts`. Nothing in
 * the app imports it. It reads source with the TypeScript parser and the file
 * system, so no client module may reach it; if one did, the Node-only gate in
 * `client-import-graph.test.ts` would report the `node:fs` import below.
 *
 * What it reads: type-only clauses are erased. `import`/`export ... from` and
 * `import x = require()` are static edges. `import("...")` and `require("...")`
 * with a literal argument are dynamic edges. A loader call whose argument is not
 * a literal is recorded in `nonLiteral`, never skipped. Each gate's blind spots
 * are listed in its own test file.
 *
 * Not under `__fixtures__` (it is not a fixture) and not named `*.test.ts`
 * (vitest would collect it as a suite with no tests).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const STORE_DIR = dirname(fileURLToPath(import.meta.url));
export const WORKBENCH_DIR = resolve(STORE_DIR, "..");
/** `@/` in apps/web resolves to apps/web/src. */
export const SRC_DIR = resolve(WORKBENCH_DIR, "../..");

const SCRIPT = /\.[cm]?[jt]sx?$/;
/** A test module, told by its suffix only: `Probe.test.helpers.ts` is production code. */
const TEST_MODULE = /\.test\.tsx?$/;

/** Which edges a walk follows into local modules. */
export type Follow = "static" | "static-and-dynamic";

export type EdgeKind = "static" | "dynamic";

export interface ImportEdge {
  readonly spec: string;
  readonly kind: EdgeKind;
  readonly syntax:
    | "import"
    | "export"
    | "import-equals"
    | "import()"
    | "require()";
}

export interface ModuleImports {
  readonly edges: readonly ImportEdge[];
  /** `line:column text` of each `import()` / `require()` whose argument is not a literal. */
  readonly nonLiteral: readonly string[];
}

export function isLocal(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("@/");
}

/** A string literal or a template literal without substitutions. */
function literalText(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  const literal =
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  return literal ? node.text : null;
}

function edge(
  node: ts.Expression | undefined,
  syntax: ImportEdge["syntax"],
): ImportEdge | null {
  const spec = literalText(node);
  const kind =
    syntax === "import()" || syntax === "require()" ? "dynamic" : "static";
  return spec === null ? null : { spec, kind, syntax };
}

/**
 * The static edge a declaration makes, or null. `import { type A } from` still
 * counts: with `verbatimModuleSyntax` only a clause-level `type` is erased.
 */
function staticEdge(node: ts.Node): ImportEdge | null {
  if (ts.isImportDeclaration(node)) {
    const typeOnly =
      node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    return typeOnly ? null : edge(node.moduleSpecifier, "import");
  }
  if (ts.isExportDeclaration(node)) {
    return node.isTypeOnly ? null : edge(node.moduleSpecifier, "export");
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    !node.isTypeOnly &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    return edge(node.moduleReference.expression, "import-equals");
  }
  return null;
}

/** `import()` or `require()` for a call that loads a module, null for any other call. */
function loaderSyntax(node: ts.CallExpression): ImportEdge["syntax"] | null {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return "import()";
  const callee = node.expression;
  return ts.isIdentifier(callee) && callee.text === "require"
    ? "require()"
    : null;
}

/** Every import edge in `text`, and every loader call it cannot follow. */
export function readImports(text: string, fileName: string): ModuleImports {
  const scriptKind = /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const edges: ImportEdge[] = [];
  const nonLiteral: string[] = [];
  const visit = (node: ts.Node): void => {
    const declared = staticEdge(node);
    if (declared !== null) edges.push(declared);
    const syntax = ts.isCallExpression(node) ? loaderSyntax(node) : null;
    if (ts.isCallExpression(node) && syntax !== null) {
      const loaded = edge(node.arguments[0], syntax);
      if (loaded !== null) edges.push(loaded);
      else nonLiteral.push(where(source, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { edges, nonLiteral };
}

function where(source: ts.SourceFile, node: ts.Node): string {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${start.line + 1}:${start.character + 1} ${node.getText(source)}`;
}

/** Parsed once per file per run; the files do not change while the tests read them. */
const parsed = new Map<string, ModuleImports>();

/** Throws on a file that is not a script: its imports would otherwise read as none. */
export function importsOf(file: string): ModuleImports {
  const cached = parsed.get(file);
  if (cached !== undefined) return cached;
  if (!SCRIPT.test(file)) throw new Error(`not a script module: ${file}`);
  const read = readImports(readFileSync(file, "utf8"), file);
  parsed.set(file, read);
  return read;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Throws on a local specifier it cannot resolve: a walker that skips those would
 * report a clean graph. Extensionless specifiers are tried as `.ts`, `.tsx` and
 * `index.*`, the bundler resolution tsconfig uses; 76 reachable imports rely on
 * it today (mostly `@/lib/workbench/...`, and `./client` inside `lib/api`).
 */
export function resolveSpecifier(fromFile: string, spec: string): string {
  const base = spec.startsWith("@/")
    ? resolve(SRC_DIR, spec.slice(2))
    : resolve(dirname(fromFile), spec);
  const found = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ].find(isFile);
  if (found === undefined)
    throw new Error(`cannot resolve "${spec}" imported by ${fromFile}`);
  return found;
}

interface Parent {
  readonly file: string;
  readonly kind: EdgeKind;
}

export type Parents = ReadonlyMap<string, Parent | null>;

/** Every file reachable over `follow` edges, mapped to the file (and edge) that first reached it; `null` for entries. */
export function reachableFrom(entries: readonly string[], follow: Follow): Parents {
  const parents = new Map<string, Parent | null>(
    entries.map((entry) => [entry, null]),
  );
  const queue = [...entries];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const found of importsOf(file).edges) {
      if (!isLocal(found.spec)) continue;
      if (follow === "static" && found.kind === "dynamic") continue;
      const target = resolveSpecifier(file, found.spec);
      if (parents.has(target)) continue;
      parents.set(target, { file, kind: found.kind });
      queue.push(target);
    }
  }
  return parents;
}

export function workbenchPath(file: string): string {
  return relative(WORKBENCH_DIR, file);
}

export function srcPath(file: string): string {
  return relative(SRC_DIR, file);
}

/**
 * `lib/workbench/store/selectors.ts -> lib/workbench/mock/kb.ts -> ...`, for a
 * readable failure. `->` is a static edge, `~>` a dynamic one.
 */
export function chainTo(parents: Parents, file: string): string {
  const up = parents.get(file);
  if (up === null || up === undefined) return srcPath(file);
  const arrow = up.kind === "static" ? "->" : "~>";
  return `${chainTo(parents, up.file)} ${arrow} ${srcPath(file)}`;
}

/** `path:line:column text` for every loader call in the graph's files whose argument is not a literal. */
export function nonLiteralLoads(parents: Parents): readonly string[] {
  return nonLiteralLoadsIn([...parents.keys()]);
}

/** `path:line:column text` for every loader call in `files` whose argument is not a literal. */
export function nonLiteralLoadsIn(files: readonly string[]): readonly string[] {
  return files.flatMap((file) =>
    importsOf(file).nonLiteral.map((at) => `${srcPath(file)}:${at}`),
  );
}

/** Every non-test script module under `directory`, nested directories included. */
export function scriptModulesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return scriptModulesUnder(path);
    return SCRIPT.test(entry.name) && !TEST_MODULE.test(entry.name)
      ? [path]
      : [];
  });
}

export function isInside(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

export interface DirectEdge {
  readonly target: string;
  /** `file -> target`, or `file ~> target` for a dynamic edge. */
  readonly line: string;
}

/** Every local edge, static or dynamic, out of `files`, resolved; no walk past them. */
export function directLocalEdges(files: readonly string[]): readonly DirectEdge[] {
  return files.flatMap((file) =>
    importsOf(file)
      .edges.filter((found) => isLocal(found.spec))
      .map((found) => {
        const target = resolveSpecifier(file, found.spec);
        const arrow = found.kind === "static" ? "->" : "~>";
        return { target, line: `${srcPath(file)} ${arrow} ${srcPath(target)}` };
      }),
  );
}
