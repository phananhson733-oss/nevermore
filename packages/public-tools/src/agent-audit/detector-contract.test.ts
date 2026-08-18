import { describe, expect, it } from "vitest";
import type { CrawlPageRecord } from "@sf/sources";
import { buildSeoAuditReport } from "../seo-audit/model.ts";
import type { SeoAuditRaw } from "../seo-audit/scan.ts";
import { PAGE_AUDIT_GROUPS, SITE_AUDIT_GROUPS } from "./catalog.ts";

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
    pages: [page("https://acme.test/", 0), page("https://acme.test/about")],
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

    const missing = checks.flatMap((check) =>
      check.evidenceRecordIds
        .filter((id) => !emitted.has(id))
        .map((id) => `${check.id} reads ${id}`),
    );
    expect(missing).toEqual([]);
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
