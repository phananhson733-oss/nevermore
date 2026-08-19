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
      declaredUrls: ["https://acme.com/", "https://acme.com/orphan"],
      complete: true,
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

function crawlPage(
  path: string,
  crawlDepth: number,
  outlinks: readonly string[] = [],
  options: {
    readonly sitemapMember?: boolean;
    readonly robotsIndexable?: boolean;
    readonly canonicalTarget?: string | null;
    readonly contentSignature?: string;
  } = {},
): InternalLinkAuditRaw["pages"][number] {
  const subjectUrl = `https://acme.com${path}`;
  return {
    subjectUrl,
    depth: crawlDepth,
    projection: {
      fetchUrl: subjectUrl,
      status: 200,
      finalStatus: 200,
      redirectChain: [],
      canonicalTarget: options.canonicalTarget ?? null,
      robotsIndexable: options.robotsIndexable ?? true,
      robotsDirectives: options.robotsIndexable === false ? ["noindex"] : [],
      title: options.contentSignature
        ? "Shared listing title"
        : path === "/"
          ? "Home"
          : path,
      metaDescription: null,
      h1: [],
      headings: [],
      wordCount: options.contentSignature ? 120 : 10,
      internalOutlinks: outlinks.map((targetSubjectUrl) => ({
        targetSubjectUrl,
        rel: null,
        anchorText: null,
      })),
      jsonLd: { types: [], errorCount: 0 },
      sitemapMember: options.sitemapMember ?? path === "/",
      bodyExcerpt: options.contentSignature ?? null,
      paragraphs: options.contentSignature
        ? [options.contentSignature, "Shared projected paragraph"]
        : [],
      responseMs: 1,
      contentType: "text/html",
    },
  };
}

describe("buildInternalLinkAuditPayload", () => {
  it("derives bounded graph facts and does not call an uncollected target broken", () => {
    const payload = buildInternalLinkAuditPayload(raw());
    expect(payload.run.persistence).toBe("none");
    expect(payload.run.schemaVersion).toBe("internal_link_audit.v3");
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
    expect(payload.result.clickDepthDistribution).toEqual({
      oneClick: 1,
      twoClicks: 0,
      threeClicks: 0,
      fourPlusClicks: 0,
      unreachable: 1,
    });
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

  it("computes homepage click depth from the full link graph instead of sitemap crawl depth", () => {
    const base = raw();
    const home = "https://acme.com/";
    const a = "https://acme.com/a";
    const b = "https://acme.com/b";
    const c = "https://acme.com/c";
    const deep = "https://acme.com/deep";
    const island = "https://acme.com/island";
    const islandChild = "https://acme.com/island-child";
    const payload = buildInternalLinkAuditPayload({
      ...base,
      pages: [
        crawlPage("/", 0, [a]),
        crawlPage("/a", 1, [b]),
        // Sitemap discovery made the crawl depth shallow, but it must not
        // shorten the observed homepage link path.
        crawlPage("/b", 1, [c], { sitemapMember: true }),
        crawlPage("/c", 1, [deep], { sitemapMember: true }),
        crawlPage("/deep", 1, [], { sitemapMember: true }),
        crawlPage("/island", 1, [islandChild], { sitemapMember: true }),
        crawlPage("/island-child", 1, [], { sitemapMember: true }),
      ],
      sitemap: {
        ...base.sitemap,
        urlCount: 5,
        subjectUrls: [home, b, c, deep, island],
        declaredUrls: [home, b, c, deep, island],
        complete: true,
      },
    });

    const nodeByUrl = new Map(
      payload.result.nodes.map((node) => [node.url, node]),
    );
    expect(nodeByUrl.get(deep)).toMatchObject({
      crawlDepth: 1,
      clickDepth: 4,
      kind: "deep",
    });
    expect(nodeByUrl.get(island)).toMatchObject({
      clickDepth: null,
      kind: "orphan_candidate",
    });
    expect(nodeByUrl.get(islandChild)).toMatchObject({
      clickDepth: null,
      kind: "unreachable",
    });
    expect(payload.result.clickDepthDistribution).toEqual({
      oneClick: 1,
      twoClicks: 1,
      threeClicks: 1,
      fourPlusClicks: 1,
      unreachable: 2,
    });
    expect(
      payload.result.findings.find((finding) => finding.kind === "deep_page"),
    ).toMatchObject({ priority: "P1", affectedUrls: [deep] });
    expect(
      payload.result.findings.find(
        (finding) => finding.kind === "unreachable_page",
      ),
    ).toMatchObject({ affectedUrls: [islandChild] });
  });

  it("projects indexability facts and excludes noindex or canonicalized pages from actions", () => {
    const base = raw();
    const noindex = "https://acme.com/noindex";
    const duplicate = "https://acme.com/duplicate";
    const payload = buildInternalLinkAuditPayload({
      ...base,
      pages: [
        crawlPage("/", 0),
        crawlPage("/noindex", 1, [], {
          sitemapMember: true,
          robotsIndexable: false,
        }),
        crawlPage("/duplicate", 1, [], {
          sitemapMember: true,
          canonicalTarget: "https://acme.com/canonical",
        }),
      ],
    });

    expect(payload.result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: noindex, robotsIndexable: false }),
        expect.objectContaining({
          url: duplicate,
          canonicalTarget: "https://acme.com/canonical",
        }),
      ]),
    );
    expect(payload.result.actionablePages).toBe(0);
    expect(payload.result.findings).toHaveLength(0);
  });

  it("groups exact projected-content duplicates into one actionable finding", () => {
    const base = raw();
    const first = "https://acme.com/blog?page=4";
    const second = "https://acme.com/blog?category=methodology&page=4";
    const payload = buildInternalLinkAuditPayload({
      ...base,
      pages: [
        crawlPage("/", 0, [first, second]),
        crawlPage("/blog?page=4", 1, [], {
          contentSignature: "The same twelve article cards",
        }),
        crawlPage("/blog?category=methodology&page=4", 1, [], {
          contentSignature: "The same twelve article cards",
        }),
      ],
    });

    expect(
      payload.result.findings.filter(
        (finding) => finding.kind === "duplicate_content",
      ),
    ).toEqual([
      expect.objectContaining({
        priority: "P1",
        confidence: "high",
        affectedUrls: [first, second],
      }),
    ]);
    expect(payload.result.actionablePages).toBe(2);
  });
});
