// @input  -- one primary keyword, market/language, abort signal and optional local PAA retention
// @output -- organic rows/counts/cost and, only on opt-in, initial PAA with independent availability
// @pos    -- the Content Brief Builder's only paid SERP read; a thin reader, no Labs call
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { SERP_DEPTH } from "@sf/public-tools/content-brief/constants";
import type { SerpReadMeta } from "@sf/public-tools/content-brief/contract";
import {
  createDataForSeoKeywordMetricsClient,
  type DataForSeoKeywordMetricsClient,
  type DataForSeoSerpPeopleAlsoAsk,
} from "@sf/sources/dataforseo/keyword-metrics";
import { SERP_LANGUAGES, SERP_LOCATIONS } from "./serp-markets.ts";

/**
 * Why this is not `readSerpLandscape`.
 *
 * That reader answers a different question ("is this page on page one?"): it
 * drops `url` and `title` from what it returns, and it buys a second Labs call
 * for domain traffic on every read. The brief needs exactly the two fields it
 * drops — the crawl fetches `url`, the format classifier reads `title` — and
 * has no use for the call it adds. One paid call, the rows verbatim.
 */

export interface ContentBriefSerpRow {
  readonly rank: number;
  /** The provider may omit it; a null row is skipped by the crawl, never guessed. */
  readonly url: string | null;
  readonly domain: string;
  readonly title: string | null;
}

export type ContentBriefSerpPeopleAlsoAsk =
  | DataForSeoSerpPeopleAlsoAsk
  | { readonly status: "unavailable"; readonly reason: "timeout" | "provider_error" };

export interface ContentBriefSerpResult {
  readonly rows: readonly ContentBriefSerpRow[];
  readonly reads: SerpReadMeta;
  /** What the provider charged. Null when no response arrived to read it from. */
  readonly costUsd: number | null;
  /** Feature names on the sampled page. Null when the provider did not report them. */
  readonly itemTypes: readonly string[] | null;
  /** Only present on opt-in; PAA availability is independent of organic row counts. */
  readonly peopleAlsoAsk?: ContentBriefSerpPeopleAlsoAsk;
}

export interface ContentBriefSerpInput {
  readonly keyword: string;
  readonly market: string;
  readonly language: string;
  readonly signal: AbortSignal;
  /** Retains initial PAA from the same response, without a paid expansion request. */
  readonly includePeopleAlsoAsk?: boolean;
}

export interface ContentBriefSerpDependencies {
  readonly client?: DataForSeoKeywordMetricsClient;
  readonly login?: string;
  readonly password?: string;
  /** Reports what the call cost, on top of the log line every paid call writes. */
  readonly onCost?: (usd: number) => void;
}

export type ContentBriefSerpInputErrorCode =
  | "unsupported_market"
  | "unsupported_language";

/**
 * The only thing this reader throws.
 *
 * Every provider outcome resolves into `reads`, because a brief is context
 * around the evidence that did arrive. A market or language the allow-list
 * refuses is different: nothing was spent, nothing was read, and the caller
 * has a request-validation branch that already speaks in codes.
 */
export class ContentBriefSerpInputError extends Error {
  readonly code: ContentBriefSerpInputErrorCode;

  constructor(code: ContentBriefSerpInputErrorCode) {
    super(`content-brief serp input rejected: ${code}`);
    this.name = "ContentBriefSerpInputError";
    this.code = code;
  }
}

/**
 * One line per paid call, so the spend can be summed out of the logs.
 * `unresolved` rides along: a page the provider could not describe is a
 * provider fact worth being able to count later, not just a status.
 */
function logProviderCost(
  usd: number,
  market: string,
  keyword: string,
  unresolved: number,
): void {
  console.info(
    `[content-brief] paid_call provider=dataforseo cost_usd=${usd} market=${market} query_units=${
      [...keyword].length
    } unresolved=${unresolved}`,
  );
}

/**
 * Whether a failure was the deadline rather than the provider.
 *
 * The client wraps an aborted request into a `SourceError` with code
 * `TIMEOUT`; a raw `AbortError` is checked too so an injected client that
 * rethrows the DOM exception verbatim lands in the same branch.
 */
function isTimeout(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  return "code" in error && error.code === "TIMEOUT";
}

interface ResolvedTarget {
  readonly market: string;
  readonly locationCode: number;
  readonly language: string;
}

/**
 * The provider takes an upper-case market and a bare language code. `us` and
 * `en-US` are the same request as `US` / `en` to a visitor; sending `zh-CN`
 * where the provider expects `zh` would be a paid error.
 */
function resolveTarget(input: ContentBriefSerpInput): ResolvedTarget {
  const market = input.market.trim().toUpperCase();
  const locationCode = SERP_LOCATIONS[market];
  if (locationCode === undefined) {
    throw new ContentBriefSerpInputError("unsupported_market");
  }
  const language = input.language.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (!SERP_LANGUAGES.has(language)) {
    throw new ContentBriefSerpInputError("unsupported_language");
  }
  return { market, locationCode, language };
}

function unavailable(
  reason: "insufficient_evidence" | "timeout" | "provider_error",
): SerpReadMeta {
  return { status: "unavailable", reason, attempted: SERP_DEPTH };
}

/**
 * `unresolved` is the provider's own count of organic items it reported but
 * could not describe (no usable rank or domain). They are not in `rows` and
 * not in `returned`, but a page that lost some of its results is a weaker
 * sample, so they make the read `partial` and are carried as a number rather
 * than silently dropped.
 */
function readsFor(returned: number, unresolved: number): SerpReadMeta {
  if (returned === 0) {
    // The provider answered with rows and we could read none of them: that
    // is the provider's page being unreadable, not a query with no results.
    // The Unavailable branch has no `unresolved` slot; the count is in the log.
    return unavailable(unresolved > 0 ? "provider_error" : "insufficient_evidence");
  }
  return {
    status: returned < SERP_DEPTH || unresolved > 0 ? "partial" : "complete",
    requested: SERP_DEPTH,
    returned,
    unresolved,
  };
}

function failed(
  reason: "timeout" | "provider_error",
  includePeopleAlsoAsk: boolean,
): ContentBriefSerpResult {
  return {
    rows: [],
    reads: unavailable(reason),
    costUsd: null,
    itemTypes: null,
    ...(includePeopleAlsoAsk ? { peopleAlsoAsk: { status: "unavailable" as const, reason } } : {}),
  };
}

/**
 * Read page one for the primary keyword.
 *
 * Resolves on every provider outcome: a returned page is `complete` or
 * `partial` by count, an empty page is `insufficient_evidence`, the deadline
 * is `timeout`, anything else is `provider_error`. Only an input the
 * allow-lists refuse throws, and that happens before any request is made.
 */
export async function readContentBriefSerp(
  input: ContentBriefSerpInput,
  dependencies: ContentBriefSerpDependencies = {},
): Promise<ContentBriefSerpResult> {
  const target = resolveTarget(input);
  const includePeopleAlsoAsk = input.includePeopleAlsoAsk === true;
  try {
    // Built inside the try: the client throws on an empty credential, and a
    // deployment without the variable set is a `provider_error` read, not a 500.
    const client =
      dependencies.client ??
      createDataForSeoKeywordMetricsClient({
        login: dependencies.login ?? process.env["DATAFORSEO_LOGIN"] ?? "",
        password:
          dependencies.password ?? process.env["DATAFORSEO_PASSWORD"] ?? "",
      });
    const response = await client.serpOrganic(
      {
        keyword: input.keyword,
        locationCode: target.locationCode,
        languageCode: target.language,
        depth: SERP_DEPTH,
        ...(includePeopleAlsoAsk ? { includePeopleAlsoAsk: true } : {}),
      },
      input.signal,
    );
    logProviderCost(
      response.costUsd,
      target.market,
      input.keyword,
      response.unresolvedItemCount,
    );
    dependencies.onCost?.(response.costUsd);

    const rows = response.rows.map(
      (row): ContentBriefSerpRow => ({
        rank: row.rankGroup,
        url: row.url,
        domain: row.domain,
        title: row.title,
      }),
    );
    return {
      rows,
      reads: readsFor(rows.length, response.unresolvedItemCount),
      costUsd: response.costUsd,
      itemTypes: response.itemTypes,
      ...(includePeopleAlsoAsk ? {
        peopleAlsoAsk: response.peopleAlsoAsk ?? { status: "unavailable" as const, reason: "not_reported" as const },
      } : {}),
    };
  } catch (error) {
    if (isTimeout(error, input.signal)) return failed("timeout", includePeopleAlsoAsk);
    console.error(
      `[content-brief] serp provider_error market=${target.market}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return failed("provider_error", includePeopleAlsoAsk);
  }
}
