import {
  type CollectionRunKeywordLibraryContext,
  type SiteRow,
} from "@sf/db";
import {
  createDataForSeoSearchLandscapeScope,
  DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
  type DataForSeoSearchLandscapeScope,
} from "@sf/sources";

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
    operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
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
): DataForSeoSearchLandscapeScope | null {
  if (site.market_codes.length !== 1 || site.language_codes.length !== 1) {
    return null;
  }
  const marketCode = site.market_codes[0]?.trim().toUpperCase();
  const languageTag = site.language_codes[0]?.trim();
  if (
    !marketCode ||
    !ISO_3166_ALPHA2_MARKET_CODES.has(marketCode) ||
    !languageTag
  ) {
    return null;
  }
  const locationName = new Intl.DisplayNames(["en"], {
    type: "region",
  }).of(marketCode);
  if (!locationName) return null;
  try {
    return createDataForSeoSearchLandscapeScope({
      target: site.host,
      marketCode,
      locationName,
      languageTag,
      rankedKeywordsLimit: maxKeywords,
      competitorsDomainLimit: maxCompetitors,
    });
  } catch {
    return null;
  }
}

export function dataForSeoConnectionConfig(
  scope: DataForSeoSearchLandscapeScope,
): DataForSeoConnectionConfig {
  if (scope.location.kind !== "name") {
    throw new Error("DataForSEO collection requires a named provider location");
  }
  return {
    target: scope.target,
    marketCode: scope.marketCode,
    locationName: scope.location.name,
    languageCode: scope.providerLanguageCode,
    maxKeywords: scope.rankedKeywords.limit,
    maxCompetitors: scope.competitorsDomain.limit,
  };
}

export function dataForSeoLimitation(
  config: DataForSeoConnectionConfig,
): string {
  return `DataForSEO search-landscape observations for ${config.target}; market ${config.marketCode} (${config.locationName}), language ${config.languageCode}; ranked keywords are capped at ${config.maxKeywords} and organic competitor domains at ${config.maxCompetitors} per collection. DataForSEO documents competitors-domain data as updated weekly, but neither response supplies an exact dataset timestamp, so capturedAt records collection time only. Every intersections value is an integer keyword-intersection count, not a percentage; no competitor name or business relationship is inferred.`;
}
