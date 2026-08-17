// @input  -- the Agents directory source and both message catalogues
// @output -- a failing test when the directory offers a peer choice again
// @pos    -- the guard for "one Agent, one technical focus" surviving future copy edits
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/messages/en.json" with { type: "json" };
import zh from "../../../i18n/messages/zh.json" with { type: "json" };

const HUB_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

/**
 * Sources that publish copy without going through the catalogue.
 *
 * Page metadata and JSON-LD are what a search result actually shows, and the
 * catalogue sweep cannot see them: the peer-choice wording survived there after
 * every message had been rewritten.
 */
const UNCATALOGUED_COPY = [
  "../page.tsx",
  "../pricing/page.tsx",
  "../../../components/seo/json-ld/software-application-json-ld.tsx",
];

/**
 * Phrases that put the two routes back on the same footing.
 *
 * They render the same workbench over the same engine and differ only in which
 * checks open first, so asking a visitor to pick one is asking them to decide
 * something already decided. The technical route stays reachable and keeps its
 * URL; what it must not do is read as a second product.
 */
const PEER_CHOICE_PHRASES = {
  en: [
    "Choose the Agent",
    "Choose one independent Agent",
    "Two independent Agents",
    "View both Agents",
    "Each Agent runs independently",
    "SEO Agent and Tech Agent",
    "SEO and Tech URL audit Agents",
  ],
  zh: [
    "两个独立",
    "查看两个 Agents",
    "各自独立运行",
    "选择一个独立 Agent",
    "SEO Agent 与 Tech Agent",
  ],
} as const;

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

describe("uncatalogued copy stays consistent with one Agent", () => {
  it.each(UNCATALOGUED_COPY)("%s names one Agent", (relative) => {
    const source = readFileSync(
      fileURLToPath(new URL(relative, import.meta.url)),
      "utf8",
    );

    for (const phrase of [
      "independent SEO and Tech",
      "SEO and Tech URL audit",
      "independent SEO or Tech",
    ]) {
      expect(source.includes(phrase), `${relative} still says "${phrase}"`).toBe(
        false,
      );
    }
  });
});

describe("the Agents directory offers one Agent", () => {
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

  it.each([
    ["en", en, PEER_CHOICE_PHRASES.en],
    ["zh", zh, PEER_CHOICE_PHRASES.zh],
  ])("keeps peer-choice wording out of %s copy", (_locale, catalogue, phrases) => {
    const offenders: string[] = [];
    walk(catalogue, (text) => {
      for (const phrase of phrases) {
        if (text.includes(phrase)) offenders.push(`${phrase} — ${text}`);
      }
    });

    expect(offenders).toEqual([]);
  });
});
