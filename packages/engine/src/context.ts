import type {
  CrawlPageProjection,
  CrawlRobotsProjection,
  CrawlSitemapProjection,
  CsvKeywordProjection,
  Ga4LandingProjection,
  GscPageProjection,
} from "@sf/sources";
import {
  METRIC_CRAWL_PAGE,
  METRIC_CRAWL_ROBOTS,
  METRIC_CRAWL_SITEMAP,
  METRIC_CSV_KEYWORD_GAP,
  METRIC_GA4_LANDING,
  METRIC_GSC_PAGE,
  subjectUrlOf,
} from "@sf/sources";
import {
  parseGovernanceProjectionV1,
  type GovernanceCompetitorAnalysisScope,
  type GovernanceCompetitorFactV1,
  type GovernanceKeywordClusterV1,
  type GovernanceKeywordFactV1,
  type GovernanceProjectionV1,
} from "./governance.ts";
import { isEnglishProject, type EngineIcp } from "./icp.ts";
import type { Dataset } from "./rule.ts";
import {
  isCommercialUrl,
  isPriorityUrl,
  priorityUrlSet,
} from "./util/page-role.ts";

/**
 * The frozen diagnostic input a rule reads (spec §8.1, §8.3). Built once per run
 * from the loaded snapshot observations; rules never touch the DB. All data is
 * indexed by canonical subjectUrl (crawl/gsc/ga4) or clusterKey (the keyword-gap
 * slot, supplied by CSV or DataForSEO). Exact crawl fetch variants remain
 * accessible alongside deterministic subject-level groups. Derived facts
 * (internal inlink counts) are computed here — pipeline step 4.
 */

export type DatasetAvailability = "available" | "partial" | "unavailable";

/** Immutable lineage copied from one persisted normalized observation. */
export interface ObservationLineageView {
  readonly observationId: string;
  readonly snapshotId: string;
  readonly sitePageId: string | null;
  readonly sitePageUrl: string | null;
  readonly pageSnapshotId: string | null;
}

/** A flat observation as loaded from `normalized_observations` (worker → engine). */
export interface ObservationView extends ObservationLineageView {
  readonly metricKey: string;
  readonly subjectType: string;
  readonly subjectRef: string;
  readonly provider: string;
  readonly availability: string;
  readonly valueJson: unknown;
  readonly observedAt: string;
}

/** Projection and lineage are retained together; rules never re-join by URL. */
export interface UrlObservationProjection<T> extends ObservationLineageView {
  readonly subjectRef: string;
  readonly projection: T;
}

export interface CoverageInput {
  readonly crawl: DatasetAvailability;
  readonly gsc: DatasetAvailability;
  readonly ga4: DatasetAvailability;
  readonly csv: DatasetAvailability;
}

export interface DiagnosticContextInput {
  readonly icp: EngineIcp;
  readonly deliveryLocale: string;
  readonly observations: readonly ObservationView[];
  readonly coverage: CoverageInput;
  /**
   * Optional frozen Keyword/Competitor Library facts. Historical manifests omit
   * this field and therefore retain the exact pre-governance replay behavior.
   */
  readonly governance?: GovernanceProjectionV1;
  /** Frozen snapshot availability keyed by its actual source provider. */
  readonly availabilityByProvider?: Readonly<
    Record<string, DatasetAvailability>
  >;
  /** capturedAt per provider, for evidence timestamps. */
  readonly capturedAt: Readonly<Record<string, string>>;
}

export type IndexablePageSubject = readonly [
  subjectUrl: string,
  variants: readonly CrawlPageProjection[],
];

type KeywordGapProvider = "csv" | "dataforseo";

interface KeywordProjectionRow {
  readonly projection: CsvKeywordProjection;
  readonly provider: KeywordGapProvider;
  readonly observationId: string;
}

export interface KeywordGapContribution {
  readonly provider: KeywordGapProvider;
  readonly keywords: readonly CsvKeywordProjection[];
}

const KEYWORD_CONTRIBUTION_PROVIDER_ORDER = [
  "dataforseo",
  "csv",
] as const satisfies readonly KeywordGapProvider[];
const EMPTY_KEYWORD_GAP_CONTRIBUTIONS = Object.freeze(
  [] as KeywordGapContribution[],
);
const EMPTY_KEYWORD_PROJECTIONS = Object.freeze(
  [] as CsvKeywordProjection[],
);
const EMPTY_APPROVED_COMPETITORS = Object.freeze(
  [] as GovernanceCompetitorFactV1[],
);

export class DiagnosticContext {
  readonly icp: EngineIcp;
  readonly deliveryLocale: string;
  readonly coverage: CoverageInput;
  readonly capturedAt: Readonly<Record<string, string>>;
  readonly governance: GovernanceProjectionV1 | null;
  /** Stable ASCII-ordered lookup over the frozen Keyword Library clusters. */
  readonly governedKeywordClusters: ReadonlyMap<
    string,
    GovernanceKeywordClusterV1
  >;
  /**
   * Approved Competitor Library facts only, in canonical domain/entity order.
   * These are contextual evidence; they never become finding targets.
   */
  readonly approvedCompetitorEvidence: readonly GovernanceCompetitorFactV1[];
  private readonly availabilityByProvider: Readonly<
    Record<string, DatasetAvailability>
  >;

  /** Stable projection lookup; never use it to infer missing subject-level facts. */
  readonly pages: ReadonlyMap<string, CrawlPageProjection>;
  /** Every exact crawl response, grouped by subjectUrl and ordered by fetchUrl. */
  readonly pageVariants: ReadonlyMap<string, readonly CrawlPageProjection[]>;
  /** Exact crawl projections with their persisted observation/SitePage lineage. */
  readonly crawlPageObservations: ReadonlyMap<
    string,
    readonly UrlObservationProjection<CrawlPageProjection>[]
  >;
  readonly robots: CrawlRobotsProjection | null;
  readonly sitemap: CrawlSitemapProjection | null;
  readonly gsc: ReadonlyMap<string, GscPageProjection>;
  readonly ga4: ReadonlyMap<string, Ga4LandingProjection>;
  /** Unique subject-level rows retain persisted analytics lineage. */
  readonly gscObservations: ReadonlyMap<
    string,
    UrlObservationProjection<GscPageProjection>
  >;
  readonly ga4Observations: ReadonlyMap<
    string,
    UrlObservationProjection<Ga4LandingProjection>
  >;
  /** All rows remain available for replay/audit, including ambiguous duplicates. */
  readonly gscObservationGroups: ReadonlyMap<
    string,
    readonly UrlObservationProjection<GscPageProjection>[]
  >;
  readonly ga4ObservationGroups: ReadonlyMap<
    string,
    readonly UrlObservationProjection<Ga4LandingProjection>[]
  >;
  readonly csvClusters: ReadonlyMap<string, readonly CsvKeywordProjection[]>;
  /** Actual provider(s) that supplied any observation for each cluster. */
  readonly keywordGapProviders: ReadonlyMap<string, ReadonlySet<"csv" | "dataforseo">>;
  /**
   * Provider ownership of the rows retained in the de-duplicated aggregate.
   * A losing overlap remains visible in `keywordGapProviders`, but cannot claim
   * another provider's retained count or volume through this projection.
   */
  private readonly keywordGapContributionsByCluster: ReadonlyMap<
    string,
    readonly KeywordGapContribution[]
  >;
  private readonly governedKeywordGapKeywordsByCluster: ReadonlyMap<
    string,
    readonly CsvKeywordProjection[]
  >;
  /** Derived internal inlink counts per subjectUrl (pipeline step 4). */
  readonly internalInlinks: ReadonlyMap<string, number>;

  private readonly prioritySet: ReadonlySet<string>;
  private readonly crawlObservationsByFetchUrl: ReadonlyMap<
    string,
    readonly UrlObservationProjection<CrawlPageProjection>[]
  >;
  private readonly ambiguousGscSubjects: ReadonlySet<string>;
  private readonly ambiguousGa4Subjects: ReadonlySet<string>;

  private constructor(input: DiagnosticContextInput) {
    this.icp = input.icp;
    this.deliveryLocale = input.deliveryLocale;
    this.coverage = input.coverage;
    this.capturedAt = input.capturedAt;
    this.governance =
      input.governance === undefined
        ? null
        : parseGovernanceProjectionV1(input.governance);
    const governedKeywordClusters = new Map<
      string,
      GovernanceKeywordClusterV1
    >();
    for (const cluster of this.governance?.keywordClusters ?? []) {
      governedKeywordClusters.set(cluster.clusterKey, cluster);
    }
    this.governedKeywordClusters = governedKeywordClusters;
    this.approvedCompetitorEvidence =
      this.governance === null
        ? EMPTY_APPROVED_COMPETITORS
        : Object.freeze(
            this.governance.competitors.filter(
              (competitor) => competitor.reviewStatus === "approved",
            ),
          );
    this.availabilityByProvider = Object.freeze({
      ...input.availabilityByProvider,
    });
    this.prioritySet = priorityUrlSet(input.icp.priorityUrls);

    const pageGroups = new Map<
      string,
      UrlObservationProjection<CrawlPageProjection>[]
    >();
    const gscGroups = new Map<
      string,
      UrlObservationProjection<GscPageProjection>[]
    >();
    const ga4Groups = new Map<
      string,
      UrlObservationProjection<Ga4LandingProjection>[]
    >();
    const keywordRows = new Map<
      string,
      Map<string, KeywordProjectionRow>
    >();
    const keywordGapProviders = new Map<
      string,
      Set<KeywordGapProvider>
    >();
    let robots: CrawlRobotsProjection | null = null;
    let sitemap: CrawlSitemapProjection | null = null;

    for (const obs of input.observations) {
      switch (obs.metricKey) {
        case METRIC_CRAWL_PAGE:
          if (obs.valueJson) {
            const variants = pageGroups.get(obs.subjectRef) ?? [];
            variants.push(
              observationProjection(
                obs,
                obs.valueJson as CrawlPageProjection,
              ),
            );
            pageGroups.set(obs.subjectRef, variants);
          }
          break;
        case METRIC_CRAWL_ROBOTS:
          if (obs.valueJson) robots = obs.valueJson as CrawlRobotsProjection;
          break;
        case METRIC_CRAWL_SITEMAP:
          if (obs.valueJson) sitemap = obs.valueJson as CrawlSitemapProjection;
          break;
        case METRIC_GSC_PAGE:
          if (obs.valueJson) {
            const rows = gscGroups.get(obs.subjectRef) ?? [];
            rows.push(
              observationProjection(obs, obs.valueJson as GscPageProjection),
            );
            gscGroups.set(obs.subjectRef, rows);
          }
          break;
        case METRIC_GA4_LANDING:
          if (obs.valueJson) {
            const rows = ga4Groups.get(obs.subjectRef) ?? [];
            rows.push(
              observationProjection(
                obs,
                obs.valueJson as Ga4LandingProjection,
              ),
            );
            ga4Groups.set(obs.subjectRef, rows);
          }
          break;
        case METRIC_CSV_KEYWORD_GAP: {
          if (!obs.valueJson) break;
          const provider: KeywordGapProvider =
            obs.provider === "dataforseo" ? "dataforseo" : "csv";
          const projection = obs.valueJson as CsvKeywordProjection;
          const providers = keywordGapProviders.get(obs.subjectRef) ?? new Set();
          providers.add(provider);
          keywordGapProviders.set(obs.subjectRef, providers);

          // CSV and DataForSEO can contribute to the same frozen keyword-gap
          // corpus. One canonical keyword in one market/language scope is one
          // unit of demand: retain the higher-grade vendor projection only for
          // a true semantic overlap, independent of observation load order.
          // The provider set above intentionally retains both sources for
          // frozen provenance.
          const rows = keywordRows.get(obs.subjectRef) ?? new Map();
          const identity = canonicalKeywordIdentity(projection);
          const existing = rows.get(identity);
          const candidate: KeywordProjectionRow = Object.freeze({
            projection,
            provider,
            observationId: obs.observationId,
          });
          if (existing === undefined || prefersKeywordRow(candidate, existing)) {
            rows.set(identity, candidate);
          }
          keywordRows.set(obs.subjectRef, rows);
          break;
        }
        default:
          break;
      }
    }

    const pages = new Map<string, CrawlPageProjection>();
    const pageVariants = new Map<
      string,
      readonly CrawlPageProjection[]
    >();
    const crawlPageObservations = new Map<
      string,
      readonly UrlObservationProjection<CrawlPageProjection>[]
    >();
    const crawlObservationsByFetchUrl = new Map<
      string,
      UrlObservationProjection<CrawlPageProjection>[]
    >();
    for (const subjectRef of [...pageGroups.keys()].sort(compareAscii)) {
      const observations = Object.freeze(
        [...(pageGroups.get(subjectRef) ?? [])].sort(
          (left, right) =>
            compareAscii(
              left.projection.fetchUrl,
              right.projection.fetchUrl,
            ) || compareAscii(left.observationId, right.observationId),
        ),
      );
      const variants = Object.freeze(
        observations.map((observation) => observation.projection),
      );
      const representative = variants[0];
      if (!representative) continue;
      pages.set(subjectRef, representative);
      pageVariants.set(subjectRef, variants);
      crawlPageObservations.set(subjectRef, observations);
      for (const observation of observations) {
        const fetchUrl = observation.projection.fetchUrl;
        const exact = crawlObservationsByFetchUrl.get(fetchUrl) ?? [];
        exact.push(observation);
        crawlObservationsByFetchUrl.set(fetchUrl, exact);
      }
    }

    const gsc = new Map<string, GscPageProjection>();
    const ga4 = new Map<string, Ga4LandingProjection>();
    const gscObservations = new Map<
      string,
      UrlObservationProjection<GscPageProjection>
    >();
    const ga4Observations = new Map<
      string,
      UrlObservationProjection<Ga4LandingProjection>
    >();
    const ambiguousGscSubjects = new Set<string>();
    const ambiguousGa4Subjects = new Set<string>();
    const gscObservationGroups = orderUrlObservationGroups(gscGroups);
    const ga4ObservationGroups = orderUrlObservationGroups(ga4Groups);
    materializeUrlObservationGroups(
      gscObservationGroups,
      gsc,
      gscObservations,
      ambiguousGscSubjects,
    );
    materializeUrlObservationGroups(
      ga4ObservationGroups,
      ga4,
      ga4Observations,
      ambiguousGa4Subjects,
    );

    const csv = new Map<string, readonly CsvKeywordProjection[]>();
    const keywordGapContributionsByCluster = new Map<
      string,
      readonly KeywordGapContribution[]
    >();
    const keywordProjectionRowsByCluster = new Map<
      string,
      readonly KeywordProjectionRow[]
    >();
    for (const subjectRef of [...keywordRows.keys()].sort(compareAscii)) {
      const rows = keywordRows.get(subjectRef);
      if (!rows) continue;
      const selectedRows = [...rows.entries()].sort(([left], [right]) =>
        compareAscii(left, right),
      );
      keywordProjectionRowsByCluster.set(
        subjectRef,
        Object.freeze(selectedRows.map(([, row]) => row)),
      );
      csv.set(
        subjectRef,
        Object.freeze(
          selectedRows.map(([, row]) => row.projection),
        ),
      );
      const byProvider = new Map<
        KeywordGapProvider,
        CsvKeywordProjection[]
      >();
      for (const [, row] of selectedRows) {
        const providerRows = byProvider.get(row.provider) ?? [];
        providerRows.push(row.projection);
        byProvider.set(row.provider, providerRows);
      }
      keywordGapContributionsByCluster.set(
        subjectRef,
        Object.freeze(
          KEYWORD_CONTRIBUTION_PROVIDER_ORDER.flatMap((provider) => {
            const providerRows = byProvider.get(provider);
            return providerRows && providerRows.length > 0
              ? [
                  Object.freeze({
                    provider,
                    keywords: Object.freeze(providerRows),
                  }),
                ]
              : [];
          }),
        ),
      );
    }
    const governedKeywordGapKeywordsByCluster = new Map<
      string,
      readonly CsvKeywordProjection[]
    >();
    for (const [
      clusterKey,
      governedCluster,
    ] of governedKeywordClusters) {
      const eligibleFacts = governedCluster.keywords.filter(
        (keyword) =>
          keyword.status === "approved" &&
          keyword.mappingReviewState === "confirmed" &&
          keyword.clusterKey === governedCluster.clusterKey,
      );
      if (eligibleFacts.length === 0) {
        governedKeywordGapKeywordsByCluster.set(
          clusterKey,
          EMPTY_KEYWORD_PROJECTIONS,
        );
        continue;
      }
      const canonicalIdentities = new Set<string>();
      for (const keyword of eligibleFacts) {
        canonicalIdentities.add(governanceKeywordIdentity(keyword));
      }
      const matched = (
        keywordProjectionRowsByCluster.get(clusterKey) ?? []
      ).filter((row) =>
        canonicalIdentities.has(
          observedGovernanceKeywordIdentity(row.projection),
        ),
      );
      governedKeywordGapKeywordsByCluster.set(
        clusterKey,
        Object.freeze(matched.map((row) => row.projection)),
      );
    }

    // Derived: union every exact source variant's internal outlinks, while
    // counting one aggregation source subject at most once per target.
    const inlinks = new Map<string, number>();
    for (const variants of pageVariants.values()) {
      const targetSubjects = new Set<string>();
      for (const page of variants) {
        for (const link of page.internalOutlinks) {
          targetSubjects.add(link.targetSubjectUrl);
        }
      }
      for (const target of [...targetSubjects].sort(compareAscii)) {
        inlinks.set(target, (inlinks.get(target) ?? 0) + 1);
      }
    }

    this.pages = pages;
    this.pageVariants = pageVariants;
    this.crawlPageObservations = crawlPageObservations;
    this.crawlObservationsByFetchUrl = crawlObservationsByFetchUrl;
    this.robots = robots;
    this.sitemap = sitemap;
    this.gsc = gsc;
    this.ga4 = ga4;
    this.gscObservations = gscObservations;
    this.ga4Observations = ga4Observations;
    this.gscObservationGroups = gscObservationGroups;
    this.ga4ObservationGroups = ga4ObservationGroups;
    this.ambiguousGscSubjects = ambiguousGscSubjects;
    this.ambiguousGa4Subjects = ambiguousGa4Subjects;
    this.csvClusters = csv;
    this.keywordGapProviders = keywordGapProviders;
    this.keywordGapContributionsByCluster =
      keywordGapContributionsByCluster;
    this.governedKeywordGapKeywordsByCluster =
      governedKeywordGapKeywordsByCluster;
    this.internalInlinks = inlinks;
  }

  static build(input: DiagnosticContextInput): DiagnosticContext {
    return new DiagnosticContext(input);
  }

  // --- helpers ------------------------------------------------------------

  isEnglish(): boolean {
    return isEnglishProject(this.icp);
  }

  datasetAvailability(dataset: Dataset): DatasetAvailability {
    if (dataset === "icp") return "available";
    return this.coverage[dataset];
  }

  /**
   * The default rule gate requires a complete provider snapshot. Partial crawl is
   * the exception because HTTP/canonical rules can still use reached pages; rules
   * that need a complete graph must reject it explicitly.
   */
  hasDataset(dataset: Dataset): boolean {
    if (dataset === "icp") return true;
    const availability = this.datasetAvailability(dataset);
    return dataset === "crawl"
      ? availability !== "unavailable"
      : availability === "available";
  }

  crawlPartial(): boolean {
    return this.coverage.crawl === "partial";
  }

  isPriority(subjectUrl: string): boolean {
    return isPriorityUrl(subjectUrl, this.prioritySet);
  }

  isCommercial(subjectUrl: string): boolean {
    return isCommercialUrl(subjectUrl, this.prioritySet);
  }

  /**
   * Canonical page subjects with every indexable 2xx exact fetch variant. A
   * subject-level rule must derive facts from the full variant group rather than
   * treating one transport response as representative of the canonical page.
   */
  indexablePages(): IndexablePageSubject[] {
    const pages: IndexablePageSubject[] = [];
    for (const [subjectUrl, variants] of this.pageVariants) {
      const indexableVariants = variants.filter(isIndexablePage);
      if (indexableVariants.length > 0) {
        pages.push([subjectUrl, Object.freeze(indexableVariants)]);
      }
    }
    return pages;
  }

  /**
   * Conversion destination subjectUrls (spec §8.4). Prefer the ICP conversion
   * targetUrl; otherwise fall back to same-origin pages whose path matches the
   * conversion type. Empty ⇒ CRO-PATH is `not_applicable`.
   */
  conversionDestinations(): Set<string> {
    const set = new Set<string>();
    const target = this.icp.primaryConversion?.targetUrl;
    if (target) {
      const subject = subjectUrlOf(target);
      if (subject) set.add(subject);
      return set;
    }
    const type = this.icp.primaryConversion?.type ?? "";
    const typePath = conversionTypePattern(type);
    if (!typePath) return set;
    for (const subjectUrl of this.pages.keys()) {
      try {
        if (typePath.test(new URL(subjectUrl).pathname)) set.add(subjectUrl);
      } catch {
        // ignore unparseable
      }
    }
    return set;
  }

  observedAt(provider: string): string {
    return this.capturedAt[provider] ?? this.capturedAt["crawl"] ?? new Date(0).toISOString();
  }

  /** One exact crawl observation, or null when absent/ambiguous. */
  crawlObservationForFetchUrl(
    fetchUrl: string,
  ): UrlObservationProjection<CrawlPageProjection> | null {
    const rows = this.crawlObservationsByFetchUrl.get(fetchUrl);
    return rows?.length === 1 ? rows[0] ?? null : null;
  }

  /** One frozen GSC subject observation, or null when absent/ambiguous. */
  gscObservationForSubject(
    subjectRef: string,
  ): UrlObservationProjection<GscPageProjection> | null {
    if (this.ambiguousGscSubjects.has(subjectRef)) return null;
    return this.gscObservations.get(subjectRef) ?? null;
  }

  /** One frozen GA4 subject observation, or null when absent/ambiguous. */
  ga4ObservationForSubject(
    subjectRef: string,
  ): UrlObservationProjection<Ga4LandingProjection> | null {
    if (this.ambiguousGa4Subjects.has(subjectRef)) return null;
    return this.ga4Observations.get(subjectRef) ?? null;
  }

  /** Availability of one actual frozen provider snapshot, not a merged slot. */
  providerAvailability(provider: string): DatasetAvailability {
    const availability = this.availabilityByProvider[provider];
    if (availability) return availability;
    if (provider === "crawl" || provider === "gsc" || provider === "ga4") {
      return this.coverage[provider];
    }
    // Backward-compatible fallback for replay fixtures created before keyword
    // gap providers were frozen separately. Production contexts always supply
    // `availabilityByProvider` from the selected snapshot manifest.
    if (provider === "csv" || provider === "dataforseo") {
      return this.coverage.csv;
    }
    return "unavailable";
  }

  /**
   * The de-duplicated aggregate rows partitioned by their retained provider.
   * Summing these partitions yields `csvClusters.get(clusterKey)` exactly once.
   */
  keywordGapContributions(
    clusterKey: string,
    selectedKeywords?: readonly CsvKeywordProjection[],
  ): readonly KeywordGapContribution[] {
    const contributions =
      this.keywordGapContributionsByCluster.get(clusterKey) ??
      EMPTY_KEYWORD_GAP_CONTRIBUTIONS;
    if (selectedKeywords === undefined) return contributions;
    if (selectedKeywords.length === 0) {
      return EMPTY_KEYWORD_GAP_CONTRIBUTIONS;
    }
    const selected = new Set(selectedKeywords);
    return Object.freeze(
      contributions.flatMap((contribution) => {
        const keywords = contribution.keywords.filter((keyword) =>
          selected.has(keyword),
        );
        return keywords.length === 0
          ? []
          : [
              Object.freeze({
                provider: contribution.provider,
                keywords: Object.freeze(keywords),
              }),
            ];
      }),
    );
  }

  governedKeywordCluster(
    clusterKey: string,
  ): GovernanceKeywordClusterV1 | null {
    return this.governedKeywordClusters.get(clusterKey) ?? null;
  }

  /**
   * Frozen CSV/DataForSEO demand rows that intersect approved + confirmed
   * Keyword Library facts for the exact outer cluster. No-governance contexts
   * intentionally return an empty set; callers choose the legacy path explicitly.
   */
  governedKeywordGapKeywords(
    clusterKey: string,
  ): readonly CsvKeywordProjection[] {
    return (
      this.governedKeywordGapKeywordsByCluster.get(clusterKey) ??
      EMPTY_KEYWORD_PROJECTIONS
    );
  }

  approvedCompetitorsForScope(
    scope: GovernanceCompetitorAnalysisScope,
  ): readonly GovernanceCompetitorFactV1[] {
    return Object.freeze(
      this.approvedCompetitorEvidence.filter((competitor) =>
        competitor.analysisScopes.includes(scope),
      ),
    );
  }
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function observationProjection<T>(
  observation: ObservationView,
  projection: T,
): UrlObservationProjection<T> {
  return {
    observationId: observation.observationId,
    snapshotId: observation.snapshotId,
    sitePageId: observation.sitePageId,
    sitePageUrl: observation.sitePageUrl,
    pageSnapshotId: observation.pageSnapshotId,
    subjectRef: observation.subjectRef,
    projection,
  };
}

function materializeUrlObservationGroups<T>(
  groups: ReadonlyMap<string, readonly UrlObservationProjection<T>[]>,
  projections: Map<string, T>,
  uniqueObservations: Map<string, UrlObservationProjection<T>>,
  ambiguousSubjects: Set<string>,
): void {
  for (const subjectRef of [...groups.keys()].sort(compareAscii)) {
    const rows = [...(groups.get(subjectRef) ?? [])].sort((left, right) =>
      compareAscii(left.observationId, right.observationId),
    );
    const representative = rows[0];
    if (!representative) continue;
    if (rows.length === 1) {
      projections.set(subjectRef, representative.projection);
      uniqueObservations.set(subjectRef, representative);
    } else {
      ambiguousSubjects.add(subjectRef);
    }
  }
}

function orderUrlObservationGroups<T>(
  groups: ReadonlyMap<string, readonly UrlObservationProjection<T>[]>,
): ReadonlyMap<string, readonly UrlObservationProjection<T>[]> {
  const ordered = new Map<
    string,
    readonly UrlObservationProjection<T>[]
  >();
  for (const subjectRef of [...groups.keys()].sort(compareAscii)) {
    ordered.set(
      subjectRef,
      Object.freeze(
        [...(groups.get(subjectRef) ?? [])].sort((left, right) =>
          compareAscii(left.observationId, right.observationId),
        ),
      ),
    );
  }
  return ordered;
}

function isIndexablePage(page: CrawlPageProjection): boolean {
  return (
    page.robotsIndexable &&
    page.status !== null &&
    page.status >= 200 &&
    page.status < 300
  );
}

/** Stable semantic demand identity used to de-duplicate repeated observations. */
function canonicalKeywordIdentity(projection: CsvKeywordProjection): string {
  const canonicalKeyword = projection.keyword
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  // A supplied CSV cluster may legally carry a punctuation-only keyword. Do
  // not collapse every such row into the same empty identity.
  const keyword =
    canonicalKeyword ||
    projection.keyword.normalize("NFKC").toLowerCase().trim();
  return JSON.stringify([
    projection.clusterKey,
    keyword,
    projection.marketCode.toUpperCase(),
    // DataForSEO emits a broad primary-language bucket while CSV can retain a
    // narrower BCP-47 locale. Case-fold the complete emitted scope; do not
    // invent equivalence between, for example, `en` and `en-US`.
    projection.languageCode.toLowerCase(),
  ]);
}

/**
 * Total preference order for conflicting observations of one demand unit. The
 * selected projection is kept whole: no volume, rank, or URL is synthesized by
 * combining rows from different observations.
 */
function prefersKeywordRow(
  candidate: KeywordProjectionRow,
  existing: KeywordProjectionRow,
): boolean {
  const providerDifference =
    keywordProviderPriority(candidate.provider) -
    keywordProviderPriority(existing.provider);
  if (providerDifference !== 0) return providerDifference > 0;

  const candidateHasVolume = candidate.projection.searchVolume !== null;
  const existingHasVolume = existing.projection.searchVolume !== null;
  if (candidateHasVolume !== existingHasVolume) return candidateHasVolume;

  const richnessDifference =
    keywordProjectionRichness(candidate.projection) -
    keywordProjectionRichness(existing.projection);
  if (richnessDifference !== 0) return richnessDifference > 0;

  const canonicalDifference = compareAscii(
    canonicalKeywordProjection(candidate.projection),
    canonicalKeywordProjection(existing.projection),
  );
  return canonicalDifference !== 0
    ? canonicalDifference < 0
    : compareAscii(candidate.observationId, existing.observationId) < 0;
}

function keywordProviderPriority(provider: KeywordGapProvider): number {
  return provider === "dataforseo" ? 1 : 0;
}

function keywordProjectionRichness(projection: CsvKeywordProjection): number {
  return [
    projection.searchVolume,
    projection.currentUrl,
    projection.currentRank,
    projection.competitorDomain,
    projection.competitorRank,
  ].filter((value) => value !== null).length;
}

/** Fixed-field serialization used only as the final deterministic tie-break. */
function canonicalKeywordProjection(projection: CsvKeywordProjection): string {
  return JSON.stringify([
    projection.keyword,
    projection.clusterKey,
    projection.searchVolume,
    projection.currentUrl,
    projection.currentRank,
    projection.competitorDomain,
    projection.competitorRank,
    projection.marketCode,
    projection.languageCode,
  ]);
}

function governanceKeywordIdentity(
  keyword: GovernanceKeywordFactV1,
): string {
  return JSON.stringify([
    canonicalKeywordText(keyword.normalizedKeyword),
    keyword.marketCode.toUpperCase(),
    keyword.languageTag.toLowerCase(),
    keyword.queryKind,
  ]);
}

function observedGovernanceKeywordIdentity(
  projection: CsvKeywordProjection,
): string {
  return JSON.stringify([
    canonicalKeywordText(projection.keyword),
    projection.marketCode.toUpperCase(),
    projection.languageCode.toLowerCase(),
    "search_query",
  ]);
}

function canonicalKeywordText(keyword: string): string {
  const canonicalKeyword = keyword
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return canonicalKeyword || keyword.normalize("NFKC").toLowerCase().trim();
}

function conversionTypePattern(type: string): RegExp | null {
  switch (type) {
    case "demo":
      return /\/demo(\/|$)/i;
    case "signup":
      return /\/(signup|sign-up|register)(\/|$)/i;
    case "trial":
      return /\/(trial|free-trial)(\/|$)/i;
    case "purchase":
      return /\/(buy|checkout|cart|shop|pricing)(\/|$)/i;
    case "contact":
      return /\/contact(\/|$)/i;
    default:
      return null;
  }
}
