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

/** A flat observation as loaded from `normalized_observations` (worker → engine). */
export interface ObservationView {
  readonly metricKey: string;
  readonly subjectType: string;
  readonly subjectRef: string;
  readonly provider: string;
  readonly availability: string;
  readonly valueJson: unknown;
  readonly observedAt: string;
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

export class DiagnosticContext {
  readonly icp: EngineIcp;
  readonly deliveryLocale: string;
  readonly coverage: CoverageInput;
  readonly capturedAt: Readonly<Record<string, string>>;
  private readonly availabilityByProvider: Readonly<
    Record<string, DatasetAvailability>
  >;

  /** Stable projection lookup; never use it to infer missing subject-level facts. */
  readonly pages: ReadonlyMap<string, CrawlPageProjection>;
  /** Every exact crawl response, grouped by subjectUrl and ordered by fetchUrl. */
  readonly pageVariants: ReadonlyMap<string, readonly CrawlPageProjection[]>;
  readonly robots: CrawlRobotsProjection | null;
  readonly sitemap: CrawlSitemapProjection | null;
  readonly gsc: ReadonlyMap<string, GscPageProjection>;
  readonly ga4: ReadonlyMap<string, Ga4LandingProjection>;
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
  /** Derived internal inlink counts per subjectUrl (pipeline step 4). */
  readonly internalInlinks: ReadonlyMap<string, number>;

  private readonly prioritySet: ReadonlySet<string>;

  private constructor(input: DiagnosticContextInput) {
    this.icp = input.icp;
    this.deliveryLocale = input.deliveryLocale;
    this.coverage = input.coverage;
    this.capturedAt = input.capturedAt;
    this.availabilityByProvider = Object.freeze({
      ...input.availabilityByProvider,
    });
    this.prioritySet = priorityUrlSet(input.icp.priorityUrls);

    const pageGroups = new Map<string, CrawlPageProjection[]>();
    const gsc = new Map<string, GscPageProjection>();
    const ga4 = new Map<string, Ga4LandingProjection>();
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
            variants.push(obs.valueJson as CrawlPageProjection);
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
          if (obs.valueJson) gsc.set(obs.subjectRef, obs.valueJson as GscPageProjection);
          break;
        case METRIC_GA4_LANDING:
          if (obs.valueJson) ga4.set(obs.subjectRef, obs.valueJson as Ga4LandingProjection);
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
          const candidate: KeywordProjectionRow = { projection, provider };
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
    for (const subjectRef of [...pageGroups.keys()].sort(compareAscii)) {
      const variants = Object.freeze(
        [...(pageGroups.get(subjectRef) ?? [])].sort((left, right) =>
          compareAscii(left.fetchUrl, right.fetchUrl),
        ),
      );
      const representative = variants[0];
      if (!representative) continue;
      pages.set(subjectRef, representative);
      pageVariants.set(subjectRef, variants);
    }

    const csv = new Map<string, readonly CsvKeywordProjection[]>();
    const keywordGapContributionsByCluster = new Map<
      string,
      readonly KeywordGapContribution[]
    >();
    for (const subjectRef of [...keywordRows.keys()].sort(compareAscii)) {
      const rows = keywordRows.get(subjectRef);
      if (!rows) continue;
      const selectedRows = [...rows.entries()].sort(([left], [right]) =>
        compareAscii(left, right),
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
    this.robots = robots;
    this.sitemap = sitemap;
    this.gsc = gsc;
    this.ga4 = ga4;
    this.csvClusters = csv;
    this.keywordGapProviders = keywordGapProviders;
    this.keywordGapContributionsByCluster =
      keywordGapContributionsByCluster;
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
  ): readonly KeywordGapContribution[] {
    return (
      this.keywordGapContributionsByCluster.get(clusterKey) ??
      EMPTY_KEYWORD_GAP_CONTRIBUTIONS
    );
  }
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

  return (
    compareAscii(
      canonicalKeywordProjection(candidate.projection),
      canonicalKeywordProjection(existing.projection),
    ) < 0
  );
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
