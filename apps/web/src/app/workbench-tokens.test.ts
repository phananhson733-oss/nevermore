import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contrast gate for the dark rail's text tokens (`@theme` in workbench.css).
 *
 * Rule: every rail text token must clear WCAG AA 4.5:1 on every rail surface it
 * is used on. The rail is light-on-dark, so the lightest tier a token sits on is
 * the binding one. The pairs below are the usage map, read off the components:
 *
 *   rail-text   nav link text on rail (hover moves the text itself to zinc-200)
 *   rail-muted  tagline, group <h4>, footer on rail; the nav badge inside the
 *               link, whose background is rail-2 on hover and rail-3 when active
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
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(left: string, right: string): number {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
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
