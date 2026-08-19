// @input  -- one target query, the visitor's market and language, and the page's host
// @output -- who holds page one for that query, and whether this page is on it
// @pos    -- the only paid provider call the On-Page Checker makes
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  bulkTrafficEstimation,
  labsLanguageForMarket,
} from "@sf/sources/dataforseo/labs-traffic";
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
import { SERP_LANGUAGES, SERP_LOCATIONS } from "./serp-markets.ts";

/**
 * The markets and languages this lookup accepts.
 *
 * Defined in a module with no imports so the form can offer exactly these codes
 * without the browser bundle reaching `@sf/sources` through this file. Still
 * re-exported here: this is where the enforcement lives, and the tests that
 * pin the enforcement read the list from the module that enforces it.
 */
export {
  SERP_LANGUAGES,
  SERP_LOCATIONS,
} from "./serp-markets.ts";

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

/** One line per paid call, so the spend can be summed out of the logs. */
function logProviderCost(usd: number, market: string, query: string): void {
  console.info(
    `[serp-landscape] paid_call cost_usd=${usd} market=${market} query_units=${
      [...query].length
    }`,
  );
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
  /**
   * Reports what the call cost. Defaults to a server-side log line.
   *
   * The provider itemises nothing per tool, so a call nobody records is a
   * charge nobody can attribute — the invoice shows one number for every tool
   * that talks to DataForSEO. A log line is enough to sum from; a ledger row
   * would put provider cost in a table whose subject is user credits.
   */
  readonly onCost?: (usd: number, market: string, query: string) => void;
  /** Injected in tests so no suite ever reaches a paid endpoint. */
  readonly estimateTraffic?: typeof bulkTrafficEstimation;
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
    (dependencies.onCost ?? logProviderCost)(response.costUsd, market, query);

    // One more call, for every domain on page one at once. The domains are
    // already in hand from the sample above, so this buys only the sizes.
    // Reported through the same cost seam: a second uninstrumented paid call
    // would make the invoice unattributable.
    const labsLanguage = labsLanguageForMarket(market);
    const sized =
      labsLanguage === null
        ? null
        : await (dependencies.estimateTraffic ?? bulkTrafficEstimation)({
            login: dependencies.login ?? process.env["DATAFORSEO_LOGIN"] ?? "",
            password:
              dependencies.password ?? process.env["DATAFORSEO_PASSWORD"] ?? "",
            targets: response.rows.map((row) => row.domain),
            locationCode,
            languageCode: labsLanguage,
          });
    if (sized !== null) {
      (dependencies.onCost ?? logProviderCost)(sized.costUsd, market, query);
    }
    const trafficByDomain = new Map(
      (sized?.rows ?? []).map(
        (row) => [row.target.toLowerCase(), row.organicEtv] as const,
      ),
    );

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
      // Null when this market has no Labs pair or the lookup did not answer.
      // Never an empty list: downstream, empty reads as "nobody on page one is
      // small", which is a finding, and a provider gap must not become one.
      domainTraffic:
        sized === null
          ? null
          : rows.map((row) => ({
              domain: row.domain,
              organicEtv: trafficByDomain.get(row.domain.toLowerCase()) ?? null,
            })),
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
