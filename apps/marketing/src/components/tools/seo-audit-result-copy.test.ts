// @input  -- synthetic SeoAuditRecord fixtures
// @output -- failing tests when ordering, grouping, or closing copy drift
// @pos    -- guard on the presentation-layer arithmetic for SEO Audit results
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";

import {
  closingCopy,
  duplicateGroups,
  observedIssueRecords,
  pageCountLabel,
  partitionRecords,
  zeroObservationSummary,
} from "./seo-audit-result-copy";

function record(
  overrides: Partial<SeoAuditRecord> & Pick<SeoAuditRecord, "id">,
): SeoAuditRecord {
  return {
    category: "metadata",
    state: "observed",
    unit: "pages",
    population: "every_collected_page",
    tested: 12,
    affected: 0,
    observations: [],
    limitation: null,
    ...overrides,
  };
}

const fixture: readonly SeoAuditRecord[] = [
  record({
    id: "robots_resource",
    category: "crawl",
    unit: "site_resource",
    tested: 1,
    affected: 1,
  }),
  record({ id: "canonical_missing", state: "not_observed", affected: 0 }),
  record({ id: "title_missing", affected: 9 }),
  record({
    id: "sitemap_resource",
    category: "crawl",
    unit: "site_resource",
    state: "unverified",
    tested: 0,
    affected: 0,
  }),
  record({ id: "title_duplicate", affected: 4 }),
  record({ id: "h1_missing", category: "structure", affected: 2 }),
  record({ id: "meta_description_missing", affected: 2 }),
  record({
    id: "multiple_h1",
    category: "structure",
    state: "not_observed",
    affected: 0,
  }),
];

describe("partitionRecords", () => {
  it("orders observed records by observed count descending", () => {
    const { observed } = partitionRecords(fixture);
    expect(observed.map((entry) => entry.id)).toEqual([
      "title_missing",
      "title_duplicate",
      "h1_missing",
      "meta_description_missing",
      "robots_resource",
    ]);
  });

  it("keeps payload order for equal observed counts", () => {
    const { observed } = partitionRecords(fixture);
    const tied = observed.filter((entry) => entry.affected === 2);
    expect(tied.map((entry) => entry.id)).toEqual([
      "h1_missing",
      "meta_description_missing",
    ]);
  });

  it("separates unverified records from checks that observed nothing", () => {
    const { unverified, nothingObserved } = partitionRecords(fixture);
    expect(unverified.map((entry) => entry.id)).toEqual(["sitemap_resource"]);
    expect(nothingObserved.map((entry) => entry.id)).toEqual([
      "canonical_missing",
      "multiple_h1",
    ]);
  });
});

describe("observedIssueRecords", () => {
  it("excludes site-resource records from the issue-type list", () => {
    expect(observedIssueRecords(fixture).map((entry) => entry.id)).toEqual([
      "title_missing",
      "title_duplicate",
      "h1_missing",
      "meta_description_missing",
    ]);
  });
});

describe("duplicateGroups", () => {
  const duplicate = record({
    id: "title_duplicate",
    affected: 4,
    tested: 10,
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
          { label: "matching_pages", value: 3 },
        ],
      },
      {
        url: "https://acme.com/en/wiki/jupiter",
        values: [
          { label: "title", value: "Jupiter" },
          { label: "matching_pages", value: 3 },
        ],
      },
    ],
  });

  it("collapses per-URL rows into one row per distinct normalised value", () => {
    const groups = duplicateGroups(duplicate);
    expect(groups).not.toBeNull();
    expect(groups?.map((group) => group.value)).toEqual(["Jupiter", "Aries"]);
    expect(groups?.[0]?.urls).toEqual([
      "https://acme.com/wiki/jupiter",
      "https://acme.com/en/wiki/jupiter",
    ]);
    expect(groups?.[0]?.pageCount).toBe(3);
    expect(groups?.[1]?.pageCount).toBe(2);
    expect(groups?.[1]?.urls).toEqual([
      "https://acme.com/wiki/aries",
      "https://acme.com/en/wiki/aries",
    ]);
  });

  it("returns null for records without the grouped evidence shape", () => {
    const plain = record({
      id: "title_missing",
      affected: 1,
      observations: [
        {
          url: "https://acme.com/",
          values: [{ label: "title", value: null }],
        },
      ],
    });
    expect(duplicateGroups(plain)).toBeNull();
    expect(duplicateGroups(record({ id: "title_duplicate" }))).toBeNull();
  });

  it("returns null when any observation is site-level", () => {
    const siteLevel = record({
      id: "title_duplicate",
      affected: 1,
      observations: [
        {
          url: null,
          values: [
            { label: "title", value: "Aries" },
            { label: "matching_pages", value: 2 },
          ],
        },
      ],
    });
    expect(duplicateGroups(siteLevel)).toBeNull();
  });
});

describe("copy", () => {
  it("summarises checks that observed nothing in both locales", () => {
    expect(zeroObservationSummary(["Canonical link not present"], "en")).toBe(
      "1 check observed nothing: Canonical link not present",
    );
    expect(zeroObservationSummary(["A", "B"], "en")).toBe(
      "2 checks observed nothing: A, B",
    );
    expect(zeroObservationSummary(["甲", "乙"], "zh")).toBe(
      "2 项检查未观察到对应情况：甲、乙",
    );
  });

  it("labels grouped page counts in both locales", () => {
    expect(pageCountLabel(1, "en")).toBe("1 page");
    expect(pageCountLabel(2, "en")).toBe("2 pages");
    expect(pageCountLabel(2, "zh")).toBe("2 个页面");
  });

  it("builds the closing copy from the actual counts", () => {
    const en = closingCopy({ pagesInspected: 12, issueTypeCount: 3 }, "en");
    expect(en.heading).toBe("We checked 12 pages and observed 3 issue types:");
    expect(en.boundary).toContain("only in your Search Console");
    // The CTA promises only what the funnel delivers: quick-wins shows real
    // rankings and traffic; nothing downstream ranks these audit findings.
    expect(en.cta).toBe(
      "Connect Search Console to see which pages actually rank and get traffic",
    );

    const single = closingCopy({ pagesInspected: 1, issueTypeCount: 1 }, "en");
    expect(single.heading).toBe("We checked 1 page and observed 1 issue type:");

    const zh = closingCopy({ pagesInspected: 12, issueTypeCount: 3 }, "zh");
    expect(zh.heading).toBe("我们检查了 12 个页面，观察到 3 类问题：");
    expect(zh.boundary).toContain("Search Console");
    expect(zh.cta).toBe("连接 Search Console，查看哪些页面真的有排名和流量");
  });

  it("notes the truncation only when more than three issue types exist", () => {
    const three = closingCopy({ pagesInspected: 12, issueTypeCount: 3 }, "en");
    expect(three.topNote).toBeNull();

    const five = closingCopy({ pagesInspected: 12, issueTypeCount: 5 }, "en");
    expect(five.topNote).toBe(
      "Top three by observed count — the full list of 5 is above.",
    );

    const zhFive = closingCopy({ pagesInspected: 12, issueTypeCount: 5 }, "zh");
    expect(zhFive.topNote).toBe("按观察数取前三，全部 5 类的完整清单见上文。");
  });

  it("does not claim unfixed issues when nothing was observed", () => {
    const en = closingCopy({ pagesInspected: 5, issueTypeCount: 0 }, "en");
    expect(en.heading).toBe(
      "We checked 5 pages and observed none of the issue conditions this audit tests for.",
    );
    expect(en.boundary).not.toContain("which to fix first");
    const zh = closingCopy({ pagesInspected: 5, issueTypeCount: 0 }, "zh");
    expect(zh.heading).toBe(
      "我们检查了 5 个页面，未观察到本工具检测的任何一类问题。",
    );
  });
});
