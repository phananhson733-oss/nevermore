/* @input  — a module that imports a name from a specifier, and a TypeScript
 *           program over the walked files
 * @output — where that binding is defined: a walked file, a package, or unknown
 *           (with the reason), following `export { x as y } from`, `export *`
 *           and `export { x }` of an import
 * @pos    — test support for app/tailwind-source-extract.ts only
 * 一旦本文件被更新，务必更新开头注释
 */
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

export type Definition =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "package"; readonly specifier: string }
  | { readonly kind: "unknown"; readonly reason: string };

export interface ModuleGraph {
  /** apps/web/src: what `@/` names. */
  readonly srcDir: string;
  readonly sourceOf: (path: string) => ts.SourceFile | undefined;
}

type Step =
  | { readonly kind: "here" }
  | { readonly kind: "from"; readonly specifier: string; readonly name: string }
  | { readonly kind: "none" };

const MAX_HOPS = 8;
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function stringLiteral(node: ts.Expression | undefined): string | null {
  return node !== undefined && ts.isStringLiteral(node) ? node.text : null;
}

function locate(graph: ModuleGraph, fromFile: string, specifier: string): Definition {
  const base = specifier.startsWith("@/")
    ? join(graph.srcDir, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (base === null) return { kind: "package", specifier };
  const path = CANDIDATE_SUFFIXES.map((suffix) => base + suffix).find(
    (candidate) => graph.sourceOf(candidate) !== undefined,
  );
  return path === undefined
    ? { kind: "unknown", reason: `no walked module for "${specifier}"` }
    : { kind: "file", path };
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function declares(statement: ts.Statement, name: string): boolean {
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return false;
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
    );
  }
  const named =
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement);
  if (!named) return false;
  if (name === "default") return hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
  return statement.name?.text === name;
}

/** The import in `source` that binds `local`, as the name it has in its own module. */
function importedBinding(
  source: ts.SourceFile,
  local: string,
): { readonly specifier: string; readonly name: string } | null {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = stringLiteral(statement.moduleSpecifier);
    const clause = statement.importClause;
    if (specifier === null || clause === undefined) continue;
    if (clause.name?.text === local) return { specifier, name: "default" };
    const bindings = clause.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      if (bindings.name.text === local) return { specifier, name: "*" };
      continue;
    }
    const element = bindings?.elements.find((candidate) => candidate.name.text === local);
    if (element !== undefined) {
      return { specifier, name: (element.propertyName ?? element.name).text };
    }
  }
  return null;
}

function reExportStep(
  source: ts.SourceFile,
  statement: ts.ExportDeclaration,
  name: string,
): Step {
  const specifier = stringLiteral(statement.moduleSpecifier);
  const clause = statement.exportClause;
  if (clause === undefined) return { kind: "none" };
  if (ts.isNamespaceExport(clause)) {
    return clause.name.text === name && specifier !== null
      ? { kind: "from", specifier, name: "*" }
      : { kind: "none" };
  }
  const element = clause.elements.find((candidate) => candidate.name.text === name);
  if (element === undefined) return { kind: "none" };
  const original = (element.propertyName ?? element.name).text;
  if (specifier !== null) return { kind: "from", specifier, name: original };
  const imported = importedBinding(source, original);
  return imported === null ? { kind: "here" } : { kind: "from", ...imported };
}

function exportStep(
  source: ts.SourceFile,
  name: string,
): { readonly step: Step; readonly stars: readonly string[] } {
  const stars = source.statements.flatMap((statement) => {
    const star = ts.isExportDeclaration(statement) && statement.exportClause === undefined;
    const specifier = star ? stringLiteral(statement.moduleSpecifier) : null;
    return specifier === null ? [] : [specifier];
  });
  for (const statement of source.statements) {
    if (declares(statement, name)) return { step: { kind: "here" }, stars };
    if (ts.isExportAssignment(statement) && name === "default") {
      return { step: { kind: "here" }, stars };
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const step = reExportStep(source, statement, name);
    if (step.kind !== "none") return { step, stars };
  }
  return { step: { kind: "none" }, stars };
}

function follow(
  graph: ModuleGraph,
  fromFile: string,
  specifier: string,
  name: string,
  seen: ReadonlySet<string>,
): Definition {
  const located = locate(graph, fromFile, specifier);
  if (located.kind !== "file" || name === "*") return located;
  const key = `${located.path}#${name}`;
  if (seen.has(key) || seen.size >= MAX_HOPS) {
    return { kind: "unknown", reason: `export chain loops or is too long at ${key}` };
  }
  const next = new Set([...seen, key]);
  const source = graph.sourceOf(located.path);
  if (source === undefined) return { kind: "unknown", reason: `unreadable ${located.path}` };
  const { step, stars } = exportStep(source, name);
  if (step.kind === "here") return located;
  if (step.kind === "from") return follow(graph, located.path, step.specifier, step.name, next);
  for (const star of stars) {
    const found = follow(graph, located.path, star, name, next);
    if (found.kind !== "unknown") return found;
  }
  return { kind: "unknown", reason: `"${specifier}" does not export ${name}` };
}

/** Where `name`, imported by `fromFile` from `specifier`, is defined ("default" and "*" included). */
export function definitionOf(
  graph: ModuleGraph,
  fromFile: string,
  specifier: string,
  name: string,
): Definition {
  return follow(graph, fromFile, specifier, name, new Set());
}
