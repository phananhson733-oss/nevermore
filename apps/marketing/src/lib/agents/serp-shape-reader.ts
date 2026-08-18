// @input  -- the visitor's confirmed query and the market it should be read in
// @output -- one live sample of one results page, or null
// @pos    -- the only paid provider call the Agent audit makes
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createDataForSeoKeywordMetricsClient } from "@sf/sources";
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

export interface SerpShapeReadInput {
  readonly keyword: string;
  readonly marketCode?: string | undefined;
  readonly languageCode?: string | undefined;
}

export function createSerpShapeReader(options: {
  readonly login: string;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
}): (input: SerpShapeReadInput) => Promise<SerpShapeRaw | null> {
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
      if (error instanceof KeywordMarketError) return null;
      throw error;
    }

    try {
      const response = await client.serpOrganic({
        keyword,
        locationCode,
        languageCode: language,
        depth: SAMPLE_DEPTH,
      });
      return {
        keyword,
        itemTypes: response.itemTypes,
        unresolvedItemCount: response.unresolvedItemCount,
        organicCount: response.rows.length,
        marketCode: market,
        languageCode: language,
      };
    } catch {
      // A provider that did not answer is not a fact about the results page.
      // The records report the sample they do not have.
      return null;
    }
  };
}

/**
 * The production reader, or null when no credentials are configured.
 *
 * Null is settled, not failed: the checks report the source they need. It is
 * also the only state in which this code makes no paid call at all, which is
 * the right default for a deployment that has not opted in.
 */
export function defaultSerpShapeReader():
  | ((input: SerpShapeReadInput) => Promise<SerpShapeRaw | null>)
  | null {
  const login = process.env["DATAFORSEO_LOGIN"];
  const password = process.env["DATAFORSEO_PASSWORD"];
  if (!login?.trim() || !password?.trim()) return null;
  return createSerpShapeReader({ login, password });
}
