/* @input  — the shipped workbench.css, the installed Tailwind compiler, and
 *           every production .ts / .tsx / .css file under a source root
 * @output — what Tailwind would scan and emit, and which walked files depend on
 *           it: utilities in class strings, class inputs the scan cannot see
 *           through, theme variables read through var() / getPropertyValue()
 * @pos    — test support for app/tailwind-source-scope.test.ts only. Nothing in
 *           the app imports it (it loads the Tailwind compiler); reading the
 *           modules (one TypeScript program over all of them) lives in
 *           tailwind-source-extract.ts
 * 一旦本文件被更新，务必更新开头注释
 */
import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compile } from "tailwindcss";
import {
  factsForFiles,
  moduleFacts,
  type ModuleFacts,
} from "./tailwind-source-extract.ts";

type Compiler = Awaited<ReturnType<typeof compile>>;
export type Check = (candidate: string) => boolean;

// A glob or negated @source needs a real matcher; guessing its coverage would
// make the scope test lie. `[projectId]` counts: Tailwind reads brackets as a glob.
const GLOB_CHARS = /[*?{}[\]!]/u;
// Spelled like a class: lowercase class characters only. Lets a literal that
// mixes custom classes with utilities ("legacy-card top-100") count.
const CLASS_TOKEN = /^[a-z0-9!:[\]()/.,%_#-]+$/u;
const SPELLED_UTILITY = /[-:[]/u;

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
 * `build()` with an already-known candidate changes nothing. Custom properties
 * are left to themeVariableCheck: asking for one adds a :root declaration and
 * would read as a utility.
 */
function utilityCheck(compiler: Compiler): Check {
  const known = new Map<string, boolean>();
  let output = compiler.build([]);
  return (candidate) => {
    if (candidate.startsWith("--")) return false;
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

function tokens(text: string): readonly string[] {
  return text.split(/\s+/u).filter((token) => token !== "");
}

/**
 * Utilities in a literal not known to reach a class sink. One token counts when
 * it is a utility spelled with `-`, `:` or `[` (a bare `flex` or `table` is
 * English); several count when all are utilities, or when every token is
 * spelled like a class and the spelled-out utilities among them are reported.
 */
function literalUtilities(text: string, isUtility: Check): readonly string[] {
  const parts = tokens(text);
  const [first, ...rest] = parts;
  if (first === undefined) return [];
  if (rest.length === 0) {
    return SPELLED_UTILITY.test(first) && isUtility(first) ? parts : [];
  }
  if (parts.every(isUtility)) return parts;
  if (!parts.every((part) => CLASS_TOKEN.test(part))) return [];
  return parts.filter((part) => SPELLED_UTILITY.test(part) && isUtility(part));
}

export function utilitiesIn(
  facts: ModuleFacts,
  isUtility: Check,
): readonly string[] {
  const fromSinks = facts.classStrings.flatMap(tokens).filter(isUtility);
  const fromLiterals = facts.literals.flatMap((literal) =>
    literalUtilities(literal, isUtility),
  );
  return [...new Set([...fromSinks, ...fromLiterals])].sort();
}

export function utilitiesInText(
  file: string,
  text: string,
  isUtility: Check,
): readonly string[] {
  return utilitiesIn(moduleFacts(file, text), isUtility);
}

/** Where an import points: a src path for `@/` and relative specifiers, null for a package. */
function importTarget(srcDir: string, file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return join(srcDir, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  return null;
}

/**
 * Class inputs whose text the scan cannot see, reported instead of read as
 * empty: an imported value from outside the roots (its module's strings are
 * never scanned, and a bare `collapse` there would not look like a class), a
 * literal glued onto a value (Tailwind cannot see `top-${n}` either), and a
 * getPropertyValue() whose name is computed.
 */
export function unresolvedInputs(
  srcDir: string,
  roots: readonly string[],
  file: string,
  facts: ModuleFacts,
): readonly string[] {
  const outsideImports = facts.importedValues.filter(({ specifier }) => {
    const target = importTarget(srcDir, file, specifier);
    return target === null || !isCovered(roots, target);
  });
  return [
    ...outsideImports.map(
      ({ name, specifier }) => `imported class value ${name} from "${specifier}"`,
    ),
    ...facts.gluedPieces.map((piece) => `glued class piece ${piece}`),
    ...facts.dynamicPropertyReads.map((call) => `computed property name ${call}`),
  ];
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
  /** src-relative path → class inputs the scan cannot see through. */
  readonly unresolved: Readonly<Record<string, readonly string[]>>;
  /** Imported values read by class sinks anywhere, resolved or not. */
  readonly importedValueCount: number;
  /** src-relative path → Tailwind theme variables the file reads. */
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
  readonly facts: ModuleFacts;
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
  const texts = new Map(
    productionFiles(srcDir).map((path) => [path, readFileSync(path, "utf8")] as const),
  );
  const factsByPath = factsForFiles(texts);
  const files: readonly WalkedFile[] = [...texts].map(([path, text]) => {
    const facts = factsByPath.get(path);
    if (facts === undefined) throw new Error(`no facts for ${path}`);
    const utilities = utilitiesIn(facts, isUtility);
    return { path, text, covered: isCovered(roots, path), facts, utilities };
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
    unresolved: byPath(srcDir, files, (file) =>
      unresolvedInputs(srcDir, roots, file.path, file.facts),
    ),
    importedValueCount: files.flatMap((file) => file.facts.importedValues).length,
    themeReads: byPath(srcDir, files, (file) =>
      file.facts.propertyReads.filter(isThemeVariable),
    ),
    emitted: await emittedVariables(cssPath, [...coveredUtilities, ...supplied]),
    isUtility,
    isThemeVariable,
  };
}
