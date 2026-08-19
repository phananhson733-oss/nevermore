// @input  -- the collected target URL and, at the deploy boundary, a PSI key
// @output -- CrUX p75 field values for that URL, or null
// @pos    -- the only place the Agent audit calls PageSpeed Insights
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  shapeCruxField,
  type PsiLoadingExperience,
} from "../diagnostics/technical-health/worker/data-sources/crux-source";
import type {
  PagePerformanceRaw,
  PageWeightRaw,
} from "@sf/public-tools/seo-audit/page-performance";

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

/**
 * Runs the Lighthouse performance category.
 *
 * PSI runs it whether or not we ask — the REST reference says a request naming
 * no category runs Performance anyway — so the lab block arrives in every
 * response we already pay for. This reader used to parse it out and drop it,
 * while 8.5 stood in the catalogue marked unmeasurable for wanting exactly the
 * number sitting in the discarded half of the body.
 */
const CATEGORY = "performance";

/**
 * Lighthouse's id for the sum of every network request's transferred bytes.
 *
 * `numericValue` only. Never `.score`, which is a log-normal curve against
 * Lighthouse's own reference points; the catalogue's published rule is a flat
 * 2 MB and scoring it on someone else's curve answers a different question.
 */
const TOTAL_BYTE_WEIGHT_AUDIT = "total-byte-weight";

export interface PagePerformanceReadInput {
  /** The URL the crawl actually landed on, never the submitted form. */
  readonly url: string;
}

/**
 * Why there is no field data, when there is none.
 *
 * Kept apart because collapsing them is a lie about the audited site. A run
 * with a rejected key or an exhausted quota that reports "CrUX has no data for
 * this page" is stating a fact about someone else's traffic that it never
 * observed — and it was doing exactly that until a live call proved the key in
 * use was invalid. Mirrors the reason vocabulary the vendored PSI source
 * already carried, which had this distinction and which the first version of
 * this reader threw away.
 */
export type PagePerformanceUnavailableReason =
  | "no_field_data"
  | "provider_rejected_credentials"
  | "provider_quota_exhausted"
  | "provider_unavailable";

/**
 * The lab block travels beside the field block, never inside it.
 *
 * CrUX field data and the Lighthouse lab run are independent facts about one
 * response: a page with no real-visit sample still gets weighed, and a page
 * with a full CrUX profile can still come back without the lab audit. Folding
 * the weight into the `ok` arm would have thrown it away in exactly the case
 * 8.5 exists for — a brand-new page too fresh for CrUX and too heavy to load.
 */
export type PagePerformanceReadResult = (
  | { readonly status: "ok"; readonly field: PagePerformanceRaw }
  | {
      readonly status: "unavailable";
      readonly reason: PagePerformanceUnavailableReason;
    }
) & {
  /** Null when PSI answered without a usable `total-byte-weight` audit. */
  readonly weight: PageWeightRaw | null;
};

interface PsiFieldResponse {
  readonly loadingExperience?: PsiLoadingExperience;
  readonly originLoadingExperience?: PsiLoadingExperience;
  readonly lighthouseResult?: {
    readonly finalUrl?: unknown;
    readonly requestedUrl?: unknown;
    readonly audits?: Record<string, { readonly numericValue?: unknown }>;
  };
}

/**
 * The transferred weight of the page Lighthouse actually loaded.
 *
 * Fail-closed on every field. A non-integer, a negative, or a missing audit
 * yields null rather than a zero — a page reported as weighing nothing would
 * pass 8.5 outright, which is the "unavailable is not 0" rule broken in the
 * direction that hides the finding.
 */
function readWeight(body: PsiFieldResponse): PageWeightRaw | null {
  const lab = body.lighthouseResult;
  if (lab === undefined) return null;
  const value = lab.audits?.[TOTAL_BYTE_WEIGHT_AUDIT]?.numericValue;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  // The URL Lighthouse ended on, so the record names the page that was weighed
  // rather than the one we asked about. They differ on every redirect.
  const landed = lab.finalUrl ?? lab.requestedUrl;
  if (typeof landed !== "string" || landed.trim() === "") return null;
  return { url: landed, totalTransferBytes: Math.round(value) };
}

export function createPagePerformanceReader(options: {
  /** Resolved at the deploy boundary; this module never reads process.env. */
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}): (input: PagePerformanceReadInput) => Promise<PagePerformanceReadResult> {
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
      if (!response.ok) {
        // Named, not collapsed. A rejected key and an exhausted quota are our
        // problems; reporting either as "CrUX has no data for this page" states
        // something about the site's traffic that was never observed.
        if (
          response.status === 400 ||
          response.status === 401 ||
          response.status === 403
        ) {
          return {
            status: "unavailable",
            reason: "provider_rejected_credentials",
            weight: null,
          };
        }
        if (response.status === 429) {
          return {
            status: "unavailable",
            reason: "provider_quota_exhausted",
            weight: null,
          };
        }
        return {
          status: "unavailable",
          reason: "provider_unavailable",
          weight: null,
        };
      }
      const body = (await response.json()) as PsiFieldResponse;
      const weight = readWeight(body);
      const field = shapeCruxField(
        body.loadingExperience,
        body.originLoadingExperience,
      );
      // The one case that IS about the page: PSI answered, and CrUX published
      // no p75 for this URL or its origin. The lab run still happened, so the
      // weight rides along rather than dying with the field block.
      if (field === null)
        return { status: "unavailable", reason: "no_field_data", weight };
      return {
        status: "ok",
        weight,
        field: {
          url,
          sourceLevel: field.source,
          lcp: field.lcp,
          inp: field.inp,
          cls: field.cls,
          ttfb: field.ttfb,
          formFactor: FORM_FACTOR,
        },
      };
    } catch {
      return {
        status: "unavailable",
        reason: "provider_unavailable",
        weight: null,
      };
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
  | ((input: PagePerformanceReadInput) => Promise<PagePerformanceReadResult>)
  | null {
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") return null;
  return createPagePerformanceReader({ apiKey });
}
