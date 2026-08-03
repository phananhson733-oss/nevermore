import { describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json" with { type: "json" };
import zh from "../../i18n/messages/zh.json" with { type: "json" };
import { PUBLIC_TOOL_SYNC_CRAWL_BUDGET } from "@sf/sources/crawl-public-preview";

/**
 * The public crawl copy has to survive contact with the budget it describes.
 *
 * The shipped page told the reader there was "no fixed page product quota"
 * while every run stopped at the same hard ceiling, and the number was never
 * shown. That ceiling is not `maxUrls`: the host pacer advances a single
 * shared launch time by `minHostDelayMs` for all workers, so the crawl issues
 * `1000 / minHostDelayMs` page fetches per second regardless of how many
 * workers are running, and the wall clock runs out long before 2000 URLs do.
 */
const PACED_LAUNCHES_PER_SECOND = 1_000 / PUBLIC_TOOL_SYNC_CRAWL_BUDGET.minHostDelayMs;
const WALL_CLOCK_SECONDS = PUBLIC_TOOL_SYNC_CRAWL_BUDGET.maxWallClockMs / 1_000;
const REACHABLE_PAGES = PACED_LAUNCHES_PER_SECOND * WALL_CLOCK_SECONDS;

const BUNDLES = { en, zh } as const;

function seoAudit(locale: "en" | "zh") {
  return (
    BUNDLES[locale] as unknown as {
      tools: { seoAudit: Record<string, string> };
    }
  ).tools.seoAudit;
}

describe("the shipped page ceiling", () => {
  it("is the pacer, not maxUrls", () => {
    // 240s / 250ms = 960. If this ever exceeds maxUrls, the copy below is
    // wrong in the other direction and needs rewriting.
    expect(REACHABLE_PAGES).toBeLessThan(PUBLIC_TOOL_SYNC_CRAWL_BUDGET.maxUrls);
    expect(Math.round(REACHABLE_PAGES)).toBe(960);
  });
});

describe("public crawl copy", () => {
  it.each(["en", "zh"] as const)(
    "does not tell %s readers there is no page limit",
    (locale) => {
      const copy = seoAudit(locale);
      const denials =
        locale === "en"
          ? ["no fixed page", "no page quota", "no page limit"]
          : ["不设固定页面", "不限页面", "没有页面上限"];
      for (const field of ["scopeShort", "faq1a"]) {
        const text = copy[field]?.toLowerCase() ?? "";
        for (const denial of denials) {
          expect(
            text,
            `${locale}.${field} denies a limit that exists: ${copy[field]}`,
          ).not.toContain(denial.toLowerCase());
        }
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "states the actual ceiling in %s, in the order of magnitude the code enforces",
    (locale) => {
      const text = `${seoAudit(locale).scopeShort} ${seoAudit(locale).faq1a}`;
      // A figure the reader can hold: hundreds of pages, not "as many as it can".
      expect(text).toMatch(/9[0-9]{2}/);
    },
  );

  /**
   * The 409 gate is keyed on the extracted client IP, which collapses an IPv6
   * address to its /64 and every proxy-header-less request to the literal
   * "unknown". Two strangers behind one NAT share it. Telling the second one
   * that *their* browser already has a scan running is simply false.
   */
  it.each(["en", "zh"] as const)(
    "does not blame the %s visitor for a stranger's crawl",
    (locale) => {
      const text = seoAudit(locale).scan_in_progress ?? "";
      const errors = (
        BUNDLES[locale] as unknown as {
          tools: { seoAudit: { errors: Record<string, string> } };
        }
      ).tools.seoAudit.errors;
      const message = errors.scan_in_progress ?? text;
      const claimsOwnership =
        locale === "en"
          ? /your browser|this browser|for this connection\./i
          : /你的浏览器|该浏览器/;
      expect(message, `${locale}: ${message}`).not.toMatch(claimsOwnership);
      // And it should say whose limit it actually is.
      expect(message).toMatch(locale === "en" ? /network address/i : /网络地址/);
    },
  );
});

describe("free-tool summary copy", () => {
  /**
   * The homepage embeds the real site-wide crawler while the pricing page
   * called it a "single-page SEO audit". One anonymous submission issues up to
   * 4,500 requests at a third-party host; describing that as a single page
   * understates it by three orders of magnitude.
   */
  it.each(["en", "zh"] as const)("does not call the %s crawler single-page", (locale) => {
    const free = (
      BUNDLES[locale] as unknown as {
        pricing: { freeTools: Record<string, string> };
      }
    ).pricing.freeTools;
    const joined = Object.values(free).join(" ").toLowerCase();
    expect(joined).not.toContain(locale === "en" ? "single-page" : "单页 seo");
  });
});
