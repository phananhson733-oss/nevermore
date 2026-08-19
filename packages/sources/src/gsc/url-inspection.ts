// @input  -- a verified property, an access token, and URLs from its sitemap
// @output -- Google's own index verdict per URL, or a named reason there is none
// @pos    -- the only caller of the URL Inspection API
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * A different host and a different version from the rest of this folder.
 *
 * `client.ts`, `search-analytics.ts` and `daily-series.ts` all build on
 * `https://www.googleapis.com/webmasters/v3/sites`. URL Inspection is not
 * served there — it is `searchconsole.googleapis.com/v1` — so the shared
 * constant cannot be reused and is deliberately not imported.
 */
const URL_INSPECTION_ENDPOINT =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

/**
 * Site-level ceiling Google publishes, in queries per minute.
 *
 * Per SITE, not per project and not per user — so it is shared with every
 * other tool the customer points at the same property. We stay well under it.
 */
const SITE_QUERIES_PER_MINUTE = 600;

/** Concurrent inspections. Kept far below the per-minute ceiling. */
const CONCURRENCY = 5;

/**
 * Minimum spacing between batches, derived from the published site ceiling.
 *
 * Concurrency alone is not a rate limit: five at a time with no spacing issues
 * as fast as the network allows, which on a warm connection is far past 600 a
 * minute. The ceiling is per SITE and shared with every other tool the
 * customer points at the property, so overrunning it does not just fail our
 * run — it spends quota their other workflows were relying on. Half the
 * published rate leaves room for those other tools.
 */
const BATCH_INTERVAL_MS = Math.ceil(
  (60_000 * CONCURRENCY) / (SITE_QUERIES_PER_MINUTE / 2),
);

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How many URLs a census of the given length of time can actually cover.
 *
 * Pacing is `CONCURRENCY` URLs every `BATCH_INTERVAL_MS`, so the budget buys a
 * fixed number of batches and nothing else. Exported because the caller sizes
 * its own population cap against it: the two numbers used to be independent —
 * a 500-URL publication cap and a 60-second budget that covers about 300 — and
 * every site between them spent three hundred calls of a quota shared with the
 * customer's other tools, then returned unavailable.
 */
export function maxCensusUrls(budgetMs: number): number {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return 0;
  return Math.floor(budgetMs / BATCH_INTERVAL_MS) * CONCURRENCY;
}

/**
 * Google's verdict enumeration, as the discovery document types it.
 *
 * Every one of these is a real enum in the API. `coverageState` — the field
 * that would name "Discovered, currently not indexed" — is deliberately NOT
 * read: the discovery document types it as a bare string with no enumeration,
 * it is a localized UI label, and Google reworded these labels wholesale in
 * the 2023 Page Indexing rework. A detector keyed on it fails silently toward
 * "indexed", which is the direction that hides a broken site.
 */
export type UrlIndexVerdict =
  | "VERDICT_UNSPECIFIED"
  | "PASS"
  | "PARTIAL"
  | "FAIL"
  | "NEUTRAL";

export interface UrlIndexStatus {
  readonly url: string;
  /** `PASS` is Search Console's "Valid"; `NEUTRAL` is its "Excluded". */
  readonly verdict: UrlIndexVerdict;
  /** Absent when Google has never successfully crawled the URL. */
  readonly lastCrawledAt: string | null;
}

export type UrlInspectionFailureReason =
  | "quota_exhausted"
  | "not_authorized"
  | "provider_unavailable"
  /** More URLs than this run's wall-clock budget can pace. Nothing was spent. */
  | "census_larger_than_one_run";

export type UrlInspectionResult =
  | {
      readonly status: "ok";
      readonly statuses: readonly UrlIndexStatus[];
      /** URLs that were asked about but produced no usable answer. */
      readonly unanswered: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason: UrlInspectionFailureReason;
    };

interface InspectionResponse {
  readonly inspectionResult?: {
    readonly indexStatusResult?: {
      readonly verdict?: unknown;
      readonly lastCrawlTime?: unknown;
    };
  };
}

const VERDICTS: ReadonlySet<string> = new Set([
  "VERDICT_UNSPECIFIED",
  "PASS",
  "PARTIAL",
  "FAIL",
  "NEUTRAL",
]);

export interface UrlInspectionOptions {
  readonly siteUrl: string;
  readonly accessToken: string;
  readonly urls: readonly string[];
  readonly fetchImpl?: typeof fetch;
  /** Wall-clock ceiling for the whole census. */
  readonly budgetMs?: number;
  readonly now?: () => number;
  /** Injected in tests so the pacing gate never sleeps for real. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks Google whether it has each URL indexed.
 *
 * One request per URL: `InspectUrlIndexRequest` carries a single scalar
 * `inspectionUrl`, and the batch endpoint counts an n-call batch as n calls
 * against the quota, so batching would buy round-trips and nothing else.
 *
 * Returns `unavailable` for the whole census rather than a partial one when
 * the quota runs out or authorization fails. A rate computed over "the URLs we
 * got answers for before Google cut us off" is a sample whose membership is
 * decided by request order, and publishing it against a whole-site threshold
 * would be a guess wearing a measurement's clothes.
 */
export async function inspectUrlIndexStatus(
  options: UrlInspectionOptions,
): Promise<UrlInspectionResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const budgetMs = options.budgetMs ?? 60_000;

  // Decided before anything is spent. Discovering mid-run that the census
  // cannot finish costs the property hundreds of calls against a per-site
  // ceiling shared with everything else the customer points at it, and buys a
  // result that was never going to be publishable.
  if (options.urls.length > maxCensusUrls(budgetMs)) {
    return { status: "unavailable", reason: "census_larger_than_one_run" };
  }

  const statuses: UrlIndexStatus[] = [];
  let unanswered = 0;
  let fatal: UrlInspectionFailureReason | null = null;

  const inspect = async (url: string): Promise<void> => {
    if (fatal !== null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(URL_INSPECTION_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          inspectionUrl: url,
          siteUrl: options.siteUrl,
        }),
      });
      if (response.status === 429) {
        fatal = "quota_exhausted";
        return;
      }
      if (response.status === 401 || response.status === 403) {
        fatal = "not_authorized";
        return;
      }
      if (!response.ok) {
        unanswered += 1;
        return;
      }
      const body = (await response.json()) as InspectionResponse;
      const result = body.inspectionResult?.indexStatusResult;
      const verdict = result?.verdict;
      if (typeof verdict !== "string" || !VERDICTS.has(verdict)) {
        unanswered += 1;
        return;
      }
      const crawled = result?.lastCrawlTime;
      statuses.push({
        url,
        verdict: verdict as UrlIndexVerdict,
        lastCrawledAt: typeof crawled === "string" ? crawled : null,
      });
    } catch {
      unanswered += 1;
    } finally {
      clearTimeout(timer);
    }
  };

  for (let start = 0; start < options.urls.length; start += CONCURRENCY) {
    if (fatal !== null) break;
    // The census is all-or-nothing, so running out of time is the same answer
    // as running out of quota: no rate, and a reason the reader can act on.
    if (now() - startedAt >= budgetMs) {
      return { status: "unavailable", reason: "provider_unavailable" };
    }
    const batchStartedAt = now();
    await Promise.all(
      options.urls.slice(start, start + CONCURRENCY).map(inspect),
    );
    const elapsed = now() - batchStartedAt;
    const pause = BATCH_INTERVAL_MS - elapsed;
    if (pause > 0 && start + CONCURRENCY < options.urls.length) {
      // A pause that does not fit is the end of the run, not a pause to skip.
      // Skipping it used to leave the loop running: the top-of-loop guard only
      // trips once the budget is already spent, so the last second fired
      // batches back to back at roughly 1500 a minute against a 600-a-minute
      // per-site ceiling shared with the customer's other tools — and then
      // returned unavailable anyway. Overrunning someone else's quota to fail
      // faster is not a trade worth making.
      if (now() - startedAt + pause >= budgetMs) {
        return { status: "unavailable", reason: "provider_unavailable" };
      }
      await (options.sleep ?? defaultSleep)(pause);
    }
  }

  if (fatal !== null) return { status: "unavailable", reason: fatal };
  // A census is all or nothing. Returning the URLs that happened to answer
  // would hand the caller a denominator made of exactly the URLs Google felt
  // like responding about: one indexed page plus four hundred failed requests
  // renders as 100% index coverage and clears the 90% rail. The membership of
  // that sample is decided by request order and provider mood, which is the
  // "unavailable is not 0" rule broken in the direction that hides a failure.
  if (statuses.length === 0 || unanswered > 0) {
    return { status: "unavailable", reason: "provider_unavailable" };
  }
  return { status: "ok", statuses, unanswered };
}

/** Exported so a caller can size its census against the published ceiling. */
export const URL_INSPECTION_SITE_QUERIES_PER_MINUTE = SITE_QUERIES_PER_MINUTE;
