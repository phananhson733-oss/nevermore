import {
  type CollectionRunKeywordLibraryContext,
  type ObservationRow,
  type SiteRow,
} from "@sf/db";
import { ProductProfileDraft, type ProductProfileDraft as ProductProfileDraftValue } from "@sf/contracts";
import {
  createDataForSeoBacklinksScope,
  createDataForSeoSearchLandscapeV3Scope,
  DATAFORSEO_BACKLINKS_OPERATION,
  DATAFORSEO_SEARCH_LANDSCAPE_V3_OPERATION,
  resolveDataForSeoMarket,
  type DataForSeoSearchLandscapeSeed,
  type DataForSeoSearchLandscapeV3Scope,
} from "@sf/sources";
import type { AnalysisRefreshRequestPayload } from "./payload.ts";

/**
 * ISO 3166-1 alpha-2 assignments. `Intl.DisplayNames` also recognizes reserved
 * identifiers, so Analysis Refresh uses the same semantic allow-list as the
 * canonical collection command.
 */
const ISO_3166_ALPHA2_MARKET_CODES = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  ),
);

export const ANALYSIS_REFRESH_COLLECTION_CONFIG = {
  crawl: {
    provider: "crawl",
    operation: "site_graph",
    queue: "collect.crawl",
  },
  gsc: {
    provider: "gsc",
    operation: "search_analytics",
    queue: "collect.gsc",
  },
  ga4: {
    provider: "ga4",
    operation: "organic_landing",
    queue: "collect.ga4",
  },
  dataforseo: {
    provider: "dataforseo",
    operation: DATAFORSEO_SEARCH_LANDSCAPE_V3_OPERATION,
    queue: "collect.dataforseo",
  },
  dataforseo_backlinks: {
    provider: "dataforseo",
    operation: DATAFORSEO_BACKLINKS_OPERATION,
    queue: "collect.dataforseo",
  },
} as const;

export interface DataForSeoConnectionConfig {
  readonly target: string;
  readonly marketCode: string;
  readonly locationName: string;
  readonly languageCode: string;
  readonly maxKeywords: number;
  readonly maxCompetitors: number;
  readonly maxSerpCompetitors: number;
}

export interface DataForSeoBacklinksConnectionConfig {
  readonly target: string;
  readonly maxBacklinks: number;
  readonly maxReferringDomains: number;
  readonly maxBacklinkPages: number;
  readonly maxSourceVerifications: number;
}

interface DataForSeoSeedProfile {
  readonly id: string;
  readonly profile: ProductProfileDraftValue;
}

interface RankedSeed {
  readonly seed: DataForSeoSearchLandscapeSeed;
  readonly impressions: number;
  readonly clicks: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function seedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

/**
 * Derive bounded query seeds only from canonical persisted evidence. The source
 * kind and exact record pointer stay frozen next to every phrase; this helper
 * never labels a GSC/Crawler/Profile phrase as a DataForSEO observation.
 */
export function deriveDataForSeoSearchLandscapeSeeds(input: {
  readonly observations: readonly Pick<
    ObservationRow,
    "id" | "provider" | "metric_key" | "availability" | "value_json"
  >[];
  readonly productProfile: DataForSeoSeedProfile | null;
}): readonly DataForSeoSearchLandscapeSeed[] {
  const gsc: RankedSeed[] = [];
  const crawler: DataForSeoSearchLandscapeSeed[] = [];
  for (const observation of input.observations) {
    if (observation.availability !== "available") continue;
    const value = record(observation.value_json);
    if (!value) continue;
    if (observation.provider === "gsc" && observation.metric_key === "gsc.page.v1") {
      const topQueries = Array.isArray(value.topQueries) ? value.topQueries : [];
      for (const [index, candidate] of topQueries.entries()) {
        const query = record(candidate);
        const keyword = seedText(query?.query);
        if (!keyword) continue;
        gsc.push({
          seed: {
            keyword,
            sourceKind: "gsc_top_query",
            sourceRef: `observation:${observation.id}#/valueJson/topQueries/${index}/query`,
          },
          impressions:
            typeof query?.impressions === "number" && Number.isFinite(query.impressions)
              ? query.impressions
              : 0,
          clicks:
            typeof query?.clicks === "number" && Number.isFinite(query.clicks)
              ? query.clicks
              : 0,
        });
      }
      continue;
    }
    if (observation.provider === "crawl" && observation.metric_key === "crawl.page.v1") {
      const values: Array<{ readonly value: unknown; readonly path: string }> = [
        { value: value.title, path: "title" },
        ...(Array.isArray(value.h1)
          ? value.h1.map((heading, index) => ({ value: heading, path: `h1/${index}` }))
          : []),
      ];
      for (const candidate of values) {
        const keyword = seedText(candidate.value);
        if (!keyword) continue;
        crawler.push({
          keyword,
          sourceKind: "crawler_page_text",
          sourceRef: `observation:${observation.id}#/valueJson/${candidate.path}`,
        });
      }
    }
  }
  gsc.sort(
    (left, right) =>
      right.impressions - left.impressions ||
      right.clicks - left.clicks ||
      left.seed.keyword.localeCompare(right.seed.keyword, "en"),
  );
  crawler.sort(
    (left, right) =>
      left.sourceRef.localeCompare(right.sourceRef, "en") ||
      left.keyword.localeCompare(right.keyword, "en"),
  );

  const profile: DataForSeoSearchLandscapeSeed[] = [];
  if (input.productProfile) {
    const parsed = ProductProfileDraft.safeParse(input.productProfile.profile);
    if (parsed.success) {
      const fields: Array<{ readonly value: unknown; readonly path: string }> = [
        { value: parsed.data.productName, path: "productName" },
        { value: parsed.data.category, path: "category" },
        { value: parsed.data.productType, path: "productType" },
        { value: parsed.data.oneLiner, path: "oneLiner" },
        ...parsed.data.coreFeatures.map((value, index) => ({
          value,
          path: `coreFeatures/${index}`,
        })),
      ];
      for (const field of fields) {
        const keyword = seedText(field.value);
        if (!keyword) continue;
        profile.push({
          keyword,
          sourceKind: "product_profile",
          sourceRef: `profile:${input.productProfile.id}#/${field.path}`,
        });
      }
    }
  }

  const seen = new Set<string>();
  const result: DataForSeoSearchLandscapeSeed[] = [];
  for (const seed of [...gsc.map((entry) => entry.seed), ...crawler, ...profile]) {
    const identity = seed.keyword.toLocaleLowerCase("en-US");
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(seed);
    if (result.length === 200) break;
  }
  return result;
}

export function keywordLibraryContextForSite(
  site: Pick<SiteRow, "market_codes" | "language_codes">,
): CollectionRunKeywordLibraryContext | null {
  if (site.market_codes.length !== 1 || site.language_codes.length !== 1) {
    return null;
  }
  const marketCode = site.market_codes[0]?.trim().toUpperCase();
  const language = site.language_codes[0]?.trim();
  if (
    !marketCode ||
    !ISO_3166_ALPHA2_MARKET_CODES.has(marketCode) ||
    !language
  ) {
    return null;
  }
  try {
    const languageTag = Intl.getCanonicalLocales(language)[0];
    return languageTag
      ? { basis: "project_context", marketCode, languageTag }
      : null;
  } catch {
    return null;
  }
}

/**
 * Return null instead of inventing market/language authority. Callers skip the
 * still-pending optional step when post-Crawl context remains incomplete.
 */
export function dataForSeoSearchLandscapeScopeForSite(
  site: Pick<SiteRow, "host" | "market_codes" | "language_codes">,
  maxKeywords: number,
  maxCompetitors: number,
  seeds: readonly DataForSeoSearchLandscapeSeed[] = [],
  aiCitations: AnalysisRefreshRequestPayload["dataForSeo"]["aiCitations"] = {
    state: "disabled",
  },
): DataForSeoSearchLandscapeV3Scope | null {
  if (site.market_codes.length !== 1 || site.language_codes.length !== 1) {
    return null;
  }
  const marketCode = site.market_codes[0]?.trim().toUpperCase();
  const rawLanguageTag = site.language_codes[0]?.trim();
  if (
    !marketCode ||
    !ISO_3166_ALPHA2_MARKET_CODES.has(marketCode) ||
    !rawLanguageTag
  ) {
    return null;
  }
  // Resolve against the provider's own catalogue rather than an Intl exonym:
  // its spelling differs for Türkiye, Bosnia & Herzegovina and Côte d'Ivoire,
  // it serves only 92 countries, and each of those serves a closed language
  // set. The site's configured language is honoured when Labs actually has
  // that database, and otherwise gives way to the market's own — sending an
  // unserved language is rejected with task status 40501.
  let languageTag: string;
  try {
    languageTag = Intl.getCanonicalLocales(rawLanguageTag)[0] ?? "";
  } catch {
    return null;
  }
  if (!languageTag) return null;
  const market = resolveDataForSeoMarket(marketCode, languageTag);
  if (!market) return null;
  try {
    const providerLanguageMatchesSite =
      languageTag.split("-")[0]?.toLowerCase() === market.languageCode;
    const aiCitationsEnabled =
      aiCitations?.state === "enabled" && providerLanguageMatchesSite;
    const aiCitationInput =
      aiCitationsEnabled
        ? {
            state: "enabled" as const,
            requestedModel: aiCitations.requestedModel,
            querySetHash: aiCitations.querySetHash,
            queries: aiCitations.queries,
            trackedCompetitorDomains:
              aiCitations.trackedCompetitorDomains,
          }
        : aiCitations?.state === "skipped_insufficient_query_cohort"
          ? {
              state: aiCitations.state,
              eligibleQueryCount: aiCitations.eligibleQueryCount,
            }
          : { state: "disabled" as const };
    return createDataForSeoSearchLandscapeV3Scope({
      target: site.host,
      marketCode,
      locationCode: market.locationCode,
      languageTag: aiCitationsEnabled ? languageTag : market.languageCode,
      rankedKeywordsLimit: maxKeywords,
      competitorsDomainLimit: maxCompetitors,
      serpCompetitorsLimit: maxCompetitors,
      seeds,
      aiCitations: aiCitationInput,
    });
  } catch {
    return null;
  }
}

/**
 * Backlink index collection needs only the canonical primary host. Provider
 * semantics and all bounded caps are frozen by the shared sources contract.
 */
export function dataForSeoBacklinksScopeForSite(
  site: Pick<SiteRow, "host">,
  maxBacklinks: number,
  maxReferringDomains: number,
  maxBacklinkPages: number,
  maxSourceVerifications: number,
): ReturnType<typeof createDataForSeoBacklinksScope> | null {
  try {
    return createDataForSeoBacklinksScope({
      target: site.host,
      maxBacklinks,
      maxReferringDomains,
      maxBacklinkPages,
      maxSourceVerifications,
    });
  } catch {
    return null;
  }
}

export function dataForSeoConnectionConfig(
  scope: DataForSeoSearchLandscapeV3Scope,
): DataForSeoConnectionConfig {
  // A scope may address the provider by code or by name. Only the customer-
  // readable name belongs in the connection config, so recover it from the
  // catalogue when the scope froze a code.
  const locationName =
    scope.location.kind === "name"
      ? scope.location.name
      : (resolveDataForSeoMarket(scope.marketCode)?.locationName ?? null);
  if (locationName === null) {
    throw new Error("DataForSEO collection requires a known provider location");
  }
  return {
    target: scope.target,
    marketCode: scope.marketCode,
    locationName,
    languageCode: scope.providerLanguageCode,
    maxKeywords: scope.rankedKeywords.limit,
    maxCompetitors: scope.competitorsDomain.limit,
    maxSerpCompetitors: scope.serpCompetitors.limit,
  };
}

export function dataForSeoLimitation(
  config: DataForSeoConnectionConfig,
): string {
  return `DataForSEO search-landscape v3 observations for ${config.target}; market ${config.marketCode} (${config.locationName}), language ${config.languageCode}; ranked keywords at positions 1–100 are capped at ${config.maxKeywords}, organic competitor domains at ${config.maxCompetitors}, and the conditional SERP Competitors fallback at ${config.maxSerpCompetitors} per collection. GSC, Crawler, and Product Profile phrases remain declared seeds, never DataForSEO evidence. Every intersections value is an integer keyword-intersection count, not a percentage; no competitor name or business relationship is inferred.`;
}

export function dataForSeoBacklinksConnectionConfig(
  scope: ReturnType<typeof createDataForSeoBacklinksScope>,
): DataForSeoBacklinksConnectionConfig {
  return {
    target: scope.target,
    maxBacklinks: scope.maxBacklinks,
    maxReferringDomains: scope.maxReferringDomains,
    maxBacklinkPages: scope.maxBacklinkPages,
    maxSourceVerifications: scope.maxSourceVerifications,
  };
}

export function dataForSeoBacklinksLimitation(
  config: DataForSeoBacklinksConnectionConfig,
): string {
  return `DataForSEO live backlink-index observations for ${config.target}; backlink rows are capped at ${config.maxBacklinks}, referring domains at ${config.maxReferringDomains}, linked target pages at ${config.maxBacklinkPages}, and SSRF-safe source-page verification at ${config.maxSourceVerifications} pages per collection. Provider index facts and crawler verification remain separately identified evidence.`;
}
