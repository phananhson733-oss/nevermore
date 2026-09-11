import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./workbench.css", import.meta.url), "utf8");

describe("workbench.css", () => {
  it("imports theme and utilities as layers and never preflight", () => {
    expect(css).toContain('@import "tailwindcss/theme.css" layer(theme);');
    expect(css).toContain('@import "tailwindcss/utilities.css" layer(utilities);');
    expect(css).not.toContain("tailwindcss/preflight");
    expect(css).not.toMatch(/@import\s+"tailwindcss";/);
  });

  it("binds the sans font to the next/font variable so font-sans works", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-wb\)/);
  });

  it("scopes every reset rule under .wb-reset", () => {
    const base = css.match(/@layer base\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(base.length).toBeGreaterThan(0);
    const selectors = base.match(/^\s*([^{}\n][^{}]*)\{/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(3);
    for (const selector of selectors) {
      expect(selector.trim(), selector).toMatch(/^\.wb-reset/);
    }
  });
});

describe("globals.css keeps its unlayered element rules out of the workbench chrome", () => {
  // Unlayered declarations beat every @layer, so a bare `a {}` / `h1 {}` /
  // `:focus-visible {}` would override Tailwind utilities inside the new shell.
  const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
  it.each(["a", "h1", "h2", "h3", ":focus-visible"])("guards %s with :where(:not(.wb-reset *))", (selector) => {
    expect(globals).not.toMatch(new RegExp(`^${selector}\\s*[{,]`, "m"));
    expect(globals).toContain(`${selector}:where(:not(.wb-reset *))`);
  });
});

describe("postcss.config.mjs", () => {
  // A postcss config file replaces Next's built-in chain, so the two defaults
  // must be restated ahead of Tailwind or legacy CSS Modules lose prefixing.
  const config = readFileSync(new URL("../../postcss.config.mjs", import.meta.url), "utf8");
  it("restates Next's default plugins before Tailwind", () => {
    const order = ["next/dist/compiled/postcss-flexbugs-fixes", "next/dist/compiled/postcss-preset-env", "@tailwindcss/postcss"]
      .map((name) => config.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(config).toContain('"custom-properties": false');
    expect(config).toContain('"safari 16.4"');
  });
});
