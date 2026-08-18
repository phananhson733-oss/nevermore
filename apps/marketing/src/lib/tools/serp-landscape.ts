// @input  -- one target query, the visitor's market and language, and the page's host
// @output -- who holds page one for that query, and whether this page is on it
// @pos    -- the only paid provider call the On-Page Checker makes
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  createDataForSeoKeywordMetricsClient,
  type DataForSeoKeywordMetricsClient,
} from "@sf/sources";
/**
 * The wire shape lives with the rest of the wire contract.
 *
 * Not here, because this module builds a provider client and the browser reads
 * that contract: a type import from here would put `@sf/sources` — and with it
 * `node:net` — one dropped `type` keyword away from a client chunk.
 */
import type { SerpLandscape } from "../agents/audit-contract.ts";

/**
 * Markets this tool will look up, mapped to the provider's location ids.
 *
 * An allow-list, not a passthrough: the provider bills per task and answers an
 * unknown location with an error only after the call is made, so an unmapped
 * code would be a paid round trip to learn the visitor typed something wrong.
 *
 * Wider than the keyword tool's list on purpose. That one is scoped to markets
 * whose copy and coverage window were reasoned about; this one only reads a
 * results page back, and refusing a Chinese-language market on a
 * Chinese-first product would have been the tool telling most of its own
 * audience that their market does not exist.
 */
export const SERP_LOCATIONS: Readonly<Record<string, number>> = {
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  IE: 2372,
  NZ: 2554,
  DE: 2276,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
  SE: 2752,
  NO: 2578,
  DK: 2208,
  FI: 2246,
  PL: 2616,
  PT: 2620,
  BR: 2076,
  MX: 2484,
  IN: 2356,
  JP: 2392,
  KR: 2410,
  SG: 2702,
  HK: 2344,
  TW: 2158,
  MY: 2458,
  TH: 2764,
  ID: 2360,
  VN: 2704,
  PH: 2608,
  AE: 2784,
  ZA: 2710,
  CN: 2156,
};

/**
 * Languages this tool will ask the provider for.
 *
 * An allow-list for the same reason the market list is one: the provider bills
 * per task and rejects an unknown language only after the call is made. The
 * market was allow-listed and the language was not, so `language: "zz"` passed
 * both the request validator and this lookup and bought a provider error.
 */
export const SERP_LANGUAGES: ReadonlySet<string> = new Set([
  "en", "zh", "ja", "ko", "de", "fr", "es", "it", "pt", "nl", "sv", "no", "da",
  "fi", "pl", "ru", "tr", "ar", "hi", "th", "vi", "id", "ms", "he", "cs", "el",
  "hu", "ro", "uk",
]);

/** Results read back. One page, because that is what "page one" means. */
const SERP_DEPTH = 10;

/** Feature names published, and characters kept per name. */
const MAX_FEATURES = 40;
const MAX_FEATURE_CHARS = 64;

/**
 * Compare hosts the way the provider reports them: lower-case, no leading www.
 *
 * A scheme-less value is retried as https, because failing to parse our own
 * target would publish "this page is not among the top ten" — a statement about
 * the site, made because of a statement about our parser.
 */
/** The path a result and a target can be compared on, trailing slash folded. */
export function pathKey(value: string): string | null {
  for (const candidate of [value, `https://${value}`]) {
    try {
      const path = new URL(candidate).pathname;
      return path === "/" ? "/" : path.replace(/\/$/, "");
    } catch {
      // Try the next spelling.
    }
  }
  return null;
}

export function hostKey(value: string): string | null {
  for (const candidate of [value, `https://${value}`]) {
    try {
      return new URL(candidate).host.toLowerCase().replace(/^www\./, "");
    } catch {
      // Try the next spelling.
    }
  }
  return null;
}

export interface SerpLandscapeInput {
  readonly query: string | null;
  readonly market: string | null;
  readonly language: string | null;
  readonly targetUrl: string;
}

export interface SerpLandscapeDependencies {
  readonly client?: DataForSeoKeywordMetricsClient;
  readonly login?: string;
  readonly password?: string;
  /** Reports what the call cost, since the provider itemises nothing per tool. */
  readonly onCost?: (usd: number) => void;
}

/**
 * Read page one for one query.
 *
 * One call per check, for the query the evidence layer already chose as
 * primary. Five calls would answer more, and this is a tool that costs its
 * visitor a single credit while the same crawl costs ten elsewhere — so the
 * number of paid calls is the thing kept deliberately small, and the copy says
 * which query was looked up.
 *
 * Every failure resolves rather than throws. A results page is context around
 * a check, and losing a finished crawl because a provider was slow would be
 * trading the thing the visitor asked for against the thing they did not.
 */
export async function readSerpLandscape(
  input: SerpLandscapeInput,
  dependencies: SerpLandscapeDependencies = {},
): Promise<SerpLandscape> {
  const query = input.query?.trim() ?? "";
  if (query === "") {
    return { availability: "unavailable", reason: "no_target_query" };
  }

  const market = (input.market ?? "").toUpperCase();
  const locationCode = SERP_LOCATIONS[market];
  if (locationCode === undefined) {
    return { availability: "unavailable", reason: "market_not_supported" };
  }

  // The provider takes a bare language code. A regioned tag is the same
  // language to it, and sending `zh-CN` where it expects `zh` is a paid error.
  const language = (input.language ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (language === undefined || !SERP_LANGUAGES.has(language)) {
    return { availability: "unavailable", reason: "market_not_supported" };
  }

  try {
    // Built inside the try, not above it. The provider client throws
    // `AUTH_REQUIRED` on an empty login or password, and this runs after a
    // 240-second crawl has already succeeded and already cost the visitor a
    // credit — so a deployment without the credential set would have turned
    // every finished check into a 500. Constructing it here is the difference
    // between a missing environment variable and an outage.
    const client =
      dependencies.client ??
      createDataForSeoKeywordMetricsClient({
        login: dependencies.login ?? process.env["DATAFORSEO_LOGIN"] ?? "",
        password:
          dependencies.password ?? process.env["DATAFORSEO_PASSWORD"] ?? "",
      });
    const response = await client.serpOrganic({
      keyword: query,
      locationCode,
      languageCode: language,
      depth: SERP_DEPTH,
    });
    dependencies.onCost?.(response.costUsd);

    const target = hostKey(input.targetUrl);
    const targetPath = pathKey(input.targetUrl);
    const rows = response.rows.map((row) => {
      const sameSite = target !== null && row.domain === target;
      return {
        position: row.rankGroup,
        domain: row.domain,
        sitelinkCount: row.sitelinkCount,
        isTarget: sameSite,
        // Whether the ranking result is THIS page or another page on the same
        // site. Reporting only the host said "your page is at position 2" when
        // position 2 was a different page of theirs competing for the same
        // query — the most likely case, not an edge one. Null when the provider
        // gave no URL to compare, which is not the same as "a different page".
        isTargetPage:
          !sameSite || row.url === null
            ? null
            : pathKey(row.url) === targetPath,
      };
    });

    return {
      availability: "available",
      query,
      market,
      language,
      resultsObserved: rows.length,
      withSitelinks: rows.filter((row) => row.sitelinkCount > 0).length,
      // Bounded here rather than only where it is validated. The provider
      // decides how many feature names a results page has; a guard that
      // refuses forty-one of them while the producer happily emits them is a
      // rejection of the whole response for a decorative field.
      features:
        response.itemTypes === null
          ? null
          : response.itemTypes
              .slice(0, MAX_FEATURES)
              .map((entry) => entry.slice(0, MAX_FEATURE_CHARS)),
      // Null is "not on the page we read", not "not ranking": we read ten
      // results, and a page at eleven is absent from both by the same rule.
      targetPosition: rows.find((row) => row.isTarget)?.position ?? null,
      // Separate from the position: the domain can be on page one while the
      // submitted page is not the result holding it.
      targetPageOnPage: rows.some((row) => row.isTargetPage === true),
      rows,
    };
  } catch (error) {
    // A credential this deployment does not have is our problem, not the
    // provider's, and saying "could not be read this time" about it would send
    // an operator looking at DataForSEO's status page.
    const notConfigured =
      error instanceof Error && /credential/i.test(error.message);
    if (notConfigured) {
      console.error("[serp-landscape] provider credentials are not set");
    }
    return {
      availability: "unavailable",
      reason: notConfigured ? "provider_not_configured" : "provider_unavailable",
    };
  }
}
