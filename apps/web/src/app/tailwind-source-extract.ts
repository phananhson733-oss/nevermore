/* @input  — the text of .ts / .tsx / .css files
 * @output — what each file feeds Tailwind: strings that reach a class sink,
 *           every other literal, the imports class values read (with where each
 *           is really defined), the class inputs out of static sight, and the
 *           custom properties it reads (var(), getPropertyValue())
 * @pos    — test support for app/tailwind-source-scan.ts only; nothing in the
 *           app imports it (it loads typescript). Value tracing lives in
 *           tailwind-source-values.ts, export chains in tailwind-source-exports.ts
 * 一旦本文件被更新，务必更新开头注释
 */
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { definitionOf, type Definition, type ModuleGraph } from "./tailwind-source-exports.ts";
import { CLASS_NAME, valueReader, type Sink, type ValueReader } from "./tailwind-source-values.ts";

export interface ImportedValue {
  readonly name: string;
  readonly specifier: string;
  readonly definition: Definition;
}

export interface ModuleFacts {
  /** Strings that can reach a class sink. */
  readonly classStrings: readonly string[];
  /** Every literal except module specifiers. */
  readonly literals: readonly string[];
  /** Imports a class value reads, resolved to where they are defined. */
  readonly importedValues: readonly ImportedValue[];
  /** Class-sink code that glues a literal onto something: `top-${n}`, "top-" + n. */
  readonly gluedPieces: readonly string[];
  /** Class-sink values the reader could not follow (parameters, calls, members, …). */
  readonly opaqueValues: readonly string[];
  /** Custom properties read through var() or getPropertyValue(). */
  readonly propertyReads: readonly string[];
  /** getPropertyValue(…) calls whose name is not static. */
  readonly dynamicPropertyReads: readonly string[];
}

const CLASS_LIST_METHODS: ReadonlySet<string> = new Set(["add", "remove", "toggle", "replace"]);
const SCRIPT = /\.tsx?$/u;

function literalText(node: ts.Node): string | null {
  const plain = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  const piece = ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
  return plain || piece ? node.text : null;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** Custom properties read through var(). Block comments are dropped: a var() there reads nothing. */
export function variablesReadIn(text: string): readonly string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//gu, "");
  const names = [...code.matchAll(/var\(\s*(--[\w-]+)/gu)].map((match) => match[1] ?? "");
  return [...new Set(names)].filter((name) => name !== "").sort();
}

function classSinkArguments(node: ts.CallExpression): readonly ts.Expression[] {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return [];
  const receiver = callee.expression;
  const onClassList = ts.isPropertyAccessExpression(receiver) && receiver.name.text === "classList";
  if (onClassList && CLASS_LIST_METHODS.has(callee.name.text)) return node.arguments;
  const [attribute, ...values] = node.arguments;
  const setsClass =
    callee.name.text === "setAttribute" && attribute !== undefined && literalText(attribute) === "class";
  return setsClass ? values : [];
}

/** Expressions whose value becomes a class. */
function classSinks(source: ts.SourceFile): readonly Sink[] {
  const sinks: Sink[] = [];
  walk(source, (node) => {
    if (ts.isJsxSpreadAttribute(node)) sinks.push({ kind: "spread", node: node.expression });
    if (ts.isJsxAttribute(node) && node.initializer && CLASS_NAME.test(node.name.getText(source))) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (value !== undefined) sinks.push({ kind: "value", node: value });
    }
    if (ts.isCallExpression(node)) {
      classSinkArguments(node).forEach((argument) => sinks.push({ kind: "value", node: argument }));
    }
  });
  return sinks;
}

/** Every literal except module specifiers: a class list kept in a constant, even in a `.ts` file. */
function allLiterals(source: ts.SourceFile): readonly string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    const text = literalText(node);
    if (text !== null) found.push(text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function propertyReads(
  source: ts.SourceFile,
  reader: ValueReader,
): Pick<ModuleFacts, "propertyReads" | "dynamicPropertyReads"> {
  const reads: string[] = [...variablesReadIn(source.text)];
  const dynamic: string[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.name.text !== "getPropertyValue") return;
    const first = node.arguments[0];
    const name = first === undefined ? null : reader.staticText(first);
    if (name === null) dynamic.push(node.getText(source));
    else if (name.startsWith("--")) reads.push(name);
  });
  return { propertyReads: [...new Set(reads)].sort(), dynamicPropertyReads: dynamic };
}

/**
 * One program over every script, served from memory: no lib, no module
 * resolution. The checker then binds each file's own scopes, which is all the
 * lookups need; cross-module links are followed by tailwind-source-exports.ts.
 */
function programFor(scripts: ReadonlyMap<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    types: [],
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.Latest,
    allowImportingTsExtensions: true,
  };
  const base = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (fileName) => scripts.has(fileName),
    readFile: (fileName) => scripts.get(fileName),
    getSourceFile: (fileName, languageVersion) => {
      const text = scripts.get(fileName);
      if (text === undefined) return undefined;
      const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      return ts.createSourceFile(fileName, text, languageVersion, true, kind);
    },
  };
  return ts.createProgram({ rootNames: [...scripts.keys()], options, host });
}

function scriptFacts(path: string, source: ts.SourceFile, checker: ts.TypeChecker, graph: ModuleGraph): ModuleFacts {
  const reader = valueReader(source, checker);
  const reading = reader.read(classSinks(source));
  return {
    classStrings: reading.strings,
    literals: allLiterals(source),
    importedValues: reading.imports.map((read) => ({
      name: read.name,
      specifier: read.specifier,
      definition: definitionOf(graph, path, read.specifier, read.importedName),
    })),
    gluedPieces: reading.glued,
    opaqueValues: reading.opaque,
    ...propertyReads(source, reader),
  };
}

const NO_SCRIPT_FACTS = { classStrings: [], literals: [], importedValues: [], gluedPieces: [], opaqueValues: [] };

/** Facts for every file, keyed by the absolute path given; `srcDir` is what `@/` names. */
export function factsForFiles(
  texts: ReadonlyMap<string, string>,
  srcDir: string,
): ReadonlyMap<string, ModuleFacts> {
  const scripts = new Map([...texts].filter(([path]) => SCRIPT.test(path)));
  const program = programFor(scripts);
  const checker = program.getTypeChecker();
  const graph: ModuleGraph = {
    srcDir,
    sourceOf: (path) => (scripts.has(path) ? program.getSourceFile(path) : undefined),
  };
  const entries = [...texts].map(([path, text]): readonly [string, ModuleFacts] => {
    if (!SCRIPT.test(path)) {
      return [path, { ...NO_SCRIPT_FACTS, propertyReads: variablesReadIn(text), dynamicPropertyReads: [] }];
    }
    const source = program.getSourceFile(path);
    if (source === undefined) throw new Error(`not loaded into the program: ${path}`);
    return [path, scriptFacts(path, source, checker, graph)];
  });
  return new Map(entries);
}

/** Facts for one file on its own: its imports resolve to nothing walked. */
export function moduleFacts(file: string, text: string): ModuleFacts {
  const path = resolve(file);
  const facts = factsForFiles(new Map([[path, text]]), dirname(path)).get(path);
  if (facts === undefined) throw new Error(`no facts for ${path}`);
  return facts;
}
