import { subjectUrlOf } from "@sf/sources/canonical-url";
import {
  PUBLIC_PREVIEW_CRAWL_BUDGET,
  PUBLIC_PREVIEW_MAX_REQUESTS,
  type CrawlRaw,
} from "@sf/sources/crawl-public-preview";
import { createPublicToolResult } from "../contract.ts";
import type {
  SeoAuditCategory,
  SeoAuditEvidenceValueEntry,
  SeoAuditObservation,
  SeoAuditPage,
  SeoAuditPayload,
  SeoAuditRecord,
  SeoAuditRecordState,
  SeoAuditRecordUnit,
  SeoAuditReport,
} from "./types.ts";
import type { SeoAuditRaw } from "./scan.ts";

const MAX_OBSERVATIONS_PER_RECORD = PUBLIC_PREVIEW_CRAWL_BUDGET.maxUrls;

function usage(raw: CrawlRaw, key: string): number {
  const value = raw.providerUsage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isHtml(contentType: string | null): boolean {
  return (
    contentType === null ||
    /^\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)
  );
}

function finalUrl(page: CrawlRaw["pages"][number]): string {
  return page.projection.redirectChain.at(-1) ?? page.projection.fetchUrl;
}

function normalizeComparableText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function values(
  entries: Readonly<Record<string, string | number | boolean | null>>,
): readonly SeoAuditEvidenceValueEntry[] {
  return Object.entries(entries).map(([label, value]) => ({ label, value }));
}

interface RecordInput {
  readonly id: string;
  readonly category: SeoAuditCategory;
  readonly unit?: SeoAuditRecordUnit;
  readonly tested: number;
  readonly observations: readonly SeoAuditObservation[];
  readonly limitation?: string | null;
  readonly state?: SeoAuditRecordState;
}

function record(input: RecordInput): SeoAuditRecord {
  const observations = input.observations.slice(0, MAX_OBSERVATIONS_PER_RECORD);
  return {
    id: input.id,
    category: input.category,
    state:
      input.state ??
      (input.tested === 0
        ? "unverified"
        : observations.length > 0
          ? "observed"
          : "not_observed"),
    unit: input.unit ?? "pages",
    tested: input.tested,
    affected: observations.length,
    observations,
    limitation: input.limitation ?? null,
  };
}

function pageObservation(
  page: SeoAuditPage,
  evidence: Readonly<Record<string, string | number | boolean | null>>,
): SeoAuditObservation {
  return { url: page.url, values: values(evidence) };
}

function duplicateObservations(
  pages: readonly SeoAuditPage[],
  select: (page: SeoAuditPage) => string | null,
  label: string,
): readonly SeoAuditObservation[] {
  const groups = new Map<string, SeoAuditPage[]>();
  for (const page of pages) {
    const selected = select(page);
    if (!selected) continue;
    const key = normalizeComparableText(selected);
    const group = groups.get(key) ?? [];
    group.push(page);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) =>
      group.map((page) =>
        pageObservation(page, {
          [label]: select(page),
          matching_pages: group.length,
        }),
      ),
    );
}

function buildPages(raw: CrawlRaw): readonly SeoAuditPage[] {
  const inbound = new Map<string, number>();
  for (const source of raw.pages) {
    for (const link of source.projection.internalOutlinks) {
      inbound.set(
        link.targetSubjectUrl,
        (inbound.get(link.targetSubjectUrl) ?? 0) + 1,
      );
    }
  }

  return raw.pages.map((page) => {
    const status = page.projection.finalStatus;
    const staticHtmlWasInspected =
      status !== null &&
      status >= 200 &&
      status < 300 &&
      isHtml(page.projection.contentType);

    return {
      url: page.projection.fetchUrl,
      subjectUrl: page.subjectUrl,
      finalUrl: finalUrl(page),
      depth: page.depth,
      initialStatus: page.projection.status,
      finalStatus: status,
      redirectHops: page.projection.redirectChain.length,
      contentType: page.projection.contentType,
      robotsDirectiveState: staticHtmlWasInspected
        ? page.projection.robotsIndexable
          ? "noindex_not_observed"
          : "noindex_observed"
        : null,
      canonicalTarget: page.projection.canonicalTarget,
      title: page.projection.title,
      metaDescription: page.projection.metaDescription,
      h1Count: page.projection.h1.length,
      headingsCount: page.projection.headings.length,
      wordCount: page.projection.wordCount,
      inboundLinks: inbound.get(page.subjectUrl) ?? 0,
      outboundLinks: page.projection.internalOutlinks.length,
      sitemapMember: page.projection.sitemapMember,
      jsonLdTypes: page.projection.jsonLd.types,
      jsonLdErrorCount: page.projection.jsonLd.errorCount,
    };
  });
}

function buildRecords(
  raw: SeoAuditRaw,
  pages: readonly SeoAuditPage[],
): readonly SeoAuditRecord[] {
  const htmlPages = pages.filter(
    (page) =>
      page.finalStatus !== null &&
      page.finalStatus >= 200 &&
      page.finalStatus < 300 &&
      isHtml(page.contentType),
  );
  const collectedBySubject = new Map(
    pages.map((page) => [page.subjectUrl, page] as const),
  );
  const linkTargetErrors = new Map<
    string,
    { readonly page: SeoAuditPage; readonly sources: Set<string> }
  >();

  for (const source of raw.pages) {
    for (const link of source.projection.internalOutlinks) {
      const target = collectedBySubject.get(link.targetSubjectUrl);
      if (
        !target ||
        target.finalStatus === null ||
        target.finalStatus < 400 ||
        target.finalStatus >= 600
      ) {
        continue;
      }
      const current = linkTargetErrors.get(target.subjectUrl) ?? {
        page: target,
        sources: new Set<string>(),
      };
      current.sources.add(source.projection.fetchUrl);
      linkTargetErrors.set(target.subjectUrl, current);
    }
  }

  const records: SeoAuditRecord[] = [
    record({
      id: "robots_resource",
      category: "crawl",
      unit: "site_resource",
      tested: raw.robots.fetched ? 1 : 0,
      state: raw.robots.fetched ? "observed" : "unverified",
      observations: raw.robots.fetched
        ? [
            {
              url: `${raw.origin}/robots.txt`,
              values: values({
                fetched: true,
                groups_observed: raw.robots.groups.length,
                sitemap_references: raw.robots.sitemaps.length,
              }),
            },
          ]
        : [],
      limitation: raw.robots.fetched
        ? null
        : "resource_not_observed_does_not_prove_absence",
    }),
    record({
      id: "sitemap_resource",
      category: "crawl",
      unit: "site_resource",
      tested: raw.sitemap.fetched ? 1 : 0,
      state: raw.sitemap.fetched ? "observed" : "unverified",
      observations: raw.sitemap.fetched
        ? [
            {
              url: null,
              values: values({
                fetched: true,
                urls_observed: raw.sitemap.urlCount,
              }),
            },
          ]
        : [],
      limitation: raw.sitemap.fetched
        ? null
        : "resource_not_observed_does_not_prove_absence",
    }),
    record({
      id: "non_2xx_final_status",
      category: "crawl",
      tested: pages.filter((page) => page.finalStatus !== null).length,
      observations: pages
        .filter(
          (page) =>
            page.finalStatus !== null &&
            (page.finalStatus < 200 || page.finalStatus >= 300),
        )
        .map((page) =>
          pageObservation(page, {
            initial_status: page.initialStatus,
            final_status: page.finalStatus,
          }),
        ),
    }),
    record({
      id: "redirect_chain",
      category: "crawl",
      tested: pages.length,
      observations: pages
        .filter((page) => page.redirectHops > 0)
        .map((page) =>
          pageObservation(page, {
            redirect_hops: page.redirectHops,
            final_url: page.finalUrl,
          }),
        ),
    }),
    record({
      id: "http_url",
      category: "crawl",
      tested: pages.length,
      observations: pages
        .filter((page) => new URL(page.finalUrl).protocol !== "https:")
        .map((page) =>
          pageObservation(page, {
            final_protocol: new URL(page.finalUrl).protocol,
          }),
        ),
    }),
    record({
      id: "noindex_directive",
      category: "indexability",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.robotsDirectiveState === "noindex_observed")
        .map((page) =>
          pageObservation(page, { robots_directive: "noindex" }),
        ),
      limitation: "static_response_directives_only",
    }),
    record({
      id: "canonical_missing",
      category: "indexability",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.canonicalTarget === null)
        .map((page) =>
          pageObservation(page, { canonical_target: null }),
        ),
    }),
    record({
      id: "canonical_differs",
      category: "indexability",
      tested: htmlPages.filter((page) => page.canonicalTarget !== null).length,
      observations: htmlPages
        .filter(
          (page) =>
            page.canonicalTarget !== null &&
            subjectUrlOf(page.canonicalTarget) !== page.subjectUrl,
        )
        .map((page) =>
          pageObservation(page, {
            page_subject: page.subjectUrl,
            canonical_target: page.canonicalTarget,
          }),
        ),
    }),
    record({
      id: "title_missing",
      category: "metadata",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.title === null)
        .map((page) =>
          pageObservation(page, { title: null }),
        ),
    }),
    record({
      id: "title_duplicate",
      category: "metadata",
      tested: htmlPages.filter((page) => page.title !== null).length,
      observations: duplicateObservations(
        htmlPages,
        (page) => page.title,
        "title",
      ),
      limitation: "normalised_text_match_within_inspected_pages",
    }),
    record({
      id: "meta_description_missing",
      category: "metadata",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.metaDescription === null)
        .map((page) =>
          pageObservation(page, { meta_description: null }),
        ),
    }),
    record({
      id: "meta_description_duplicate",
      category: "metadata",
      tested: htmlPages.filter((page) => page.metaDescription !== null).length,
      observations: duplicateObservations(
        htmlPages,
        (page) => page.metaDescription,
        "meta_description",
      ),
      limitation: "normalised_text_match_within_inspected_pages",
    }),
    record({
      id: "h1_missing",
      category: "structure",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.h1Count === 0)
        .map((page) =>
          pageObservation(page, { h1_count: 0 }),
        ),
    }),
    record({
      id: "multiple_h1",
      category: "structure",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.h1Count > 1)
        .map((page) =>
          pageObservation(page, { h1_count: page.h1Count }),
        ),
    }),
    record({
      id: "sitemap_page_without_observed_inlink",
      category: "links",
      tested: pages.filter((page) => page.sitemapMember).length,
      observations: pages
        .filter(
          (page) =>
            page.sitemapMember &&
            page.inboundLinks === 0 &&
            page.subjectUrl !== subjectUrlOf(`${raw.origin}/`),
        )
        .map((page) =>
          pageObservation(page, {
            sitemap_member: true,
            observed_inbound_links: 0,
          }),
        ),
      limitation: "bounded_static_html_crawl_inlinks_only",
    }),
    record({
      id: "internal_target_http_error",
      category: "links",
      unit: "link_targets",
      tested: new Set(
        raw.pages.flatMap((page) =>
          page.projection.internalOutlinks
            .filter((link) => collectedBySubject.has(link.targetSubjectUrl))
            .map((link) => link.targetSubjectUrl),
        ),
      ).size,
      observations: [...linkTargetErrors.values()].map(({ page, sources }) =>
        pageObservation(page, {
          final_status: page.finalStatus,
          observed_source_pages: sources.size,
        }),
      ),
      limitation: "uncollected_link_targets_not_classified",
    }),
    record({
      id: "json_ld_parse_error",
      category: "structured_data",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.jsonLdErrorCount > 0)
        .map((page) =>
          pageObservation(page, {
            malformed_blocks: page.jsonLdErrorCount,
            types_observed: page.jsonLdTypes.join(", ") || null,
          }),
        ),
      limitation: "static_html_json_ld_only",
    }),
  ];

  return records;
}

export function buildSeoAuditReport(raw: SeoAuditRaw): SeoAuditReport {
  const pages = buildPages(raw);
  return {
    targetUrl: raw.requestedUrl,
    scannedAt: raw.capturedAt,
    coverage: {
      availability: raw.availability,
      pagesInspected: pages.length,
      maxPages: PUBLIC_PREVIEW_CRAWL_BUDGET.maxUrls,
      maxDepth: PUBLIC_PREVIEW_CRAWL_BUDGET.maxDepth,
      maxRequests: PUBLIC_PREVIEW_MAX_REQUESTS,
      linksObserved: pages.reduce(
        (total, page) => total + page.outboundLinks,
        0,
      ),
      sitemapUrlsObserved: raw.sitemap.urlCount,
      urlsSkipped: usage(raw, "urlsSkipped"),
      urlsBlocked: usage(raw, "urlsBlocked"),
      urlsDisallowed: usage(raw, "urlsDisallowed"),
      urlsErrored: usage(raw, "urlsErrored"),
      stopReason: raw.stopReason,
    },
    siteResources: {
      robotsFetched: raw.robots.fetched,
      robotsGroupsObserved: raw.robots.groups.length,
      sitemapReferencesObserved: raw.robots.sitemaps.length,
      sitemapFetched: raw.sitemap.fetched,
    },
    records: buildRecords(raw, pages),
    pages,
  };
}

export function buildSeoAuditPayload(raw: SeoAuditRaw): SeoAuditPayload {
  return createPublicToolResult(
    {
      tool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v2",
      scope: "bounded_same_origin_static_html_audit",
      completedAt: raw.capturedAt,
    },
    buildSeoAuditReport(raw),
  );
}
