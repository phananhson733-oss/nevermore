import { describe, expect, it } from "vitest";
import type { CrawlPageRecord } from "@sf/sources";
import { buildSeoAuditReport } from "../seo-audit/model.ts";
import type { SeoAuditRaw } from "../seo-audit/scan.ts";
import { PAGE_AUDIT_GROUPS, SITE_AUDIT_GROUPS } from "./catalog.ts";
import {
  SEO_AUDIT_EVIDENCE_LABELS,
  SEO_AUDIT_LIMITATION_CODES,
  SEO_AUDIT_RECORD_IDS,
} from "../seo-audit/record-ledger.ts";
import { SEARCH_PERFORMANCE_RECORD_IDS } from "../seo-audit/search-performance.ts";
import { KEYWORD_EVIDENCE_RECORD_IDS } from "../seo-audit/keyword-evidence/records.ts";
import { PAGE_PERFORMANCE_RECORD_IDS } from "../seo-audit/page-performance.ts";

function page(url: string, depth = 1): CrawlPageRecord {
  return {
    subjectUrl: url,
    depth,
    projection: {
      fetchUrl: url,
      status: 200,
      finalStatus: 200,
      redirectChain: [],
      canonicalTarget: url,
      robotsIndexable: true,
      robotsDirectives: [],
      title: `Title for ${url}`,
      metaDescription: `Description for ${url}`,
      h1: ["Heading"],
      headings: ["Heading"],
      wordCount: 320,
      internalOutlinks: [],
      jsonLd: { types: ["WebPage"], errorCount: 0 },
      sitemapMember: true,
      bodyExcerpt: "Body",
      paragraphs: ["Body"],
      responseMs: 42,
      contentType: "text/html; charset=utf-8",
    },
  };
}

function raw(): SeoAuditRaw {
  return {
    origin: "https://acme.test",
    host: "acme.test",
    // Varied on purpose: a clean page alone leaves most records with no
    // observation, and it is the observation values this file has to see.
    pages: [
      page("https://acme.test/", 0),
      page("https://acme.test/about"),
      {
        ...page("https://acme.test/gone"),
        projection: {
          ...page("https://acme.test/gone").projection,
          finalStatus: 404,
        },
      },
      {
        ...page("https://acme.test/down"),
        projection: {
          ...page("https://acme.test/down").projection,
          finalStatus: 503,
        },
      },
      {
        ...page("https://acme.test/old"),
        projection: {
          ...page("https://acme.test/old").projection,
          redirectChain: ["https://acme.test/gone"],
          finalStatus: 404,
        },
      },
      {
        ...page("http://acme.test/insecure"),
        projection: {
          ...page("http://acme.test/insecure").projection,
          fetchUrl: "http://acme.test/insecure",
          robotsIndexable: false,
          title: null,
          metaDescription: null,
          h1: [],
          jsonLd: { types: [], errorCount: 1 },
          sitemapMember: false,
          canonicalTarget: "https://acme.test/",
        },
      },
    ],
    robots: {
      fetched: true,
      groups: [{ userAgent: "*", disallow: [], allow: ["/"] }],
      sitemaps: ["https://acme.test/sitemap.xml"],
    },
    sitemap: {
      fetched: true,
      urlCount: 2,
      subjectUrls: ["https://acme.test/", "https://acme.test/about"],
    },
    availability: "available",
    capturedAt: "2026-08-18T09:00:00.000Z",
    sourceWindow: {
      start: "2026-08-18T09:00:00.000Z",
      end: "2026-08-18T09:00:00.000Z",
    },
    stopReason: null,
    providerUsage: {
      urlsSkipped: 0,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 0,
    },
    limitation: "Fixture crawl.",
    requestedUrl: "https://acme.test/",
  };
}

describe("catalog / detector contract", () => {
  /**
   * The failure this exists for.
   *
   * `inventoryReady` is derived from the evidence map, so asserting the two
   * agree proves nothing — both come from the same table. What the panel
   * actually promises is that a ready check can return a verdict, and that is
   * only true if something emits the record it reads. A typo, a rename, or a
   * detector deleted from the model leaves the catalog claiming coverage that
   * no run can produce, which is the exact defect that let 47 checks advertise
   * readiness against 24 real detectors.
   */
  it("emits every evidence record the catalog says it reads", () => {
    const emitted = new Set(
      buildSeoAuditReport(raw()).records.map((record) => record.id),
    );
    const checks = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap(
      (group) => group.checks,
    );

    // These read records the Agent layer derives per visitor, so a crawl report
    // does not emit them and must not: their category is refused by the payload
    // guard precisely so one visitor's property cannot land in a shared cache
    // row. Taken from their own producer rather than re-listed here — a
    // hand-written copy of this set is what would quietly exempt the next
    // per-visitor record from the check that exists to catch it.
    const perVisitor = new Set([
      ...SEARCH_PERFORMANCE_RECORD_IDS,
      ...KEYWORD_EVIDENCE_RECORD_IDS,
      ...PAGE_PERFORMANCE_RECORD_IDS,
    ]);
    const missing = checks.flatMap((check) =>
      check.evidenceRecordIds
        .filter((id) => !emitted.has(id) && !perVisitor.has(id))
        .map((id) => `${check.id} reads ${id}`),
    );
    expect(missing).toEqual([]);
  });

  it("emits exactly the record ledger every consumer pins", () => {
    // The Agent layer validates an upstream payload against a hand-written list
    // of record ids and refuses a payload whose ledger differs at all. Its own
    // tests build fixtures from that list, so nothing there ever runs the real
    // producer past it: five detectors landed and the Agent audit answered 502
    // with every unit test green. Printing the difference both ways is what
    // makes this catch a record added on either side.
    const emitted = buildSeoAuditReport(raw())
      .records.map((record) => record.id)
      .sort();
    expect(new Set(emitted).size).toBe(emitted.length);
    expect(emitted).toEqual(SEO_AUDIT_RECORD_IDS.slice().sort());
  });

  it("publishes no observation label the ledger does not declare", () => {
    // The UI fails closed on a label it cannot name, which blanks the results
    // panel rather than showing an odd row. Declaring the labels lets that
    // check live in the UI package without either side importing the other's
    // internals — this half proves the declaration matches what actually runs.
    const declared = new Set(SEO_AUDIT_EVIDENCE_LABELS);
    const published = new Set(
      buildSeoAuditReport(raw()).records.flatMap((record) =>
        record.observations.flatMap((observation) =>
          observation.values.map((entry) => entry.label),
        ),
      ),
    );
    expect([...published].filter((label) => !declared.has(label))).toEqual([]);
    expect(published.size).toBeGreaterThan(10);
  });

  it("publishes no limitation code the ledger does not declare", () => {
    // The third fail-closed list, and the one that actually took the panel
    // dark: the display seam refuses a record whose limitation it cannot name,
    // and it refuses by rendering nothing at all. `average_response_time`
    // publishes its code on every run, so one unlisted string blanked every
    // audit while every unit test stayed green.
    const declared = new Set(SEO_AUDIT_LIMITATION_CODES);
    const published = new Set(
      buildSeoAuditReport(raw())
        .records.map((record) => record.limitation)
        .filter((code): code is string => code !== null),
    );
    expect([...published].filter((code) => !declared.has(code))).toEqual([]);
    expect(published.size).toBeGreaterThan(3);
  });

  it("keeps the catalog the only consumer contract for a ready check", () => {
    const checks = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap(
      (group) => group.checks,
    );
    // The other direction is deliberately not asserted: the model may emit
    // records no check reads yet — a detector can land before the check that
    // consumes it. Only the reverse is a broken promise to the visitor.
    for (const check of checks) {
      if (!check.inventoryReady) continue;
      expect(check.evidenceRecordIds.length).toBeGreaterThan(0);
    }
  });
});
