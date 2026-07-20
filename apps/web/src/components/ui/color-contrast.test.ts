import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(TEST_DIR, "..", "..");
const GLOBALS_CSS = readFileSync(join(WEB_SRC, "app", "globals.css"), "utf8");
const TONES = ["cobalt", "coral", "mint", "amber", "violet"] as const;

function cssBlock(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector);
  if (selectorIndex < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const open = css.indexOf("{", selectorIndex + selector.length);
  const close = css.indexOf("}", open + 1);
  if (open < 0 || close < 0) throw new Error(`Invalid CSS block: ${selector}`);
  return css.slice(open + 1, close);
}

function declarations(block: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/giu)) {
    values.set(match[1]!, match[2]!.trim());
  }
  return values;
}

function resolveHex(
  name: string,
  values: ReadonlyMap<string, string>,
  seen: ReadonlySet<string> = new Set(),
): string {
  if (seen.has(name)) throw new Error(`Cyclic CSS token: ${name}`);
  const value = values.get(name);
  if (value === undefined) throw new Error(`Missing CSS token: ${name}`);
  const reference = /^var\((--[a-z0-9-]+)\)$/iu.exec(value)?.[1];
  if (reference !== undefined) {
    return resolveHex(reference, values, new Set([...seen, name]));
  }
  if (!/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new Error(`Expected a six-digit hex color for ${name}, received ${value}`);
  }
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
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

function cssFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...cssFiles(path));
    else if (entry.endsWith(".css")) files.push(path);
  }
  return files;
}

const lightTokens = declarations(cssBlock(GLOBALS_CSS, ":root"));
const systemDarkTokens = new Map([
  ...lightTokens,
  ...declarations(
    cssBlock(GLOBALS_CSS, ':root:not([data-theme="light"])'),
  ),
]);
const explicitDarkTokens = new Map([
  ...lightTokens,
  ...declarations(cssBlock(GLOBALS_CSS, ':root[data-theme="dark"]')),
]);

describe("semantic accent text contrast", () => {
  for (const [theme, tokens] of [
    ["light", lightTokens],
    ["system dark", systemDarkTokens],
    ["explicit dark", explicitDarkTokens],
  ] as const) {
    for (const tone of TONES) {
      it(`${theme} ${tone} text meets WCAG AA on its soft and surface backgrounds`, () => {
        const foreground = resolveHex(`--sf-${tone}-text`, tokens);
        for (const backgroundName of [`--sf-${tone}-soft`, "--sf-surface"]) {
          const background = resolveHex(backgroundName, tokens);
          expect(
            contrast(foreground, background),
            `${theme} ${tone} text ${foreground} on ${backgroundName} ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  it("routes direct accent text through semantic text tokens", () => {
    const directAccent =
      /^\s*color:\s*var\(--sf-(?:accent|cobalt|coral|mint|amber|violet)\)\s*;/gmu;
    const offenders = cssFiles(WEB_SRC).flatMap((path) => {
      const css = readFileSync(path, "utf8");
      return [...css.matchAll(directAccent)].map(
        (match) => `${relative(WEB_SRC, path)}:${css.slice(0, match.index).split("\n").length}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
