import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./_overview.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("./overview.module.css", import.meta.url), "utf8");

function cssBlock(selector: string, source = CSS): string {
  const match = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*\\{([^}]*)\\}`,
    "u",
  ).exec(source);
  if (!match?.[1]) throw new Error(`Missing CSS selector: ${selector}`);
  return match[1];
}

function mediaSection(query: string): string {
  const start = CSS.indexOf(`@media ${query}`);
  if (start < 0) throw new Error(`Missing CSS media query: ${query}`);
  const next = CSS.indexOf("\n@media ", start + 1);
  return CSS.slice(start, next < 0 ? undefined : next);
}

describe("Overview accessibility regressions", () => {
  it("keeps every Portfolio metric description inside its definition", () => {
    const portfolio = /<dl className=\{styles\.portfolioMetrics\}>([\s\S]*?)<\/dl>/u.exec(
      SOURCE,
    )?.[1];

    expect(portfolio).toBeDefined();
    expect(portfolio?.match(/<dt>/gu)).toHaveLength(4);
    expect(portfolio?.match(/<dd>/gu)).toHaveLength(4);
    expect(portfolio?.match(/<dd>[\s\S]*?<small>[\s\S]*?<\/small>\s*<\/dd>/gu)).toHaveLength(4);
    expect(portfolio).not.toMatch(/<\/dd>\s*<small>/u);
  });

  it("uses resilient contrast for the primary CTA and audit identity", () => {
    expect(cssBlock(".primaryLink")).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--sf-accent\)[^;]+var\(--sf-fg\)\);/u,
    );
    expect(cssBlock(".auditIdentity")).toMatch(/color:\s*var\(--sf-fg\);/u);
  });

  it("stacks the hero content before its actions claim the mobile width", () => {
    const narrowHero = cssBlock(".hero", mediaSection("(max-width: 760px)"));

    expect(narrowHero).toMatch(/flex-direction:\s*column;/u);
  });
});
