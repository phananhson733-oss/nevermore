import {
  DATAFORSEO_LABS_LOCATIONS,
  type DataForSeoLabsLocation,
} from "./generated/labs-locations.ts";

const MARKET_CODE_RE = /^[A-Za-z]{2}$/;

/** The provider's own identity for one served market. */
export interface DataForSeoMarketResolution {
  readonly locationCode: number;
  readonly locationName: string;
  readonly languageCode: string;
}

/** Row caps frozen by the server for one discovery request. */
export interface DataForSeoMarketRowCaps {
  readonly rankedKeywords: number;
  readonly competitorDomains: number;
}

/**
 * Resolve an ISO 3166-1 alpha-2 market to the location and search language
 * DataForSEO Labs actually serves for it.
 *
 * Two values used to be guessed and both were wrong in production:
 *
 * - the language was taken from the operator's UI locale, so a Chinese-speaking
 *   operator researching the United States sent `language_code: "zh"`. Labs
 *   serves only `en` and `es` there and answers task status 40501, which the
 *   collection layer classifies as a permanent `INVALID_CONFIGURATION`;
 * - the location was an `Intl.DisplayNames` English exonym, which disagrees
 *   with the provider's spelling for Türkiye, Bosnia & Herzegovina and Côte
 *   d'Ivoire. Resolving to `location_code` removes that class entirely.
 *
 * The search language is the market's largest provider database, which is an
 * observed keyword count rather than an assumption about who lives there. It is
 * deliberately independent of the report language: the customer may read a
 * Chinese report about English-language search demand.
 *
 * Returns `null` when the market has no Labs database at all — roughly two
 * thirds of ISO 3166-1 countries. Callers must skip discovery in that case
 * rather than enqueue work that can only fail permanently.
 */
export function resolveDataForSeoMarket(
  marketCode: unknown,
  preferredLanguage?: unknown,
): DataForSeoMarketResolution | null {
  if (typeof marketCode !== "string") return null;
  const trimmed = marketCode.trim();
  if (!MARKET_CODE_RE.test(trimmed)) return null;

  const entry: DataForSeoLabsLocation | undefined =
    DATAFORSEO_LABS_LOCATIONS[trimmed.toUpperCase()];
  if (!entry) return null;

  const languageCode = preferredLanguageCode(entry, preferredLanguage);
  if (languageCode === undefined) return null;

  return {
    locationCode: entry.locationCode,
    locationName: entry.locationName,
    languageCode,
  };
}

/**
 * Honour a configured language only when the provider actually serves it for
 * this location. A site declared as Swiss-French keeps `fr`; a site declared in
 * Chinese while targeting the United States does not silently produce `zh`,
 * because Labs has no such database and answers 40501.
 */
function preferredLanguageCode(
  entry: DataForSeoLabsLocation,
  preferred: unknown,
): string | undefined {
  if (typeof preferred === "string") {
    const primary = preferred.trim().split("-")[0]?.toLowerCase();
    if (primary && entry.languageCodes.includes(primary)) return primary;
  }
  return entry.languageCodes[0];
}

/** True when DataForSEO Labs serves the market at all. */
export function isDataForSeoServedMarket(marketCode: unknown): boolean {
  return resolveDataForSeoMarket(marketCode) !== null;
}

/**
 * Customer-readable statement of what one discovery request actually asked for.
 * It names the search language explicitly so a Chinese report never implies the
 * keywords were observed in Chinese.
 */
export function dataForSeoMarketLimitation(
  target: string,
  market: DataForSeoMarketResolution,
  caps: DataForSeoMarketRowCaps,
): string {
  return (
    `Automatic DataForSEO competitor discovery for ${target} in ` +
    `${market.locationName} (location ${market.locationCode}), search ` +
    `language ${market.languageCode} — chosen from the market, not the ` +
    `report language. Ranked keywords capped at ${caps.rankedKeywords} and ` +
    `competitor domains at ${caps.competitorDomains}. Intersections are ` +
    `counts, not similarity percentages.`
  );
}
