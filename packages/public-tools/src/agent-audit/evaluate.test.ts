import { describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "../seo-audit/types.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

function record(
  id: string,
  state: SeoAuditRecord["state"],
  affected = 0,
): SeoAuditRecord {
  return {
    id,
    category:
      id === "title_duplicate" || id === "meta_description_duplicate"
        ? "metadata"
        : "crawl",
    state,
    unit: "pages",
    population: "every_collected_page" as const,
    tested: 4,
    affected,
    observations:
      affected > 0 ? [{ url: "https://example.com", values: [] }] : [],
    limitation: null,
  };
}

/** A record whose affected count is a real share of a real tested population. */
function ratioRecord(
  id: string,
  tested: number,
  affected: number,
): SeoAuditRecord {
  return {
    id,
    category: "links",
    state:
      tested === 0 ? "unverified" : affected > 0 ? "observed" : "not_observed",
    unit: "pages",
    population: "every_collected_page" as const,
    tested,
    affected,
    observations: Array.from({ length: affected }, (_, index) => ({
      url: `https://example.com/page-${index}`,
      values: [],
    })),
    limitation: null,
  };
}

describe("v2 Agent audit evaluator", () => {
  it("compares a published average against the aggregate, not the affected count", () => {
    const aggregate = (id: string, label: string, value: number | null) => ({
      id,
      category: "crawl" as const,
      state: "observed" as const,
      unit: "pages" as const,
      population: "every_collected_page" as const,
      tested: 40,
      affected: 1,
      observations: [
        {
          url: null,
          values: value === null ? [] : [{ label, value }],
        },
      ],
      limitation: null,
    });
    const b3 = (value: number | null) =>
      evaluateAgentAuditScope("site", {
        availability: "available",
        records: [aggregate("average_response_time", "average_response_ms", value)],
      }).checks.find((entry) => entry.check.id === "B3");

    // Published threshold: below 500 ms, above 1 s is a Warning.
    expect(b3(320)?.result).toBe("pass");
    expect(b3(700)?.result).toBe("tip");
    expect(b3(1_400)?.result).toBe("warning");

    // An aggregate the detector never computed is a gap, not a pass: the whole
    // point of this engine state is that unmeasured never reads as within-limit.
    expect(b3(null)?.result).toBe("excluded");
    expect(b3(null)?.engine).toBe("needs-supplement");

    // The panel has to show the number the engine compared. Counting affected
    // observations would print "1 affected across 40 tested" for every average.
    expect(b3(320)?.measurement?.en).toContain("320 ms");
    expect(b3(320)?.measurement?.zh).toContain("320 毫秒");
    expect(b3(320)?.measurement?.en).not.toContain("affected");
  });

  it("reads site-wide Schema coverage as a share of the same JSON-LD record", () => {
    const check = (tested: number, affected: number) =>
      evaluateAgentAuditScope("site", {
        availability: "available",
        records: [ratioRecord("json_ld_missing", tested, affected)],
      }).checks.find((entry) => entry.check.id === "D5");

    // D5 publishes "at least 90% coverage", which is the same measurement as
    // the page-level "is there any JSON-LD" check read as a share, so it reuses
    // the record instead of the crawl paying for it twice.
    expect(check(10, 3)?.result).toBe("warning");
    expect(check(100, 5)?.result).toBe("pass");
    expect(check(10, 0)?.result).toBe("pass");
    // "At least 90%" includes exactly 90%. Expressed as the exclusive
    // "missing share below 10%", a site sitting precisely on its own published
    // mark failed it.
    expect(check(10, 1)?.result).toBe("pass");
    expect(check(100, 11)?.result).toBe("warning");
    // Coverage is a real measurement here, not a borrowed one.
    expect(check(10, 3)?.engine).toBe("ready");
    expect(check(10, 3)?.truth).toBe("observed");
  });

  it("keeps unavailable checks excluded instead of zero or pass", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "unavailable",
      records: [],
    });
    expect(result.checks).toHaveLength(50);
    expect(result.evaluated).toBe(0);
    expect(result.health).toBeNull();
    expect(result.checks.every((check) => check.result === "excluded")).toBe(
      true,
    );
  });

  it("counts page blockers separately and dims health in the view model", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/",
      records: [record("non_2xx_final_status", "observed", 1)],
    });
    expect(result.blockers).toBeGreaterThan(0);
    expect(
      result.checks.find((check) => check.check.id === "1.1")?.result,
    ).toBe("blocker");
  });

  it("does not turn a fetched robots resource into proof of robots allowance", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      records: [record("robots_resource", "observed", 1)],
    });
    const allowance = result.checks.find((check) => check.check.id === "1.2");

    expect(allowance?.result).toBe("excluded");
    expect(allowance?.truth).not.toBe("observed");
  });

  it("does not turn missing-field detectors into Title or description length measurements", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/",
      records: [
        record("title_missing", "not_observed"),
        record("meta_description_missing", "not_observed"),
      ],
    });

    expect(
      result.checks.find((check) => check.check.id === "2.1")?.result,
    ).toBe("excluded");
    expect(
      result.checks.find((check) => check.check.id === "2.4")?.result,
    ).toBe("excluded");
  });

  it("does not infer redirect destinations returning 404 from generic redirect or status records", () => {
    const result = evaluateAgentAuditScope("site", {
      availability: "available",
      records: [
        record("redirect_chain", "observed", 1),
        record("non_2xx_final_status", "observed", 1),
      ],
    });

    expect(result.checks.find((check) => check.check.id === "A6")?.result).toBe(
      "excluded",
    );
  });

  it("does not attribute an issue observed on another URL to the target page", () => {
    const otherPage = record("title_duplicate", "observed", 1);
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/target",
      records: [otherPage],
    });
    const uniqueness = result.checks.find((check) => check.check.id === "2.2");

    expect(uniqueness?.result).toBe("excluded");
    expect(uniqueness?.truth).toBe("partial");
    expect(uniqueness?.measurement).toBeNull();
  });

  it("keeps target-specific observations available to the matching page check", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com",
      records: [record("title_duplicate", "observed", 1)],
    });
    const uniqueness = result.checks.find((check) => check.check.id === "2.2");

    expect(uniqueness?.result).toBe("warning");
    expect(uniqueness?.evidenceRecordIds).toEqual(["title_duplicate"]);
  });

  it("keeps the D1 false-positive detector excluded until the P6 gate is fixed", () => {
    const result = evaluateAgentAuditScope("site", {
      availability: "available",
      records: [record("title_duplicate", "observed", 2)],
    });
    const duplicateTitles = result.checks.find(
      (check) => check.check.id === "D1",
    );

    expect(duplicateTitles?.result).toBe("excluded");
    expect(duplicateTitles?.evidenceRecordIds).toEqual([]);
  });

  it("passes a tested condition with no affected unit while keeping its bounded truth", () => {
    const result = evaluateAgentAuditScope("site", {
      availability: "available",
      records: [record("meta_description_duplicate", "not_observed")],
    });
    const duplicateDescriptions = result.checks.find(
      (check) => check.check.id === "D2",
    );

    expect(duplicateDescriptions?.result).toBe("pass");
    expect(duplicateDescriptions?.truth).toBe("not-observed");
    expect(duplicateDescriptions?.measurement?.en).toContain("0 affected");
    expect(duplicateDescriptions?.scoreValue).toBe(1);
    expect(result.health).toBe(100);
  });

  it("keeps a condition never tested out of Pass and Health", () => {
    const result = evaluateAgentAuditScope("site", {
      availability: "available",
      records: [record("meta_description_duplicate", "unverified")],
    });
    const duplicateDescriptions = result.checks.find(
      (check) => check.check.id === "D2",
    );

    expect(duplicateDescriptions?.result).toBe("excluded");
    expect(duplicateDescriptions?.scoreValue).toBeNull();
    expect(result.health).toBeNull();
  });

  it("still passes a tested clean condition under partial coverage, flagged partial", () => {
    const result = evaluateAgentAuditScope("site", {
      availability: "partial",
      records: [record("meta_description_duplicate", "not_observed")],
    });
    const duplicateDescriptions = result.checks.find(
      (check) => check.check.id === "D2",
    );

    expect(duplicateDescriptions?.result).toBe("pass");
    expect(duplicateDescriptions?.truth).toBe("partial");
  });
});

describe("v2 Agent audit page projection", () => {
  it("passes an inspected target page that appears in no issue list", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/target",
      targetInspected: true,
      records: [record("title_duplicate", "observed", 1)],
    });
    const uniqueness = result.checks.find((check) => check.check.id === "2.2");

    expect(uniqueness?.result).toBe("pass");
    expect(uniqueness?.truth).toBe("not-observed");
    expect(uniqueness?.measurement?.en).toContain("across 1 tested units");
  });

  it("keeps an uninspected target unverified instead of crediting it a pass", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/never-crawled",
      targetInspected: false,
      records: [record("title_duplicate", "observed", 1)],
    });

    expect(result.checks.find((check) => check.check.id === "2.2")?.result).toBe(
      "excluded",
    );
  });

  it("measures a page check against the page, not the whole crawl", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/target",
      targetInspected: true,
      records: [ratioRecord("h1_missing", 400, 0), ratioRecord("multiple_h1", 400, 0)],
    });
    const headings = result.checks.find((check) => check.check.id === "3.1");

    expect(headings?.result).toBe("pass");
    expect(headings?.measurement?.en).toBe(
      "0 affected observations across 1 tested units",
    );
  });
});

describe("v2 Agent audit target identity", () => {
  function noindexOn(url: string): SeoAuditRecord {
    return {
      id: "noindex_directive",
      category: "indexability",
      state: "observed",
      unit: "pages",
      population: "every_collected_page",
      tested: 4,
      affected: 1,
      observations: [{ url, values: [] }],
      limitation: null,
    };
  }

  it("attributes a problem to the target when the crawl normalised its URL", () => {
    // The visitor submitted /blog; the site serves /blog/ and the crawl
    // recorded that form. Matching on the submitted string alone reported a
    // noindexed page as a clean pass.
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/blog",
      targetInspected: true,
      inspectedTargetUrl: "https://example.com/blog/",
      records: [noindexOn("https://example.com/blog/")],
    });
    const indexability = result.checks.find((check) => check.check.id === "1.3");

    expect(indexability?.result).toBe("blocker");
    expect(indexability?.truth).toBe("observed");
  });

  it("still passes a normalised target that carries no problem", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/blog",
      targetInspected: true,
      inspectedTargetUrl: "https://example.com/blog/",
      records: [noindexOn("https://example.com/other/")],
    });

    expect(result.checks.find((check) => check.check.id === "1.3")?.result).toBe(
      "pass",
    );
  });

  it("never passes a check whose record only tested a qualifying subset", () => {
    // title_duplicate only tests self-canonical pages that have a title, so a
    // target's absence from it proves nothing about the target.
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/target",
      targetInspected: true,
      inspectedTargetUrl: "https://example.com/target",
      records: [
        {
          ...record("title_duplicate", "observed", 1),
          population: "conditional_subset",
        },
      ],
    });
    const uniqueness = result.checks.find((check) => check.check.id === "2.2");

    expect(uniqueness?.result).toBe("excluded");
    expect(uniqueness?.scoreValue).toBeNull();
  });
});

describe("v2 Agent audit unmeasurable rules", () => {
  function redirectRecord(values: readonly { label: string; value: unknown }[]) {
    return {
      id: "redirect_chain",
      category: "crawl" as const,
      state: "observed" as const,
      unit: "pages" as const,
      population: "every_collected_page" as const,
      tested: 10,
      affected: 1,
      observations: [
        {
          url: "https://example.com/",
          values: values as { label: string; value: never }[],
        },
      ],
      limitation: null,
    };
  }

  it.each([
    ["a missing label", [{ label: "hops", value: 2 }]],
    ["a non-numeric value", [{ label: "redirect_hops", value: "2" }]],
    ["a null value", [{ label: "redirect_hops", value: null }]],
  ])("does not pass a threshold it could not apply: %s", (_case, values) => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/",
      targetInspected: true,
      inspectedTargetUrl: "https://example.com/",
      records: [redirectRecord(values)],
    });
    const chain = result.checks.find((check) => check.check.id === "1.6");

    expect(chain?.result).toBe("excluded");
    expect(chain?.result).not.toBe("pass");
  });
});

describe("v2 Agent audit scoring monotonicity", () => {
  function siteHealth(records: readonly SeoAuditRecord[]): number | null {
    return evaluateAgentAuditScope("site", {
      availability: "available",
      records,
    }).health;
  }

  const cleanLedger: readonly SeoAuditRecord[] = [
    ratioRecord("sitemap_page_without_observed_inlink", 100, 0),
    ratioRecord("internal_target_http_error", 100, 0),
    ratioRecord("meta_description_duplicate", 172, 0),
    ratioRecord("title_missing", 100, 0),
    ratioRecord("h1_missing", 100, 0),
  ];

  it("scores a fully clean bounded crawl 100 instead of leaving it unscored", () => {
    expect(siteHealth(cleanLedger)).toBe(100);
  });

  it("never scores a site with more issues above the same site with fewer", () => {
    const oneBrokenLink = cleanLedger.map((entry) =>
      entry.id === "internal_target_http_error"
        ? ratioRecord("internal_target_http_error", 100, 1)
        : entry,
    );
    const brokenLinkAndDuplicates = oneBrokenLink.map((entry) =>
      entry.id === "meta_description_duplicate"
        ? ratioRecord("meta_description_duplicate", 172, 30)
        : entry,
    );

    const clean = siteHealth(cleanLedger) ?? -1;
    const one = siteHealth(oneBrokenLink) ?? -1;
    const two = siteHealth(brokenLinkAndDuplicates) ?? -1;

    expect(clean).toBeGreaterThan(one);
    expect(one).toBeGreaterThan(two);
  });
});

describe("v2 Agent audit published thresholds", () => {
  function siteCheck(id: string, records: readonly SeoAuditRecord[]) {
    return evaluateAgentAuditScope("site", {
      availability: "available",
      records,
    }).checks.find((check) => check.check.id === id);
  }

  it("passes an orphan rate below the published 5% threshold", () => {
    const check = siteCheck("C1", [
      ratioRecord("sitemap_page_without_observed_inlink", 100, 1),
    ]);

    expect(check?.result).toBe("pass");
  });

  it("warns only once the orphan rate passes the published 20% threshold", () => {
    expect(
      siteCheck("C1", [
        ratioRecord("sitemap_page_without_observed_inlink", 100, 30),
      ])?.result,
    ).toBe("warning");
    expect(
      siteCheck("C1", [
        ratioRecord("sitemap_page_without_observed_inlink", 100, 10),
      ])?.result,
    ).toBe("tip");
  });

  it("passes the live gengrowth.ai duplicate-description rate of 3.5%", () => {
    const check = siteCheck("D2", [
      ratioRecord("meta_description_duplicate", 172, 6),
    ]);

    expect(check?.result).toBe("pass");
  });

  it("keeps counting checks failing on a single affected unit", () => {
    expect(
      siteCheck("C2", [ratioRecord("internal_target_http_error", 100, 1)])
        ?.result,
    ).toBe("warning");
    expect(
      siteCheck("D3", [
        ratioRecord("title_missing", 100, 1),
        ratioRecord("h1_missing", 100, 0),
      ])?.result,
    ).toBe("warning");
  });

  it("accepts the published single redirect hop and warns on longer chains", () => {
    function redirectCheck(hops: number) {
      return evaluateAgentAuditScope("page", {
        availability: "available",
        targetUrl: "https://example.com/",
        records: [
          {
            id: "redirect_chain",
            category: "crawl",
            state: "observed",
            unit: "pages",
            population: "every_collected_page" as const,
            tested: 10,
            affected: 1,
            observations: [
              {
                url: "https://example.com/",
                values: [{ label: "redirect_hops", value: hops }],
              },
            ],
            limitation: null,
          },
        ],
      }).checks.find((check) => check.check.id === "1.6");
    }

    expect(redirectCheck(1)?.result).toBe("pass");
    expect(redirectCheck(2)?.result).toBe("warning");
  });

  it("still blocks 1.6 when the redirect destination is not 2xx", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/",
      records: [
        {
          id: "redirect_chain",
          category: "crawl",
          state: "observed",
          unit: "pages",
          population: "every_collected_page" as const,
          tested: 10,
          affected: 1,
          observations: [
            {
              url: "https://example.com/",
              values: [{ label: "redirect_hops", value: 1 }],
            },
          ],
          limitation: null,
        },
        record("non_2xx_final_status", "observed", 1),
      ],
    });

    expect(
      result.checks.find((check) => check.check.id === "1.6")?.result,
    ).toBe("blocker");
  });
});
