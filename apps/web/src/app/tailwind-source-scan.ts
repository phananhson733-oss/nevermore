/* @input  — the shipped workbench.css, the installed Tailwind compiler, and
 *           every production .ts / .tsx / .css file under apps/web/src and
 *           packages/*\/src
 * @output — what Tailwind would scan and emit, and which walked files depend on
 *           it: utilities in class strings, class inputs out of static sight,
 *           theme variables read through var() / getPropertyValue()
 * @pos    — test support for app/tailwind-source-scope.test.ts and
 *           app/tailwind-source-extract.test.ts only. Nothing in the app imports
 *           it (it loads the Tailwind compiler); reading the files lives in
 *           tailwind-source-extract.ts
 * 一旦本文件被更新，务必更新开头注释
 */
import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compile } from "tailwindcss";
import { factsForFiles, type ModuleFacts } from "./tailwind-source-extract.ts";

type Compiler = Awaited<ReturnType<typeof compile>>;
export type Check = (candidate: string) => boolean;

// A glob or negated @source needs a real matcher; guessing its coverage would
// make the scope test lie. `[projectId]` counts: Tailwind reads brackets as a glob.
const GLOB_CHARS = /[*?{}[\]!]/u;
// Spelled like a class list: lowercase class characters only.
const CLASS_TOKEN = /^[a-z0-9!:[\]()/.,%_#-]+$/u;
const SPELLED_UTILITY = /[-:[]/u;
// Spelled like a class name rather than an English word: `legacy-card`, not `please`.
const SPELLED_CLASS = /[-_:[]/u;
// Generated from the OpenAPI contract and a DataForSEO location dump: data, no markup.
const GENERATED = /(?:^|\/)generated\//u;

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
  const declarations = bodies.flatMap((body) => [...(body[1] ?? "").matchAll(/(--[\w-]+)\s*:/gu)]);
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
export async function emittedVariables(cssPath: string, candidates: readonly string[]): Promise<ReadonlySet<string>> {
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

export interface Checks {
  readonly roots: readonly string[];
  readonly isUtility: Check;
  readonly isThemeVariable: Check;
}

export async function checksFor(cssPath: string): Promise<Checks> {
  const utilityCompiler = await compileStylesheet(cssPath);
  return {
    roots: scanRoots(utilityCompiler),
    isUtility: utilityCheck(utilityCompiler),
    isThemeVariable: themeVariableCheck(await compileStylesheet(cssPath)),
  };
}

export function isCovered(roots: readonly string[], file: string): boolean {
  return roots.some((root) => file === root || file.startsWith(root + sep));
}

/** `globSync` returns [] for a missing root instead of throwing: callers need floors. */
function walkFiles(root: string, pattern: string): readonly string[] {
  return globSync(pattern, { cwd: root })
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
 * English); several count when all are utilities, or when every token is a
 * utility or spelled like a class name ("legacy-card top-100", not
 * "please use top-100 carefully").
 */
function literalUtilities(text: string, isUtility: Check): readonly string[] {
  const parts = tokens(text);
  const [first, ...rest] = parts;
  if (first === undefined) return [];
  if (rest.length === 0) return SPELLED_UTILITY.test(first) && isUtility(first) ? parts : [];
  if (!parts.every((part) => CLASS_TOKEN.test(part))) return [];
  if (!parts.every((part) => isUtility(part) || SPELLED_CLASS.test(part))) return [];
  return parts.filter(isUtility);
}

export function utilitiesIn(facts: ModuleFacts, isUtility: Check): readonly string[] {
  const fromSinks = facts.classStrings.flatMap(tokens).filter(isUtility);
  const fromLiterals = facts.literals.flatMap((literal) => literalUtilities(literal, isUtility));
  return [...new Set([...fromSinks, ...fromLiterals])].sort();
}

/**
 * Class inputs whose text the scan cannot see, reported instead of read as
 * empty: an imported value defined outside the roots (or in a package, or
 * nowhere walked), a literal glued onto something (Tailwind cannot see
 * `top-${n}` either), a value the reader could not follow, and a
 * getPropertyValue() whose name is computed.
 */
export function unresolvedInputs(roots: readonly string[], facts: ModuleFacts): readonly string[] {
  const imports = facts.importedValues.flatMap(({ name, specifier, definition }) => {
    if (definition.kind === "file") {
      return isCovered(roots, definition.path) ? [] : [`imported class value ${name} from "${specifier}", defined outside the roots`];
    }
    if (definition.kind === "package") return [`imported class value ${name} from package "${specifier}"`];
    return [`imported class value ${name} from "${specifier}": ${definition.reason}`];
  });
  return [
    ...imports,
    ...facts.gluedPieces.map((piece) => `glued class piece ${piece}`),
    ...facts.opaqueValues,
    ...facts.dynamicPropertyReads.map((call) => `computed property name ${call}`),
  ];
}

/** Custom-property-shaped tokens: what the Tailwind scanner hands on from a scanned file. */
function variableTokensIn(text: string): readonly string[] {
  return [...new Set(text.match(/--[A-Za-z0-9][\w-]*/gu) ?? [])];
}

export interface ScanInput {
  readonly srcDir: string;
  readonly packagesDir: string;
  readonly cssPath: string;
}

export interface Scan extends Checks {
  readonly compilerRoot: Compiler["root"];
  /** Walked files, labelled src-relative or `packages/…`. */
  readonly files: readonly string[];
  /** Generated files left out of the walk, labelled the same way. */
  readonly skipped: readonly string[];
  readonly coveredUtilities: ReadonlySet<string>;
  /** label → utilities, for files outside the roots that have any. */
  readonly outsideUtilities: Readonly<Record<string, readonly string[]>>;
  /** label → class inputs the scan cannot see through. */
  readonly unresolved: Readonly<Record<string, readonly string[]>>;
  /** Imports read by class values anywhere, resolved or not. */
  readonly importedValueCount: number;
  /** label → Tailwind theme variables the file reads. */
  readonly themeReads: Readonly<Record<string, readonly string[]>>;
  /** :root variables given only what the roots supply (their utilities and variable tokens). */
  readonly emitted: ReadonlySet<string>;
}

interface WalkedFile {
  readonly label: string;
  readonly text: string;
  readonly covered: boolean;
  readonly facts: ModuleFacts;
  readonly utilities: readonly string[];
}

function byLabel(
  files: readonly WalkedFile[],
  pick: (file: WalkedFile) => readonly string[],
): Readonly<Record<string, readonly string[]>> {
  const entries = files.map((file) => [file.label, pick(file)] as const).filter(([, values]) => values.length > 0);
  return Object.fromEntries(entries);
}

function walkedFiles(input: ScanInput, checks: Checks): { readonly files: readonly WalkedFile[]; readonly skipped: readonly string[] } {
  const label = (path: string): string =>
    path.startsWith(input.srcDir + sep) ? relative(input.srcDir, path) : join("packages", relative(input.packagesDir, path));
  const packages = walkFiles(input.packagesDir, "*/src/**/*.{ts,tsx,css}");
  const paths = [...walkFiles(input.srcDir, "**/*.{ts,tsx,css}"), ...packages.filter((p) => !GENERATED.test(p))];
  const texts = new Map(paths.map((path) => [path, readFileSync(path, "utf8")] as const));
  const factsByPath = factsForFiles(texts, input.srcDir);
  const files = [...texts].map(([path, text]) => {
    const facts = factsByPath.get(path);
    if (facts === undefined) throw new Error(`no facts for ${path}`);
    const utilities = utilitiesIn(facts, checks.isUtility);
    return { label: label(path), text, covered: isCovered(checks.roots, path), facts, utilities };
  });
  return { files, skipped: packages.filter((p) => GENERATED.test(p)).map(label) };
}

export async function scanTailwindSources(input: ScanInput): Promise<Scan> {
  const checks = await checksFor(input.cssPath);
  const compilerRoot = (await compileStylesheet(input.cssPath)).root;
  const { files, skipped } = walkedFiles(input, checks);
  const covered = files.filter((file) => file.covered);
  const coveredUtilities = new Set(covered.flatMap((file) => file.utilities));
  const supplied = covered.flatMap((file) => variableTokensIn(file.text));
  return {
    ...checks,
    compilerRoot,
    files: files.map((file) => file.label),
    skipped,
    coveredUtilities,
    outsideUtilities: byLabel(files, (file) => (file.covered ? [] : file.utilities)),
    unresolved: byLabel(files, (file) => unresolvedInputs(checks.roots, file.facts)),
    importedValueCount: files.flatMap((file) => file.facts.importedValues).length,
    themeReads: byLabel(files, (file) => file.facts.propertyReads.filter(checks.isThemeVariable)),
    emitted: await emittedVariables(input.cssPath, [...coveredUtilities, ...supplied]),
  };
}
