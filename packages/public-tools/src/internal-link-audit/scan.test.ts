import { describe, expect, it } from "vitest";
import type { InternalLinkAuditRaw } from "./scan.ts";
import { buildInternalLinkAuditPayload } from "./scan.ts";

function raw(
  availability: "available" | "partial" = "available",
): InternalLinkAuditRaw {
  return {
    origin: "https://acme.com",
    host: "acme.com",
    availability,
    stopReason: availability === "partial" ? "max_urls" : null,
    limitation: "bounded crawl",
    capturedAt: "2026-07-30T09:00:00.000Z",
    sourceWindow: {
      start: "2026-07-30T09:00:00.000Z",
      end: "2026-07-30T09:00:00.000Z",
    },
    providerUsage: {},
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: {
      fetched: true,
      urlCount: 2,
      subjectUrls: ["https://acme.com/", "https://acme.com/orphan"],
    },
    pages: [
      {
        subjectUrl: "https://acme.com/",
        depth: 0,
        projection: {
          fetchUrl: "https://acme.com/",
          status: 200,
          finalStatus: 200,
          redirectChain: [],
          canonicalTarget: null,
          robotsIndexable: true,
          robotsDirectives: [],
          title: "Home",
          metaDescription: null,
          h1: [],
          headings: [],
          wordCount: 10,
          internalOutlinks: [
            {
              targetSubjectUrl: "https://acme.com/about",
              rel: null,
              anchorText: "About",
            },
            {
              targetSubjectUrl: "https://acme.com/missing",
              rel: null,
              anchorText: "Old page",
            },
          ],
          jsonLd: { types: [], errorCount: 0 },
          sitemapMember: true,
          bodyExcerpt: null,
          paragraphs: [],
          responseMs: 1,
          contentType: "text/html",
        },
      },
      {
        subjectUrl: "https://acme.com/about",
        depth: 1,
        projection: {
          fetchUrl: "https://acme.com/about",
          status: 200,
          finalStatus: 200,
          redirectChain: [],
          canonicalTarget: null,
          robotsIndexable: true,
          robotsDirectives: [],
          title: "About",
          metaDescription: null,
          h1: [],
          headings: [],
          wordCount: 10,
          internalOutlinks: [],
          jsonLd: { types: [], errorCount: 0 },
          sitemapMember: false,
          bodyExcerpt: null,
          paragraphs: [],
          responseMs: 1,
          contentType: "text/html",
        },
      },
      {
        subjectUrl: "https://acme.com/orphan",
        depth: 1,
        projection: {
          fetchUrl: "https://acme.com/orphan",
          status: 200,
          finalStatus: 200,
          redirectChain: [],
          canonicalTarget: null,
          robotsIndexable: true,
          robotsDirectives: [],
          title: "Orphan",
          metaDescription: null,
          h1: [],
          headings: [],
          wordCount: 10,
          internalOutlinks: [],
          jsonLd: { types: [], errorCount: 0 },
          sitemapMember: true,
          bodyExcerpt: null,
          paragraphs: [],
          responseMs: 1,
          contentType: "text/html",
        },
      },
    ],
  } as InternalLinkAuditRaw;
}

describe("buildInternalLinkAuditPayload", () => {
  it("derives bounded graph facts and does not call an uncollected target broken", () => {
    const payload = buildInternalLinkAuditPayload(raw());
    expect(payload.run.persistence).toBe("none");
    expect(payload.run.schemaVersion).toBe("internal_link_audit.v2");
    expect(payload.result).not.toHaveProperty("maxPages");
    expect(payload.result.nodes).toHaveLength(3);
    expect(payload.result.edges).toEqual([
      { from: "page-01", to: "page-02", anchorText: "About" },
    ]);
    expect(
      payload.result.findings.some(
        (finding) => finding.kind === "orphan_candidate",
      ),
    ).toBe(true);
    expect(
      payload.result.findings.some(
        (finding) => finding.kind === "unresolved_target",
      ),
    ).toBe(true);
    expect(
      payload.result.findings.map((finding) => finding.title).join(" "),
    ).not.toContain("broken");
  });

  /**
   * This replaces a test that asserted the *limitation* string changed when
   * coverage was partial. That was the defect, not the fix: the finding kept
   * priority P1 and the assertive title "is a sitemap-only orphan candidate",
   * and the UI only shows `limitation` after the card is opened. A reader
   * scanning the list saw a confident P1 orphan claim that the run could not
   * support.
   *
   * The crawler stops at roughly 950 pages on every site (240s at the 250ms
   * host pacer), so on any larger site this is the default path, not an edge
   * case.
   */
  describe("when the crawl was truncated", () => {
    it("does not assert an orphan it could not have observed", () => {
      const payload = buildInternalLinkAuditPayload(raw("partial"));
      expect(
        payload.result.findings.some(
          (finding) => finding.kind === "orphan_candidate",
        ),
      ).toBe(false);
    });

    it("reports the question instead, at a lower priority", () => {
      const payload = buildInternalLinkAuditPayload(raw("partial"));
      const finding = payload.result.findings.find(
        (candidate) => candidate.kind === "orphan_undetermined",
      );
      expect(finding).toBeDefined();
      expect(finding?.priority).toBe("P2");
      // The always-visible fields must carry the uncertainty, not just the
      // collapsed limitation panel.
      expect(finding?.title).toContain("could not be checked");
      expect(finding?.detail).toContain("not evidence of an orphan");
      expect(finding?.evidence).toContain("max_urls");
    });

    it("paints the graph node as unchecked rather than as an orphan", () => {
      const payload = buildInternalLinkAuditPayload(raw("partial"));
      const node = payload.result.nodes.find(
        (candidate) => candidate.url === "https://acme.com/orphan",
      );
      expect(node?.kind).toBe("orphan_undetermined");
    });
  });

  it("still asserts an orphan when coverage was complete", () => {
    const payload = buildInternalLinkAuditPayload(raw("available"));
    const finding = payload.result.findings.find(
      (candidate) => candidate.kind === "orphan_candidate",
    );
    expect(finding?.priority).toBe("P1");
    expect(
      payload.result.nodes.find(
        (candidate) => candidate.url === "https://acme.com/orphan",
      )?.kind,
    ).toBe("orphan_candidate");
  });
});
