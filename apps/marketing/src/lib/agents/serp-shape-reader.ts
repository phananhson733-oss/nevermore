// @input  -- the visitor's confirmed query and the market it should be read in
// @output -- one live sample of one results page, or null
// @pos    -- the only paid provider call the Agent audit makes
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createDataForSeoKeywordMetricsClient } from "@sf/sources";
import {
  bulkTrafficEstimation,
  labsLanguageForMarket,
} from "@sf/sources/dataforseo/labs-traffic";
import type { SerpShapeRaw } from "@sf/public-tools/seo-audit/serp-shape";

import {
  KeywordMarketError,
  keywordLocationCode,
} from "../tools/keyword-providers.ts";

/**
 * One results page. Not five.
 *
 * This is a paid live call and the two checks it feeds ask about the shape of a
 * results page, not about a ranking. A second query answers the same question
 * about a second page and doubles the cost of every run to do it, so the sample
 * is the query the evidence layer already selected as primary.
 */
const SAMPLE_DEPTH = 10;

/** Fallbacks, used only when the visitor confirmed no market or language. */
const DEFAULT_MARKET = "US";
const DEFAULT_LANGUAGE = "en";

export type SerpShapeReadResult =
  | { readonly status: "ok"; readonly sample: SerpShapeRaw }
  | {
      readonly status: "unavailable";
      readonly reason: "market_not_supported" | "provider_unavailable";
    };

export interface SerpShapeReadInput {
  readonly keyword: string;
  readonly marketCode?: string | undefined;
  readonly languageCode?: string | undefined;
}

export interface SerpShapeReaderDependencies {
  readonly login: string;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
  /** Injected in tests so no suite ever reaches a paid endpoint. */
  readonly estimateTraffic?: typeof bulkTrafficEstimation;
}

export function createSerpShapeReader(
  options: SerpShapeReaderDependencies,
): (input: SerpShapeReadInput) => Promise<SerpShapeReadResult> {
  const client = createDataForSeoKeywordMetricsClient({
    login: options.login,
    password: options.password,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });

  return async ({ keyword, marketCode, languageCode }) => {
    const market = (marketCode ?? DEFAULT_MARKET).toUpperCase();
    const language = languageCode ?? DEFAULT_LANGUAGE;

    // Resolved before the request, not inside it. An unmapped market would be
    // rejected by the provider after we had already paid for the call, and
    // paying to learn that we cannot ask is the one outcome with no upside.
    let locationCode: number;
    try {
      locationCode = keywordLocationCode(market);
    } catch (error) {
      if (error instanceof KeywordMarketError) {
        return { status: "unavailable", reason: "market_not_supported" };
      }
      throw error;
    }

    try {
      const response = await client.serpOrganic({
        keyword,
        locationCode,
        languageCode: language,
        depth: SAMPLE_DEPTH,
      });
      // One extra call for every domain on page one, not one per domain: the
      // endpoint takes up to a thousand targets per task. The domains
      // themselves cost nothing — the SERP sample above already carries them.
      const domainTraffic = await sizePageOne(
        response.rows.map((row) => row.domain),
        market,
        locationCode,
        options,
      );

      return {
        status: "ok",
        sample: {
          keyword,
          itemTypes: response.itemTypes,
          unresolvedItemCount: response.unresolvedItemCount,
          organicCount: response.rows.length,
          domainTraffic,
          marketCode: market,
          languageCode: language,
        },
      };
    } catch {
      // A provider that did not answer is not a fact about the results page,
      // and it is not the visitor failing to confirm a query either.
      return { status: "unavailable", reason: "provider_unavailable" };
    }
  };
}

/**
 * Estimated monthly organic traffic for each domain on page one, or null.
 *
 * Null in every way there is no answer — an unserved market, missing
 * credentials, a provider that did not respond. Never an empty list: an empty
 * list reads downstream as "nobody on page one is small", which is a finding,
 * and inventing it out of a provider gap would tell a visitor a query is hard
 * when nobody ever looked.
 *
 * The language is Labs' own, never the SERP call's. That call normalises to a
 * bare primary subtag on purpose, and Labs serves Norway only as `nb` and
 * Taiwan only as `zh-TW` — sending the SERP pair here buys a paid error.
 */
async function sizePageOne(
  domains: readonly string[],
  market: string,
  locationCode: number,
  dependencies: SerpShapeReaderDependencies,
): Promise<
  readonly { readonly domain: string; readonly organicEtv: number | null }[] | null
> {
  const languageCode = labsLanguageForMarket(market);
  if (languageCode === null) return null;
  const login = dependencies.login ?? process.env["DATAFORSEO_LOGIN"] ?? "";
  const password =
    dependencies.password ?? process.env["DATAFORSEO_PASSWORD"] ?? "";
  if (login === "" || password === "") return null;

  const estimated = await (dependencies.estimateTraffic ??
    bulkTrafficEstimation)({
    login,
    password,
    targets: domains,
    locationCode,
    languageCode,
  });
  if (estimated === null) return null;
  return estimated.rows.map((row) => ({
    domain: row.target,
    organicEtv: row.organicEtv,
  }));
}

/**
 * The production reader, or null when no credentials are configured.
 *
 * Null is settled, not failed: the checks report the source they need. It is
 * also the only state in which this code makes no paid call at all, which is
 * the right default for a deployment that has not opted in.
 */
export function defaultSerpShapeReader():
  | ((input: SerpShapeReadInput) => Promise<SerpShapeReadResult>)
  | null {
  const login = process.env["DATAFORSEO_LOGIN"];
  const password = process.env["DATAFORSEO_PASSWORD"];
  if (!login?.trim() || !password?.trim()) return null;
  return createSerpShapeReader({ login, password });
}
