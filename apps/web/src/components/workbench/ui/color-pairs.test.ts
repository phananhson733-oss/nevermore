/**
 * Computed contrast gate for every colour pair the ui primitives render.
 *
 * It exists because the first version of these primitives carried six contrast
 * ratios in comments and none of them was computed — and the one pair nobody
 * wrote a sentence about (`PANEL_TAG`, slate-500 on slate-100, 4.35:1 at 12px)
 * was the one that missed AA. A ratio in prose is a claim; this file is the gate.
 *
 * Two halves, and they check each other:
 *
 * 1. `PAIRS` is written out here, in the test, with the size it is rendered at
 *    and the threshold that size implies. Each row is measured against the
 *    theme the build compiles: a `--color-*` declared in the `@theme` blocks of
 *    app/workbench.css wins over Tailwind's theme as installed, as it does in
 *    the compiled utility (Tailwind values are `oklch()`; workbench tokens are
 *    hex). Only the conversion's calibration reads Tailwind's theme on its own.
 * 2. The string literals of every non-test .ts / .tsx module under ui/ are
 *    parsed (walked, not listed): double- or single-quoted, and template
 *    literals, which may span lines. A template with a `${…}` interpolation and
 *    a `text-` / `bg-` class anywhere in it cannot be read statically, so it is
 *    reported and fails the gate rather than being skipped. The pairs found must
 *    be exactly the rows in `PAIRS`: no missing row (a text colour and a fill
 *    written in one literal cannot go unmeasured) and no stale row (a row cannot
 *    be added to silence the gate without the source actually using it). The
 *    walk replaced a hand-kept list of thirteen files: a new ui file writing
 *    slate-400 body copy passed 33/33, and four primitives already outside the
 *    list (DemoChip, Dialog, PageHead, LegacyLinks) rendered one pair nobody had
 *    measured (amber-700 on amber-50) and one fill the parser cannot read (the
 *    Dialog scrim, see `EXEMPT`).
 *
 * Thresholds are WCAG 1.4.3: 4.5:1 for body text, 3:1 only for large text
 * (>= 24px, or >= 18.66px bold). A `text-*` class with no `bg-*` in the same
 * string is measured on BOTH white (every card and panel shell here is
 * `bg-white`) and `wb-paper` (the `#wb-app` page ground, ShellChrome.tsx:100),
 * because a view may place a primitive on either.
 *
 * Scope is ui/, not all of components/workbench: shell/ puts the dark rail
 * ground on ancestor elements (Sidebar, SiteCard), so reading pairs one class
 * string at a time measures rail text against white. Walking the whole tree on
 * 2026-09-14 gave 30 unmeasured pairs and 3 unreadable tokens from files outside
 * ui/, most of them that artefact. The rail tiers are measured in
 * app/workbench-tokens.test.ts; nothing outside ui/ is checked here.
 *
 * What this file is not: a measurement of what renders. It reads literals. The
 * real contrast gate is T17's e2e, which runs axe `color-contrast` over rendered
 * pages and so sees theme overrides, composition and opacity. Known blind spots
 * here, left open on purpose rather than chased with a parser:
 *
 * - Text colour and fill on different elements. A `bg-amber-50` wrapper around
 *   a `text-amber-700` child is measured against white and wb-paper instead of
 *   that fill, so a 3.075:1 combination written that way passes every case
 *   here. Zero places in ui/ do that today. Counted 2026-09-14 over the non-test
 *   ui/ modules: 17 class strings carry a fill other than white / wb-paper
 *   (variant fills included). 13 name their text colour in the same string, and
 *   every use site inside ui/ gives that element plain text only (Chip children
 *   and TABLE_ROW cells come from views, outside this walk); the other 4 render
 *   no text (SWITCH_TRACK, the two RunningSteps dots, the Dialog scrim).
 *   Re-count when a filled element gains nested text.
 * - Text colour and fill on the same element, in different literals. Joined
 *   through `cn(...)`, a constant (`cn(FG, BG)`) or a conditional, each literal
 *   is measured on its own: the text on white and wb-paper, the fill with no
 *   text, never the two together.
 * - Font size. A pair carries no size from the source: the large-text threshold
 *   is granted by the `px` written in `PAIRS`, so small text reusing a colour
 *   that has a 36px row (`text-xs text-amber-600`) is measured as that row and
 *   passes.
 * - A standalone `opacity-*` on the element is not composited into either
 *   colour (an opacity modifier on the token itself, `bg-slate-50/50`, is
 *   reported).
 * - A token behind a bracketed arbitrary variant (`[&]:text-slate-400`) does not
 *   parse as a `text-` / `bg-` class and is skipped, not reported.
 * - `EXEMPT` is checked by occurrence count and by the absence of a text colour
 *   in the same literal, not by what the element renders: the scrim gaining
 *   text children with no text colour class would not show here.
 * - Theme: only single `--color-<name>` declarations are read from `@theme`; a
 *   namespace reset such as `--color-*: initial` is not modelled.
 *
 * Mechanism (theme reading, oklch → linear sRGB, WCAG luminance) is copied from
 * app/workbench-tokens.test.ts rather than imported: that file is a test suite.
 *
 * 一旦本文件被更新，务必更新开头注释
 */

import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const AA_TEXT = 4.5;
const AA_LARGE = 3;
/** Below this size, WCAG's large-text allowance does not apply. */
const LARGE_PX = 24;

/** Every ground a primitive can sit on when its own class string names no fill. */
const GROUNDS = ["white", "wb-paper"] as const;

/** `[foreground, background, px, threshold]`, px = the smallest size it renders at. */
const PAIRS: readonly (readonly [string, string, number, number])[] = [
  // panel.ts
  ["slate-600", "slate-100", 12, AA_TEXT], // PANEL_TAG
  ["slate-900", "white", 15, AA_TEXT], // PANEL_TITLE, EmptyState title, default accent
  ["slate-900", "wb-paper", 15, AA_TEXT],
  ["slate-500", "white", 12, AA_TEXT], // FOOT_NOTE, TABLE_HEAD_ROW, Field meta, unknown dash
  ["slate-500", "wb-paper", 12, AA_TEXT],
  ["slate-700", "white", 12, AA_TEXT], // TABLE_ROW, BUTTON_SECONDARY, BUTTON_MINI
  ["slate-700", "wb-paper", 12, AA_TEXT],
  ["slate-700", "slate-50", 12, AA_TEXT], // their hover fill, and Chip neutral
  ["white", "wb-ink", 14, AA_TEXT], // BUTTON_PRIMARY, Tabs TAB_ON
  ["white", "black", 14, AA_TEXT], // BUTTON_PRIMARY hover
  // Field.tsx label, StatCard label, Tabs TAB_OFF
  ["slate-600", "white", 14, AA_TEXT],
  ["slate-600", "wb-paper", 14, AA_TEXT],
  ["slate-600", "slate-50", 14, AA_TEXT], // TAB_OFF hover
  // Chip.tsx tones
  ["emerald-700", "emerald-50", 12, AA_TEXT],
  ["fuchsia-700", "fuchsia-50", 12, AA_TEXT],
  ["amber-800", "amber-50", 12, AA_TEXT],
  ["rose-700", "rose-50", 12, AA_TEXT],
  // DemoChip.tsx, the sample-data marker
  ["amber-700", "amber-50", 12, AA_TEXT],
  // Delta.tsx
  ["emerald-700", "white", 14, AA_TEXT],
  ["emerald-700", "wb-paper", 14, AA_TEXT],
  ["rose-700", "white", 14, AA_TEXT],
  ["rose-700", "wb-paper", 14, AA_TEXT],
  // StatCard.tsx accents: 36px semibold, so the large-text threshold applies.
  // Small text reusing one of these colours is not detected here (see the header).
  ["fuchsia-500", "white", 36, AA_LARGE],
  ["fuchsia-500", "wb-paper", 36, AA_LARGE],
  ["emerald-600", "white", 36, AA_LARGE],
  ["emerald-600", "wb-paper", 36, AA_LARGE],
  ["amber-600", "white", 36, AA_LARGE],
  ["amber-600", "wb-paper", 36, AA_LARGE],
];

const UI_DIR = fileURLToPath(new URL(".", import.meta.url));
/** Every non-test module under ui/, relative to it. */
const SOURCES = globSync("**/*.{ts,tsx}", { cwd: UI_DIR })
  .filter((path) => !/\.test\.tsx?$/u.test(path))
  .sort();
/**
 * Floor, not a count: `globSync` returns [] for a missing directory instead of
 * throwing, and a walk that finds nothing makes both directions of the table
 * check trivially true. Measured 2026-09-14: 22 modules.
 */
const MIN_SOURCES = 20;

/**
 * Tokens under ui/ that start `bg-` / `text-` but name nothing this file can
 * measure, left out on purpose, by file. Deliberate exemptions: 1.
 * - Dialog.tsx `bg-slate-900/50`: the scrim, an empty aria-hidden button behind
 *   the panel. No text is drawn on it; the panel over it is `bg-white`.
 * Each listed token must occur exactly once in its file, in a literal with no
 * text colour: a second element reusing the fill, or the scrim's own literal
 * gaining a text colour, is not covered by the exemption and fails.
 */
const EXEMPT: Readonly<Record<string, readonly string[]>> = {
  "Dialog.tsx": ["bg-slate-900/50"],
};
const EXEMPT_COUNT = 1;

/** `text-*` utilities that are not colours. Anything else must resolve to one. */
const TEXT_NOT_COLOUR =
  /^(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|inherit|\[\d+px\])$/u;
const BG_NOT_COLOUR = /^(?:transparent|current|inherit|none|fixed|local|scroll)$/u;
const COLOUR = /^(?:white|black|wb-[a-z0-9-]+|[a-z]+-\d{2,3})$/u;

function relativeLuminance(linear: readonly number[]): number {
  const [r, g, b] = [linear[0] ?? 0, linear[1] ?? 0, linear[2] ?? 0];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexLuminance(hex: string): number {
  const full =
    hex.length === 4 ? `#${hex[1] ?? ""}${hex[1] ?? ""}${hex[2] ?? ""}${hex[2] ?? ""}${hex[3] ?? ""}${hex[3] ?? ""}` : hex;
  const channels = [1, 3, 5].map((index) => Number.parseInt(full.slice(index, index + 2), 16) / 255);
  return relativeLuminance(
    channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    ),
  );
}

/** Björn Ottosson's reference matrices (OKLab → LMS → linear sRGB). */
function oklchLuminance(value: string): number {
  const found = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/u.exec(value);
  if (found === null) throw new Error(`Expected an oklch() literal, received ${value}`);
  const lightness = Number(found[1]) / 100;
  const chroma = Number(found[2]);
  const hue = (Number(found[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return relativeLuminance([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]);
}

function declarations(block: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of block.replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/giu)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) values.set(name, value.trim());
  }
  return values;
}

/** The index of the `}` that closes the `{` at `open`, found by brace depth. */
function closingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unterminated CSS block at offset ${open}`);
}

/** The bodies of every top-level block `opener` starts, in source order. */
function atRuleBodies(source: string, opener: RegExp): readonly string[] {
  const start = source.search(opener);
  if (start === -1) return [];
  const open = source.indexOf("{", start);
  const close = closingBrace(source, open);
  return [source.slice(open + 1, close), ...atRuleBodies(source.slice(close + 1), opener)];
}

type Theme = ReadonlyMap<string, string>;

const tailwindTheme: Theme = declarations(
  readFileSync(createRequire(import.meta.url).resolve("tailwindcss/theme.css"), "utf8"),
);
const workbenchThemeBodies = atRuleBodies(
  readFileSync(new URL("../../../app/workbench.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//gu, ""),
  /@theme(?:\s+inline)?\s*\{/u,
);
if (workbenchThemeBodies.length === 0) throw new Error("Missing @theme block in app/workbench.css");
/**
 * Parsed block by block, each body closed with a `;` so a last declaration
 * written without one (valid CSS) is not swallowed by the next block's first,
 * then merged in source order: a later block's declaration wins, as in the
 * compiled CSS.
 */
const workbenchTheme: Theme = new Map(workbenchThemeBodies.flatMap((body) => [...declarations(`${body};`)]));

/**
 * The theme the build compiles, which `PAIRS` is measured in: workbench.css
 * declares its theme after importing Tailwind's, so for a name both declare,
 * the workbench value is the one the compiled utility carries.
 */
const COMPILED: readonly Theme[] = [workbenchTheme, tailwindTheme];
/**
 * Tailwind's theme as installed, alone. Only the conversion's calibration reads
 * it: those expected ratios are facts about Tailwind's palette, and a workbench
 * override that legitimately changes one of those colours must not fail them.
 */
const INSTALLED: readonly Theme[] = [tailwindTheme];

function luminance(token: string, themes: readonly Theme[]): number {
  const name = `--color-${token}`;
  const value = themes.map((theme) => theme.get(name)).find((found) => found !== undefined);
  if (value === undefined) {
    throw new Error(`No ${name} in the ${themes === INSTALLED ? "Tailwind" : "workbench or Tailwind"} theme`);
  }
  return value.startsWith("#") ? hexLuminance(value) : oklchLuminance(value);
}

function ratio(foreground: string, background: string, themes: readonly Theme[] = COMPILED): number {
  const [a, b] = [luminance(foreground, themes), luminance(background, themes)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

type Use = { readonly kind: "text" | "bg"; readonly colour: string; readonly base: boolean };

/**
 * Class-string tokens that start `text-`/`bg-` but resolve to no known colour,
 * and templates this file cannot read.
 */
const unclassified: string[] = [];
/**
 * Every occurrence of an exempted token, one entry per occurrence (not a set),
 * with the literal it sits in, so a stale, repeated or text-carrying exemption shows.
 */
const exemptHits: { readonly where: string; readonly literal: string }[] = [];

function parseToken(file: string, literal: string, token: string): Use | null {
  const found = /^((?:[a-z0-9-]+:)*)(text|bg)-(.+)$/u.exec(token);
  if (found === null) return null;
  const kind = found[2] === "bg" ? "bg" : "text";
  const rest = found[3] ?? "";
  const notColour = kind === "bg" ? BG_NOT_COLOUR : TEXT_NOT_COLOUR;
  if (notColour.test(rest)) return null;
  // An opacity modifier (`bg-slate-50/50`) cannot be measured against a token,
  // so it is reported rather than skipped.
  if (!COLOUR.test(rest)) {
    if (EXEMPT[file]?.includes(token) === true) exemptHits.push({ where: `${file}: ${token}`, literal });
    else unclassified.push(`${file}: ${token}`);
    return null;
  }
  return { kind, colour: rest, base: (found[1] ?? "") === "" };
}

/** A `text-` / `bg-` class start anywhere in a literal: at the start, or after a quote, space or variant colon. */
const COLOUR_CLASS_START = /(?:^|[^a-z0-9-])(?:text|bg)-/u;

/**
 * String literals: double- or single-quoted on one line, or template literals,
 * which may span lines. Comments are stripped first so prose cannot leak in. A
 * template with a `${…}` interpolation is not parsed: when a `text-` / `bg-`
 * class appears anywhere in it (static text, or a string inside the
 * interpolation) it is reported as unreadable, because the part this file cannot
 * evaluate may carry the colour. An interpolated template with no such class
 * (an id such as `${idPrefix}-tab-${id}`) is skipped. A template nested inside
 * an interpolation is not delimited correctly; none exists under ui/.
 */
function classStrings(file: string, source: string): readonly string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
  return [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/gu)].flatMap((match) => {
    const template = match[3];
    if (template === undefined) return [match[1] ?? match[2] ?? ""];
    if (!/\$\{/u.test(template)) return [template];
    if (COLOUR_CLASS_START.test(template)) {
      unclassified.push(`${file}: interpolated template cannot be read statically: \`${template.trim()}\``);
    }
    return [];
  });
}

/** The text-colour tokens of a literal: each `text-*` class (any variant) that is not a size, alignment or wrap utility. */
function textColours(literal: string): readonly string[] {
  return literal.split(/\s+/u).filter((token) => {
    const found = /^(?:.*:)?!?text-(.+)$/u.exec(token);
    return found !== null && !TEXT_NOT_COLOUR.test(found[1] ?? "");
  });
}

function pairsIn(file: string, literal: string): readonly string[] {
  const uses = literal
    .split(/\s+/u)
    .filter(Boolean)
    .flatMap((token) => parseToken(file, literal, token) ?? []);
  const foregrounds = uses.filter((use) => use.kind === "text").map((use) => use.colour);
  const fills = uses.filter((use) => use.kind === "bg");
  const base = fills.filter((use) => use.base).map((use) => use.colour);
  const grounds = base.length > 0 ? base : [...GROUNDS];
  const backgrounds = [...new Set([...grounds, ...fills.filter((u) => !u.base).map((u) => u.colour)])];
  return foregrounds.flatMap((foreground) => backgrounds.map((bg) => `${foreground} on ${bg}`));
}

const rendered = new Set(
  SOURCES.flatMap((file) =>
    classStrings(file, readFileSync(join(UI_DIR, file), "utf8")).flatMap((literal) => pairsIn(file, literal)),
  ),
);
const measured = new Set(PAIRS.map(([foreground, background]) => `${foreground} on ${background}`));

describe("ui colour pairs clear WCAG 1.4.3", () => {
  it.each(PAIRS)("%s on %s at %ipx clears %f:1", (foreground, background, _px, threshold) => {
    expect(
      ratio(foreground, background),
      `${foreground} on ${background}`,
    ).toBeGreaterThanOrEqual(threshold);
  });

  it("grants the large-text threshold only to rows written at a large size", () => {
    // The px in the table, not in the source: see the header's blind spots.
    for (const [foreground, background, px, threshold] of PAIRS) {
      const where = `${foreground} on ${background} at ${px}px`;
      if (threshold === AA_LARGE) expect(px, where).toBeGreaterThanOrEqual(LARGE_PX);
      else expect(threshold, where).toBe(AA_TEXT);
    }
  });

  it("measures the palette the way the browser renders it", () => {
    // Calibration of the oklch conversion, against Tailwind's palette as
    // installed (`INSTALLED`), never the compiled theme: a workbench override
    // may change these colours, and the PAIRS rows above measure it where it
    // does. Nothing here requires a pair to fail in the compiled theme.
    // workbench.css documents slate-500 on white as 4.77:1 and slate-400 as
    // 2.63:1, both read out of Tailwind's palette.
    expect(ratio("slate-500", "white", INSTALLED)).toBeCloseTo(4.77, 1);
    expect(ratio("slate-400", "white", INSTALLED)).toBeLessThan(AA_TEXT);
    // The pair this gate was written for reads as a failure in that palette.
    expect(ratio("slate-500", "slate-100", INSTALLED)).toBeLessThan(AA_TEXT);
  });
});

describe("the table covers exactly what the primitives render", () => {
  it("reads colour pairs out of the primitives at all", () => {
    // Cardinality guards: a walk that finds no file, or an extraction that
    // silently stops matching, would otherwise make both directions below
    // trivially true.
    expect(SOURCES.length, "non-test modules walked under ui/").toBeGreaterThanOrEqual(MIN_SOURCES);
    expect(rendered.size).toBeGreaterThanOrEqual(20);
  });

  it("understands every text-/bg- class in the sources", () => {
    // Fail closed: an opacity-modified or unknown colour must be added to the
    // table (or to the not-a-colour lists, or to EXEMPT with its reason) rather
    // than silently skipped, and an interpolated template carrying a colour
    // class must be rewritten as literals this file can read.
    expect([...new Set(unclassified)]).toEqual([]);
  });

  it("exempts exactly the listed tokens, each once, in a literal with no text colour", () => {
    const listed = Object.entries(EXEMPT).flatMap(([file, tokens]) =>
      tokens.map((token) => `${file}: ${token}`),
    );
    expect(listed).toHaveLength(EXEMPT_COUNT);
    // Occurrences, not a set: a second element in the same file reusing the
    // fill would otherwise ride on the first one's exemption, unmeasured.
    expect(exemptHits.map((hit) => hit.where).sort()).toEqual([...listed].sort());
    for (const hit of exemptHits) {
      expect(textColours(hit.literal), `${hit.where}: text colour in the exempted literal`).toEqual([]);
    }
  });

  it("measures every pair the primitives render", () => {
    expect([...rendered].filter((pair) => !measured.has(pair)).sort()).toEqual([]);
  });

  it("keeps no row the primitives no longer render", () => {
    expect([...measured].filter((pair) => !rendered.has(pair)).sort()).toEqual([]);
  });
});
