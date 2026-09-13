import { describe, expect, it } from "vitest";
import { PERSISTED_VERSION, parsePersistedState } from "../store/schema.ts";
import { populatedProjectState } from "../store/test-fixtures.ts";
import type { AuditPageRow, AuditReport, CrawlSignals, GscRow, Profile, ProfileDoc } from "../types.ts";
import { sitePages } from "./audit.ts";
import { marketLanguage } from "./market.ts";
import { crawlSignals, demoAiDoc, gscSignals } from "./profile.ts";

const AT = "2026-09-13 10:00";
/** Not GenGrowth (see profile-ai.test.ts for why). */
const ACME: Profile = { url: "acme.io", brand: "Acme", positioning: "", features: "", competitors: "", market: "US" };
const WIDGETS: Profile = {
  url: "https://www.widgets.co.uk",
  brand: "Widgets",
  positioning: "inventory software for small warehouses",
  features: "barcode scanning, stock alerts, supplier portal",
  competitors: "Sortly, inFlow, Zoho Inventory, Fishbowl, Cin7",
  market: "GB",
};
const NO_BRAND: Profile = { ...WIDGETS, brand: "", url: "", market: "cn" };
const PROFILES = [ACME, WIDGETS, NO_BRAND] as const;
const VARIANTS = ["crawl", "third"] as const;
/** The sample does not know the site's framework, so it never guesses one. */
const UNKNOWN_STACK = "[未知：先识别仓库框架]";
const CRAWL_KEYS = [
  "dr", "h1", "hasBlog", "hasDocs", "hasPricing", "indexable", "lang", "pages", "refdomains", "stack", "traffic",
];

function row(query: string, clicks: number | null, position: number | null): GscRow {
  return { query, clicks, impressions: 100, ctr: 1, position };
}

function pageRow(url: string, status = 200): AuditPageRow {
  return { url, status, h1: 1, hasSchema: false, lcp: "2.0", issues: 0 };
}

/** Built literally rather than with runAudit, so these tests do not move when the audit mock does. */
function observedAudit(
  urls: readonly string[],
  pages: number,
  indexable: number,
): Pick<AuditReport, "crawl" | "pageRows"> {
  return {
    crawl: { pages, indexable, blocked: pages - indexable, orphan: 1, lcp: "2.8", schema: 40, llmReadable: 60 },
    pageRows: urls.map((url) => pageRow(url)),
  };
}

const PRICING_AND_POST = observedAudit(["https://acme.io/", "https://acme.io/pricing", "https://acme.io/blog/rank-guide"], 64, 59);
const DOCS_AND_BLOG = observedAudit(["https://acme.io/", "https://acme.io/docs", "https://acme.io/blog"], 12, 12);
const LOOKALIKES = observedAudit(
  ["https://acme.io/", "https://acme.io/pricing-old", "https://acme.io/docs-v2", "https://acme.io/blogger", "https://acme.io/about/blog"],
  30,
  25,
);
const AUDITS = [PRICING_AND_POST, DOCS_AND_BLOG, LOOKALIKES] as const;

/** Fields drawn from the seed whether or not an audit is supplied. */
function drawnFields(signals: CrawlSignals): Pick<CrawlSignals, "lang" | "stack" | "h1" | "traffic" | "dr" | "refdomains"> {
  const { lang, stack, h1, traffic, dr, refdomains } = signals;
  return { lang, stack, h1, traffic, dr, refdomains };
}

describe("crawlSignals", () => {
  it("takes the language from the market code (R16), not from a label", () => {
    expect(crawlSignals({ ...ACME, market: "CN" }, "crawl").lang).toBe("zh-CN");
    expect(crawlSignals({ ...ACME, market: "jp" }, "third").lang).toBe("ja-JP");
    expect(crawlSignals({ ...ACME, market: "中文" }, "crawl").lang).toBe("en-US");
    for (const profile of PROFILES) {
      expect(crawlSignals(profile, "crawl").lang).toBe(marketLanguage(profile.market));
    }
  });

  it("marks the H1 as a placeholder that was never crawled (R10)", () => {
    expect(crawlSignals(ACME, "crawl").h1).toBe("[示例] Acme 的首页 H1（未抓取）");
    expect(crawlSignals(NO_BRAND, "third").h1).toBe("[示例] [品牌] 的首页 H1（未抓取）");
    expect(crawlSignals({ ...ACME, brand: "   " }, "crawl").h1).toBe("[示例] [品牌] 的首页 H1（未抓取）");
    // The prototype put the positioning into the H1, which reads as observed page copy.
    expect(crawlSignals(WIDGETS, "crawl").h1).not.toContain(WIDGETS.positioning);
  });

  it("draws the crawl and the third-party variants from different seeds", () => {
    for (const profile of PROFILES) {
      expect(crawlSignals(profile, "crawl")).not.toEqual(crawlSignals(profile, "third"));
    }
  });

  it("is deterministic per variant and keyed on the normalized domain", () => {
    expect(crawlSignals(WIDGETS, "crawl")).toEqual(crawlSignals(WIDGETS, "crawl"));
    expect(crawlSignals({ ...ACME, url: "https://www.ACME.io/pricing" }, "third")).toEqual(crawlSignals(ACME, "third"));
  });

  it("stays inside the prototype's ranges and never reports more indexable pages than crawled ones", () => {
    const cases = PROFILES.flatMap((profile) => VARIANTS.map((variant) => ({ profile, variant })));
    for (const { profile, variant } of cases) {
      const signals = crawlSignals(profile, variant);
      const floor = sitePages(profile).length;
      expect(Object.keys(signals).sort()).toEqual(CRAWL_KEYS);
      expect(signals.stack).toBe(UNKNOWN_STACK);
      expect(signals.pages).toBeGreaterThanOrEqual(floor);
      expect(signals.pages).toBeLessThan(floor + 40);
      expect(signals.indexable).toBeGreaterThanOrEqual(1);
      expect(signals.indexable).toBeLessThanOrEqual(signals.pages);
      expect(signals.traffic % 10).toBe(0);
      expect(signals.traffic).toBeGreaterThanOrEqual(300);
      expect(signals.traffic).toBeLessThanOrEqual(5500);
      expect(signals.dr).toBeGreaterThanOrEqual(8);
      expect(signals.dr).toBeLessThan(53);
      expect(signals.refdomains).toBeGreaterThanOrEqual(15);
      expect(signals.refdomains).toBeLessThan(275);
      const counts = [signals.pages, signals.indexable, signals.traffic, signals.dr, signals.refdomains];
      expect(counts.every((value) => Number.isInteger(value))).toBe(true);
      expect([signals.hasPricing, signals.hasDocs, signals.hasBlog].every((flag) => typeof flag === "boolean")).toBe(true);
    }
  });

  it("takes pages, indexable and the page flags from a supplied audit", () => {
    for (const variant of VARIANTS) {
      expect(crawlSignals(ACME, variant, PRICING_AND_POST)).toMatchObject({
        pages: 64, indexable: 59, hasPricing: true, hasDocs: false, hasBlog: true,
      });
      expect(crawlSignals(ACME, variant, DOCS_AND_BLOG)).toMatchObject({
        pages: 12, indexable: 12, hasPricing: false, hasDocs: true, hasBlog: true,
      });
      expect(crawlSignals(ACME, variant, LOOKALIKES)).toMatchObject({
        pages: 30, indexable: 25, hasPricing: false, hasDocs: false, hasBlog: false,
      });
    }
  });

  it("reads paths from relative rows, ignoring a query string and a trailing slash", () => {
    const audit = { ...LOOKALIKES, pageRows: ["/pricing/", "https://acme.io/docs?ref=nav", "/blog/"].map((url) => pageRow(url)) };
    expect(crawlSignals(WIDGETS, "crawl", audit)).toMatchObject({ hasPricing: true, hasDocs: true, hasBlog: true });
  });

  it("counts a page only when its row answered 2xx", () => {
    const audit = {
      ...PRICING_AND_POST,
      pageRows: [pageRow("https://acme.io/"), pageRow("https://acme.io/pricing", 301), pageRow("https://acme.io/blog/guide")],
    };
    for (const variant of VARIANTS) {
      expect(crawlSignals(ACME, variant, audit)).toMatchObject({ hasPricing: false, hasDocs: false, hasBlog: true });
    }
    const hasDocsAt = (status: number): boolean =>
      crawlSignals(ACME, "crawl", { ...audit, pageRows: [pageRow("https://acme.io/docs", status)] }).hasDocs;
    expect([199, 200, 204, 299, 300, 301, 404, 500].map(hasDocsAt)).toEqual([false, true, true, true, false, false, false, false]);
  });

  it("never guesses the stack, with or without an audit", () => {
    for (const profile of PROFILES) {
      for (const variant of VARIANTS) {
        expect(crawlSignals(profile, variant).stack).toBe(UNKNOWN_STACK);
        expect(crawlSignals(profile, variant, DOCS_AND_BLOG).stack).toBe(UNKNOWN_STACK);
      }
    }
  });

  it("draws the same stack, traffic, DR and referring domains with or without an audit", () => {
    const cases = PROFILES.flatMap((profile) => VARIANTS.flatMap((variant) => AUDITS.map((audit) => ({ profile, variant, audit }))));
    for (const { profile, variant, audit } of cases) {
      expect(drawnFields(crawlSignals(profile, variant, audit))).toEqual(drawnFields(crawlSignals(profile, variant)));
    }
  });
});

describe("gscSignals", () => {
  const ROWS: readonly GscRow[] = Object.freeze(
    [
      row("gen pricing", 10, 2),
      row("genre music", 7, 15),
      row("Gen login", null, 12),
      row("best tools", 30, 31),
      row("gen vs rival", 5, 30),
      row("x", 1, null),
      row("y", 2, 10.01),
    ].map((entry) => Object.freeze(entry)),
  );
  const queries = (rows: readonly GscRow[]): readonly string[] => rows.map((entry) => entry.query);

  it("matches the brand as a whole word: Gen is not genre", () => {
    const signals = gscSignals({ brand: "Gen" }, ROWS);
    expect(signals.total).toBe(7);
    expect(signals.brandQueries).toBe(3);
    // "Gen login" has no clicks, so 15 is the sum of the available clicks: a lower bound.
    expect(signals.brandClicks).toBe(15);
    expect(signals.nonBrandClicks).toBe(40);
  });

  it("reports a real zero for a brand no query mentions", () => {
    expect(gscSignals({ brand: "Zed" }, ROWS)).toMatchObject({ brandQueries: 0, brandClicks: 0, nonBrandClicks: 55 });
  });

  it("does not know the brand split without a brand", () => {
    for (const brand of ["", "   "]) {
      const signals = gscSignals({ brand }, ROWS);
      expect(signals).toMatchObject({ total: 7, brandQueries: null, brandClicks: null, nonBrandClicks: null, near: 4 });
      expect(signals.top).toHaveLength(5);
    }
  });

  it("is null, not 0, when every click in a subset is unavailable", () => {
    const rows = [row("gen a", null, 5), row("gen b", Number.NaN, 5), row("other", 3, 5)];
    expect(gscSignals({ brand: "Gen" }, rows)).toMatchObject({ brandQueries: 2, brandClicks: null, nonBrandClicks: 3 });
    expect(gscSignals({ brand: "Gen" }, [row("other", null, 5)])).toMatchObject({ brandClicks: 0, nonBrandClicks: null });
  });

  it("counts borderline rows (10 < position <= 30) as near", () => {
    expect(gscSignals({ brand: "Gen" }, ROWS).near).toBe(4);
    expect(gscSignals({ brand: "Gen" }, [row("a", 1, 3), row("b", 1, null)]).near).toBe(0);
  });

  it("does not know near when no row has an available position", () => {
    expect(gscSignals({ brand: "Gen" }, [row("a", 1, null), row("b", 2, 0)]).near).toBeNull();
  });

  it("lists the top five by available clicks, unavailable last, without reordering the input", () => {
    const before = queries(ROWS);
    expect(queries(gscSignals({ brand: "Gen" }, ROWS).top)).toEqual(["best tools", "gen pricing", "genre music", "gen vs rival", "y"]);
    expect(queries(ROWS)).toEqual(before);
    expect(queries(gscSignals({ brand: "Gen" }, [row("a", null, 1), row("b", 0, 1), row("c", 1, 1)]).top)).toEqual(["c", "b", "a"]);
    const ties = [row("n1", null, 1), row("n2", Number.NaN, 1), row("z", 0, 1), row("y", 0, 1)];
    expect(queries(gscSignals({ brand: "Gen" }, ties).top)).toEqual(["z", "y", "n1", "n2"]);
  });

  it("reports nothing it was not given", () => {
    expect(gscSignals({ brand: "Gen" }, [])).toEqual({
      total: 0, brandQueries: 0, brandClicks: 0, nonBrandClicks: 0, top: [], near: 0,
    });
    expect(gscSignals({ brand: "" }, [])).toEqual({
      total: 0, brandQueries: null, brandClicks: null, nonBrandClicks: null, top: [], near: 0,
    });
  });
});

describe("profile document round-trip", () => {
  const GSC_CASES: readonly (readonly GscRow[])[] = [[row("acme pricing", 3, 4), row("other", null, null)], [row("other", null, null)], []];

  it("has a fixture with every nullable count null", () => {
    expect(gscSignals(NO_BRAND, [row("other", null, null)])).toMatchObject({
      brandQueries: null, brandClicks: null, nonBrandClicks: null, near: null,
    });
  });

  it("survives JSON and the strict persisted-state schema, unavailable counts included", () => {
    const cases = PROFILES.flatMap((profile) => GSC_CASES.map((rows) => ({ profile, rows })));
    for (const { profile, rows } of cases) {
      const profileDoc: ProfileDoc = {
        crawl: crawlSignals(profile, "crawl", DOCS_AND_BLOG),
        gsc: gscSignals(profile, rows),
        third: crawlSignals(profile, "third"),
        ai: demoAiDoc(profile),
        at: AT,
      };
      const state = {
        ...populatedProjectState({ url: profile.url, brand: profile.brand, market: profile.market }),
        profile,
        profileDoc,
      };
      const raw: unknown = JSON.parse(JSON.stringify({ v: PERSISTED_VERSION, state }));
      expect(parsePersistedState(raw)?.profileDoc).toEqual(profileDoc);
    }
  });
});
