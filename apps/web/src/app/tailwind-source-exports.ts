/* @input  — a module that imports a name from a specifier, and the parsed
 *           walked files
 * @output — where that binding's value is defined: a walked file, a package,
 *           or unknown (with the reason). Follows `export { x as y } from`,
 *           `export *`, `export { x }` of an import, and a value that merely
 *           aliases an import (`export default x`, `export const y = x`); a
 *           value built from an import in any other way is unknown
 * @pos    — test support for app/tailwind-source-extract.ts only
 * 一旦本文件被更新，务必更新开头注释
 */
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { unwrap } from "./tailwind-source-bindings.ts";

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
  | { readonly kind: "here"; readonly local: string }
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
  return imported === null ? { kind: "here", local: original } : { kind: "from", ...imported };
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
    if (declares(statement, name)) return { step: { kind: "here", local: name }, stars };
    if (ts.isExportAssignment(statement) && name === "default") {
      return { step: { kind: "here", local: "default" }, stars };
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const step = reExportStep(source, statement, name);
    if (step.kind !== "none") return { step, stars };
  }
  return { step: { kind: "none" }, stars };
}

/** The expression a top-level binding holds: a variable initializer, or `export default <expression>`. */
function valueOf(source: ts.SourceFile, local: string): ts.Expression | undefined {
  for (const statement of source.statements) {
    if (local === "default" && ts.isExportAssignment(statement)) return statement.expression;
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === local,
    );
    if (declaration !== undefined) return declaration.initializer;
  }
  return undefined;
}

/** Names an expression reads as values: not types, member names or object keys. */
function valueNames(expression: ts.Expression): readonly string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      names.push(node.text);
    } else if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
    } else if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) visit(node.name);
      visit(node.initializer);
    } else {
      ts.forEachChild(node, visit);
    }
  };
  visit(expression);
  return [...new Set(names)];
}

function unknown(reason: string): Definition {
  return { kind: "unknown", reason };
}

/**
 * The file a binding's value really comes from. A binding whose value only
 * aliases another name is followed to it; one built from an import some other
 * way (`{ a: x }`, `` `${x}` ``) cannot be placed, so it is unknown. CSS Module
 * imports build class names Tailwind never needs, and are not followed.
 */
function settle(graph: ModuleGraph, path: string, local: string, seen: ReadonlySet<string>): Definition {
  const source = graph.sourceOf(path);
  const value = source === undefined ? undefined : valueOf(source, local);
  if (source === undefined || value === undefined) return { kind: "file", path };
  const inner = unwrap(value);
  const alias = ts.isIdentifier(inner) ? inner.text : null;
  for (const name of valueNames(value)) {
    if (name === local) continue;
    const imported = importedBinding(source, name);
    if (imported !== null && imported.specifier.endsWith(".css")) continue;
    if (imported !== null) {
      return name === alias
        ? follow(graph, path, imported.specifier, imported.name, seen)
        : unknown(`${local} in ${path} is built from the import ${name}`);
    }
    if (valueOf(source, name) === undefined) continue;
    const key = `${path}#local:${name}`;
    if (seen.has(key) || seen.size >= MAX_HOPS) return unknown(`value chain loops or is too long at ${key}`);
    const nested = settle(graph, path, name, new Set([...seen, key]));
    if (name === alias) return nested;
    if (nested.kind !== "file" || nested.path !== path) return unknown(`${local} in ${path} is built from ${name}, defined elsewhere`);
  }
  return { kind: "file", path };
}

function follow(
  graph: ModuleGraph,
  fromFile: string,
  specifier: string,
  name: string,
  seen: ReadonlySet<string>,
): Definition {
  const located = locate(graph, fromFile, specifier);
  if (located.kind !== "file") return located;
  if (name === "*") return unknown(`namespace import of "${specifier}" read whole`);
  const key = `${located.path}#${name}`;
  if (seen.has(key) || seen.size >= MAX_HOPS) return unknown(`export chain loops or is too long at ${key}`);
  const next = new Set([...seen, key]);
  const source = graph.sourceOf(located.path);
  if (source === undefined) return unknown(`unreadable ${located.path}`);
  const { step, stars } = exportStep(source, name);
  if (step.kind === "here") return settle(graph, located.path, step.local, next);
  if (step.kind === "from") return follow(graph, located.path, step.specifier, step.name, next);
  for (const star of stars) {
    const found = follow(graph, located.path, star, name, next);
    if (found.kind !== "unknown") return found;
  }
  return unknown(`"${specifier}" does not export ${name}`);
}

/** Where `name`, imported by `fromFile` from `specifier`, is defined ("default" included; "*" is unknown). */
export function definitionOf(
  graph: ModuleGraph,
  fromFile: string,
  specifier: string,
  name: string,
): Definition {
  return follow(graph, fromFile, specifier, name, new Set());
}
