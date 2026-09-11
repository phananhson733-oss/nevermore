import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./workbench.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

/** The full text of a top-level at-rule block (`@layer base { … }`, `@theme { … }`), found by brace depth. */
function atRuleBlock(source: string, opener: RegExp): string {
  const start = source.search(opener);
  if (start === -1) return "";
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("workbench.css", () => {
  it("imports theme and utilities as layers and never preflight", () => {
    expect(css).toContain('@import "tailwindcss/theme.css" layer(theme);');
    expect(css).toContain(
      '@import "tailwindcss/utilities.css" layer(utilities);',
    );
    expect(css).not.toContain("tailwindcss/preflight");
    expect(css).not.toMatch(/@import\s+"tailwindcss";/);
  });

  it("binds the sans font to the next/font variable so font-sans works", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-wb(?:,[^)]*)?\)/);
  });

  it("does not define --font-display (legacy modules rely on it being unset)", () => {
    // Brace depth, not a lazy regex: `@theme` may legitimately nest `@keyframes`.
    const theme = atRuleBlock(css, /@theme\s*\{/);
    expect(theme.length).toBeGreaterThan(0);
    expect(theme).not.toContain("--font-display");
  });

  it("scopes every reset rule under .wb-reset", () => {
    const base = atRuleBlock(css, /@layer base\s*\{/);
    expect(base.length).toBeGreaterThan(0);
    // Exclude the `@layer base {` wrapper line itself — atRuleBlock() returns the
    // full block including that opening line, which would otherwise be picked up by
    // the selector regex below as a (failing) fake selector.
    const selectors = (base.match(/^\s*([^{}\n][^{}]*)\{/gm) ?? []).filter(
      (line) => !line.trim().startsWith("@"),
    );
    expect(selectors.length).toBeGreaterThan(3);
    for (const selector of selectors) {
      expect(selector.trim(), selector).toMatch(/^\.wb-reset/);
    }
  });

  it("has no unlayered top-level rules (everything lives in @import / @layer / @theme)", () => {
    // A rule appended after the `@layer base` block would escape the scope check above
    // and, being unlayered, beat every utility — the removed print rule had that shape.
    const topLevelRules = css.match(/^[^\s@/*}][^{\n]*\{/gm) ?? [];
    expect(topLevelRules).toEqual([]);
  });

  it("keeps pseudo-elements outside :where() so the rules actually match", () => {
    expect(css).not.toMatch(/:where\([^)]*::/);
  });
});

describe("globals.css keeps its unlayered element rules out of the workbench chrome", () => {
  // Deliberate exemption (not listed here): the `*, *::before, *::after` rule inside
  // `@media (prefers-reduced-motion: reduce)` is indented, so the column-0 regex skips it;
  // it is an accessibility rule that SHOULD reach into the chrome.
  // Unlayered declarations beat every @layer, so a bare `* {}` / `a {}` / `h1 {}` /
  // `:focus-visible {}` would override Tailwind utilities inside the new shell.
  it.each(["*", "a", "h1", "h2", "h3", ":focus-visible"])(
    "guards %s with :where(:not(.wb-reset *))",
    (selector) => {
      expect(globals).not.toMatch(
        new RegExp(`^${escapeRegExp(selector)}\\s*[{,]`, "m"),
      );
      expect(globals).toContain(`${selector}:where(:not(.wb-reset *))`);
    },
  );
});

describe("layout.tsx", () => {
  it("imports workbench.css after globals.css and never puts .wb-reset on html or body", () => {
    const globalsAt = layout.indexOf('import "./globals.css";');
    const workbenchAt = layout.indexOf('import "./workbench.css";');
    expect(globalsAt).toBeGreaterThan(-1);
    expect(workbenchAt).toBeGreaterThan(globalsAt);
    expect(layout).not.toContain("wb-reset");
  });
});

describe("postcss.config.mjs", () => {
  // A postcss config file replaces Next's built-in webpack chain, so the two defaults
  // must be restated ahead of Tailwind or legacy CSS Modules lose prefixing.
  const config = readFileSync(
    new URL("../../postcss.config.mjs", import.meta.url),
    "utf8",
  );
  it("restates Next's default plugins before Tailwind", () => {
    const order = [
      "next/dist/compiled/postcss-flexbugs-fixes",
      "next/dist/compiled/postcss-preset-env",
      "@tailwindcss/postcss",
    ].map((name) => config.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(config).toContain('"custom-properties": false');
    expect(config).toContain('"safari 16.4"');
  });
});
