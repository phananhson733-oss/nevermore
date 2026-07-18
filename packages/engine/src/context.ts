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
 * indexed by canonical subjectUrl (crawl/gsc/ga4) or clusterKey (csv). Derived
 * facts (internal inlink counts) are computed here — pipeline step 4.
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
  /** capturedAt per provider, for evidence timestamps. */
  readonly capturedAt: Readonly<Record<string, string>>;
}

export class DiagnosticContext {
  readonly icp: EngineIcp;
  readonly deliveryLocale: string;
  readonly coverage: CoverageInput;
  readonly capturedAt: Readonly<Record<string, string>>;

  readonly pages: ReadonlyMap<string, CrawlPageProjection>;
  readonly robots: CrawlRobotsProjection | null;
  readonly sitemap: CrawlSitemapProjection | null;
  readonly gsc: ReadonlyMap<string, GscPageProjection>;
  readonly ga4: ReadonlyMap<string, Ga4LandingProjection>;
  readonly csvClusters: ReadonlyMap<string, readonly CsvKeywordProjection[]>;
  /** Derived internal inlink counts per subjectUrl (pipeline step 4). */
  readonly internalInlinks: ReadonlyMap<string, number>;

  private readonly prioritySet: ReadonlySet<string>;

  private constructor(input: DiagnosticContextInput) {
    this.icp = input.icp;
    this.deliveryLocale = input.deliveryLocale;
    this.coverage = input.coverage;
    this.capturedAt = input.capturedAt;
    this.prioritySet = priorityUrlSet(input.icp.priorityUrls);

    const pages = new Map<string, CrawlPageProjection>();
    const gsc = new Map<string, GscPageProjection>();
    const ga4 = new Map<string, Ga4LandingProjection>();
    const csv = new Map<string, CsvKeywordProjection[]>();
    let robots: CrawlRobotsProjection | null = null;
    let sitemap: CrawlSitemapProjection | null = null;

    for (const obs of input.observations) {
      switch (obs.metricKey) {
        case METRIC_CRAWL_PAGE:
          if (obs.valueJson) pages.set(obs.subjectRef, obs.valueJson as CrawlPageProjection);
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
          const list = csv.get(obs.subjectRef) ?? [];
          list.push(obs.valueJson as CsvKeywordProjection);
          csv.set(obs.subjectRef, list);
          break;
        }
        default:
          break;
      }
    }

    // Derived: internal inlink counts from every page's internal outlinks.
    const inlinks = new Map<string, number>();
    for (const page of pages.values()) {
      const seen = new Set<string>();
      for (const link of page.internalOutlinks) {
        const target = link.targetSubjectUrl;
        if (seen.has(target)) continue; // count distinct source pages once
        seen.add(target);
        inlinks.set(target, (inlinks.get(target) ?? 0) + 1);
      }
    }

    this.pages = pages;
    this.robots = robots;
    this.sitemap = sitemap;
    this.gsc = gsc;
    this.ga4 = ga4;
    this.csvClusters = csv;
    this.internalInlinks = inlinks;
  }

  static build(input: DiagnosticContextInput): DiagnosticContext {
    return new DiagnosticContext(input);
  }

  // --- helpers ------------------------------------------------------------

  isEnglish(): boolean {
    return isEnglishProject(this.icp);
  }

  hasDataset(dataset: Dataset): boolean {
    if (dataset === "icp") return true;
    if (dataset === "crawl") return this.coverage.crawl !== "unavailable";
    if (dataset === "gsc") return this.coverage.gsc !== "unavailable";
    if (dataset === "ga4") return this.coverage.ga4 !== "unavailable";
    if (dataset === "csv") return this.coverage.csv !== "unavailable";
    return false;
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

  /** Indexable 2xx pages (the eligible set for content/link rules). */
  indexablePages(): [string, CrawlPageProjection][] {
    return [...this.pages.entries()].filter(
      ([, p]) => p.robotsIndexable && p.status !== null && p.status >= 200 && p.status < 300,
    );
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
