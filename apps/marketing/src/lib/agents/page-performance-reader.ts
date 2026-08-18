// @input  -- the collected target URL and, at the deploy boundary, a PSI key
// @output -- CrUX p75 field values for that URL, or null
// @pos    -- the only place the Agent audit calls PageSpeed Insights
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  shapeCruxField,
  type PsiLoadingExperience,
} from "../diagnostics/technical-health/worker/data-sources/crux-source";
import type { PagePerformanceRaw } from "@sf/public-tools/seo-audit/page-performance";

const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/**
 * Mobile, because that is the experience Google reports a site's Core Web
 * Vitals from, and a desktop-only reading would pass sites that fail the
 * assessment that matters.
 */
const FORM_FACTOR = "mobile" as const;

/**
 * An audit must not wait on PageSpeed Insights.
 *
 * PSI runs Lighthouse before it answers, so it is slow by construction — the
 * field data we want is returned alongside a lab run we do not. A run that
 * cannot get an answer in time degrades to the gated state, which is a state
 * the visitor can act on, unlike a failed audit.
 */
const READ_TIMEOUT_MS = 20_000;

/** Only the field block is read; the Lighthouse categories are not requested. */
const CATEGORY = "performance";

export interface PagePerformanceReadInput {
  /** The URL the crawl actually landed on, never the submitted form. */
  readonly url: string;
}

interface PsiFieldResponse {
  readonly loadingExperience?: PsiLoadingExperience;
  readonly originLoadingExperience?: PsiLoadingExperience;
}

export function createPagePerformanceReader(options: {
  /** Resolved at the deploy boundary; this module never reads process.env. */
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}): (input: PagePerformanceReadInput) => Promise<PagePerformanceRaw | null> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async ({ url }) => {
    const query = new URLSearchParams({
      url,
      strategy: FORM_FACTOR,
      category: CATEGORY,
      key: options.apiKey,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${PSI_ENDPOINT}?${query.toString()}`, {
        signal: controller.signal,
      });
      // Every failure is the same answer here: no field data. PSI answers 429
      // on a shared quota and 5xx under load, and neither is a fact about the
      // audited page — reporting them as one would attribute our budget to the
      // site, which is what the crawl-waste checks already refuse to do.
      if (!response.ok) return null;
      const body = (await response.json()) as PsiFieldResponse;
      const field = shapeCruxField(
        body.loadingExperience,
        body.originLoadingExperience,
      );
      if (field === null) return null;
      return {
        url,
        sourceLevel: field.source,
        lcp: field.lcp,
        inp: field.inp,
        cls: field.cls,
        ttfb: field.ttfb,
        formFactor: FORM_FACTOR,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * The production reader, or null when no key is configured.
 *
 * Null is a settled answer, not a failure: the checks report the source they
 * need and stay excluded. Reading a missing key as "no field data for this
 * page" would tell a visitor CrUX has nothing on their site when we simply
 * never asked.
 */
export function defaultPagePerformanceReader():
  | ((input: PagePerformanceReadInput) => Promise<PagePerformanceRaw | null>)
  | null {
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") return null;
  return createPagePerformanceReader({ apiKey });
}
