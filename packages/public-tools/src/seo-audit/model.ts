import { subjectUrlOf } from "@sf/sources/canonical-url";
import {
  isAllowedPublicToolEntryRedirect,
  PUBLIC_TOOL_SYNC_CRAWL_BUDGET,
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
  SeoAuditRecordPopulation,
  SeoAuditRecordUnit,
  SeoAuditReport,
} from "./types.ts";
import type { SeoAuditRaw } from "./scan.ts";
import { buildTargetPageExtract } from "./keyword-evidence/extract.ts";

const MAX_OBSERVATIONS_PER_RECORD = PUBLIC_TOOL_SYNC_CRAWL_BUDGET.maxUrls;

/**
 * Reviewed working ranges, not official limits. Google truncates titles and
 * descriptions by rendered pixel width, not character count, so these bounds
 * only flag lengths far enough outside common practice to be worth a look.
 */
const TITLE_LENGTH = { min: 15, max: 70 } as const;
const DESCRIPTION_LENGTH = { min: 50, max: 165 } as const;
const CLICK_DEPTH_LIMIT = 4;

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
  /** Defaults to the whole collected population; say so when it is narrower. */
  readonly population?: SeoAuditRecordPopulation;
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
    population: input.population ?? "every_collected_page",
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
  // Duplicate detection runs only over self-canonical pages: a page whose
  // canonical resolves to another subject is excluded from grouping AND from
  // `tested`, so `tested` counts exactly the population the check ran over.
  const selfCanonicalHtmlPages = htmlPages.filter(
    (page) =>
      page.canonicalTarget === null ||
      subjectUrlOf(page.canonicalTarget) === page.subjectUrl,
  );
  const collectedBySubject = new Map(
    pages.map((page) => [page.subjectUrl, page] as const),
  );
  const linkTargetErrors = new Map<
    string,
    { readonly page: SeoAuditPage; readonly sources: Set<string> }
  >();
  /** Broken internal link targets keyed by the page that links to them. */
  const brokenLinkSources = new Map<string, Set<string>>();
  const htmlSubjects = new Set(htmlPages.map((page) => page.subjectUrl));
  /** Sitemap membership is only testable when a sitemap was actually collected. */
  const sitemapWasFetched = raw.sitemap.fetched;

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

      // Only pages inside the tested population may become source rows, or the
      // record reports more affected pages than it tested.
      if (htmlSubjects.has(source.subjectUrl)) {
        const owned =
          brokenLinkSources.get(source.projection.fetchUrl) ??
          new Set<string>();
        owned.add(target.subjectUrl);
        brokenLinkSources.set(source.projection.fetchUrl, owned);
      }
    }
  }

  const records: SeoAuditRecord[] = [
    record({
      id: "robots_resource",
      population: "site_resource",
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
      population: "site_resource",
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
        .map((page) => pageObservation(page, { robots_directive: "noindex" })),
      limitation: "static_response_directives_only",
    }),
    record({
      id: "canonical_missing",
      category: "indexability",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.canonicalTarget === null)
        .map((page) => pageObservation(page, { canonical_target: null })),
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
        .map((page) => pageObservation(page, { title: null })),
    }),
    record({
      id: "title_duplicate",
      // Tested population: self-canonical pages that have a title.
      population: "conditional_subset",
      category: "metadata",
      tested: selfCanonicalHtmlPages.filter((page) => page.title !== null)
        .length,
      observations: duplicateObservations(
        selfCanonicalHtmlPages,
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
        .map((page) => pageObservation(page, { meta_description: null })),
    }),
    record({
      id: "meta_description_duplicate",
      // Tested population: self-canonical pages that have a description.
      population: "conditional_subset",
      category: "metadata",
      tested: selfCanonicalHtmlPages.filter(
        (page) => page.metaDescription !== null,
      ).length,
      observations: duplicateObservations(
        selfCanonicalHtmlPages,
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
        .map((page) => pageObservation(page, { h1_count: 0 })),
    }),
    record({
      id: "multiple_h1",
      category: "structure",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.h1Count > 1)
        .map((page) => pageObservation(page, { h1_count: page.h1Count })),
    }),
    record({
      id: "sitemap_page_without_observed_inlink",
      // Tested population: sitemap members other than the root.
      population: "conditional_subset",
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
      // Tested population: collected internal link targets.
      population: "conditional_subset",
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
      id: "page_outbound_broken_link",
      category: "links",
      tested: htmlPages.length,
      observations: [...brokenLinkSources.entries()].map(
        ([sourceUrl, brokenTargets]) => ({
          url: sourceUrl,
          values: values({ broken_link_targets: brokenTargets.size }),
        }),
      ),
      limitation: "uncollected_link_targets_not_classified",
    }),
    record({
      id: "page_not_in_sitemap",
      // Tested population: collected pages, only when a sitemap was retrieved.
      population: "conditional_subset",
      category: "crawl",
      tested: sitemapWasFetched ? htmlPages.length : 0,
      observations: sitemapWasFetched
        ? htmlPages
            .filter((page) => !page.sitemapMember)
            .map((page) => pageObservation(page, { sitemap_member: false }))
        : [],
      limitation: sitemapWasFetched
        ? null
        : "no_sitemap_collected_membership_not_testable",
    }),
    record({
      id: "title_length_outside_range",
      // Tested population: pages that have a title.
      population: "conditional_subset",
      category: "metadata",
      tested: htmlPages.filter((page) => page.title !== null).length,
      observations: htmlPages
        .filter(
          (page) =>
            page.title !== null &&
            (page.title.trim().length < TITLE_LENGTH.min ||
              page.title.trim().length > TITLE_LENGTH.max),
        )
        .map((page) =>
          pageObservation(page, {
            title_characters: page.title!.trim().length,
            reviewed_range: `${TITLE_LENGTH.min}-${TITLE_LENGTH.max}`,
          }),
        ),
      limitation: "character_count_only_rendered_pixel_width_not_measured",
    }),
    record({
      id: "meta_description_length_outside_range",
      // Tested population: pages that have a description.
      population: "conditional_subset",
      category: "metadata",
      tested: htmlPages.filter((page) => page.metaDescription !== null).length,
      observations: htmlPages
        .filter(
          (page) =>
            page.metaDescription !== null &&
            (page.metaDescription.trim().length < DESCRIPTION_LENGTH.min ||
              page.metaDescription.trim().length > DESCRIPTION_LENGTH.max),
        )
        .map((page) =>
          pageObservation(page, {
            description_characters: page.metaDescription!.trim().length,
            reviewed_range: `${DESCRIPTION_LENGTH.min}-${DESCRIPTION_LENGTH.max}`,
          }),
        ),
      limitation: "character_count_only_rendered_pixel_width_not_measured",
    }),
    record({
      id: "page_without_outbound_internal_link",
      category: "links",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.outboundLinks === 0)
        .map((page) =>
          pageObservation(page, { observed_outbound_internal_links: 0 }),
        ),
      limitation: "bounded_static_html_crawl_outlinks_only",
    }),
    record({
      id: "click_depth_beyond_reviewed_limit",
      category: "links",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.depth > CLICK_DEPTH_LIMIT)
        .map((page) =>
          pageObservation(page, {
            observed_click_depth: page.depth,
            reviewed_limit: CLICK_DEPTH_LIMIT,
          }),
        ),
      limitation: "depth_from_bounded_crawl_entry_point_only",
    }),
    record({
      id: "json_ld_missing",
      category: "structured_data",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => page.jsonLdTypes.length === 0)
        .map((page) => pageObservation(page, { json_ld_blocks: 0 })),
      limitation: "static_html_json_ld_only",
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

/**
 * The subject URLs that could be the submitted target, in the order to try.
 *
 * The crawler resolves the entry redirect before it crawls anything: a
 * submitted `www.` host that 301s to the apex yields an origin — and therefore
 * a whole set of collected pages — on the apex, while `requestedUrl` keeps the
 * string the visitor typed. Comparing only that string against those pages
 * finds nothing, so a site crawled end to end reports its one requested page as
 * never collected.
 *
 * The second candidate re-bases the submitted path onto the crawled origin, and
 * only when the entry resolver would have been allowed to move between those
 * two hosts in the first place. Re-basing on the origin unconditionally would
 * answer a URL on an unrelated site with whatever this crawl collected at the
 * same path.
 */
function targetSubjectCandidates(
  raw: SeoAuditRaw,
  requestedSubject: string | null,
): readonly string[] {
  if (requestedSubject === null) return [];
  let rebased: string | null = null;
  try {
    const submitted = new URL(raw.requestedUrl);
    const origin = new URL(raw.origin);
    const onOrigin = `${origin.protocol}//${origin.host}${submitted.pathname}${submitted.search}`;
    rebased = isAllowedPublicToolEntryRedirect(raw.requestedUrl, onOrigin)
      ? subjectUrlOf(onOrigin)
      : null;
  } catch {
    rebased = null;
  }
  return rebased === null || rebased === requestedSubject
    ? [requestedSubject]
    : [requestedSubject, rebased];
}

export function buildSeoAuditReport(raw: SeoAuditRaw): SeoAuditReport {
  const pages = buildPages(raw);
  const requestedSubject = subjectUrlOf(raw.requestedUrl);
  // `pages` is a positional map of `raw.pages`, so one index identifies the
  // target in both. Selecting the raw record by a second predicate could pick
  // a different journey for the same subject URL and report one page's text
  // beside another page's observations.
  const inspectedIndex = (() => {
    for (const subject of targetSubjectCandidates(raw, requestedSubject)) {
      const at = pages.findIndex(
        (page) =>
          page.subjectUrl === subject &&
          page.finalStatus !== null &&
          page.finalStatus >= 200 &&
          page.finalStatus < 300 &&
          isHtml(page.contentType),
      );
      if (at !== -1) return at;
    }
    return -1;
  })();
  const inspectedTarget = inspectedIndex === -1 ? null : pages[inspectedIndex];
  const inspectedProjection =
    inspectedIndex === -1 ? null : raw.pages[inspectedIndex]?.projection;
  return {
    targetUrl: raw.requestedUrl,
    targetInspected: inspectedTarget !== undefined && inspectedTarget !== null,
    inspectedTargetUrl: inspectedTarget?.url ?? null,
    targetPageExtract:
      inspectedProjection === null || inspectedProjection === undefined
        ? null
        : buildTargetPageExtract(
            inspectedProjection,
            raw.pages[inspectedIndex]?.onPage,
          ),
    siteOrigin: raw.origin,
    scannedAt: raw.capturedAt,
    coverage: {
      availability: raw.availability,
      pagesInspected: pages.length,
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
      schemaVersion: "seo_audit.sitewide.v6",
      scope: "discoverable_same_origin_static_html_audit",
      completedAt: raw.capturedAt,
    },
    buildSeoAuditReport(raw),
  );
}
