import { subjectUrlOf } from "@sf/sources/canonical-url";
import { measurePageSimilarity } from "./page-similarity.ts";
import {
  SOFT_404_BODY_FLOOR_UNITS,
  softNotFoundVerdict,
} from "./soft-404.ts";
import { CRAWL_PROJECTION_LIMITS, type ParsedOnPageFacts } from "@sf/sources";
import {
  searchCrawlerMayFetch,
  SEARCH_CRAWLER_USER_AGENT,
} from "./robots-allowance.ts";
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
import {
  displayWidth,
  SNIPPET_DESCRIPTION_WIDTH,
  SNIPPET_TITLE_WIDTH,
} from "./text-width.ts";
import { buildTargetPageExtract } from "./keyword-evidence/extract.ts";

const MAX_OBSERVATIONS_PER_RECORD = PUBLIC_TOOL_SYNC_CRAWL_BUDGET.maxUrls;

/**
 * The same bounds the On-Page Checker judges by, read from one definition.
 *
 * They used to be 15–70 / 50–165 on raw `.length` here and 15–60 / 50–160 on
 * display width there, so one title was flagged by one tool and cleared by the
 * other. Width is the closer proxy for the pixel budget that actually
 * truncates, so the audit moved to it rather than the checker moving back.
 */
const TITLE_LENGTH = SNIPPET_TITLE_WIDTH;
const DESCRIPTION_LENGTH = SNIPPET_DESCRIPTION_WIDTH;
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
  /**
   * The pages the rule ran over, or a count when the unit is not pages.
   *
   * Given the pages themselves, the record can also say whether one named page
   * was among them — which is the difference between "this page is clean" and
   * "this rule never looked at this page", and those are not the same sentence.
   */
  readonly tested: number | readonly SeoAuditPage[];
  readonly observations: readonly SeoAuditObservation[];
  readonly limitation?: string | null;
  readonly state?: SeoAuditRecordState;
}

/**
 * A record builder that knows which page the visitor asked about.
 *
 * Membership is answered from the rule's own tested list rather than re-derived
 * from the rule's precondition, so the count and the membership cannot disagree
 * about the same population.
 */
function recorderFor(targetSubjectUrl: string | null) {
  return function record(input: RecordInput): SeoAuditRecord {
    const observations = input.observations.slice(
      0,
      MAX_OBSERVATIONS_PER_RECORD,
    );
    const tested =
      typeof input.tested === "number" ? input.tested : input.tested.length;
    const targetTested =
      typeof input.tested === "number" || targetSubjectUrl === null
        ? null
        : input.tested.some((page) => page.subjectUrl === targetSubjectUrl);
    return {
      id: input.id,
      category: input.category,
      state:
        input.state ??
        (tested === 0
          ? "unverified"
          : observations.length > 0
            ? "observed"
            : "not_observed"),
      unit: input.unit ?? "pages",
      population: input.population ?? "every_collected_page",
      tested,
      targetTested,
      affected: observations.length,
      observations,
      limitation: input.limitation ?? null,
    };
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
  assets: ParsedOnPageFacts | null,
): readonly string[] {
  return assets?.imageFormats ?? [];
}

/** Share of format-readable images that are not WebP or AVIF. */
function legacyFormatShare(assets: ParsedOnPageFacts | null): number {
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
  assets: ParsedOnPageFacts | null,
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

/**
 * Properties a declared type needs to be usable, by lowercase `@type`.
 *
 * Short on purpose: only what Google's rich-result documentation lists as
 * required, and only for types a marketing site actually ships. A type absent
 * from this table is not judged — assuming a type is complete because we have
 * no opinion about it would report every unlisted type as correct.
 */
const REQUIRED_JSON_LD_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  product: ["name"],
  offer: ["price", "priceCurrency"],
  article: ["headline"],
  blogposting: ["headline"],
  newsarticle: ["headline"],
  faqpage: ["mainEntity"],
  question: ["name", "acceptedAnswer"],
  howto: ["name", "step"],
  recipe: ["name", "recipeIngredient", "recipeInstructions"],
  event: ["name", "startDate", "location"],
  jobposting: ["title", "datePosted", "hiringOrganization"],
  breadcrumblist: ["itemListElement"],
  softwareapplication: ["name"],
  organization: ["name"],
  localbusiness: ["name", "address"],
};

/**
 * Smallest declared edge that could plausibly be the image a reader came for.
 *
 * A 32-pixel logo mark is the first `<img>` on a very large share of sites.
 */
const LEAD_IMAGE_MIN_EDGE = 200;

/** Whether the first image declares a size big enough to be worth judging. */
function leadImageIsJudgeable(facts: ParsedOnPageFacts | null): boolean {
  const first = facts?.firstImage;
  if (first === undefined || first === null) return false;
  const width = first.width ?? 0;
  const height = first.height ?? 0;
  if (first.width === null && first.height === null) return false;
  return Math.max(width, height) >= LEAD_IMAGE_MIN_EDGE;
}

function buildRecords(
  raw: SeoAuditRaw,
  pages: readonly SeoAuditPage[],
  targetSubjectUrl: string | null,
): readonly SeoAuditRecord[] {
  const record = recorderFor(targetSubjectUrl);
  // Read from the raw crawl, never from the projected page. `onPage` carries
  // per-page counts and the whole body's text metrics; hanging anything that
  // size on SeoAuditPage would put it inside `result.pages`, which IS the
  // cached payload.
  const rawByUrl = new Map(
    raw.pages.map((entry) => [entry.projection.fetchUrl, entry] as const),
  );
  const onPageByUrl = new Map(
    raw.pages.map(
      (entry) => [entry.projection.fetchUrl, entry.onPage] as const,
    ),
  );
  const onPageOf = (page: SeoAuditPage): ParsedOnPageFacts | null =>
    onPageByUrl.get(page.url) ?? null;
  const hreflangTargetsOf = (page: SeoAuditPage) =>
    onPageOf(page)?.hreflangAlternates ?? [];
  /** JSON-LD nodes whose type this run has a reviewed opinion about. */
  const judgedJsonLdNodes = (page: SeoAuditPage) =>
    (onPageOf(page)?.jsonLdProperties ?? []).filter(
      (node) =>
        REQUIRED_JSON_LD_PROPERTIES[node.type.trim().toLowerCase()] !== undefined,
    ).map((node) => ({ type: node.type.trim().toLowerCase(), keys: node.keys }));
  /**
   * Lowercased, punctuation-free, whitespace-collapsed.
   *
   * A FAQPage routinely writes the question with a different apostrophe or a
   * trailing question mark than the heading does. Matching the raw strings
   * would report a page whose FAQ is right there on screen.
   */
  const normalizeForMatch = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const visibleTextIndexOf = (page: SeoAuditPage): string => {
    const raw = rawByUrl.get(page.url);
    if (raw === undefined) return "";
    return normalizeForMatch(
      [...raw.projection.headings, ...raw.projection.paragraphs].join(" "),
    );
  };

  /**
   * Whether a missing question would mean the site broke its promise.
   *
   * The crawl keeps the first 50 paragraphs of a page. A long FAQ page puts
   * its later answers past that line, so a question absent from what we kept
   * is not a question absent from the page. Only judge when the paragraph
   * list came back under the cap and there is a promise to judge.
   */
  const faqPromiseIsCheckable = (page: SeoAuditPage): boolean => {
    const raw = rawByUrl.get(page.url);
    if (raw === undefined) return false;
    return (
      (onPageOf(page)?.faqQuestions ?? []).length > 0 &&
      raw.projection.paragraphs.length <
        CRAWL_PROJECTION_LIMITS.maxParagraphs &&
      raw.projection.headings.length < CRAWL_PROJECTION_LIMITS.maxHeadings
    );
  };

  /** The published bar: at or above this, two pages compete with each other. */
  const NEAR_DUPLICATE_THRESHOLD = 0.7;

  const htmlPages = pages.filter(
    (page) =>
      page.finalStatus !== null &&
      page.finalStatus >= 200 &&
      page.finalStatus < 300 &&
      isHtml(page.contentType),
  );

  /**
   * Computed once for the whole run: every page needs every other page.
   *
   * Keyed by `page.url` to match `onPageByUrl` and `rawByUrl` beside it.
   */
  const similarityByUrl = new Map(
    measurePageSimilarity(
      htmlPages.map((page) => ({
        url: page.url,
        paragraphs: rawByUrl.get(page.url)?.projection.paragraphs ?? [],
        partOfASequence: onPageOf(page)?.partOfASequence ?? false,
      })),
    ).map((entry) => [entry.url, entry] as const),
  );

  const entrySubjectUrl = subjectUrlOf(`${raw.origin}/`);
  /**
   * Whether "nothing links here" means the site, or only means this crawl.
   *
   * An inbound count is a claim about every page that exists, built from the
   * pages this run happened to fetch and the links it happened to keep. Both
   * of those are bounded, and when either bound was reached the count stops
   * being evidence about the site.
   */
  const outlinkListTruncated = raw.pages.some(
    (page) =>
      page.projection.internalOutlinks.length >=
      CRAWL_PROJECTION_LIMITS.maxInternalOutlinks,
  );
  const discoveryJudgeable = raw.stopReason === null && !outlinkListTruncated;
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
    (page) => (onPageOf(page)?.images.total ?? 0) > 0,
  );
  const uncoveredImagePages = pagesWithImages.filter(
    (page) => (onPageOf(page)?.images.withoutAlt ?? 0) > 0,
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
      tested: pages.filter((page) => page.finalStatus !== null),
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
      tested: pages,
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
      tested: pages,
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
      tested: htmlPages,
      observations: htmlPages
        .filter((page) => page.robotsDirectiveState === "noindex_observed")
        .map((page) => pageObservation(page, { robots_directive: "noindex" })),
      limitation: "static_response_directives_only",
    }),
    record({
      id: "canonical_missing",
      category: "indexability",
      tested: htmlPages,
      observations: htmlPages
        .filter((page) => page.canonicalTarget === null)
        .map((page) => pageObservation(page, { canonical_target: null })),
    }),
    record({
      id: "canonical_differs",
      category: "indexability",
      tested: htmlPages.filter((page) => page.canonicalTarget !== null),
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
      tested: htmlPages,
      observations: htmlPages
        .filter((page) => page.title === null)
        .map((page) => pageObservation(page, { title: null })),
    }),
    record({
      id: "title_duplicate",
      // Tested population: self-canonical pages that have a title.
      population: "conditional_subset",
      category: "metadata",
      tested: selfCanonicalHtmlPages.filter((page) => page.title !== null),
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
      tested: htmlPages,
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
      ),
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
      tested: htmlPages,
      observations: htmlPages
        .filter((page) => page.h1Count === 0)
        .map((page) => pageObservation(page, { h1_count: 0 })),
    }),
    record({
      id: "multiple_h1",
      category: "structure",
      tested: htmlPages,
      observations: htmlPages
        .filter((page) => page.h1Count > 1)
        .map((page) => pageObservation(page, { h1_count: page.h1Count })),
    }),
    record({
      id: "page_without_any_discovery_path",
      // Tested population: collected HTML pages other than the entry URL.
      //
      // Distinct from `sitemap_page_without_observed_inlink`, which asks the
      // narrower question "is this sitemap member linked to?". This one asks
      // whether the page has ANY route in: no inbound internal link and no
      // sitemap entry means the only way this run reached it was a redirect
      // hop, and a search engine starting from the homepage has no path at all.
      population: "conditional_subset",
      category: "links",
      tested: discoveryJudgeable
        ? htmlPages.filter((page) => page.subjectUrl !== entrySubjectUrl)
        : [],
      observations: discoveryJudgeable
        ? htmlPages
            .filter(
              (page) =>
                page.subjectUrl !== entrySubjectUrl &&
                page.inboundLinks === 0 &&
                !page.sitemapMember,
            )
            .map((page) =>
              pageObservation(page, {
                observed_inbound_links: 0,
                sitemap_member: false,
                redirect_hops: page.redirectHops,
              }),
            )
        : [],
      // Two ways this run could invent an orphan that does not exist, both of
      // them about what the crawl did not see rather than what the site did:
      // a page linked only from beyond another page's 500-link cap, and a
      // crawl that stopped before fetching the page that links here. Neither
      // is distinguishable from a real orphan after the fact, so the rule
      // declines to judge the whole site rather than name innocent pages.
      limitation: discoveryJudgeable
        ? "bounded_static_html_crawl_inlinks_only"
        : "crawl_incomplete_inlinks_unreliable",
    }),
    record({
      id: "sitemap_page_without_observed_inlink",
      // Tested population: sitemap members other than the root.
      population: "conditional_subset",
      category: "links",
      // The root carries the same exclusion as the observations below. It was
      // only excluded there, so a homepage listed in the sitemap with no
      // inbound links counted as tested and — never being emitted as affected
      // — rendered a clean pass for a rule that deliberately never looks at it.
      tested: pages.filter(
        (page) =>
          page.sitemapMember &&
          page.subjectUrl !== subjectUrlOf(`${raw.origin}/`),
      ),
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
      tested: htmlPages,
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
      tested: sitemapWasFetched ? htmlPages : [],
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
      tested: htmlPages.filter((page) => page.title !== null),
      observations: htmlPages
        .filter(
          (page) =>
            page.title !== null &&
            (displayWidth(page.title.trim()) < TITLE_LENGTH.min ||
              displayWidth(page.title.trim()) > TITLE_LENGTH.max),
        )
        .map((page) =>
          pageObservation(page, {
            title_display_width: displayWidth(page.title!.trim()),
            reviewed_range: `${TITLE_LENGTH.min}-${TITLE_LENGTH.max}`,
          }),
        ),
      limitation: "display_width_approximation_rendered_pixel_width_not_measured",
    }),
    record({
      id: "meta_description_length_outside_range",
      // Tested population: pages that have a description.
      population: "conditional_subset",
      category: "metadata",
      tested: htmlPages.filter((page) => page.metaDescription !== null),
      observations: htmlPages
        .filter(
          (page) =>
            page.metaDescription !== null &&
            (displayWidth(page.metaDescription.trim()) <
              DESCRIPTION_LENGTH.min ||
              displayWidth(page.metaDescription.trim()) >
                DESCRIPTION_LENGTH.max),
        )
        .map((page) =>
          pageObservation(page, {
            description_display_width: displayWidth(
              page.metaDescription!.trim(),
            ),
            reviewed_range: `${DESCRIPTION_LENGTH.min}-${DESCRIPTION_LENGTH.max}`,
          }),
        ),
      limitation: "display_width_approximation_rendered_pixel_width_not_measured",
    }),
    record({
      id: "page_without_outbound_internal_link",
      category: "links",
      tested: htmlPages,
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
      tested: htmlPages,
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
      tested: htmlPages,
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
        .filter((page) => (onPageOf(page)?.images.withoutAlt ?? 0) > 0)
        .map((page) =>
          pageObservation(page, {
            images_without_alt: onPageOf(page)?.images.withoutAlt ?? 0,
            images_observed: onPageOf(page)?.images.total ?? 0,
            images_on_page: onPageOf(page)?.images.total ?? 0,
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
        .filter((page) => legacyFormatShare(onPageOf(page)) > 0)
        .map((page) => {
          const readable = readableFormats(onPageOf(page));
          return pageObservation(page, {
            modern_format_share: Number(
              (1 - legacyFormatShare(onPageOf(page))).toFixed(4),
            ),
            legacy_format_share: Number(legacyFormatShare(onPageOf(page)).toFixed(4)),
            images_with_readable_format: readable.length,
            images_on_page: onPageOf(page)?.images.total ?? 0,
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
          const og = onPageOf(page)?.openGraph;
          return (
            og !== undefined &&
            !(og.title !== null && og.description !== null && og.image !== null)
          );
        })
        .map((page) =>
          pageObservation(page, {
            open_graph_title: (onPageOf(page)?.openGraph.title ?? null) !== null,
            open_graph_description: (onPageOf(page)?.openGraph.description ?? null) !== null,
            open_graph_image: (onPageOf(page)?.openGraph.image ?? null) !== null,
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
        .filter((page) => firstSkippedLevel(onPageOf(page)) !== null)
        .map((page) =>
          pageObservation(page, {
            skipped_from_level: firstSkippedLevel(onPageOf(page))?.from ?? null,
            skipped_to_level: firstSkippedLevel(onPageOf(page))?.to ?? null,
            heading_levels_observed: onPageOf(page)?.headingLevels.length ?? 0,
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
        const verdict = softNotFoundVerdict(page, onPageOf(page)?.textMetrics ?? null, rawByUrl.get(page.url)?.projection.bodyExcerpt ?? null);
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
      // D6 and 1.7. Only alternates this crawl also fetched are classified —
      // the same posture the broken-link check takes, and for the same reason:
      // an international cluster routinely points at another domain, and a
      // target we never requested is not a target we can call broken.
      id: "hreflang_target_http_error",
      category: "indexability",
      population: "conditional_subset",
      tested: htmlPages.filter(
        (page) => hreflangTargetsOf(page).length > 0,
      ),
      observations: htmlPages.flatMap((page) => {
        const broken = hreflangTargetsOf(page).filter((alternate) => {
          const target = collectedBySubject.get(
            subjectUrlOf(alternate.href) ?? alternate.href,
          );
          return (
            target !== undefined &&
            target.finalStatus !== null &&
            target.finalStatus >= 400
          );
        });
        return broken.length === 0
          ? []
          : [
              pageObservation(page, {
                broken_hreflang_targets: broken.length,
                declared_hreflang_alternates: hreflangTargetsOf(page).length,
                // The URLs, not just the count: "two alternates are broken" is
                // not something a reader can act on.
                broken_hreflang_sample: broken
                  .slice(0, MAX_LISTED_SOURCE_PAGES)
                  .map((alternate) => `${alternate.lang}=${alternate.href}`)
                  .join(" "),
              }),
            ];
      }),
      limitation: "hreflang_targets_outside_this_crawl_were_not_classified",
    }),
    record({
      // 4.4. Published as a rendering-weight hint with no threshold, so this
      // never fails a page — but "no detector reads it yet" was false, and a
      // reader planning work can use the number.
      id: "content_to_code_ratio",
      category: "structure",
      population: "every_collected_page",
      tested: htmlPages,
      observations: htmlPages.flatMap((page) => {
        const facts = onPageOf(page);
        if (facts === null || facts.htmlBytes <= 0) return [];
        return [
          pageObservation(page, {
            visible_text_bytes: facts.visibleTextBytes,
            html_bytes: facts.htmlBytes,
            script_bytes: facts.scriptBytes,
            content_to_code_ratio: Number(
              (facts.visibleTextBytes / facts.htmlBytes).toFixed(4),
            ),
          }),
        ];
      }),
      limitation: "utf8_bytes_of_the_delivered_html_no_rendering_performed",
    }),
    record({
      // 6.5. Display only, and the parser now keeps external links — this was
      // listed as permanently unmeasurable because they used to be dropped.
      id: "external_link_follow_mix",
      category: "links",
      population: "conditional_subset",
      tested: htmlPages.filter(
        (page) => (onPageOf(page)?.externalLinks.total ?? 0) > 0,
      ),
      observations: htmlPages.flatMap((page) => {
        const links = onPageOf(page)?.externalLinks;
        if (links === undefined || links.total === 0) return [];
        return [
          pageObservation(page, {
            external_links: links.total,
            external_links_nofollow: links.nofollow,
            external_links_blank_without_noopener: links.blankWithoutNoopener,
          }),
        ];
      }),
      limitation: "external_links_counted_by_destination_not_by_anchor",
    }),
    record({
      // 8.6. The published threshold said "in a separate Lighthouse lab run",
      // which is not what happens — this reads the markup. Render-blocking is
      // a property of where a resource sits and what it declares, so it is
      // readable without running anything.
      id: "render_blocking_head_resource",
      category: "structure",
      population: "every_collected_page",
      tested: htmlPages,
      observations: htmlPages.flatMap((page) => {
        const blocking = onPageOf(page)?.renderBlocking;
        if (blocking === undefined) return [];
        const total = blocking.stylesheets + blocking.scripts;
        return total === 0
          ? []
          : [
              pageObservation(page, {
                render_blocking_stylesheets: blocking.stylesheets,
                render_blocking_scripts: blocking.scripts,
              }),
            ];
      }),
      limitation:
        "declared_in_the_head_markup_no_lab_run_and_no_network_timing",
    }),
    record({
      // 5.4. A static crawl has no viewport, so it cannot know the fold. What
      // it can know is which image comes first and how big the markup says it
      // is — and the first image is very often a 32-pixel logo mark, where
      // lazy loading is harmless. Firing on one of those is noise, so this
      // needs a declared size large enough to be the image the reader came
      // for. An image that declares no size at all is not judged: guessing
      // would put the logo back in.
      id: "first_image_lazy_loaded",
      category: "structure",
      population: "conditional_subset",
      tested: htmlPages.filter((page) => leadImageIsJudgeable(onPageOf(page))),
      observations: htmlPages
        .filter((page) => {
          const first = onPageOf(page)?.firstImage;
          return (
            leadImageIsJudgeable(onPageOf(page)) && first?.lazyLoaded === true
          );
        })
        .map((page) => {
          const first = onPageOf(page)?.firstImage;
          return pageObservation(page, {
            first_image_lazy_loaded: true,
            first_image_width: first?.width ?? null,
            first_image_height: first?.height ?? null,
            images_on_page: onPageOf(page)?.images.total ?? 0,
          });
        }),
      limitation:
        "first_image_in_document_order_with_a_declared_size_no_viewport_is_available",
    }),
    record({
      // 7.3. The required-property table is a judgement, so it is written down
      // where it can be argued with. It is deliberately short: only properties
      // Google's own rich-result documentation lists as required, and only for
      // types a marketing site actually ships. A type not in the table is not
      // judged rather than assumed complete.
      id: "json_ld_missing_required_property",
      category: "structured_data",
      population: "conditional_subset",
      tested: htmlPages.filter((page) => judgedJsonLdNodes(page).length > 0),
      observations: htmlPages.flatMap((page) => {
        const missing = judgedJsonLdNodes(page).flatMap((node) => {
          const required = REQUIRED_JSON_LD_PROPERTIES[node.type] ?? [];
          const absent = required.filter((key) => !node.keys.includes(key));
          return absent.length === 0
            ? []
            : [`${node.type}:${absent.join(",")}`];
        });
        return missing.length === 0
          ? []
          : [
              pageObservation(page, {
                missing_required_properties: missing
                  .slice(0, MAX_LISTED_SOURCE_PAGES)
                  .join(" "),
                judged_json_ld_types: judgedJsonLdNodes(page)
                  .map((node) => node.type)
                  .join(" "),
              }),
            ];
      }),
      limitation:
        "only_types_in_the_reviewed_required_property_table_are_judged",
    }),
    record({
      id: "page_near_duplicate_of_another_page",
      // Same category as the other whole-body measurements beside it; there is
      // no separate content category and inventing one moves every consumer.
      category: "structure",
      // Tested population: pages with enough distinctive text left to score.
      population: "conditional_subset",
      tested: htmlPages.filter(
        (page) => similarityByUrl.get(page.url)?.similarity !== null &&
          similarityByUrl.get(page.url) !== undefined,
      ),
      observations: htmlPages.flatMap((page) => {
        const measured = similarityByUrl.get(page.url);
        const score = measured?.similarity ?? null;
        if (score === null || score < NEAR_DUPLICATE_THRESHOLD) return [];
        return [
          pageObservation(page, {
            similarity_to_nearest_page: Math.round(score * 100) / 100,
            // Named, not just scored. "This page is 84% similar to something"
            // is not actionable without knowing what it is similar to.
            nearest_page: measured?.nearest ?? "",
            distinctive_blocks_compared: measured?.distinctiveShingles ?? 0,
          }),
        ];
      }),
      limitation: "similarity_measured_on_collected_paragraphs_after_chrome",
    }),
    record({
      id: "faq_schema_question_not_on_page",
      category: "structured_data",
      // Tested population: pages that declare a FAQPage with questions.
      population: "conditional_subset",
      tested: htmlPages.filter((page) => faqPromiseIsCheckable(page)),
      observations: htmlPages.flatMap((page) => {
        if (!faqPromiseIsCheckable(page)) return [];
        const visible = visibleTextIndexOf(page);
        const absent = (onPageOf(page)?.faqQuestions ?? []).filter(
          (question) => !visible.includes(normalizeForMatch(question)),
        );
        return absent.length === 0
          ? []
          : [
              pageObservation(page, {
                declared_faq_questions: (onPageOf(page)?.faqQuestions ?? [])
                  .length,
                questions_not_found_in_visible_text: absent.length,
                // Named, not just counted: "3 of 8 questions are missing" is
                // not something the reader can act on without knowing which.
                first_missing_question: absent[0] ?? "",
              }),
            ];
      }),
      limitation: "faq_match_against_collected_paragraphs_only",
    }),
    record({
      id: "json_ld_parse_error",
      category: "structured_data",
      tested: htmlPages,
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
    records: buildRecords(raw, pages, inspectedTarget?.subjectUrl ?? null),
    pages,
  };
}

export function buildSeoAuditPayload(raw: SeoAuditRaw): SeoAuditPayload {
  return createPublicToolResult(
    {
      tool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v11",
      scope: "discoverable_same_origin_static_html_audit",
      completedAt: raw.capturedAt,
    },
    buildSeoAuditReport(raw),
  );
}
