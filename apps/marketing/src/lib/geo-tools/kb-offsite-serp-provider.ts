// @input  -- one GEO off-site SERP request, and the DataForSEO credentials in the environment
// @output -- the organic rows and the price of the call, in the shape `readGeoOffsiteSerp` reads
// @pos    -- server only: holds a paid provider client; never import from a client component
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * The one adapter between the off-site reader and the paid SERP provider.
 *
 * `readGeoOffsiteSerp` was written against `GeoOffsiteSerpFetch` and nothing
 * else: it is a pure reader that classifies venues, measures cross-reference and
 * decides independence, and it has no provider knowledge at all. That is the
 * right shape, and it left exactly one thing missing -- something that actually
 * calls a provider. Without this the whole off-site half of section 2 R6 is
 * built, tested and unreachable: every v3 update passes `offsite: null`, so the
 * evidence module can only ever hold first-party sources.
 *
 * Three properties this keeps, all of which are the reader's assumptions:
 *
 * - **It reports its own price, or says it does not know.** `costUsd` reaching
 *   the reader is what puts a line in the cost log; a call whose price never
 *   came back is logged as `null` rather than skipped, because a dispatch with
 *   no line reads as a call that did not happen.
 * - **It never throws for a provider outcome.** The reader turns a rejection
 *   into an `unavailable` query with a reason, which is the honest shape: a
 *   query nobody could run is not a query that found nothing.
 * - **It adds no claim of its own.** `sitelinkCount`, `itemTypes` and the AI
 *   Overview block are dropped here rather than carried, because the off-site
 *   judgement is made from rank, domain, title and URL, and a field nothing
 *   reads is a field that will be read wrongly later.
 */
import {
  createDataForSeoKeywordMetricsClient,
  type DataForSeoKeywordMetricsClient,
} from "@sf/sources/dataforseo/keyword-metrics";

import type {
  GeoOffsiteSerpFetch,
  GeoOffsiteSerpRequest,
  GeoOffsiteSerpResponse,
} from "./kb-offsite-serp.ts";

export interface GeoOffsiteSerpProviderOptions {
  /** Injected in tests; production builds one from the environment per call. */
  readonly client?: Pick<DataForSeoKeywordMetricsClient, "serpOrganic">;
  readonly login?: string;
  readonly password?: string;
  readonly signal?: AbortSignal;
}

/**
 * Build the fetch `collectGeoOffsiteEvidence` needs.
 *
 * The client is constructed per call, inside the request, for the same reason
 * `readContentBriefSerp` does it: the factory throws on an empty credential, and
 * a deployment with no DataForSEO variables set must produce an unavailable
 * off-site read rather than a 500 on the update route.
 */
export function createGeoOffsiteSerpFetch(
  options: GeoOffsiteSerpProviderOptions = {},
): GeoOffsiteSerpFetch {
  return async (request: GeoOffsiteSerpRequest): Promise<GeoOffsiteSerpResponse> => {
    const client =
      options.client ??
      createDataForSeoKeywordMetricsClient({
        login: options.login ?? process.env["DATAFORSEO_LOGIN"] ?? "",
        password: options.password ?? process.env["DATAFORSEO_PASSWORD"] ?? "",
      });
    const response = await client.serpOrganic(
      {
        keyword: request.keyword,
        locationCode: request.locationCode,
        languageCode: request.languageCode,
        depth: request.depth,
      },
      options.signal,
    );
    return {
      rows: response.rows.map((row) => ({
        rankGroup: row.rankGroup,
        domain: row.domain,
        title: row.title,
        url: row.url,
      })),
      costUsd: response.costUsd,
    };
  };
}
