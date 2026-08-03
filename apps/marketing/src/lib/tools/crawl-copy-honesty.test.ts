import { describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json" with { type: "json" };
import zh from "../../i18n/messages/zh.json" with { type: "json" };
import { getInternalLinkAuditContent } from "../../components/tools/internal-link-audit-content.ts";
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

describe("internal-link-audit page copy", () => {
  const serialized = ["en", "zh"]
    .map((locale) =>
      JSON.stringify(
        getInternalLinkAuditContent(locale as "en" | "zh"),
      ),
    )
    .join(" ");

  /**
   * The sibling tool's page carried the same denial the seo-audit page did, in
   * its own copy module rather than the message bundle, so the first pass at
   * this missed it. It is now definitively false: there is a per-network and a
   * per-target hourly ceiling, and a ~950 page run limit.
   */
  it("does not deny a scan quota that exists", () => {
    for (const denial of [
      "No normal-use scan quota",
      "no normal-use scan quota",
      "不设置日常检测次数配额",
    ]) {
      expect(serialized, `still claims: ${denial}`).not.toContain(denial);
    }
  });

  it("states the ceiling in both locales", () => {
    // Same figure the engine enforces, quoted to the reader.
    expect(serialized).toContain("950");
    expect((serialized.match(/950/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the quota-outage message", () => {
  /**
   * The owner read "The usage-limit service is unavailable" as "you have used
   * up your limit" and replied that they had not run the tool at all that day.
   * If the person who wrote the limiter reads it that way, a visitor certainly
   * will. An outage on our side must not be phrased so it can be mistaken for
   * the reader's fault.
   */
  it.each(["en", "zh"] as const)("tells %s readers it is our outage", (locale) => {
    const errors = (
      BUNDLES[locale] as unknown as {
        tools: { seoAudit: { errors: Record<string, string> } };
      }
    ).tools.seoAudit.errors;
    const message = errors.quota_unavailable ?? "";
    expect(message).toMatch(locale === "en" ? /our side/i : /我们这边/);
    expect(message).toMatch(
      locale === "en" ? /not about your usage/i : /与你的使用量无关/,
    );
  });
});
