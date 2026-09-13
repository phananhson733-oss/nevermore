/* @input  — the shipped workbench.css, the installed Tailwind compiler, and
 *           every production .ts / .tsx / .css file under a source root
 * @output — what Tailwind would scan and emit, and which walked files depend on
 *           it: utilities in class strings, theme variables read through var()
 * @pos    — test support for app/tailwind-source-scope.test.ts only. Nothing in
 *           the app imports it (it loads typescript and the Tailwind compiler)
 * 一旦本文件被更新，务必更新开头注释
 */
import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compile } from "tailwindcss";
import ts from "typescript";

type Compiler = Awaited<ReturnType<typeof compile>>;
export type Check = (candidate: string) => boolean;

const CLASS_ATTRIBUTE = /^(?:class|className|[A-Za-z]+ClassName)$/u;
// A glob or negated @source needs a real matcher; guessing its coverage would
// make the scope test lie. `[projectId]` counts: Tailwind reads brackets as a glob.
const GLOB_CHARS = /[*?{}[\]!]/u;

export async function compileStylesheet(cssPath: string): Promise<Compiler> {
  const resolveId = createRequire(import.meta.url).resolve;
  return compile(readFileSync(cssPath, "utf8"), {
    base: dirname(cssPath),
    loadStylesheet: async (id: string) => {
      const path = resolveId(id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
}

/**
 * `build()` is incremental and returns the whole stylesheet, so a candidate is a
 * utility exactly when adding it changes the output. Memoised: a second
 * `build()` with an already-known candidate changes nothing.
 */
function utilityCheck(compiler: Compiler): Check {
  const known = new Map<string, boolean>();
  let output = compiler.build([]);
  return (candidate) => {
    const cached = known.get(candidate);
    if (cached !== undefined) return cached;
    const next = compiler.build([candidate]);
    const isUtility = next !== output;
    known.set(candidate, isUtility);
    output = next;
    return isUtility;
  };
}

/** Custom properties declared in the compiled `:root, :host` rule. */
export function rootVariables(css: string): ReadonlySet<string> {
  const bodies = [...css.matchAll(/:root,\s*:host\s*\{([^}]*)\}/gu)];
  const declarations = bodies.flatMap((body) => [
    ...(body[1] ?? "").matchAll(/(--[\w-]+)\s*:/gu),
  ]);
  return new Set(declarations.map((match) => match[1] ?? ""));
}

/**
 * A theme variable is one the compiler declares in :root once asked for it.
 * Membership, not "did the output change": a variable this stylesheet already
 * reads is emitted before anyone asks, and a change test would call it foreign.
 */
function themeVariableCheck(compiler: Compiler): Check {
  const known = new Map<string, boolean>();
  return (name) => {
    const cached = known.get(name);
    if (cached !== undefined) return cached;
    const isTheme = rootVariables(compiler.build([name])).has(name);
    known.set(name, isTheme);
    return isTheme;
  };
}

/** Theme variables in :root when the compiler sees exactly `candidates`. */
export async function emittedVariables(
  cssPath: string,
  candidates: readonly string[],
): Promise<ReadonlySet<string>> {
  const compiler = await compileStylesheet(cssPath);
  return rootVariables(compiler.build([...candidates]));
}

function scanRoots(compiler: Compiler): readonly string[] {
  return compiler.sources.map((source) => {
    if (source.negated || GLOB_CHARS.test(source.pattern)) {
      throw new Error(`unsupported @source entry: ${JSON.stringify(source)}`);
    }
    return resolve(source.base, source.pattern);
  });
}

export function isCovered(roots: readonly string[], file: string): boolean {
  return roots.some((root) => file === root || file.startsWith(root + sep));
}

/** `globSync` returns [] for a missing root instead of throwing: callers need floors. */
function productionFiles(root: string): readonly string[] {
  return globSync("**/*.{ts,tsx,css}", { cwd: root })
    .filter((path) => !/\.test\.tsx?$/u.test(path) && !path.endsWith(".d.ts"))
    .map((path) => join(root, path))
    .sort();
}

function literalText(node: ts.Node): string | null {
  const plain =
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  const piece =
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node);
  return plain || piece ? node.text : null;
}

/**
 * Every string that can reach a class attribute: literals, template pieces, both
 * arms of a conditional, `cn()` / `clsx()` arguments and object keys, and the
 * initializer of a same-file variable the attribute names. Member access
 * (`styles.card`) is a CSS Module lookup, so only its object is followed.
 */
function classAttributeStrings(source: ts.SourceFile): readonly string[] {
  const declarations = new Map<string, ts.Expression>();
  const index = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.initializer) declarations.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, index);
  };
  index(source);
  const found: string[] = [];
  const followed = new Set<ts.Expression>();
  const collect = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== null) found.push(text);
    if (ts.isPropertyAccessExpression(node)) return collect(node.expression);
    const keyed =
      ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node);
    if (keyed && ts.isIdentifier(node.name)) found.push(node.name.text);
    const target = ts.isIdentifier(node)
      ? declarations.get(node.text)
      : undefined;
    if (target !== undefined && !followed.has(target)) {
      followed.add(target);
      collect(target);
    }
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node): void => {
    const name = ts.isJsxAttribute(node) ? node.name.getText(source) : "";
    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      CLASS_ATTRIBUTE.test(name)
    ) {
      collect(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
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

function tokens(text: string): readonly string[] {
  return text.split(/\s+/u).filter((token) => token !== "");
}

/**
 * Outside a class attribute a literal counts when every token is a utility, or
 * when it is one utility spelled with `-`, `:` or `[`. A bare `flex`, `block` or
 * `table` is ordinary English and would flag prose.
 */
function looksLikeClassList(text: string, isUtility: Check): boolean {
  const parts = tokens(text);
  const [only, ...rest] = parts;
  if (only === undefined) return false;
  if (rest.length === 0) return /[-:[]/u.test(only) && isUtility(only);
  return parts.every(isUtility);
}

/** Utilities a .ts / .tsx module carries in class strings; [] for anything else. */
export function utilitiesInText(
  file: string,
  text: string,
  isUtility: Check,
): readonly string[] {
  if (!/\.tsx?$/u.test(file)) return [];
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const fromAttributes = classAttributeStrings(source)
    .flatMap(tokens)
    .filter(isUtility);
  const fromLiterals = allLiterals(source)
    .filter((literal) => looksLikeClassList(literal, isUtility))
    .flatMap(tokens);
  return [...new Set([...fromAttributes, ...fromLiterals])].sort();
}

/**
 * Custom properties read through var(). Block comments are dropped: a var() in a
 * comment reads nothing (workbench.css quotes one while explaining this check).
 */
export function variablesReadIn(text: string): readonly string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//gu, "");
  const names = [...code.matchAll(/var\(\s*(--[\w-]+)/gu)].map(
    (m) => m[1] ?? "",
  );
  return [...new Set(names)].filter((name) => name !== "").sort();
}

/** Custom-property-shaped tokens: what the Tailwind scanner hands on from a scanned file. */
function variableTokensIn(text: string): readonly string[] {
  return [...new Set(text.match(/--[A-Za-z0-9][\w-]*/gu) ?? [])];
}

export interface Scan {
  readonly compilerRoot: Compiler["root"];
  readonly roots: readonly string[];
  readonly files: readonly string[];
  readonly coveredUtilities: ReadonlySet<string>;
  /** src-relative path → utilities, for files outside the roots that have any. */
  readonly outsideUtilities: Readonly<Record<string, readonly string[]>>;
  /** src-relative path → Tailwind theme variables the file reads through var(). */
  readonly themeReads: Readonly<Record<string, readonly string[]>>;
  /** :root variables given only what the roots supply (their utilities and variable tokens). */
  readonly emitted: ReadonlySet<string>;
  readonly isUtility: Check;
  readonly isThemeVariable: Check;
}

interface WalkedFile {
  readonly path: string;
  readonly text: string;
  readonly covered: boolean;
  readonly utilities: readonly string[];
}

function byPath(
  srcDir: string,
  files: readonly WalkedFile[],
  pick: (file: WalkedFile) => readonly string[],
): Readonly<Record<string, readonly string[]>> {
  const entries = files
    .map((file) => [relative(srcDir, file.path), pick(file)] as const)
    .filter(([, values]) => values.length > 0);
  return Object.fromEntries(entries);
}

export async function scanTailwindSources(
  srcDir: string,
  cssPath: string,
): Promise<Scan> {
  const utilityCompiler = await compileStylesheet(cssPath);
  const roots = scanRoots(utilityCompiler);
  const isUtility = utilityCheck(utilityCompiler);
  const isThemeVariable = themeVariableCheck(await compileStylesheet(cssPath));
  const files: readonly WalkedFile[] = productionFiles(srcDir).map((path) => {
    const text = readFileSync(path, "utf8");
    const utilities = utilitiesInText(path, text, isUtility);
    return { path, text, covered: isCovered(roots, path), utilities };
  });
  const covered = files.filter((file) => file.covered);
  const coveredUtilities = new Set(covered.flatMap((file) => file.utilities));
  const supplied = covered.flatMap((file) => variableTokensIn(file.text));
  return {
    compilerRoot: utilityCompiler.root,
    roots,
    files: files.map((file) => file.path),
    coveredUtilities,
    outsideUtilities: byPath(srcDir, files, (file) =>
      file.covered ? [] : file.utilities,
    ),
    themeReads: byPath(srcDir, files, (file) =>
      variablesReadIn(file.text).filter(isThemeVariable),
    ),
    emitted: await emittedVariables(cssPath, [
      ...coveredUtilities,
      ...supplied,
    ]),
    isUtility,
    isThemeVariable,
  };
}
