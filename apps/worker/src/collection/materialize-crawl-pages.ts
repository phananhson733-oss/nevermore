import { isDeepStrictEqual } from "node:util";
import {
  contentHash,
  PageSnapshotsRepository,
  SitePagesRepository,
  type CanonicalValue,
  type DbTx,
} from "@sf/db";
import {
  canonicalizeUrl,
  CRAWL_BUDGET,
  CRAWL_PROJECTION_LIMITS,
  SourceError,
  type Availability,
  type CrawlPageProjection,
  type SourceWindow,
} from "@sf/sources";
import { z } from "zod";

/**
 * Immutable, versioned projection copied from one crawl DataSnapshot into a
 * PageSnapshot. A shape change must use a new suffix: the content hash is part
 * of the persisted lineage and cannot be reinterpreted in place.
 */
export const CRAWL_PAGE_EXTRACT_SCHEMA_VERSION = "crawl.page-extract.v1";

const CRAWL_RAW_MISMATCH_MESSAGE =
  "Crawl raw payload does not match its collection outcome.";
const CRAWL_PAGE_EXTRACT_INVALID_MESSAGE =
  "Crawl PageSnapshot extract is invalid.";
const MAX_PROVIDER_USAGE_KEYS = 64;
const MAX_PROVIDER_USAGE_KEY_CHARS = 128;
const MAX_HOST_CHARS = 253;

const utcInstant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
const sourceWindowSchema = z
  .object({
    start: utcInstant.nullable(),
    end: utcInstant.nullable(),
  })
  .strict();
const boundedUrl = z.url().max(CRAWL_PROJECTION_LIMITS.maxUrlChars);
const nullableString = (maximum: number) => z.string().max(maximum).nullable();
const nonnegativeInteger = z.number().int().nonnegative();
const finiteNonnegative = z.number().finite().nonnegative();
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const crawlLinkSchema = z
  .object({
    targetSubjectUrl: boundedUrl,
    rel: nullableString(CRAWL_PROJECTION_LIMITS.maxRelChars),
    anchorText: nullableString(CRAWL_PROJECTION_LIMITS.maxAnchorTextChars),
  })
  .strict();

const crawlProjectionSchema = z
  .object({
    fetchUrl: boundedUrl,
    status: z.number().int().min(100).max(599).nullable(),
    finalStatus: z.number().int().min(100).max(599).nullable(),
    redirectChain: z
      .array(boundedUrl)
      .max(CRAWL_BUDGET.maxRedirects),
    canonicalTarget: boundedUrl.nullable(),
    robotsIndexable: z.boolean(),
    robotsDirectives: z
      .array(
        z.string().max(CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars),
      )
      .max(CRAWL_PROJECTION_LIMITS.maxRobotsDirectives),
    title: nullableString(CRAWL_PROJECTION_LIMITS.maxTitleChars),
    metaDescription: nullableString(
      CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars,
    ),
    h1: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxH1Chars))
      .max(CRAWL_PROJECTION_LIMITS.maxH1),
    headings: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxHeadingChars))
      .max(CRAWL_PROJECTION_LIMITS.maxHeadings),
    wordCount: nonnegativeInteger.nullable(),
    internalOutlinks: z
      .array(crawlLinkSchema)
      .max(CRAWL_PROJECTION_LIMITS.maxInternalOutlinks),
    jsonLd: z
      .object({
        types: z
          .array(
            z.string().max(CRAWL_PROJECTION_LIMITS.maxJsonLdTypeChars),
          )
          .max(CRAWL_PROJECTION_LIMITS.maxJsonLdTypes),
        errorCount: nonnegativeInteger.max(
          CRAWL_PROJECTION_LIMITS.maxJsonLdBlocks,
        ),
      })
      .strict(),
    sitemapMember: z.boolean(),
    bodyExcerpt: nullableString(CRAWL_PROJECTION_LIMITS.maxBodyExcerptChars),
    paragraphs: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxParagraphChars))
      .max(CRAWL_PROJECTION_LIMITS.maxParagraphs),
    responseMs: finiteNonnegative.nullable(),
    contentType: nullableString(CRAWL_PROJECTION_LIMITS.maxContentTypeChars),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== null &&
      value.finalStatus !== null &&
      value.robotsIndexable ===
        !value.robotsDirectives.some(
          (directive) => directive === "noindex" || directive === "none",
        ) &&
      (value.redirectChain.length === 0
        ? value.status === value.finalStatus
        : redirectStatuses.has(value.status)),
  );

const crawlPageSchema = z
  .object({
    subjectUrl: boundedUrl,
    depth: nonnegativeInteger.max(CRAWL_BUDGET.maxDepth),
    projection: crawlProjectionSchema,
  })
  .strict();

const crawlPageExtractSchema = z
  .object({
    schemaVersion: z.literal(CRAWL_PAGE_EXTRACT_SCHEMA_VERSION),
    subjectUrl: boundedUrl,
    depth: nonnegativeInteger.max(CRAWL_BUDGET.maxDepth),
    projection: crawlProjectionSchema,
  })
  .strict();

const robotsRule = z
  .string()
  .max(CRAWL_PROJECTION_LIMITS.maxRobotsRuleChars);
const robotsSchema = z
  .object({
    fetched: z.boolean(),
    groups: z
      .array(
        z
          .object({
            userAgent: z
              .string()
              .max(CRAWL_PROJECTION_LIMITS.maxUserAgentChars),
            disallow: z
              .array(robotsRule)
              .max(CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup),
            allow: z
              .array(robotsRule)
              .max(CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup),
          })
          .strict(),
      )
      .max(CRAWL_PROJECTION_LIMITS.maxRobotsGroups),
    sitemaps: z
      .array(boundedUrl)
      .max(CRAWL_PROJECTION_LIMITS.maxSitemaps),
  })
  .strict();
const sitemapSchema = z
  .object({
    fetched: z.boolean(),
    urlCount: nonnegativeInteger.max(CRAWL_PROJECTION_LIMITS.maxSitemapUrls),
    subjectUrls: z
      .array(boundedUrl)
      .max(CRAWL_PROJECTION_LIMITS.maxSitemapUrls),
  })
  .strict()
  .refine((value) => value.urlCount === value.subjectUrls.length);
const providerUsageSchema = z
  .record(
    z.string().min(1).max(MAX_PROVIDER_USAGE_KEY_CHARS),
    finiteNonnegative,
  )
  .refine((value) => Object.keys(value).length <= MAX_PROVIDER_USAGE_KEYS);

const crawlRawSchema = z
  .object({
    origin: boundedUrl,
    host: z.string().min(1).max(MAX_HOST_CHARS),
    pages: z.array(crawlPageSchema).max(CRAWL_BUDGET.maxUrls),
    robots: robotsSchema,
    sitemap: sitemapSchema,
    availability: z.enum(["available", "partial", "unavailable"]),
    capturedAt: utcInstant,
    sourceWindow: sourceWindowSchema,
    stopReason: z.string().nullable(),
    providerUsage: providerUsageSchema,
    limitation: z.string(),
  })
  .strict();

type ParsedCrawlPage = z.infer<typeof crawlPageSchema>;

export interface CrawlPageMaterializationOutcome {
  readonly availability: Availability;
  readonly capturedAt: string;
  readonly sourceWindow: SourceWindow;
  readonly rowCount: number;
  readonly stopReason: string | null;
  readonly providerUsage: Record<string, number>;
  readonly limitation: string;
  readonly raw: unknown;
}

/** Trusted canonical Site identity loaded from the collection run's DB scope. */
export interface CrawlSiteIdentity {
  readonly origin: string;
  readonly host: string;
}

export interface CrawlPageExtract extends Record<string, unknown> {
  readonly schemaVersion: typeof CRAWL_PAGE_EXTRACT_SCHEMA_VERSION;
  /** Aggregation identity shared with crawl.page.v1 Observations. */
  readonly subjectUrl: string;
  readonly depth: number;
  readonly projection: CrawlPageProjection;
}

export interface PreparedCrawlPage {
  /** Exact initial request identity; redirects remain facts in the extract. */
  readonly normalizedUrl: string;
  readonly contentHash: string;
  readonly extract: CrawlPageExtract;
}

function invalidCrawlRaw(): never {
  throw new SourceError("INVALID_RESPONSE", CRAWL_RAW_MISMATCH_MESSAGE);
}

function invalidCrawlPageExtract(): never {
  throw new SourceError(
    "INVALID_RESPONSE",
    CRAWL_PAGE_EXTRACT_INVALID_MESSAGE,
  );
}

function originIdentity(value: string): {
  readonly origin: string;
  readonly hostname: string;
} | null {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.origin !== value
    ) {
      return null;
    }
    return { origin: parsed.origin, hostname: parsed.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

function canonicalPageIdentity(
  page: ParsedCrawlPage,
  expectedOrigin: string,
): boolean {
  const pair = canonicalizeUrl(page.projection.fetchUrl);
  if (
    !pair ||
    pair.fetchUrl !== page.projection.fetchUrl ||
    pair.subjectUrl !== page.subjectUrl
  ) {
    return false;
  }
  try {
    if (new URL(pair.fetchUrl).origin !== expectedOrigin) return false;
  } catch {
    return false;
  }
  const canonicalTarget = page.projection.canonicalTarget;
  if (canonicalTarget !== null) {
    const target = canonicalizeUrl(canonicalTarget);
    if (!target || target.fetchUrl !== canonicalTarget) return false;
    // A canonical tag is an observed document fact, not transport authority.
    // Cross-origin canonicals are legitimate for syndication and migrations;
    // the crawl frontier independently refuses to enqueue another origin.
  }
  const redirectChain = page.projection.redirectChain;
  if (
    !redirectChain.every((url) => {
      const redirect = canonicalizeUrl(url);
      if (!redirect || redirect.fetchUrl !== url) return false;
      try {
        return new URL(redirect.fetchUrl).origin === expectedOrigin;
      } catch {
        return false;
      }
    })
  ) {
    return false;
  }
  return page.projection.internalOutlinks.every((link) => {
    const target = canonicalizeUrl(link.targetSubjectUrl);
    if (!target || target.subjectUrl !== link.targetSubjectUrl) return false;
    try {
      return new URL(target.subjectUrl).origin === expectedOrigin;
    } catch {
      return false;
    }
  });
}

/**
 * Strict runtime reader for the only PageSnapshot extract version understood by
 * the current worker. Historical/null/extended shapes are deliberately refused:
 * immutable content-addressed rows may never be silently reinterpreted.
 */
export function parseCrawlPageExtract(value: unknown): CrawlPageExtract {
  const parsed = crawlPageExtractSchema.safeParse(value);
  if (!parsed.success) invalidCrawlPageExtract();

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(parsed.data.projection.fetchUrl).origin;
  } catch {
    invalidCrawlPageExtract();
  }
  if (!canonicalPageIdentity(parsed.data, expectedOrigin)) {
    invalidCrawlPageExtract();
  }
  return parsed.data;
}

function parseAlignedCrawlRaw(
  outcome: CrawlPageMaterializationOutcome,
  expectedSite: CrawlSiteIdentity,
): z.infer<typeof crawlRawSchema> {
  const parsed = crawlRawSchema.safeParse(outcome.raw);
  if (!parsed.success) invalidCrawlRaw();
  const raw = parsed.data;
  const origin = originIdentity(raw.origin);
  const expectedOrigin = originIdentity(expectedSite.origin);
  if (
    !origin ||
    !expectedOrigin ||
    origin.hostname !== raw.host ||
    expectedOrigin.hostname !== expectedSite.host ||
    raw.origin !== expectedSite.origin ||
    raw.host !== expectedSite.host ||
    raw.availability !== outcome.availability ||
    raw.capturedAt !== outcome.capturedAt ||
    !isDeepStrictEqual(raw.sourceWindow, outcome.sourceWindow) ||
    raw.pages.length !== outcome.rowCount ||
    raw.stopReason !== outcome.stopReason ||
    !isDeepStrictEqual(raw.providerUsage, outcome.providerUsage) ||
    raw.limitation !== outcome.limitation
  ) {
    invalidCrawlRaw();
  }
  if (raw.availability === "unavailable" && raw.pages.length > 0) {
    invalidCrawlRaw();
  }

  const seenSitemapSubjects = new Set<string>();
  for (const subjectUrl of raw.sitemap.subjectUrls) {
    const subject = canonicalizeUrl(subjectUrl);
    let sameOrigin = false;
    try {
      sameOrigin = new URL(subjectUrl).origin === origin.origin;
    } catch {
      // The schema already validated URL syntax; keep this branch fail closed.
    }
    if (
      !subject ||
      subject.subjectUrl !== subjectUrl ||
      !sameOrigin ||
      seenSitemapSubjects.has(subjectUrl)
    ) {
      invalidCrawlRaw();
    }
    seenSitemapSubjects.add(subjectUrl);
  }

  const seenFetchUrls = new Set<string>();
  for (const page of raw.pages) {
    const fetchUrl = page.projection.fetchUrl;
    if (
      seenFetchUrls.has(fetchUrl) ||
      !canonicalPageIdentity(page, origin.origin)
    ) {
      invalidCrawlRaw();
    }
    seenFetchUrls.add(fetchUrl);
  }
  if (
    typeof raw.providerUsage["pagesCollected"] === "number" &&
    raw.providerUsage["pagesCollected"] !== raw.pages.length
  ) {
    invalidCrawlRaw();
  }
  return raw;
}

function pageExtract(page: ParsedCrawlPage): CrawlPageExtract {
  return {
    schemaVersion: CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
    subjectUrl: page.subjectUrl,
    depth: page.depth,
    projection: page.projection,
  };
}

/**
 * Validate the current crawl method's `crawl.site_graph.v1` dataset payload
 * before any blob or SQL write and prepare deterministic content addresses.
 * Other providers deliberately bypass this interpretation and therefore cannot
 * create SitePage/PageSnapshot rows.
 */
export function prepareCrawlPageMaterialization(input: {
  readonly provider: string;
  readonly outcome: CrawlPageMaterializationOutcome;
  readonly expectedSite?: CrawlSiteIdentity;
}): readonly PreparedCrawlPage[] {
  if (input.provider !== "crawl") return [];
  if (!input.expectedSite) invalidCrawlRaw();
  const raw = parseAlignedCrawlRaw(input.outcome, input.expectedSite);
  return raw.pages
    .map((page): PreparedCrawlPage => {
      const extract = pageExtract(page);
      const normalizedUrl = page.projection.fetchUrl;
      return {
        normalizedUrl,
        contentHash: contentHash(extract as CanonicalValue),
        extract,
      };
    })
    .sort((left, right) =>
      left.normalizedUrl < right.normalizedUrl
        ? -1
        : left.normalizedUrl > right.normalizedUrl
          ? 1
          : 0,
    );
}

/** Persist prepared pages through transaction-bound repositories, sequentially. */
export async function materializePreparedCrawlPages(
  tx: DbTx,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly siteId: string;
    readonly dataSnapshotId: string;
    readonly capturedAt: string;
    readonly pages: readonly PreparedCrawlPage[];
  },
): Promise<void> {
  if (input.pages.length === 0) return;
  const scope = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  };
  const sitePages = new SitePagesRepository(tx);
  const pageSnapshots = new PageSnapshotsRepository(tx);
  for (const prepared of input.pages) {
    const sitePage = await sitePages.upsertNormalizedUrl({
      ...scope,
      siteId: input.siteId,
      normalizedUrl: prepared.normalizedUrl,
      templateKey: null,
    });
    await pageSnapshots.create({
      ...scope,
      sitePageId: sitePage.id,
      dataSnapshotId: input.dataSnapshotId,
      contentHash: prepared.contentHash,
      extract: prepared.extract,
      capturedAt: input.capturedAt,
    });
  }
}
