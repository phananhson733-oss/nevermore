// @input  -- the Agents directory, both message catalogues, and every uncatalogued copy source
// @output -- a failing test when the product goes back to being two Agents
// @pos    -- the structural guard behind "one Agent, one technical focus"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/messages/en.json" with { type: "json" };
import zh from "../../../i18n/messages/zh.json" with { type: "json" };

const HUB_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

/**
 * Copy that ships without going through the catalogue.
 *
 * Page metadata and JSON-LD are what a search result and an unfurl actually
 * show, and a catalogue sweep cannot see them: the peer-choice wording survived
 * in both after every message had been rewritten, including in one half of a
 * locale ternary where a check for English phrases could never have found it.
 */
const UNCATALOGUED_COPY = [
  "../page.tsx",
  "../pricing/page.tsx",
  "../../../components/seo/json-ld/software-application-json-ld.tsx",
  "../../../config/navigation.ts",
];

/**
 * The product has no "Tech Agent" in it.
 *
 * This is the whole rule, and it is deliberately a name rather than a list of
 * phrasings: the technical route renders the same workbench over the same engine
 * and differs only in which checks open first, so anything that gives it a
 * product name of its own re-creates the choice we removed. A blacklist of
 * sentences is worked around by writing a new sentence; a banned name is not.
 *
 * The route itself stays reachable and stays in the header — as a focus.
 */
const RETIRED_PRODUCT_NAME = "Tech Agent";

function walk(node: unknown, visit: (text: string) => void): void {
  if (typeof node === "string") {
    visit(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, visit);
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const entry of Object.values(node)) walk(entry, visit);
  }
}

describe("the product is one Agent with a technical focus", () => {
  it.each([
    ["en", en],
    ["zh", zh],
  ])("%s copy gives the technical route no product name of its own", (
    _locale,
    catalogue,
  ) => {
    const offenders: string[] = [];
    walk(catalogue, (text) => {
      if (text.includes(RETIRED_PRODUCT_NAME)) offenders.push(text);
    });

    expect(offenders).toEqual([]);
  });

  it.each(UNCATALOGUED_COPY)("%s does the same", (relative) => {
    const source = readFileSync(
      fileURLToPath(new URL(relative, import.meta.url)),
      "utf8",
    );
    const copyOnly = [...source.matchAll(/"([^"\\]{12,})"/g)].map(
      (match) => match[1],
    );

    // Only string literals long enough to be prose: a `slug: "tech"` or an
    // icon name is routing, not a claim about the product.
    const offenders = copyOnly.filter((text) =>
      text.includes(RETIRED_PRODUCT_NAME),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * Both halves of every locale ternary.
   *
   * The Chinese branch of two metadata descriptions kept advertising separate
   * SEO and Tech audits after the English branch had been rewritten, and a
   * verification pass that grepped English phrases against `/zh/...` reported
   * it clean.
   */
  it.each(UNCATALOGUED_COPY)("%s carries no two-audit claim in either locale", (
    relative,
  ) => {
    const source = readFileSync(
      fileURLToPath(new URL(relative, import.meta.url)),
      "utf8",
    );

    for (const phrase of [
      "SEO and Tech",
      "SEO 与 Tech",
      "independent SEO or Tech",
      "独立的 SEO 或 Tech",
    ]) {
      expect(source.includes(phrase), `${relative} still says "${phrase}"`).toBe(
        false,
      );
    }
  });

  it("renders a single primary card and no card loop", () => {
    const source = readFileSync(HUB_PAGE, "utf8");

    expect(source).toContain('t("seo.title")');
    expect(source).toContain('localePath(locale, "/agents/seo")');
    // The technical route stays reachable, subordinate to it.
    expect(source).toContain('localePath(locale, "/agents/tech")');
    // A map over a card list is what made them peers.
    expect(source).not.toMatch(/cards\.map/);
    expect(source).not.toMatch(/md:grid-cols-2/);
  });
});
