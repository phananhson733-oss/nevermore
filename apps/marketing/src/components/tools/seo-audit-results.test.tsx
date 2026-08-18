// @input  -- a SeoAuditReport rendered through the real message bundles
// @output -- failing tests when ordering, grouping, legend, or closing drift
// @pos    -- guard on the SEO Audit result surface (交办 7a/7b/7c/9)
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type {
  SeoAuditPage,
  SeoAuditRecord,
  SeoAuditReport,
} from "@sf/public-tools";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { SeoAuditResults } from "./seo-audit-results";

function record(
  overrides: Partial<SeoAuditRecord> & Pick<SeoAuditRecord, "id">,
): SeoAuditRecord {
  return {
    category: "metadata",
    state: "observed",
    unit: "pages",
    population: "every_collected_page" as const,
    tested: 12,
    affected: 0,
    observations: [],
    limitation: null,
    ...overrides,
  };
}

function pageObservations(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://acme.com/p${index}`,
    values: [{ label: "title", value: null }],
  }));
}

const page: SeoAuditPage = {
  url: "https://acme.com/",
  subjectUrl: "https://acme.com/",
  finalUrl: "https://acme.com/",
  depth: 0,
  initialStatus: 200,
  finalStatus: 200,
  redirectHops: 0,
  contentType: "text/html",
  robotsDirectiveState: "noindex_not_observed",
  canonicalTarget: null,
  title: "Home",
  metaDescription: null,
  h1Count: 1,
  headingsCount: 3,
  wordCount: 120,
  inboundLinks: 0,
  outboundLinks: 2,
  sitemapMember: true,
  jsonLdTypes: [],
  jsonLdErrorCount: 0,
    assets: null,
};

const records: readonly SeoAuditRecord[] = [
  record({
    id: "robots_resource",
    category: "crawl",
    unit: "site_resource",
    population: "every_collected_page" as const,
    tested: 1,
    affected: 1,
    observations: [
      {
        url: "https://acme.com/robots.txt",
        values: [
          { label: "fetched", value: true },
          { label: "groups_observed", value: 1 },
        ],
      },
    ],
  }),
  record({ id: "canonical_missing", state: "not_observed", affected: 0 }),
  record({
    id: "title_missing",
    affected: 9,
    observations: pageObservations(9),
  }),
  record({
    id: "sitemap_resource",
    category: "crawl",
    unit: "site_resource",
    population: "every_collected_page" as const,
    state: "unverified",
    tested: 0,
    affected: 0,
    limitation: "resource_not_observed_does_not_prove_absence",
  }),
  record({
    id: "title_duplicate",
    affected: 4,
    tested: 10,
    limitation: "normalised_text_match_within_inspected_pages",
    observations: [
      {
        url: "https://acme.com/wiki/aries",
        values: [
          { label: "title", value: "Aries" },
          { label: "matching_pages", value: 2 },
        ],
      },
      {
        url: "https://acme.com/en/wiki/aries",
        values: [
          { label: "title", value: " aries " },
          { label: "matching_pages", value: 2 },
        ],
      },
      {
        url: "https://acme.com/wiki/jupiter",
        values: [
          { label: "title", value: "Jupiter" },
          { label: "matching_pages", value: 2 },
        ],
      },
      {
        url: "https://acme.com/en/wiki/jupiter",
        values: [
          { label: "title", value: "Jupiter" },
          { label: "matching_pages", value: 2 },
        ],
      },
    ],
  }),
  record({
    id: "h1_missing",
    category: "structure",
    affected: 2,
    observations: [
      {
        url: "https://acme.com/a",
        values: [{ label: "h1_count", value: 0 }],
      },
      {
        url: "https://acme.com/b",
        values: [{ label: "h1_count", value: 0 }],
      },
    ],
  }),
  record({
    id: "meta_description_missing",
    affected: 1,
    observations: [
      {
        url: "https://acme.com/c",
        values: [{ label: "meta_description", value: null }],
      },
    ],
  }),
  record({
    id: "multiple_h1",
    category: "structure",
    state: "not_observed",
    affected: 0,
  }),
];

const report: SeoAuditReport = {
  targetUrl: "https://acme.com",
  siteOrigin: "https://acme.com",
  scannedAt: "2026-08-07T00:00:00.000Z",
  targetInspected: true,
  inspectedTargetUrl: "https://acme.test/",
  targetPageExtract: null,
  coverage: {
    availability: "available",
    pagesInspected: 12,
    linksObserved: 40,
    sitemapUrlsObserved: 10,
    urlsSkipped: 0,
    urlsBlocked: 0,
    urlsDisallowed: 0,
    urlsErrored: 0,
    stopReason: null,
  },
  siteResources: {
    robotsFetched: true,
    robotsGroupsObserved: 1,
    sitemapReferencesObserved: 1,
    sitemapFetched: false,
  },
  records,
  pages: [page],
};

function render(value: SeoAuditReport, locale = "en"): string {
  const bundle = locale === "zh" ? zh : en;
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={{ tools: { seoAudit: bundle.tools.seoAudit } }}
    >
      <SeoAuditResults report={value} locale={locale} />
    </NextIntlClientProvider>,
  );
}

function recordSlice(html: string, id: string): string {
  const marker = `data-testid="seo-audit-record-${id}"`;
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + marker.length);
  const next = rest.search(/data-testid="seo-audit-(?:record-|zero-records)/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("SeoAuditResults ordering (7a)", () => {
  it("renders records by observed count descending, arithmetic only", () => {
    const html = render(report);
    const order = [
      ...html.matchAll(/data-testid="seo-audit-record-([a-z0-9_]+)"/g),
    ].map((match) => match[1]);
    expect(order).toEqual([
      "title_missing",
      "title_duplicate",
      "h1_missing",
      "robots_resource",
      "meta_description_missing",
      "sitemap_resource",
      "canonical_missing",
      "multiple_h1",
    ]);
  });

  it("collapses zero-observation checks into one expandable summary line", () => {
    const html = render(report);
    expect(html).toContain(
      "2 checks observed nothing: Canonical link not present, Multiple H1 elements",
    );
    const zeroStart = html.indexOf('data-testid="seo-audit-zero-records"');
    expect(zeroStart).toBeGreaterThan(-1);
    // The unverified record is a "could not check" disclosure, not "observed
    // nothing"; it must stay outside the collapsed group.
    expect(
      html.indexOf('data-testid="seo-audit-record-sitemap_resource"'),
    ).toBeLessThan(zeroStart);
    expect(
      html.indexOf('data-testid="seo-audit-record-canonical_missing"'),
    ).toBeGreaterThan(zeroStart);
  });

  it("omits the collapsed line when every check observed something", () => {
    const html = render({
      ...report,
      records: records.filter((entry) => entry.affected > 0),
    });
    expect(html).not.toContain("seo-audit-zero-records");
  });
});

describe("SeoAuditResults grouped evidence (9)", () => {
  it("renders one row per distinct duplicate value with count and URLs", () => {
    const html = render(report);
    const slice = recordSlice(html, "title_duplicate");
    expect(slice.split("Aries").length - 1).toBe(1);
    expect(slice.split("Jupiter").length - 1).toBe(1);
    expect(slice).toContain("2 pages");
    for (const url of [
      "https://acme.com/wiki/aries",
      "https://acme.com/en/wiki/aries",
      "https://acme.com/wiki/jupiter",
      "https://acme.com/en/wiki/jupiter",
    ]) {
      expect(slice).toContain(`>${url}<`);
    }
    expect(
      slice.split('data-testid="seo-audit-duplicate-group"').length - 1,
    ).toBe(2);
  });

  it("keeps per-URL evidence cards for non-grouped records", () => {
    const html = render(report);
    const slice = recordSlice(html, "title_missing");
    expect(slice).not.toContain("seo-audit-duplicate-group");
    expect(slice).toContain("Title text");
  });
});

describe("SeoAuditResults legend (7c)", () => {
  it("explains the record states next to the results header", () => {
    const html = render(report);
    expect(html).toContain('data-testid="seo-audit-state-legend"');
    expect(html).toContain("Reading the record states");
    expect(html).toContain("not a severity rating");
  });

  it("styles observed problem checks apart from observed site resources", () => {
    const html = render(report);
    expect(recordSlice(html, "title_missing")).toContain("brand-info");
    const robots = recordSlice(html, "robots_resource");
    expect(robots).toContain("border-brand-accent/30");
    expect(robots).not.toContain("brand-info");
  });

  it("localises the legend", () => {
    expect(render(report, "zh")).toContain("状态标识说明");
  });
});

describe("SeoAuditResults closing section (7b)", () => {
  it("computes every number from the payload and links the GSC funnel", () => {
    const html = render(report);
    const start = html.indexOf('data-testid="seo-audit-closing"');
    expect(start).toBeGreaterThan(-1);
    const slice = html.slice(start);
    expect(slice).toContain("We checked 12 pages and observed 4 issue types:");
    // Top three issue types by observed count; the fourth stays out.
    expect(slice).toContain("Title not present");
    expect(slice).toContain("Repeated title text");
    expect(slice).toContain("H1 not present");
    expect(slice).not.toContain("Meta description not present");
    // Site resources are observations, not issue types.
    expect(slice).not.toContain("robots.txt resource");
    expect(slice).toContain("only in your Search Console");
    // Four issue types in the fixture: the top-three list carries its note.
    expect(slice).toContain("the full list of 4 is above");
    expect(slice).toContain(
      "Connect Search Console to see which pages actually rank and get traffic",
    );
    expect(slice).toContain("scope=gsc");
    expect(slice).toContain("next=%2Ftools%2Fseo-quick-wins");
  });

  it("localises the closing section and keeps the locale in the funnel link", () => {
    const html = render(report, "zh");
    const slice = html.slice(html.indexOf('data-testid="seo-audit-closing"'));
    expect(slice).toContain("我们检查了 12 个页面，观察到 4 类问题：");
    expect(slice).toContain("next=%2Fzh%2Ftools%2Fseo-quick-wins");
  });

  it("renders after the page inventory as the final block", () => {
    const html = render(report);
    expect(html.indexOf('data-testid="seo-audit-closing"')).toBeGreaterThan(
      html.indexOf('data-testid="seo-audit-pages"'),
    );
  });
});
