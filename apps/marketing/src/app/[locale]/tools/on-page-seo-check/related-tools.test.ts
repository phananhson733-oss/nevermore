// @input  -- the related-tool links this page publishes, in both catalogues
// @output -- a failing test when one of them is dead or goes through a redirect
// @pos    -- the guard for the internal links added to the bottom of this page

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../../../../i18n/messages/en.json" with { type: "json" };
import zh from "../../../../i18n/messages/zh.json" with { type: "json" };

interface RelatedTool {
  readonly href: string;
  readonly name: string;
  readonly blurb: string;
}

const APP_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const CATALOGUES: readonly (readonly [string, readonly RelatedTool[]])[] = [
  ["en", en.tools.onPageChecker.related.items],
  ["zh", zh.tools.onPageChecker.related.items],
];

/** The route file a locale-relative href resolves to. */
function routeFile(href: string): string {
  return `${APP_ROOT}[locale]${href}/page.tsx`;
}

describe("the links this page adds at the bottom", () => {
  it.each(CATALOGUES)("%s names five destinations", (_locale, items) => {
    expect(items).toHaveLength(5);
    expect(new Set(items.map((item) => item.href)).size).toBe(5);
  });

  it.each(CATALOGUES)("%s points at routes that exist", (_locale, items) => {
    for (const item of items) {
      expect(existsSync(routeFile(item.href)), item.href).toBe(true);
    }
  });

  it.each(CATALOGUES)(
    "%s links the destination, not the shim that redirects to it",
    (_locale, items) => {
      // `/tools/seo-audit` remains a `permanentRedirect` shim, so this
      // catalogue links straight to `/agents/seo`. The restored Internal Link
      // Audit is an active public page and remains its own destination.
      for (const item of items) {
        const source = readFileSync(routeFile(item.href), "utf8");
        expect(source, item.href).not.toContain("permanentRedirect");
        expect(source, item.href).not.toContain("redirect(");
      }
    },
  );

  it("keeps the two catalogues pointing at the same places", () => {
    const [[, enItems], [, zhItems]] = CATALOGUES as unknown as readonly [
      readonly [string, readonly RelatedTool[]],
      readonly [string, readonly RelatedTool[]],
    ];
    expect(zhItems.map((item) => item.href)).toEqual(
      enItems.map((item) => item.href),
    );
    // Translated, not copied: a zh blurb identical to the en one is an
    // untranslated string that the parity check alone would pass.
    for (const [index, item] of zhItems.entries()) {
      expect(item.blurb).not.toBe(enItems[index]?.blurb);
    }
  });

  it.each(CATALOGUES)(
    "%s links Internal Link Audit directly to the public tool",
    (_locale, items) => {
      const internalLinkAudit = items.find(
        (item) =>
          item.name === "Internal Link Audit" || item.name === "内链审计",
      );

      expect(internalLinkAudit?.href).toBe("/tools/internal-link-audit");
    },
  );

  it("does not link the page it is on", () => {
    for (const [, items] of CATALOGUES) {
      expect(items.map((item) => item.href)).not.toContain(
        "/tools/on-page-seo-check",
      );
    }
  });
});
