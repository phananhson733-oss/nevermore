import { describe, expect, it } from "vitest";
import type { InternalLinkAuditRaw } from "./scan.ts";
import { buildInternalLinkAuditPayload } from "./scan.ts";

function raw(availability: "available" | "partial" = "available"): InternalLinkAuditRaw {
  return {
    origin: "https://acme.com",
    host: "acme.com",
    availability,
    stopReason: availability === "partial" ? "max_urls" : null,
    limitation: "bounded crawl",
    capturedAt: "2026-07-30T09:00:00.000Z",
    sourceWindow: { start: "2026-07-30T09:00:00.000Z", end: "2026-07-30T09:00:00.000Z" },
    providerUsage: {},
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: { fetched: true, urlCount: 2, subjectUrls: ["https://acme.com/", "https://acme.com/orphan"] },
    pages: [
      { subjectUrl: "https://acme.com/", depth: 0, projection: { fetchUrl: "https://acme.com/", status: 200, finalStatus: 200, redirectChain: [], canonicalTarget: null, robotsIndexable: true, robotsDirectives: [], title: "Home", metaDescription: null, h1: [], headings: [], wordCount: 10, internalOutlinks: [{ targetSubjectUrl: "https://acme.com/about", rel: null, anchorText: "About" }, { targetSubjectUrl: "https://acme.com/missing", rel: null, anchorText: "Old page" }], jsonLd: { types: [], errorCount: 0 }, sitemapMember: true, bodyExcerpt: null, paragraphs: [], responseMs: 1, contentType: "text/html" } },
      { subjectUrl: "https://acme.com/about", depth: 1, projection: { fetchUrl: "https://acme.com/about", status: 200, finalStatus: 200, redirectChain: [], canonicalTarget: null, robotsIndexable: true, robotsDirectives: [], title: "About", metaDescription: null, h1: [], headings: [], wordCount: 10, internalOutlinks: [], jsonLd: { types: [], errorCount: 0 }, sitemapMember: false, bodyExcerpt: null, paragraphs: [], responseMs: 1, contentType: "text/html" } },
      { subjectUrl: "https://acme.com/orphan", depth: 1, projection: { fetchUrl: "https://acme.com/orphan", status: 200, finalStatus: 200, redirectChain: [], canonicalTarget: null, robotsIndexable: true, robotsDirectives: [], title: "Orphan", metaDescription: null, h1: [], headings: [], wordCount: 10, internalOutlinks: [], jsonLd: { types: [], errorCount: 0 }, sitemapMember: true, bodyExcerpt: null, paragraphs: [], responseMs: 1, contentType: "text/html" } },
    ],
  } as InternalLinkAuditRaw;
}

describe("buildInternalLinkAuditPayload", () => {
  it("derives bounded graph facts and does not call an uncollected target broken", () => {
    const payload = buildInternalLinkAuditPayload(raw());
    expect(payload.run.persistence).toBe("none");
    expect(payload.result.nodes).toHaveLength(3);
    expect(payload.result.edges).toEqual([{ from: "page-01", to: "page-02", anchorText: "About" }]);
    expect(payload.result.findings.some((finding) => finding.kind === "orphan_candidate")).toBe(true);
    expect(payload.result.findings.some((finding) => finding.kind === "unresolved_target")).toBe(true);
    expect(payload.result.findings.map((finding) => finding.title).join(" ")).not.toContain("broken");
  });

  it("carries a partial-coverage limitation into orphan candidate findings", () => {
    const payload = buildInternalLinkAuditPayload(raw("partial"));
    const orphan = payload.result.findings.find((finding) => finding.kind === "orphan_candidate");
    expect(orphan?.limitation).toContain("candidate rather than a definitive orphan");
  });
});
