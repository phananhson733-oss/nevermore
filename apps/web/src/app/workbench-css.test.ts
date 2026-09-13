import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const cssUrl = new URL("./workbench.css", import.meta.url);
const css = readFileSync(cssUrl, "utf8");
const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const rootLayout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");
const projectLayout = readFileSync(
  new URL("./p/[projectId]/layout.tsx", import.meta.url),
  "utf8",
);

async function compileWorkbench(): Promise<Awaited<ReturnType<typeof compile>>> {
  const resolve = createRequire(import.meta.url).resolve;
  return compile(css, {
    base: dirname(fileURLToPath(cssUrl)),
    loadStylesheet: async (id: string) => {
      const path = resolve(id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
}

/**
 * Compiles the shipped workbench.css with the installed Tailwind and returns the
 * CSS emitted for `candidates`.
 *
 * Source text cannot tell `@theme` from `@theme inline`: both spell
 * `--font-sans: var(--font-wb, …)`. The difference shows up in what the compiled
 * *utility* declares.
 */
async function buildUtilities(candidates: readonly string[]): Promise<string> {
  return (await compileWorkbench()).build([...candidates]);
}

/** The part of @tailwindcss/oxide's API this file calls. */
interface OxideModule {
  readonly Scanner: new (options: {
    readonly sources: readonly { base: string; pattern: string; negated: boolean }[];
  }) => { scan(): string[]; readonly files: string[] };
}

/**
 * workbench.css compiled the way the build compiles it: over the candidates
 * Tailwind's own file scanner finds, not over a list a test picks. Same scanner
 * (@tailwindcss/oxide, resolved through @tailwindcss/postcss so it is the copy
 * the build loads) and the same source list @tailwindcss/postcss derives from
 * `compiler.root` and `compiler.sources`, so it sees every class string,
 * arbitrary value and bare custom-property name under the @source roots.
 * Returns the joined bodies of the emitted `:root, :host` rules.
 */
async function buildScanned(extra: readonly string[] = []): Promise<{
  readonly files: number;
  readonly candidates: number;
  readonly root: string;
}> {
  const compiler = await compileWorkbench();
  if (compiler.root === null) {
    // Automatic detection scans from PostCSS's `base` (process.cwd() in the
    // build), which a test cannot reproduce faithfully.
    throw new Error("workbench.css no longer sets source(none); see app/tailwind-source-scope.test.ts");
  }
  const sources = [
    ...(compiler.root === "none" ? [] : [{ ...compiler.root, negated: false }]),
    ...compiler.sources,
  ];
  const postcssEntry = createRequire(import.meta.url).resolve("@tailwindcss/postcss");
  const { Scanner } = createRequire(postcssEntry)("@tailwindcss/oxide") as OxideModule;
  const scanner = new Scanner({ sources });
  const candidates = scanner.scan();
  const compiled = compiler.build([...candidates, ...extra]);
  const root = [...compiled.matchAll(/(?:^|[\n}])\s*:root,\s*:host\s*\{([^}]*)\}/gu)]
    .map((match) => match[1]!)
    .join("\n");
  return { files: scanner.files.length, candidates: candidates.length, root };
}

// Floors, not counts (measured 2026-09-14: 101 files, 3256 candidates). A scanner
// handed the wrong roots finds nothing, and "nothing declares --font-sans" holds.
const MIN_SCANNED_FILES = 80;
const MIN_SCANNED_CANDIDATES = 2000;
const FONT_SANS_DECLARATION = /(?:^|[\s;])--font-sans\s*:/u;

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
      '@import "tailwindcss/utilities.css" layer(utilities) source(none);',
    );
    expect(css).not.toContain("tailwindcss/preflight");
    expect(css).not.toMatch(/@import\s+"tailwindcss";/);
  });

  it("declares the sans font binding in @theme inline, never in a plain @theme", () => {
    // `@theme` resolves the binding at `:root`: it emits
    // `--font-sans: var(--font-wb, …)` there and makes `.font-sans` read
    // `font-family: var(--font-sans)`. next/font's variable class is on the
    // project layout's root element, not `<html>`, so at `:root` `--font-wb` is
    // undefined and `--font-sans` computes to the fallback stack. Nothing errors:
    // the page renders in the wrong face and every source-text assertion that
    // only looks for this declaration stays green. `@theme inline` puts the
    // *value* in the utility, so the `var()` resolves on the element using it.
    const inlineTheme = atRuleBlock(css, /@theme\s+inline\s*\{/);
    expect(inlineTheme, "an `@theme inline` block").not.toBe("");
    expect(inlineTheme).toMatch(/--font-sans:\s*var\(--font-wb(?:,[^)]*)?\)/);
    expect(css, "a plain `@theme {` block").not.toMatch(/@theme\s*\{/);
  });

  it("compiles .font-sans to a declaration that resolves --font-wb at the element", async () => {
    // The gate above pins the spelling; this one pins its consequence, by
    // running the installed compiler over the shipped file. Under a plain
    // `@theme` this rule reads `font-family: var(--font-sans)` instead.
    const rule = (await buildUtilities(["font-sans"])).match(
      /\.font-sans\s*\{([^}]*)\}/u,
    );
    expect(rule, ".font-sans in the compiled stylesheet").not.toBeNull();
    expect(rule?.[1]).toMatch(/var\(--font-wb[,)]/u);
    expect(rule?.[1]).not.toMatch(/var\(--font-sans\)/u);
  });

  it("emits no --font-sans to :root for anything under the @source roots", async () => {
    // `@theme inline` fixes `.font-sans`, not every reader of the variable. Any
    // rule or candidate that reads it through var() (an arbitrary value such as
    // `[font-family:var(--font-sans)]` on a heading, or the bare custom-property
    // name in a scanned file, tests and prose included) makes Tailwind declare
    // `--font-sans: var(--font-wb, …)` in :root. `--font-wb` is undefined there,
    // so that element computes to the fallback stack with no error. The gates
    // above only ask for `font-sans`, and the e2e sweep only reads `.font-sans`
    // elements; this one builds from what the scanner actually finds.
    const scanned = await buildScanned();
    expect(scanned.files, "files scanned under the @source roots").toBeGreaterThanOrEqual(MIN_SCANNED_FILES);
    expect(scanned.candidates, "candidates found there").toBeGreaterThanOrEqual(MIN_SCANNED_CANDIDATES);
    expect(scanned.root, ":root, :host rule in the compiled stylesheet").not.toBe("");
    expect(scanned.root).not.toMatch(FONT_SANS_DECLARATION);
    // Positive control, same pipeline: one scanned reader is enough to emit it.
    const control = await buildScanned(["[font-family:var(--font-sans)]"]);
    expect(control.root).toMatch(FONT_SANS_DECLARATION);
  });

  it("still emits to :root every --color-wb-* token this stylesheet reads through var()", async () => {
    // Under `@theme inline` a token reaches :root only while Tailwind sees
    // something read it through var(); every utility gets the literal value
    // instead. A rule in this stylesheet is such a read: add one written as
    // var(--color-wb-rail) and Tailwind emits --color-wb-rail with it (measured
    // 2026-09-14), as it does today for --color-wb-seo. What gets nothing,
    // silently, is a read of a name @theme does not declare (a typo, a renamed or
    // removed token), which this test catches here, or a read Tailwind never
    // compiles or scans, such as a stylesheet outside the @source roots (none
    // today; app/tailwind-source-scope.test.ts fails for one). Either way that
    // var() resolves to nothing, the declaration is invalid at computed-value time
    // and falls back to the inherited or initial value. Candidates are irrelevant
    // here: the references below live in @layer base, which is always emitted.
    // `var(\s*`: `var( --x)` is valid CSS and must not slip past the extraction.
    const referenced = [
      ...new Set(
        [...css.replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/var\(\s*(--color-wb-[a-z0-9-]+)/gu)].map(
          (match) => match[1]!,
        ),
      ),
    ];
    expect(referenced.length, "var(--color-wb-*) references in workbench.css").toBeGreaterThan(0);
    // Inside the emitted `:root, :host` rule, not anywhere in the output: the
    // same declaration under some other selector would not reach <progress>.
    const compiled = await buildUtilities([]);
    const rootRules = [...compiled.matchAll(/(?:^|[\n}])\s*:root,\s*:host\s*\{([^}]*)\}/gu)].map(
      (match) => match[1]!,
    );
    expect(rootRules.length, ":root, :host rule in the compiled stylesheet").toBeGreaterThan(0);
    const root = rootRules.join("\n");
    for (const token of referenced) {
      expect(root, `${token} declared in :root, :host`).toMatch(
        new RegExp(`(?:^|[\\s;])${token}:\\s*#[0-9a-f]{6}\\s*;`, "u"),
      );
    }
  });

  it("does not define --font-display (legacy modules rely on it being unset)", () => {
    // Brace depth, not a lazy regex: `@theme` may legitimately nest `@keyframes`.
    const theme = atRuleBlock(css, /@theme(?:\s+inline)?\s*\{/);
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

  it("keeps the print override in @layer utilities, after the Tailwind import", () => {
    // `[data-wb-content]` and `.md\:ml-64` have the same specificity, so the layer
    // decides: in `@layer components` the print rule lost to that utility at every
    // print width >= 48rem (Letter is 816px) and the sidebar gutter was printed blank.
    const utilities = atRuleBlock(css, /@layer utilities\s*\{/);
    expect(utilities.length).toBeGreaterThan(0);
    expect(utilities).toMatch(/@media print\s*\{[\s\S]*\[data-wb-content\]/);
    // Same layer AND same specificity: only source order breaks the tie.
    const importAt = css.indexOf(
      '@import "tailwindcss/utilities.css" layer(utilities) source(none);',
    );
    expect(importAt).toBeGreaterThan(-1);
    expect(css.search(/@layer utilities\s*\{/)).toBeGreaterThan(importAt);
  });

  it("keeps pseudo-elements outside :where() so the rules actually match", () => {
    expect(css).not.toMatch(/:where\([^)]*::/);
  });

  it("gives legacy pages the old .main gutter, keyed on <main> having no .wb-reset child", () => {
    // ShellChrome's <main> is bare `flex-1`; the old AppShell's `.main` gave every
    // project page `max-width: 1480px` + a clamp() gutter. New views are `.wb-reset`
    // roots with their own padding, so the rule must exclude them via `:has()` and
    // must live in `@layer components` (an unlayered rule would beat every utility).
    const components = atRuleBlock(css, /@layer components\s*\{/);
    expect(components.length).toBeGreaterThan(0);
    const selector = "#main-content:not(:has(> .wb-reset))";
    const rule = components.match(
      new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`),
    );
    expect(rule, `${selector} rule inside @layer components`).not.toBeNull();
    expect(rule?.[1]).toMatch(/max-width:\s*1480px/);
    expect(rule?.[1]).toMatch(/padding:\s*40px clamp\(24px, 3\.3vw, 56px\) 30px/);
    // The rule must never be written without the `:has()` guard.
    expect(css).not.toMatch(/^\s*#main-content\s*\{/m);
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

describe("where the workbench stylesheet and the workbench face are mounted", () => {
  // Both belong to /p/[projectId] alone: /login and /new-project render no
  // workbench markup, so they must neither ship the stylesheet (it carries the
  // whole Tailwind utility set) nor preload a face they never draw with. Moving
  // the next/font variable class off <html> is what forces `@theme inline`
  // above — the two changes cannot be made separately.
  // Source order across the two files (globals.css first) is now Next's layout
  // nesting rather than a line order this test can read; the stylesheet-order
  // assertion in e2e/legacy-style-parity.mock.spec.ts pins it on a served page.
  it("keeps workbench.css and the workbench face out of the root layout", () => {
    expect(rootLayout).toContain('import "./globals.css";');
    // The import, not the string: the comment that explains the move names the
    // file, and a blanket substring check would forbid explaining it.
    expect(rootLayout).not.toMatch(/^\s*import\s+["']\.\/workbench\.css["']/mu);
    expect(rootLayout).not.toContain("Plus_Jakarta_Sans");
    expect(rootLayout).not.toContain("--font-wb");
  });

  it("mounts workbench.css and the --font-wb variable class on the project layout", () => {
    expect(projectLayout).toContain('import "../../workbench.css";');
    expect(projectLayout).toMatch(/variable:\s*"--font-wb"/);
    // Declaring the face is not applying it: the generated class has to reach an
    // element, or `--font-wb` is defined nowhere and `font-sans` falls back.
    expect(projectLayout).toMatch(/className=\{\w+\.variable\}/);
  });

  it("never puts .wb-reset on html, body or the project layout root", () => {
    expect(rootLayout).not.toContain("wb-reset");
    expect(projectLayout).not.toContain("wb-reset");
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
