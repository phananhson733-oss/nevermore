import { subjectUrlOf } from "@sf/sources/canonical-url";
import {
  SOFT_404_BODY_FLOOR_UNITS,
  softNotFoundVerdict,
} from "./soft-404.ts";
import { CRAWL_PROJECTION_LIMITS, type CrawlPageAssets } from "@sf/sources";
import {
  searchCrawlerMayFetch,
  SEARCH_CRAWLER_USER_AGENT,
} from "./robots-allowance.ts";
import {
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

/** Image formats a modern-format check treats as current. */
const MODERN_IMAGE_FORMATS = new Set(["webp", "avif"]);

/**
 * The file extension of an image reference, or null when it has none.
 *
 * Read from the URL text and nothing else. A data URI, a query-string image
 * service and an extensionless CDN path all return null, which keeps them out
 * of the ratio entirely — an unreadable format is not an old format, and
 * guessing one would publish a share of something never measured.
 */
function imageExtension(src: string | null): string | null {
  if (src === null) return null;
  const withoutQuery = src.split(/[?#]/)[0] ?? "";
  const match = /\.([a-z0-9]{2,5})$/i.exec(withoutQuery);
  return match?.[1]?.toLowerCase() ?? null;
}

function readableFormats(
  assets: CrawlPageAssets | null,
): readonly string[] {
  return (assets?.images ?? [])
    .map((image) => imageExtension(image.src))
    .filter((extension): extension is string => extension !== null);
}

/** Share of format-readable images that are not WebP or AVIF. */
function legacyFormatShare(assets: CrawlPageAssets | null): number {
  const formats = readableFormats(assets);
  if (formats.length === 0) return 0;
  const legacy = formats.filter(
    (extension) => !MODERN_IMAGE_FORMATS.has(extension),
  ).length;
  return legacy / formats.length;
}

/**
 * The first place the heading outline jumps a level, or null.
 *
 * Counts from the first heading the document actually has rather than from a
 * notional level zero. Starting at zero makes a page whose first heading is an
 * `<h2>` — a nav heading above the title, which is ordinary — report a skip it
 * does not have, and that false positive is the whole reason this check needs
 * its own level scan in the first place.
 */
function firstSkippedLevel(
  assets: CrawlPageAssets | null,
): { readonly from: number; readonly to: number } | null {
  const levels = assets?.headingLevels ?? [];
  let previous: number | null = null;
  for (const level of levels) {
    if (previous !== null && level > previous + 1) {
      return { from: previous, to: level };
    }
    // Compared against the heading immediately before it, in document order.
    // Coming back up to a shallower level is how every document is structured
    // and is never a skip; only a jump downward past a level is.
    previous = level;
  }
  return null;
}

/**
 * How many linking pages one broken target lists by URL.
 *
 * Enough to act on — a shared template shows up as a shape within two or three
 * — without turning one observation into a page of text. The count is published
 * beside it, so a truncated list is visible rather than implied.
 */
const MAX_LISTED_SOURCE_PAGES = 5;

/** Whether a URL is the origin's own root, which has nothing above it. */
function isOriginRoot(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" && parsed.search === "";
  } catch {
    return false;
  }
}

function buildRecords(
  raw: SeoAuditRaw,
  pages: readonly SeoAuditPage[],
): readonly SeoAuditRecord[] {
  // Read from the raw crawl, never from the projected page.
  //
  // `assets` carries every page's full body text and up to three hundred image
  // references. Hanging it on SeoAuditPage put it inside `result.pages`, which
  // IS the cached payload — a real run of this site came to 1,907,879 bytes
  // against a 1,500,000 cap, so `writeCrawlCache` silently discarded every
  // write and each visitor paid for a fresh sixty-second crawl. It is 88.7% of
  // the payload and none of it is published.
  const assetsByUrl = new Map(
    raw.pages.map((record) => [record.projection.fetchUrl, record.assets] as const),
  );
  const assetsOf = (page: SeoAuditPage): CrawlPageAssets | null =>
    assetsByUrl.get(page.url) ?? null;
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
  // An unfetched robots.txt is not permission. Reading it as permission is how
  // a check that could not run turns into a clean pass.
  //
  // Neither is a TRUNCATED one. The crawl projection slices each group's rules
  // at 128 and the group list at 64, and a Disallow that fell off the end is
  // indistinguishable from one that was never written — so a page it forbids
  // comes back allowed and two Blocker-capable checks pass. A file at either
  // cap is read as unreadable rather than as permissive.
  const robotsTruncated =
    raw.robots.groups.length >= CRAWL_PROJECTION_LIMITS.maxRobotsGroups ||
    raw.robots.groups.some(
      (group) =>
        group.disallow.length >= CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup ||
        group.allow.length >= CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup,
    );
  const robotsReadable = raw.robots.fetched && !robotsTruncated;
  // Same shape for the sitemap: the projection slices at 2,000 and then reports
  // the SLICED length as the count, so the cut leaves no trace. Members are
  // sorted, so what falls off is a whole late-alphabet branch — exactly the
  // kind of section a site disallows.
  const sitemapTruncated =
    raw.sitemap.subjectUrls.length >= CRAWL_PROJECTION_LIMITS.maxSitemapUrls;
  const sitemapReadable = raw.sitemap.fetched && !sitemapTruncated;
  // "Below the root" is a fact about the URL, not about crawl order. Reading it
  // as depth > 0 exempted the submitted page from 7.5 entirely: the engine
  // enqueues the seed at depth 0 and never lowers it, so the ONE page the
  // page-scope check is about could never fail — and any page reached first
  // from the seed was judged while the seed itself was not.
  const belowRootHtmlPages = htmlPages.filter((page) => !isOriginRoot(page.url));
  // A page with no images cannot fail an image check, and counting it as
  // tested would report a text-only site as fully covered rather than as not
  // applicable.
  // Counted from the true image total, not the stored sample.
  const pagesWithImages = htmlPages.filter(
    (page) => (assetsOf(page)?.imageCount ?? 0) > 0,
  );
  const uncoveredImagePages = pagesWithImages.filter(
    (page) => (assetsOf(page)?.imagesWithoutAltAttribute ?? 0) > 0,
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
    ...(() => {
      // Aggregates, not affected-unit counts: both checks publish a threshold
      // about the population as a whole, so each emits one site-level value the
      // evaluator compares directly. A page with no timing is left out of the
      // mean rather than counted as zero.
      const timings = raw.pages
        .map((entry) => entry.projection.responseMs)
        .filter((ms): ms is number => typeof ms === "number" && ms >= 0);
      const depths = htmlPages.map((entry) => entry.depth);
      const mean = (input: readonly number[]) =>
        input.reduce((sum, value) => sum + value, 0) / input.length;

      return [
        record({
          id: "average_response_time",
          category: "crawl",
          tested: timings.length,
          observations:
            timings.length === 0
              ? []
              : [
                  {
                    url: null,
                    values: values({
                      average_response_ms: Math.round(mean(timings)),
                      slowest_response_ms: Math.max(...timings),
                      pages_timed: timings.length,
                    }),
                  },
                ],
          limitation: "single_uncached_request_per_url_not_a_field_measurement",
        }),
        record({
          id: "average_click_depth",
          category: "links",
          tested: depths.length,
          observations:
            depths.length === 0
              ? []
              : [
                  {
                    url: null,
                    values: values({
                      average_click_depth: Number(mean(depths).toFixed(2)),
                      deepest_click_depth: Math.max(...depths),
                      pages_measured: depths.length,
                    }),
                  },
                ],
          limitation: "depth_from_bounded_crawl_entry_point_only",
        }),
      ];
    })(),
    ...(() => {
      const redirecting = pages.filter((page) => page.redirectHops > 0);
      const settled = redirecting.filter((page) => page.finalStatus !== null);
      const unsettled = redirecting.length - settled.length;
      return [
        record({
          id: "redirect_destination_error",
          category: "crawl",
          // Only redirecting pages qualify, so this record's silence says
          // nothing about a URL that never redirected.
          population: "conditional_subset",
          // A redirect whose destination never returned a status was not
          // tested. Counting it would let an unknown destination read as a
          // clean one, which is the failure this whole panel exists to avoid.
          tested: settled.length,
          // A site with no redirects has no redirect destination that could be
          // broken. That is a conclusion, not a gap: leaving it unverified is
          // what fills the panel with grey labels nobody can act on.
          ...(redirecting.length === 0
            ? { state: "not_observed" as const }
            : {}),
          observations: settled
            .filter(
              (page) =>
                page.finalStatus !== null &&
                page.finalStatus >= 400 &&
                page.finalStatus < 600,
            )
            .map((page) =>
              pageObservation(page, {
                redirect_hops: page.redirectHops,
                final_url: page.finalUrl,
                final_status: page.finalStatus,
              }),
            ),
          limitation:
            unsettled > 0
              ? "redirect_destination_status_not_observed_for_every_redirect"
              : null,
        }),
      ];
    })(),
    record({
      id: "server_error_response",
      category: "crawl",
      // A page that never returned a status was not tested for a server error,
      // so its absence here is not evidence that it is healthy.
      population: "conditional_subset",
      tested: pages.filter((page) => page.finalStatus !== null).length,
      observations: pages
        .filter(
          (page) =>
            page.finalStatus !== null &&
            page.finalStatus >= 500 &&
            page.finalStatus < 600,
        )
        .map((page) =>
          pageObservation(page, {
            initial_status: page.initialStatus,
            final_status: page.finalStatus,
          }),
        ),
    }),
    record({
      id: "fetch_without_direct_page",
      category: "crawl",
      // A request that produced no status at all is our crawl not finishing,
      // not the site spending budget. Charging it to the site would report our
      // own timeout as their waste, so it is left out of the population rather
      // than counted as clean or as waste.
      population: "conditional_subset",
      tested: pages.filter((page) => page.finalStatus !== null).length,
      // A fetch that did not land straight on a 2xx document: either it ended
      // somewhere other than 200-299, or it got there through a redirect. Both
      // spend a request that a correct link would not have spent. Non-HTML 2xx
      // responses are excluded — a PDF that answers the request is not waste.
      observations: pages
        .filter(
          (page) =>
            page.finalStatus !== null &&
            (page.finalStatus < 200 ||
              page.finalStatus >= 300 ||
              page.redirectHops > 0),
        )
        .map((page) =>
          pageObservation(page, {
            initial_status: page.initialStatus,
            final_status: page.finalStatus,
            redirect_hops: page.redirectHops,
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
          // The URLs, not just how many. "3 pages link to this 404" is not a
          // fix instruction — the reader cannot open the three pages, and on
          // our own site it took reading the source to find them. Bounded and
          // sorted so the sample is stable between runs; the count beside it
          // says whether anything was left out.
          source_pages: [...sources]
            .sort()
            .slice(0, MAX_LISTED_SOURCE_PAGES)
            .join(" "),
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
      // Every collected page, whenever a sitemap was collected at all. Declaring a
      // subset made the page projection refuse to read absence as evidence, so a
      // page that IS in the sitemap came back "not tested" instead of passing.
      // With no sitemap the record is already unverified via tested === 0.
      population: "every_collected_page",
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
      // 1.2. Not "did our crawler get in" — it did, or this page would not be
      // here. The question is whether the crawler that decides indexing is let
      // through, and a file can allow one and stop the other.
      id: "page_disallowed_for_search_crawler",
      category: "crawl",
      tested: robotsReadable ? pages.length : 0,
      ...(robotsReadable ? {} : { state: "unverified" as const }),
      observations: (robotsReadable ? pages : [])
        .filter((page) => searchCrawlerMayFetch(raw.robots, page.url) === false)
        .map((page) =>
          pageObservation(page, {
            robots_user_agent: SEARCH_CRAWLER_USER_AGENT,
            robots_allowed: false,
            sitemap_member: page.sitemapMember,
          }),
        ),
      limitation: robotsTruncated
        ? "robots_rules_hit_this_runs_cap_so_a_disallow_may_have_been_dropped"
        : robotsReadable
          ? "robots_rules_read_for_one_search_crawler_token_only"
          : "resource_not_observed_does_not_prove_absence",
    }),
    record({
      // A5. Read against the sitemap rather than the collected pages on
      // purpose: a URL our own crawler was forbidden to fetch never became a
      // page, so counting pages would report zero on exactly the site that has
      // the problem. The sitemap is the site's own list of what it wants
      // indexed, and a URL on it that robots.txt forbids is the site
      // contradicting itself.
      id: "sitemap_url_disallowed_by_robots",
      category: "crawl",
      unit: "site_resource",
      population: "site_resource",
      tested:
        robotsReadable && sitemapReadable ? raw.sitemap.subjectUrls.length : 0,
      ...(robotsReadable && sitemapReadable
        ? {}
        : { state: "unverified" as const }),
      observations: (robotsReadable && sitemapReadable
        ? raw.sitemap.subjectUrls
        : []
      )
        .filter((url) => searchCrawlerMayFetch(raw.robots, url) === false)
        .map((url) => ({
          url,
          values: values({
            robots_user_agent: SEARCH_CRAWLER_USER_AGENT,
            robots_allowed: false,
            sitemap_member: true,
          }),
        })),
      limitation: robotsTruncated
        ? "robots_rules_hit_this_runs_cap_so_a_disallow_may_have_been_dropped"
        : !robotsReadable
          ? "resource_not_observed_does_not_prove_absence"
          : sitemapTruncated
            ? "sitemap_urls_hit_this_runs_cap_so_a_declared_url_may_be_missing"
            : raw.sitemap.fetched
              ? "robots_rules_read_for_one_search_crawler_token_only"
              : "no_sitemap_collected_membership_not_testable",
    }),
    record({
      // 7.5, presence only. Whether the markup matches the breadcrumb a reader
      // sees is not decidable here: the parser keeps no visible trail to
      // compare against. What is decidable is whether a page below the root
      // declares one at all, and the root is excluded because a homepage
      // legitimately has no breadcrumb to declare.
      id: "page_without_breadcrumb_list",
      category: "structured_data",
      unit: "pages",
      // Runs over every collected page; the root simply never fails it, which
      // is the right verdict rather than an exemption. Declaring a subset here
      // instead would make a clean page unreadable: the page projection only
      // treats absence as evidence for a record that tested everything, so a
      // page that correctly declares its breadcrumb would come back "not
      // tested" rather than "passes".
      tested: htmlPages.length,
      observations: belowRootHtmlPages
        .filter(
          (page) =>
            !page.jsonLdTypes.some(
              (type) => type.trim().toLowerCase() === "breadcrumblist",
            ),
        )
        .map((page) =>
          pageObservation(page, {
            types_observed: page.jsonLdTypes.join(", ") || null,
            observed_click_depth: page.depth,
          }),
        ),
      limitation: "breadcrumb_markup_presence_only_not_compared_to_visible_trail",
    }),
    record({
      // D4 and 5.1 read the same condition at two scales. `alt=""` counts as
      // covered: an empty alt is how correct markup marks a decorative image,
      // and calling it a defect would push every accessible site below the bar.
      id: "image_without_alt_text",
      category: "structure",
      // Every collected page, not the image-carrying subset. A page with no
      // images has no image missing alt, which is a true pass — and it is the
      // only shape the page projection can read: for a conditional subset it
      // cannot tell a clean page from one that never qualified, so every
      // correctly-marked-up page came back "excluded".
      tested: htmlPages.length,
      observations: htmlPages
        // The uncapped count. The stored list stops at 300, so filtering on it
        // published a page whose last fifty images have no alt as covered.
        .filter((page) => (assetsOf(page)?.imagesWithoutAltAttribute ?? 0) > 0)
        .map((page) =>
          pageObservation(page, {
            images_without_alt: assetsOf(page)?.imagesWithoutAltAttribute ?? 0,
            images_observed: assetsOf(page)?.images.length ?? 0,
            images_on_page: assetsOf(page)?.imageCount ?? 0,
          }),
        ),
      limitation:
        "static_html_img_tags_only_css_and_script_rendered_images_not_seen",
    }),
    record({
      // D4. A share of the pages that carry images, which is what the
      // published threshold is about. Counting every collected page instead
      // would let a mostly-text site dilute its way past the bar with five
      // percent image pages that are all broken.
      id: "image_alt_coverage",
      category: "structure",
      unit: "site_resource",
      population: "site_resource",
      tested: pagesWithImages.length,
      ...(pagesWithImages.length === 0
        ? { state: "unverified" as const }
        : {}),
      observations:
        pagesWithImages.length === 0
          ? []
          : [
              {
                url: null,
                values: values({
                  alt_coverage_share: Number(
                    (
                      1 -
                      uncoveredImagePages.length / pagesWithImages.length
                    ).toFixed(4),
                  ),
                  pages_with_images: pagesWithImages.length,
                  pages_with_uncovered_images: uncoveredImagePages.length,
                }),
              },
            ],
      limitation:
        "static_html_img_tags_only_css_and_script_rendered_images_not_seen",
    }),
    record({
      // 5.3. The denominator is images whose extension is readable at all, so
      // a data URI or an extensionless CDN path leaves the ratio rather than
      // counting against it — an unreadable format is not an old format.
      id: "image_in_legacy_format",
      category: "structure",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => legacyFormatShare(assetsOf(page)) > 0)
        .map((page) => {
          const readable = readableFormats(assetsOf(page));
          return pageObservation(page, {
            modern_format_share: Number(
              (1 - legacyFormatShare(assetsOf(page))).toFixed(4),
            ),
            legacy_format_share: Number(legacyFormatShare(assetsOf(page)).toFixed(4)),
            images_with_readable_format: readable.length,
            images_on_page: assetsOf(page)?.imageCount ?? 0,
          });
        }),
      limitation:
        "format_read_from_the_url_extension_only_not_from_the_response",
    }),
    record({
      // 2.6. All three or none: a card that renders a title and no image is
      // not two-thirds of a share preview, it is a share preview that looks
      // broken.
      id: "open_graph_incomplete",
      category: "metadata",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => {
          const og = assetsOf(page)?.openGraph;
          return og !== undefined && !(og.title && og.description && og.image);
        })
        .map((page) =>
          pageObservation(page, {
            open_graph_title: assetsOf(page)?.openGraph.title ?? false,
            open_graph_description: assetsOf(page)?.openGraph.description ?? false,
            open_graph_image: assetsOf(page)?.openGraph.image ?? false,
          }),
        ),
      limitation: "static_html_meta_tags_only",
    }),
    record({
      // 3.3. Levels come from their own scan, so an icon-only heading still
      // occupies its level; the text collector drops it, and a level dropped
      // between h1 and h3 fabricates exactly the skip this reports.
      id: "heading_level_skipped",
      category: "structure",
      tested: htmlPages.length,
      observations: htmlPages
        .filter((page) => firstSkippedLevel(assetsOf(page)) !== null)
        .map((page) =>
          pageObservation(page, {
            skipped_from_level: firstSkippedLevel(assetsOf(page))?.from ?? null,
            skipped_to_level: firstSkippedLevel(assetsOf(page))?.to ?? null,
            heading_levels_observed: assetsOf(page)?.headingLevels.length ?? 0,
          }),
        ),
      limitation: "heading_levels_read_from_static_html_in_document_order",
    }),
    record({
      // A4 and 1.8. Both Blocker-capable, so the detection needs two
      // independent signals: a page that says it is missing AND has nothing
      // else on it. Thin content alone is a short page, which other checks
      // report; a not-found phrase alone is an article about error pages.
      id: "soft_404_page",
      category: "indexability",
      tested: htmlPages.length,
      observations: htmlPages.flatMap((page) => {
        const verdict = softNotFoundVerdict(page, assetsOf(page)?.bodyText);
        return verdict === null
          ? []
          : [
              pageObservation(page, {
                final_status: page.finalStatus,
                matched_phrase: verdict.matchedPhrase,
                body_text_units: verdict.bodyUnits.units,
                text_units_basis: verdict.bodyUnits.basis,
                text_units_floor: SOFT_404_BODY_FLOOR_UNITS,
              }),
            ];
      }),
      limitation:
        "soft_404_needs_both_a_not_found_phrase_and_a_body_below_the_published_floor",
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
  const requestedSubject = subjectUrlOf(raw.requestedUrl);
  // `pages` is a positional map of `raw.pages`, so one index identifies the
  // target in both. Selecting the raw record by a second predicate could pick
  // a different journey for the same subject URL and report one page's text
  // beside another page's observations.
  const inspectedIndex = pages.findIndex(
    (page) =>
      page.subjectUrl === requestedSubject &&
      page.finalStatus !== null &&
      page.finalStatus >= 200 &&
      page.finalStatus < 300 &&
      isHtml(page.contentType),
  );
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
        : buildTargetPageExtract(inspectedProjection),
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
