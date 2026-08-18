// @input  -- the Agents directory, both message catalogues, and every uncatalogued copy source
// @output -- a failing test when the product goes back to being two Agents
// @pos    -- the structural guard behind "one Agent, one technical focus"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/messages/en.json" with { type: "json" };
import zh from "../../../i18n/messages/zh.json" with { type: "json" };

const HUB_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

/**
 * Every source file in the app, not a list of the ones we thought of.
 *
 * The first version of this guard named four files. It passed while the retired
 * product name was still shipping from the Tools directory, the blog index, two
 * blog CTAs, the traffic-drop results, the quick-wins article and a homepage
 * component — six of them user-visible, and all of them found by grepping the
 * production build rather than by this test. A guard that enumerates its own
 * scope can only ever be as complete as the sweep that wrote it.
 */
const SOURCE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    // Tests may name the retired product to assert its absence.
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    found.push(path);
  }
  return found;
}

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

/**
 * Match the name as the reader sees it, not as the file stores it.
 *
 * A contiguous `includes` passed while a live Chinese cookie policy still said
 * "SEO 与 Tech Agent" — with the line wrapped between "Tech" and "Agent". The
 * rendered page has no newline there; the markdown source does. Any run of
 * whitespace counts as one space before the check.
 */
function asRendered(source: string): string {
  return source.replace(/\s+/gu, " ");
}

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
      if (asRendered(text).includes(RETIRED_PRODUCT_NAME)) offenders.push(text);
    });

    expect(offenders).toEqual([]);
  });

  /**
   * The legal pages, which are markdown rather than source.
   *
   * A privacy policy that describes what "the SEO Agent and the Tech Agent" do
   * with a visitor's data is a statement about a product that does not exist.
   *
   * `content/blog/` and `content/skills/` are deliberately NOT covered. Those are
   * dated, published documents; rewriting what they said on the day they were
   * published is a content decision for the Owner, not a mechanical sweep, and
   * the technical route they link to is still reachable. Twelve blog posts and
   * four Skill manuals still name the retired product, across 13 rendered pages
   * — a recorded exemption, not an oversight.
   */
  it("legal pages describe one Agent", () => {
    const legalRoot = fileURLToPath(
      new URL("../../../../content/legal", import.meta.url),
    );
    const offenders: string[] = [];
    for (const locale of readdirSync(legalRoot)) {
      const directory = `${legalRoot}/${locale}`;
      for (const entry of readdirSync(directory)) {
        if (!entry.endsWith(".md")) continue;
        const source = readFileSync(`${directory}/${entry}`, "utf8");
        if (asRendered(source).includes(RETIRED_PRODUCT_NAME)) {
          offenders.push(`${locale}/${entry}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no source file anywhere in the app names the retired product", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SOURCE_ROOT.replace(/\/$/, ""))) {
      const source = readFileSync(path, "utf8");
      if (!asRendered(source).includes(RETIRED_PRODUCT_NAME)) continue;
      offenders.push(path.slice(SOURCE_ROOT.length));
    }

    // Comments count. They are not user-visible, but a header comment that still
    // describes two products is how the next reader learns the wrong model.
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
  it("carries no two-audit claim anywhere, in either locale", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SOURCE_ROOT.replace(/\/$/, ""))) {
      const source = readFileSync(path, "utf8");
      for (const phrase of [
        "SEO and Tech",
        "SEO 与 Tech",
        "independent SEO or Tech",
        "独立的 SEO 或 Tech",
      ]) {
        if (asRendered(source).includes(phrase)) {
          offenders.push(`${path.slice(SOURCE_ROOT.length)}: ${phrase}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The hub's own search snippet.
   *
   * It kept telling searchers to choose between two Agents after every message
   * on the page had been rewritten — metadata is copy, and it is the copy a
   * reader sees before they see the page.
   */
  it.each([
    ["en", en],
    ["zh", zh],
  ])("%s hub metadata does not offer a choice of Agent", (_locale, catalogue) => {
    const description = (
      catalogue as unknown as {
        agents: { hub: { metaDescription: string } };
      }
    ).agents.hub.metaDescription;

    for (const framing of ["Choose a", "choose a", "选择一个", "任选"]) {
      expect(description.includes(framing), description).toBe(false);
    }
  });

  /**
   * Peer cards are for Agents, and the technical route is not one.
   *
   * The rule used to be "no card list at all", which was right when SEO and
   * Tech were the only two things on this page and wrong the moment GEO landed:
   * GEO asks a live assistant real questions and reads back who it cited, which
   * is a different capability on different evidence. What must not come back is
   * the technical route sitting in that list as a third product — it renders the
   * same workbench over the same engine as SEO and differs only in which checks
   * open first.
   */
  it("lists the Agents as peers and keeps the technical route out of that list", () => {
    const source = readFileSync(HUB_PAGE, "utf8");

    const cardList = /const cards = \[([\s\S]*?)\] as const;/.exec(source)?.[1];
    expect(cardList, "the hub no longer declares its Agent cards").toBeTruthy();
    const ids = [...(cardList ?? "").matchAll(/id: "([a-z]+)"/g)].map(
      (match) => match[1],
    );
    expect(ids).toEqual(["seo", "geo"]);

    // Both Agents reachable from their own card.
    expect(source).toContain('t(`${id}.title`)');
    expect(source).toContain('{ id: "seo", icon: ScanSearch, path: "/agents/seo" }');
    expect(source).toContain('{ id: "geo", icon: Radar, path: "/agents/geo" }');
    // The technical route stays reachable, below them, outside the card list.
    expect(source).toContain('localePath(locale, "/agents/tech")');
    const afterCards = source.slice(source.indexOf("] as const;"));
    expect(afterCards).toContain('t("tech.title")');
  });
});
