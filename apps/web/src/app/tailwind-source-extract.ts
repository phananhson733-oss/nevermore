/* @input  — the text of .ts / .tsx modules (or a stylesheet's text)
 * @output — what each module feeds Tailwind: strings that reach a class sink,
 *           every other literal, the class inputs it cannot see through
 *           (imported values, literals glued onto an interpolation, computed
 *           property names), and the custom properties it reads. Names are
 *           resolved by scope through a TypeScript checker, not by spelling
 * @pos    — test support for app/tailwind-source-scan.ts only; nothing in the
 *           app imports it (it loads typescript)
 * 一旦本文件被更新，务必更新开头注释
 */
import { resolve } from "node:path";
import ts from "typescript";

export interface ImportedValue {
  readonly name: string;
  readonly specifier: string;
}

export interface ModuleFacts {
  /** Strings that reach a class sink: class-like JSX attributes, classList.*, setAttribute("class", …). */
  readonly classStrings: readonly string[];
  /** Every literal except module specifiers. */
  readonly literals: readonly string[];
  /** Imported bindings a class sink reads as a value (not a call): their strings live in another module. */
  readonly importedValues: readonly ImportedValue[];
  /** Class-sink code that glues a literal onto a value: `top-${n}`, "top-" + n. */
  readonly gluedPieces: readonly string[];
  /** Custom properties read through var() or getPropertyValue("--x"). */
  readonly propertyReads: readonly string[];
  /** getPropertyValue(…) calls whose argument is not a literal. */
  readonly dynamicPropertyReads: readonly string[];
}

const CLASS_ATTRIBUTE = /^(?:class|className|[A-Za-z]+ClassName)$/u;
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

function classSinkArguments(node: ts.CallExpression): readonly ts.Node[] {
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
function classSinks(source: ts.SourceFile): readonly ts.Node[] {
  const sinks: ts.Node[] = [];
  walk(source, (node) => {
    if (ts.isJsxAttribute(node) && node.initializer && CLASS_ATTRIBUTE.test(node.name.getText(source))) {
      sinks.push(node.initializer);
    }
    if (ts.isCallExpression(node)) sinks.push(...classSinkArguments(node));
  });
  return sinks;
}

/** `top-${n}` or "top-" + n: a literal glued onto a value the scan cannot read. */
function gluesPieces(node: ts.Node): boolean {
  if (ts.isTemplateExpression(node)) {
    const pieces = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
    const last = pieces.length - 1;
    return pieces.some(
      (piece, index) => (index < last && /\S$/u.test(piece)) || (index > 0 && /^\S/u.test(piece)),
    );
  }
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return false;
  const left = literalText(node.left);
  const right = literalText(node.right);
  const leftGlues = left === null || /\S$/u.test(left);
  const rightGlues = right === null || /^\S/u.test(right);
  return (left !== null || right !== null) && leftGlues && rightGlues;
}

/** The module an import declaration names, walking up from one of its bindings. */
function importSpecifier(declaration: ts.Node): string | null {
  for (let node: ts.Node = declaration; !ts.isSourceFile(node); node = node.parent) {
    if (ts.isImportDeclaration(node)) return literalText(node.moduleSpecifier);
  }
  return null;
}

function symbolOf(checker: ts.TypeChecker, node: ts.Identifier): ts.Symbol | undefined {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
    return checker.getShorthandAssignmentValueSymbol(parent);
  }
  return checker.getSymbolAtLocation(node);
}

interface SinkReading {
  readonly strings: readonly string[];
  readonly importedValues: readonly ImportedValue[];
  readonly gluedPieces: readonly string[];
}

function readSinks(source: ts.SourceFile, checker: ts.TypeChecker): SinkReading {
  const strings: string[] = [];
  const importedValues: ImportedValue[] = [];
  const gluedPieces: string[] = [];
  const followed = new Set<ts.Node>();

  // By scope, not by spelling: a same-name local in another function is not
  // what this sink reads (following names made unrelated templates look like
  // glued classes), and a shadowing local cannot hide the one it does read.
  function readIdentifier(node: ts.Identifier): void {
    for (const declaration of symbolOf(checker, node)?.declarations ?? []) {
      const specifier = importSpecifier(declaration);
      if (specifier !== null && !specifier.endsWith(".css")) {
        importedValues.push({ name: node.text, specifier });
      }
      if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) continue;
      if (followed.has(declaration.initializer)) continue;
      followed.add(declaration.initializer);
      visit(declaration.initializer);
    }
  }

  function visit(node: ts.Node): void {
    const text = literalText(node);
    if (text !== null) strings.push(text);
    if (gluesPieces(node)) gluedPieces.push(node.getText(source));
    // `styles[`status${x}`]` is a CSS Module key, `styles.card` a lookup: only the object is a value.
    if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    // `cn(…)`: the callee joins, the arguments are the classes.
    if (ts.isCallExpression(node)) {
      node.arguments.forEach(visit);
      return;
    }
    const keyed = ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node);
    if (keyed && ts.isIdentifier(node.name)) strings.push(node.name.text);
    if (ts.isIdentifier(node)) readIdentifier(node);
    ts.forEachChild(node, visit);
  }

  classSinks(source).forEach(visit);
  return { strings, importedValues, gluedPieces };
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
): Pick<ModuleFacts, "propertyReads" | "dynamicPropertyReads"> {
  const reads: string[] = [...variablesReadIn(source.text)];
  const dynamic: string[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.name.text !== "getPropertyValue") return;
    const first = node.arguments[0];
    const name = first === undefined ? null : literalText(first);
    if (name === null) dynamic.push(node.getText(source));
    else if (name.startsWith("--")) reads.push(name);
  });
  return { propertyReads: [...new Set(reads)].sort(), dynamicPropertyReads: dynamic };
}

/**
 * One program over every script, served from memory: no lib, no module
 * resolution. The checker then binds each file's own scopes, which is all the
 * name lookups above need.
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

function scriptFacts(source: ts.SourceFile, checker: ts.TypeChecker): ModuleFacts {
  const sinks = readSinks(source, checker);
  return {
    classStrings: sinks.strings,
    literals: allLiterals(source),
    importedValues: sinks.importedValues,
    gluedPieces: sinks.gluedPieces,
    ...propertyReads(source),
  };
}

/** Facts for every file, keyed by the absolute path given. Throws if a script did not load. */
export function factsForFiles(
  texts: ReadonlyMap<string, string>,
): ReadonlyMap<string, ModuleFacts> {
  const scripts = new Map([...texts].filter(([path]) => SCRIPT.test(path)));
  const program = programFor(scripts);
  const checker = program.getTypeChecker();
  const entries = [...texts].map(([path, text]): readonly [string, ModuleFacts] => {
    if (!SCRIPT.test(path)) {
      const none = { classStrings: [], literals: [], importedValues: [], gluedPieces: [] };
      return [path, { ...none, propertyReads: variablesReadIn(text), dynamicPropertyReads: [] }];
    }
    const source = program.getSourceFile(path);
    if (source === undefined) throw new Error(`not loaded into the program: ${path}`);
    return [path, scriptFacts(source, checker)];
  });
  return new Map(entries);
}

export function moduleFacts(file: string, text: string): ModuleFacts {
  const path = resolve(file);
  const facts = factsForFiles(new Map([[path, text]])).get(path);
  if (facts === undefined) throw new Error(`no facts for ${path}`);
  return facts;
}
