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
 *    Tailwind theme as installed (values are `oklch()`; workbench tokens are hex).
 * 2. The class strings of the thirteen primitive sources are parsed, and the pairs
 *    found there must be exactly the rows in `PAIRS` — no missing row (a new tone
 *    cannot slip in unmeasured) and no stale row (a row cannot be added to
 *    silence the gate without the source actually using it).
 *
 * Thresholds are WCAG 1.4.3: 4.5:1 for body text, 3:1 only for large text
 * (>= 24px, or >= 18.66px bold). A `text-*` class with no `bg-*` in the same
 * string is measured on BOTH white (every card and panel shell here is
 * `bg-white`) and `wb-paper` (the `#wb-app` page ground, ShellChrome.tsx:100),
 * because a view may place a primitive on either.
 *
 * Mechanism (theme reading, oklch → linear sRGB, WCAG luminance) is copied from
 * app/workbench-tokens.test.ts rather than imported: that file is a test suite.
 *
 * 一旦本文件被更新，务必更新开头注释
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
  // Delta.tsx
  ["emerald-700", "white", 14, AA_TEXT],
  ["emerald-700", "wb-paper", 14, AA_TEXT],
  ["rose-700", "white", 14, AA_TEXT],
  ["rose-700", "wb-paper", 14, AA_TEXT],
  // StatCard.tsx accents: 36px semibold, so the large-text threshold applies and
  // none of these may be reused for body copy.
  ["fuchsia-500", "white", 36, AA_LARGE],
  ["fuchsia-500", "wb-paper", 36, AA_LARGE],
  ["emerald-600", "white", 36, AA_LARGE],
  ["emerald-600", "wb-paper", 36, AA_LARGE],
  ["amber-600", "white", 36, AA_LARGE],
  ["amber-600", "wb-paper", 36, AA_LARGE],
];

const SOURCES = [
  "panel.ts",
  "Chip.tsx",
  "Delta.tsx",
  "StatCard.tsx",
  "Field.tsx",
  "Tabs.tsx",
  "EmptyState.tsx",
  "InPane.tsx",
  "OutPane.tsx",
  "RunningSteps.tsx",
  "ArtifactActions.tsx",
  "ConfirmDialog.tsx",
  "Toggle.tsx",
] as const;

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

/** The body of a top-level at-rule block, found by brace depth. */
function atRuleBody(source: string, opener: RegExp): string {
  const start = source.search(opener);
  if (start === -1) throw new Error(`Missing CSS block: ${opener}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`Unterminated CSS block: ${opener}`);
}

const tailwindTheme = declarations(
  readFileSync(createRequire(import.meta.url).resolve("tailwindcss/theme.css"), "utf8"),
);
const workbenchTheme = declarations(
  atRuleBody(readFileSync(new URL("../../../app/workbench.css", import.meta.url), "utf8"), /@theme(?:\s+inline)?\s*\{/u),
);

function luminance(token: string): number {
  const value = tailwindTheme.get(`--color-${token}`) ?? workbenchTheme.get(`--color-${token}`);
  if (value === undefined) throw new Error(`No --color-${token} in the Tailwind or workbench theme`);
  return value.startsWith("#") ? hexLuminance(value) : oklchLuminance(value);
}

function ratio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

type Use = { readonly kind: "text" | "bg"; readonly colour: string; readonly base: boolean };

/** Class-string tokens that start `text-`/`bg-` but resolve to no known colour. */
const unclassified: string[] = [];

function parseToken(token: string): Use | null {
  const found = /^((?:[a-z0-9-]+:)*)(text|bg)-(.+)$/u.exec(token);
  if (found === null) return null;
  const kind = found[2] === "bg" ? "bg" : "text";
  const rest = found[3] ?? "";
  const notColour = kind === "bg" ? BG_NOT_COLOUR : TEXT_NOT_COLOUR;
  if (notColour.test(rest)) return null;
  // An opacity modifier (`bg-slate-50/50`) cannot be measured against a token,
  // so it is reported rather than skipped.
  if (!COLOUR.test(rest)) {
    unclassified.push(token);
    return null;
  }
  return { kind, colour: rest, base: (found[1] ?? "") === "" };
}

/** Class strings, quoted or templated; comments are stripped so prose cannot leak in. */
function classStrings(source: string): readonly string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
  return [...code.matchAll(/["`]([^"`\n]*)["`]/gu)].flatMap((match) => match[1] ?? []);
}

function pairsIn(literal: string): readonly string[] {
  const uses = literal
    .split(/\s+/u)
    .filter(Boolean)
    .flatMap((token) => parseToken(token) ?? []);
  const foregrounds = uses.filter((use) => use.kind === "text").map((use) => use.colour);
  const fills = uses.filter((use) => use.kind === "bg");
  const base = fills.filter((use) => use.base).map((use) => use.colour);
  const grounds = base.length > 0 ? base : [...GROUNDS];
  const backgrounds = [...new Set([...grounds, ...fills.filter((u) => !u.base).map((u) => u.colour)])];
  return foregrounds.flatMap((foreground) => backgrounds.map((bg) => `${foreground} on ${bg}`));
}

const rendered = new Set(
  SOURCES.flatMap((file) =>
    classStrings(readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).flatMap(pairsIn),
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

  it("only grants the large-text threshold to large text", () => {
    for (const [foreground, background, px, threshold] of PAIRS) {
      const where = `${foreground} on ${background} at ${px}px`;
      if (threshold === AA_LARGE) expect(px, where).toBeGreaterThanOrEqual(LARGE_PX);
      else expect(threshold, where).toBe(AA_TEXT);
    }
  });

  it("measures the palette the way the browser renders it", () => {
    // Anchor for the oklch conversion: workbench.css:135-140 documents
    // slate-500 on white as 4.77:1 and rejects slate-400 for the same rule.
    expect(ratio("slate-500", "white")).toBeCloseTo(4.77, 1);
    expect(ratio("slate-400", "white")).toBeLessThan(AA_TEXT);
    // The pair this gate was written for: it must still read as a failure.
    expect(ratio("slate-500", "slate-100")).toBeLessThan(AA_TEXT);
  });
});

describe("the table covers exactly what the primitives render", () => {
  it("reads colour pairs out of the primitives at all", () => {
    // Cardinality guard: an extraction that silently stops matching would
    // otherwise make both directions below trivially true.
    expect(rendered.size).toBeGreaterThanOrEqual(20);
  });

  it("understands every text-/bg- class in the sources", () => {
    // Fail closed: an opacity-modified or unknown colour must be added to the
    // table (or to the not-a-colour lists) rather than silently skipped.
    expect([...new Set(unclassified)]).toEqual([]);
  });

  it("measures every pair the primitives render", () => {
    expect([...rendered].filter((pair) => !measured.has(pair)).sort()).toEqual([]);
  });

  it("keeps no row the primitives no longer render", () => {
    expect([...measured].filter((pair) => !rendered.has(pair)).sort()).toEqual([]);
  });
});
