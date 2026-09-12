import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Contrast gate for the dark rail's text tokens (`@theme` in workbench.css).
 *
 * Rule: every rail text token must clear WCAG AA 4.5:1 on every rail surface it
 * is used on. The rail is light-on-dark, so the lightest tier a token sits on is
 * the binding one. The pairs below are the usage map, read off the components:
 *
 *   rail-text   nav link text on rail (hover moves the text itself to zinc-200)
 *   rail-muted  tagline, group labels, footer on rail; the nav badge inside
 *               the link, whose background is rail-2 on hover and rail-3 when
 *               active
 *   rail-label  SiteCard <dt> column on rail-2
 *   rail-dim    10px footer version line on rail
 *   rail-line   a border, never text — deliberately not listed
 *
 * Helpers are copied from components/ui/color-contrast.test.ts rather than
 * imported: that file is itself a test suite.
 */

const css = readFileSync(new URL("./workbench.css", import.meta.url), "utf8");
const SHELL = "../components/workbench/shell/";
const railSources = {
  "Sidebar.tsx": readFileSync(new URL(`${SHELL}Sidebar.tsx`, import.meta.url), "utf8"),
  "SiteCard.tsx": readFileSync(new URL(`${SHELL}SiteCard.tsx`, import.meta.url), "utf8"),
} as const;

/** The body of a top-level at-rule block, found by brace depth (`@theme` may nest `@keyframes`). */
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

function declarations(block: string): Map<string, string> {
  const values = new Map<string, string>();
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const match of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/giu)) {
    values.set(match[1]!, match[2]!.trim());
  }
  return values;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return relativeLuminance(linear);
}

function relativeLuminance(linear: readonly number[]): number {
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastOfLuminance(left: number, right: number): number {
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

function contrast(left: string, right: string): number {
  return contrastOfLuminance(luminance(left), luminance(right));
}

/**
 * Tailwind v4 writes its palette in `oklch()`, so a token read from its theme
 * has to come back to linear sRGB before WCAG luminance means anything.
 * Björn Ottosson's reference matrices (OKLab → LMS → linear sRGB); the result
 * is what `contrast()` above computes from a hex, minus the gamma round trip.
 */
function oklchLuminance(value: string): number {
  const match = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/u.exec(value);
  if (!match) throw new Error(`Expected an oklch() literal, received ${value}`);
  const lightness = Number(match[1]) / 100;
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
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

/** Tailwind's own palette, read from the installed theme rather than copied. */
const tailwindTheme = declarations(
  readFileSync(createRequire(import.meta.url).resolve("tailwindcss/theme.css"), "utf8"),
);

function tailwindLuminance(token: string): number {
  const value = tailwindTheme.get(`--color-${token}`);
  if (value === undefined) throw new Error(`Missing Tailwind token: --color-${token}`);
  return oklchLuminance(value);
}

const theme = declarations(atRuleBody(css, /@theme\s*\{/u));

function railHex(name: string): string {
  const value = theme.get(`--color-wb-${name}`);
  if (value === undefined) throw new Error(`Missing rail token: --color-wb-${name}`);
  if (!/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new Error(`Expected a six-digit hex for --color-wb-${name}, received ${value}`);
  }
  return value;
}

const AA_TEXT = 4.5;

describe("workbench.css rail text tokens", () => {
  it.each([
    ["rail-text", "rail"],
    ["rail-text", "rail-2"],
    ["rail-muted", "rail"],
    ["rail-muted", "rail-2"],
    ["rail-muted", "rail-3"],
    ["rail-label", "rail-2"],
    ["rail-dim", "rail"],
  ])("%s clears 4.5:1 on %s", (token, surface) => {
    const foreground = railHex(token);
    const background = railHex(surface);
    expect(
      contrast(foreground, background),
      `${token} ${foreground} on ${surface} ${background}`,
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the tiers in luminance order: text > muted >= label > dim", () => {
    const [text, muted, label, dim] = ["rail-text", "rail-muted", "rail-label", "rail-dim"].map(
      (name) => luminance(railHex(name)),
    );
    expect(text).toBeGreaterThan(muted!);
    expect(muted).toBeGreaterThanOrEqual(label!);
    expect(label).toBeGreaterThan(dim!);
  });
});

describe("workbench.css placeholder colour", () => {
  // Placeholder text is text: WCAG 1.4.3 grants it no exemption, and the
  // palette input and every future form field in the new views inherit this
  // rule. slate-400 sat at 2.63:1 on white before this test existed.
  const WHITE = 1;

  it("uses a Tailwind slate token that clears 4.5:1 on white", () => {
    const rule = css.match(
      /\.wb-reset :where\(input, textarea\)::placeholder\s*\{([^}]*)\}/u,
    );
    expect(rule, "placeholder rule under .wb-reset").not.toBeNull();
    const token = /color:\s*var\(--color-(slate-\d{3})\)/u.exec(rule![1]!)?.[1];
    expect(token, "placeholder colour is a var(--color-slate-*)").toBeDefined();
    expect(
      contrastOfLuminance(tailwindLuminance(token!), WHITE),
      `${token} on white`,
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("measures Tailwind's palette the way the browser renders it", () => {
    // Sanity anchor for the oklch conversion: Tailwind documents slate-500 as
    // #62748e, and the ratio must come out the same from either form.
    expect(contrastOfLuminance(tailwindLuminance("slate-500"), WHITE)).toBeCloseTo(
      contrast("#62748e", "#ffffff"),
      1,
    );
    expect(contrastOfLuminance(tailwindLuminance("slate-400"), WHITE)).toBeLessThan(AA_TEXT);
  });
});

describe("rail components route grey text through the tokens above", () => {
  // Bare Tailwind greys in the secondary range bypass the contrast gate: zinc-500
  // (#71717a) was the brand tagline at 3.45:1 on the rail before this test existed.
  const BARE_GREY = /\btext-(?:zinc|slate|neutral|stone|gray)-[3-6]00\b/gu;
  // Intentional allow-list (measured, not assumed):
  //   text-zinc-300 — SiteCard <dd> value column, #d4d4d8 on rail-2: 9.83:1.
  // 100/200 are outside the regex (active/hover link text, >= 10:1) and 900 is
  // the GG mark on a white tile.
  const ALLOWED = new Set(["text-zinc-300"]);

  it.each(Object.entries(railSources))("%s has no bare Tailwind grey text class", (_file, source) => {
    const offenders = [...source.matchAll(BARE_GREY)]
      .map((match) => match[0])
      .filter((className) => !ALLOWED.has(className));
    expect(offenders).toEqual([]);
  });
});
