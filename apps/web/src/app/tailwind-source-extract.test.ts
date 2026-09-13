import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { factsForFiles, moduleFacts, type ModuleFacts } from "./tailwind-source-extract.ts";
import { checksFor, emittedVariables, unresolvedInputs, utilitiesIn, type Checks } from "./tailwind-source-scan.ts";

/**
 * The reader behind app/tailwind-source-scope.test.ts, on fixtures. Each case is
 * an input that once passed the scope check while Tailwind could not see the
 * class it produced (gpt-6-astra review of T14, rounds 1 and 2), or a shape the
 * fix must keep reading as harmless. Paths are virtual: the files only exist in
 * the in-memory program.
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(APP_DIR, "..");
const CSS_PATH = join(APP_DIR, "workbench.css");
const SLOW = { timeout: 60_000 };
const CSS_MODULE = 'import styles from "./fixture.module.css";';
// The app's joiner, as the reader must find it: through its module, not its spelling.
const CX_MODULE = { "components/ui/cx.ts": "export function cx(...values: readonly unknown[]): string { return String(values); }" };
const CX_IMPORT = 'import { cx } from "@/components/ui/cx";';

let checks: Promise<Checks> | undefined;
function setup(): Promise<Checks> {
  checks ??= checksFor(CSS_PATH);
  return checks;
}

interface Read {
  readonly facts: ModuleFacts;
  readonly utilities: readonly string[];
  readonly unresolved: readonly string[];
}

/** Reads `target` out of a set of src-relative virtual files. */
async function read(files: Readonly<Record<string, string>>, target: string): Promise<Read> {
  const { isUtility, roots } = await setup();
  const texts = new Map(Object.entries(files).map(([path, text]) => [join(SRC_DIR, path), text] as const));
  const facts = factsForFiles(texts, SRC_DIR).get(join(SRC_DIR, target));
  if (facts === undefined) throw new Error(`fixture ${target} missing`);
  return { facts, utilities: utilitiesIn(facts, isUtility), unresolved: unresolvedInputs(roots, facts) };
}

const outside = (text: string): Promise<Read> => read({ "legacy/A.tsx": text }, "legacy/A.tsx");

describe("class values the reader follows", () => {
  it("through conditionals, clsx keys and same-file constants", SLOW, async () => {
    const { utilities } = await outside([
      CSS_MODULE,
      'import { clsx } from "clsx";',
      'const tone = "hidden";',
      "export const A = ({ on }: { on: boolean }) => (",
      '  <div className={on ? "flex gap-2" : styles.card}>',
      '    <p className={tone} /><i className={clsx({ italic: on })} /><b className="sf-eyebrow" />',
      "  </div>",
      ");",
    ].join("\n"));
    expect(utilities).toEqual(["flex", "gap-2", "hidden", "italic"]);
  });

  it("by scope: a shadowing local elsewhere neither hides nor replaces the constant a sink reads", SLOW, async () => {
    const { utilities, unresolved } = await outside([
      'const tone = "collapse";',
      "export const A = () => <div className={tone} />;",
      'export function B() { const tone = "local-label"; const value = `${1}%`; return <span>{tone}{value}</span>; }',
    ].join("\n"));
    expect(utilities).toContain("collapse");
    expect(unresolved).toEqual([]);
  });

  it("into the defaults of class-named parameters, which no call site writes", SLOW, async () => {
    const { utilities, unresolved } = await outside([
      'export function A({ className = "collapse" }: { className?: string }) { return <div className={className} />; }',
      'export function B(tableClassName = "grow") { return <table className={tableClassName} />; }',
    ].join("\n"));
    expect(utilities).toEqual(["collapse", "grow"]);
    expect(unresolved).toEqual([]);
  });

  it("through classList and setAttribute(\"class\")", SLOW, async () => {
    const { utilities } = await read(
      { "legacy/c.ts": 'export function f(el: Element) { el.classList.add("collapse"); el.setAttribute("class", "grow"); }' },
      "legacy/c.ts",
    );
    expect(utilities).toEqual(["collapse", "grow"]);
  });

  it("through destructuring of a static object, later assignment, a local function and a static JSX spread", SLOW, async () => {
    const { utilities, unresolved } = await outside([
      'const { tone } = { tone: "collapse" };',
      'export function B() { let late; late = "grow"; return <div className={late} />; }',
      'const getTone = () => "shrink";',
      'const props = { className: "contents", title: "x" };',
      "export const A = () => <><div className={tone} /><p className={getTone()} /><i {...props} /></>;",
    ].join("\n"));
    expect(utilities).toEqual(["collapse", "contents", "grow", "shrink"]);
    expect(unresolved).toEqual([]);
  });

  it("reading only the member a sink names, and only the value side of && (round 2 F6)", SLOW, async () => {
    const files = {
      ...CX_MODULE,
      "lib/flags.ts": "export const isActive = true;",
      "legacy/A.tsx": [
        CSS_MODULE,
        CX_IMPORT,
        'import { isActive } from "@/lib/flags";',
        "const state = { tone: styles.a, percent: `${10}%` };",
        'export const A = () => <><div className={cx(styles.a, isActive && "is-active")} /><p className={state.tone} /></>;',
      ].join("\n"),
    };
    expect((await read(files, "legacy/A.tsx")).unresolved).toEqual([]);
  });

  it("keeps CSS Module lookups, props passthrough, props rest spreads and next/font classes quiet", SLOW, async () => {
    const { utilities, unresolved } = await read({ ...CX_MODULE, "legacy/A.tsx": [
      CSS_MODULE,
      CX_IMPORT,
      'import { cx as joinClasses } from "@/components/ui";',
      'import { Plus_Jakarta_Sans } from "next/font/google";',
      'const face = Plus_Jakarta_Sans({ variable: "--font-wb" });',
      "export function A({ className, ...rest }: { className?: string }) {",
      "  return <div className={`${styles.a} ${face.variable} ${className ?? \"\"}`} {...rest} />;",
      "}",
      "export const B = (props: { className: string }) => <i className={cx(styles.hidden, props.className)} />;",
      "export const C = ({ n }: { n: string }) => <b className={styles[`status${n}`]} />;",
      'export const D = () => <u className={[styles.a, joinClasses(styles.b)].filter(Boolean).join(" ")} />;',
    ].join("\n"), "components/ui/index.ts": 'export { cx } from "./cx.ts";' }, "legacy/A.tsx");
    expect(utilities).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("counts a literal mixing custom classes with utilities, but not prose mentioning one (round 2 F8)", SLOW, async () => {
    const { utilities } = await read({
      "legacy/c.ts": [
        'export const CARD = "rounded-lg border px-3";',
        'export const LEGACY = "legacy-card top-100";',
        'export const LABEL = "Open the table";',
        'export const HELP = "please use top-20 carefully";',
        'export const VAR = "--color-slate-400";',
      ].join("\n"),
    }, "legacy/c.ts");
    expect(utilities).toEqual(["border", "px-3", "rounded-lg", "top-100"]);
  });
});

describe("class values the reader reports instead of reading as empty", () => {
  it("a parameter, a destructured parameter, and a prop renamed on its way to className (round 2 F1, F3)", SLOW, async () => {
    const { unresolved } = await outside([
      'function renderBadge(tone = "collapse") { return <div className={tone} />; }',
      'export function C({ look = "grow" }: { look?: string }) { return <p className={look} />; }',
      "function Card({ tone }: { tone: string }) { return <i className={tone} />; }",
      'export const A = () => <Card tone="hidden" />;',
      "export default function Page() { return renderBadge(); }",
    ].join("\n"));
    expect(unresolved).toEqual([
      'class value from parameter: tone = "collapse"',
      'class value from destructured parameter: look = "grow"',
      "class value from destructured parameter: tone",
    ]);
  });

  it("a call it cannot follow, an unknown spread, an import = require, a name it cannot bind, a member of an unseen object", SLOW, async () => {
    const { unresolved } = await outside([
      'import { badgeClass } from "@/lib/badge";',
      'import tone = require("./classes");',
      "const box = makeBox();",
      "export const A = (x: object) => (",
      "  <><div className={badgeClass()} /><p {...makeProps()} /><i className={tone} /><b className={missing} /><u className={box.className} /></>",
      ");",
    ].join("\n"));
    expect(unresolved).toEqual([
      "class value from call: badgeClass()",
      "class value from JSX spread: makeProps()",
      'class value from declaration: import tone = require("./classes");',
      "class value from an undeclared name: missing",
      "class value from member: box.className",
    ]);
  });

  it("literals glued onto something, through constants too (round 1 F4, round 2 F5)", SLOW, async () => {
    const { unresolved } = await read({
      "components/workbench/P.tsx": [
        'const prefix = "top-";',
        "const offset = 100;",
        "export const P = () => <><div className={prefix + offset} /><p className={`top-${offset}`} /><i className={\"top-\" + 1} /></>;",
      ].join("\n"),
    }, "components/workbench/P.tsx");
    expect(unresolved).toEqual([
      "glued class piece prefix + offset",
      "glued class piece `top-${offset}`",
      'glued class piece "top-" + 1',
    ]);
  });

  it("an import defined outside the roots, also through a barrel inside them; not the reverse (round 2 F2)", SLOW, async () => {
    const files = {
      "legacy/classes.ts": 'export const x = "collapse";',
      "components/workbench/barrel.ts": 'export { x as y } from "../../legacy/classes";',
      "components/workbench/tokens.ts": 'export const CARD = "rounded-lg";',
      "lib/barrel.ts": 'export * from "@/components/workbench/tokens";',
      "legacy/A.tsx": [
        'import { y } from "@/components/workbench/barrel";',
        'import { CARD } from "@/lib/barrel";',
        'import { SHELL } from "@sf/ui";',
        "export const A = () => <><div className={y} /><p className={CARD} /><i className={SHELL} /></>;",
      ].join("\n"),
    };
    expect((await read(files, "legacy/A.tsx")).unresolved).toEqual([
      'imported class value y from "@/components/workbench/barrel", defined outside the roots',
      'imported class value SHELL from package "@sf/ui"',
    ]);
  });
});

describe("round 3 (gpt-6-astra): shapes that read as empty before", () => {
  it("reads computed literal keys, rewrites, props defaults, overload bodies, local look-alike joiners and space joins", SLOW, async () => {
    const { utilities, unresolved } = await outside([
      'const state = { ["tone"]: "collapse" };',
      'const pair = { tone: "", mode: "lowercase" };',
      'export function B({ className = "" }: { className?: string }) { className = "grow"; return <div className={className} />; }',
      'export function C(props = { className: "shrink" }) { return <div {...props} />; }',
      'export function D({ className } = { className: "contents" }) { return <div className={className} />; }',
      "function tone(): string;",
      'function tone() { return "italic"; }',
      'function cn() { return "underline"; }',
      "export const A = (n: number) => (",
      '  <><div className={state.tone} /><i {...{ ["className"]: "uppercase" }} /><p className={tone()} /><b className={cn()} />',
      '  <u className={["truncate"].join(" ")} /><s {...{ [`data-${n}`]: "" }} /><em className={pair["tone"]} /></>',
      ");",
    ].join("\n"));
    expect(utilities).toEqual(["collapse", "contents", "grow", "italic", "shrink", "truncate", "underline", "uppercase"]);
    expect(unresolved).toEqual([]);
  });

  it("reports an object written through a member, a dynamic computed key and a join that glues", SLOW, async () => {
    const { unresolved } = await outside([
      'const props = { className: "" };',
      'props.className = "collapse";',
      'export const A = (k: string) => <><div {...props} /><p {...{ [k]: "grow" }} /><i className={["col", "lapse"].join("")} /></>;',
    ].join("\n"));
    expect(unresolved).toEqual([
      "class value from JSX spread: props",
      'class value behind a computed key: [k]: "grow"',
      'class value from join: ["col", "lapse"].join("")',
    ]);
  });

  it("follows a root file that only re-labels an outside value: default export, alias, namespace member", SLOW, async () => {
    const files = {
      "legacy/classes.ts": 'export const x = "collapse";',
      "components/workbench/barrel.ts": 'import { x } from "../../legacy/classes";\nexport default x;\nexport const y = x;\nexport { x };',
      "components/workbench/tokens.ts": 'import styles from "./tokens.module.css";\nexport const TONE = { ok: styles.ok, warn: "text-amber-700" };',
      "legacy/A.tsx": [
        'import value, { y, TONE } from "@/components/workbench/barrel";',
        'import * as palette from "@/components/workbench/barrel";',
        'import { TONE as tones } from "@/components/workbench/tokens";',
        "export const A = () => <><div className={value} /><p className={y} /><i className={palette.x} /><b className={tones.warn} /></>;",
      ].join("\n"),
    };
    expect((await read(files, "legacy/A.tsx")).unresolved).toEqual([
      'imported class value value from "@/components/workbench/barrel", defined outside the roots',
      'imported class value y from "@/components/workbench/barrel", defined outside the roots',
      'imported class value palette.x from "@/components/workbench/barrel", defined outside the roots',
    ]);
  });

  it("reads stylesheets: classes composed from global, Tailwind directives outside the entry, --name in style queries", SLOW, async () => {
    const module = await read({
      "legacy/A.module.css": [
        ".box { composes: collapse from global; }",
        ".card { @apply rounded-lg; }",
        "@container card style(--color-slate-400) { .box { --local-gap: 4px; } }",
      ].join("\n"),
    }, "legacy/A.module.css");
    expect(module.utilities).toEqual(["collapse"]);
    expect(module.unresolved).toEqual(["Tailwind directive @apply in a stylesheet Tailwind does not compile"]);
    expect(module.facts.propertyReads).toEqual(["--color-slate-400"]);
    const entry = await read({ "app/entry.css": '@import "tailwindcss/utilities.css";\n@utility wb-x { color: red; }' }, "app/entry.css");
    expect(entry.unresolved).toEqual([]);
  });
});

describe("round 4 (gpt-6-astra): the round 3 fixes, completed", () => {
  it("reads a numeric key conservatively and props defaults through a local rest; reports a destructuring write", SLOW, async () => {
    const { utilities, unresolved } = await outside([
      'let tone = "";',
      '({ tone } = { tone: "collapse" });',
      'const tones = { 2: "grow", 11: "" };',
      'export function C(props = { className: "shrink" }) { const { ...rest } = props; return <div {...rest} />; }',
      "export const A = () => <><div className={tone} /><p className={tones[1 + 1]} /></>;",
    ].join("\n"));
    expect(utilities).toEqual(["grow", "shrink"]);
    expect(unresolved).toEqual(["class value written through a member or destructuring: tone"]);
  });

  it("does not place a let or destructured export in its file; checks a barrel joiner by its package name", SLOW, async () => {
    const files = {
      "legacy/values.ts": 'export const x = "collapse";',
      "components/workbench/tone.ts": 'import { x } from "../../legacy/values";\nlet tone = "";\ntone = x;\nexport default tone;',
      "components/workbench/pair.ts": 'import { x } from "../../legacy/values";\nconst { value: tone } = { value: x };\nexport default tone;',
      "components/workbench/join.ts": 'export { clsx as cx } from "clsx";',
      "legacy/A.tsx": [
        'import tone from "@/components/workbench/tone";',
        'import pair from "@/components/workbench/pair";',
        'import { cx } from "@/components/workbench/join";',
        'export const A = () => <><div className={tone} /><p className={pair} /><i className={cx("legacy-card")} /></>;',
      ].join("\n"),
    };
    expect((await read(files, "legacy/A.tsx")).unresolved).toEqual([
      'imported class value tone from "@/components/workbench/tone": default in components/workbench/tone.ts reads tone, which is not a const',
      'imported class value pair from "@/components/workbench/pair": default in components/workbench/pair.ts reads tone, which is bound by destructuring',
    ]);
  });

  it("reads --name in a style query with a value, and ignores quoted text in a stylesheet", SLOW, async () => {
    const { facts, unresolved } = await read({
      "legacy/A.module.css": [
        "@container card style(--color-slate-400: red) { .box { --local-gap: 4px; margin: var(--local-gap); } }",
        '.box::before { content: "@apply --not-a-read"; }',
      ].join("\n"),
    }, "legacy/A.module.css");
    expect(unresolved).toEqual([]);
    expect(facts.propertyReads).toEqual(["--color-slate-400", "--local-gap"]);
  });
});

describe("custom properties", () => {
  it("reads var() and getPropertyValue() names, resolving constants before calling one computed", SLOW, async () => {
    const { isThemeVariable } = await setup();
    const css = "/* var(--color-wb-rail) */ .a { color: var(--color-slate-400, #94a3b8); font: var( --font-wb, serif); }";
    expect(moduleFacts("fixture.css", css).propertyReads).toEqual(["--color-slate-400", "--font-wb"]);
    const { facts } = await read({
      "legacy/c.ts": [
        'const key = "color";',
        'export const a = (el: Element) => getComputedStyle(el).getPropertyValue("--color-wb-" + "rail");',
        "export const b = (el: Element) => getComputedStyle(el).getPropertyValue(key);",
        "export const c = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name);",
      ].join("\n"),
    }, "legacy/c.ts");
    expect(facts.propertyReads).toEqual(["--color-wb-rail"]);
    expect(facts.dynamicPropertyReads).toEqual(["getComputedStyle(el).getPropertyValue(name)"]);
    expect(["--color-slate-400", "--font-wb"].filter(isThemeVariable)).toEqual(["--color-slate-400"]);
    // The failure mode itself: nothing scanned mentions it, so :root lacks it.
    expect((await emittedVariables(CSS_PATH, [])).has("--color-slate-400")).toBe(false);
    expect((await emittedVariables(CSS_PATH, ["--color-slate-400"])).has("--color-slate-400")).toBe(true);
  });
});
