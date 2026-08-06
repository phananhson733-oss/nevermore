import {
  SitePagesRepository,
  type DbTx,
  type ObservationInsert,
  type ProjectScope,
} from "@sf/db";
import { canonicalizeUrl, SourceError } from "@sf/sources";

const CRAWL_PAGE_METRIC = "crawl.page.v1";
const ANALYTICS_PAGE_METRIC = {
  gsc: "gsc.page.v1",
  ga4: "ga4.landing.v1",
} as const;
const DATAFORSEO_BACKLINK_PAGE_METRICS = new Set([
  "dataforseo.backlink.v1",
  "dataforseo.backlink_page.v1",
]);

/**
 * Derive the complete exact-fetch set represented by canonical_url.v1.
 * A non-root subject has exactly two possible fetch identities; the slash is
 * inserted into the pathname before any query. Root has only one variant.
 */
export function exactCandidatesForCanonicalSubject(
  subjectRef: string,
  siteOrigin: string,
): readonly string[] | null {
  const canonical = canonicalizeUrl(subjectRef);
  if (
    canonical === null ||
    canonical.subjectUrl !== subjectRef ||
    canonical.fetchUrl !== subjectRef
  ) {
    return null;
  }

  let subject: URL;
  let expectedOrigin: string;
  try {
    subject = new URL(subjectRef);
    expectedOrigin = new URL(siteOrigin).origin;
  } catch {
    return null;
  }
  if (subject.origin !== expectedOrigin) return null;
  if (subject.pathname === "/") return [subjectRef];

  const slashUrl = new URL(subjectRef);
  slashUrl.pathname = `${slashUrl.pathname}/`;
  const slash = canonicalizeUrl(slashUrl.href);
  if (
    slash === null ||
    slash.subjectUrl !== subjectRef ||
    slash.fetchUrl === subjectRef
  ) {
    return null;
  }
  return [subjectRef, slash.fetchUrl];
}

function crawlFetchUrl(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const fetchUrl = (value as Record<string, unknown>)["fetchUrl"];
  return typeof fetchUrl === "string" ? fetchUrl : null;
}

function invalidCrawlObservation(): never {
  throw new SourceError(
    "INVALID_RESPONSE",
    "Crawl page observation does not match its exact materialized page.",
  );
}

export interface ResolveObservationSitePageLineageInput {
  readonly tx: DbTx;
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly siteOrigin: string;
  readonly provider: string;
  readonly observations: readonly ObservationInsert[];
  /** Exact fetchUrl -> SitePage id produced in this same transaction. */
  readonly crawlExactSitePageIds: ReadonlyMap<string, string>;
}

/**
 * Attach only proven URL lineage before the append-only Observation insert.
 * `subjectRef` remains the canonical aggregation key. An ambiguous analytics
 * subject is persisted with sitePageId=null instead of being guessed at read
 * time, while Crawl page observations fail the transaction if exact proof is
 * missing.
 */
export async function resolveObservationSitePageLineage(
  input: ResolveObservationSitePageLineageInput,
): Promise<readonly ObservationInsert[]> {
  if (input.provider === "crawl") {
    return input.observations.map((observation) => {
      if (observation.metricKey !== CRAWL_PAGE_METRIC) {
        return { ...observation, sitePageId: null };
      }
      const fetchUrl = crawlFetchUrl(observation.valueJson);
      const canonical = fetchUrl === null ? null : canonicalizeUrl(fetchUrl);
      let sameOrigin = false;
      try {
        sameOrigin =
          fetchUrl !== null &&
          new URL(fetchUrl).origin === new URL(input.siteOrigin).origin;
      } catch {
        // Fail closed below; adapter and raw validation should make this rare.
      }
      const sitePageId =
        fetchUrl === null
          ? undefined
          : input.crawlExactSitePageIds.get(fetchUrl);
      if (
        observation.subjectType !== "url" ||
        canonical === null ||
        canonical.fetchUrl !== fetchUrl ||
        canonical.subjectUrl !== observation.subjectRef ||
        !sameOrigin ||
        sitePageId === undefined
      ) {
        invalidCrawlObservation();
      }
      return { ...observation, sitePageId };
    });
  }

  const pageMetrics =
    input.provider === "gsc" || input.provider === "ga4"
      ? new Set([ANALYTICS_PAGE_METRIC[input.provider]])
      : input.provider === "dataforseo"
        ? DATAFORSEO_BACKLINK_PAGE_METRICS
        : null;
  if (pageMetrics === null) {
    return input.observations.map((observation) => ({
      ...observation,
      sitePageId: null,
    }));
  }

  const candidatesBySubject = new Map<string, readonly string[]>();
  for (const observation of input.observations) {
    if (
      !pageMetrics.has(observation.metricKey) ||
      observation.subjectType !== "url"
    ) {
      continue;
    }
    const candidates = exactCandidatesForCanonicalSubject(
      observation.subjectRef,
      input.siteOrigin,
    );
    if (candidates !== null) {
      candidatesBySubject.set(observation.subjectRef, candidates);
    }
  }

  const subjects = [...candidatesBySubject.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([subjectRef, exactCandidates]) => ({
      subjectRef,
      exactCandidates,
    }));
  const resolved =
    subjects.length === 0
      ? new Map<string, null>()
      : await new SitePagesRepository(
          input.tx,
        ).resolveUnambiguousCanonicalSubjects(
          input.scope,
          input.siteId,
          subjects,
        );

  return input.observations.map((observation) => {
    if (
      !pageMetrics.has(observation.metricKey) ||
      observation.subjectType !== "url" ||
      !candidatesBySubject.has(observation.subjectRef)
    ) {
      return { ...observation, sitePageId: null };
    }
    return {
      ...observation,
      sitePageId: resolved.get(observation.subjectRef)?.id ?? null,
    };
  });
}
