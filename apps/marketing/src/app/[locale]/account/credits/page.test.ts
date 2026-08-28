// @input  -- the credits account page source, both message catalogs, sitemap.ts
// @output -- a failing test when the page becomes indexable, cacheable or untranslated
// @pos    -- the guard on the only session-scoped page of the marketing site

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "../../../../i18n/messages/en.json" with { type: "json" };
import zh from "../../../../i18n/messages/zh.json" with { type: "json" };

function read(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

const PAGE = read("./page.tsx");

describe("/account/credits page contract", () => {
  /**
   * A personal ledger indexed under gengrowth.ai would be an empty page in
   * search results at best. Both halves matter: `noIndex` keeps it out of the
   * index, and staying out of sitemap.ts keeps it from being submitted.
   */
  it("keeps itself out of search results", () => {
    expect(PAGE).toContain("noIndex: true");
    expect(read("../../../sitemap.ts")).not.toContain("/account");
  });

  it("is rendered per request rather than cached", () => {
    expect(PAGE).toContain('export const dynamic = "force-dynamic"');
  });

  it("mounts the client body with the credits namespace only", () => {
    expect(PAGE).toContain("<CreditsAccountClient />");
    expect(PAGE).toContain("messages={{ credits: messages.credits }}");
    expect(PAGE).not.toContain("messages={messages}");
  });

  it("lets the shared account layout own the page frame", () => {
    expect(PAGE).not.toContain("min-h-screen");
    expect(PAGE).not.toContain(">GenGrowth<");
  });

  /**
   * The heading comes from the catalog rather than a locale ternary, so a
   * missing key would render the literal path `credits.account.title` on the
   * page instead of throwing. Both catalogs are checked here, since the page
   * cannot be rendered without a next-intl request scope.
   */
  it("takes its heading from both catalogs", () => {
    expect(PAGE).toContain('getTranslations({ locale, namespace: "credits.account" })');
    expect(PAGE).toContain('{t("title")}');
    expect(PAGE).toContain('{t("subtitle")}');

    for (const account of [en.credits.account, zh.credits.account]) {
      expect(account.title).toEqual(expect.any(String));
      expect(account.title).not.toBe("");
      expect(account.subtitle).toEqual(expect.any(String));
      expect(account.subtitle).not.toBe("");
    }
    expect(zh.credits.account.title).toMatch(/[一-鿿]/u);
  });
});
