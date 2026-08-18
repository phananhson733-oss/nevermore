// @input  -- the parsed JSON body of an SEO audit request
// @output -- the validated URL, target queries and page role, or a rejection
// @pos    -- one request contract shared by the public tool and the Agent boundary
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  normalizeTargetQueries,
  type KeywordEvidencePageRole,
  type NormalizedTargetQuery,
} from "@sf/public-tools";

/**
 * Body budget for an SEO audit request.
 *
 * A URL, five short queries and a page role. Enforced by the bounded reader
 * before anything is parsed, so a caller cannot make either layer hold an
 * arbitrary body in memory just by sending one.
 */
export const SEO_AUDIT_REQUEST_BODY_LIMIT_BYTES = 4_096;

/**
 * Fields a caller may send.
 *
 * A whitelist rather than a key count: the keyword layer adds two optional
 * fields, and an unknown field still fails the request rather than being
 * ignored, so a caller who misspells one is told instead of quietly receiving
 * an answer to a different question.
 */
const ALLOWED_INPUT_KEYS: ReadonlySet<string> = new Set([
  "url",
  "targetQueries",
  "pageRole",
  "market",
  "language",
]);

const PAGE_ROLES: ReadonlySet<string> = new Set([
  "homepage",
  "product",
  "tool",
  "guide",
]);

export interface SeoAuditRequestInput {
  readonly url: unknown;
  /** Null when the caller sent no queries at all, never an empty list. */
  readonly targetQueries: readonly NormalizedTargetQuery[] | null;
  readonly pageRole: KeywordEvidencePageRole | null;
  /**
   * Where the visitor wants to rank, and in what language.
   *
   * Read only by the results-page lookup, which is why they arrive here rather
   * than being inferred: a market guessed from the page's own language would
   * spend a provider call on the wrong country and then report the answer as
   * though it had been asked for. The crawl itself ignores both.
   */
  readonly market: string | null;
  readonly language: string | null;
}

/**
 * Read and validate the request body.
 *
 * An over-length or sixth query fails the whole request. Repairing the list
 * would answer a question the visitor did not ask, and they cannot see that
 * happen.
 */
export function readSeoAuditInput(
  body: unknown,
):
  | { readonly ok: true; readonly value: SeoAuditRequestInput }
  | { readonly ok: false } {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !Object.hasOwn(body, "url") ||
    Object.keys(body).some((key) => !ALLOWED_INPUT_KEYS.has(key))
  ) {
    return { ok: false };
  }

  const input = body as {
    readonly url?: unknown;
    readonly targetQueries?: unknown;
    readonly pageRole?: unknown;
    readonly market?: unknown;
    readonly language?: unknown;
  };

  let targetQueries: readonly NormalizedTargetQuery[] | null = null;
  if (input.targetQueries !== undefined) {
    if (
      !Array.isArray(input.targetQueries) ||
      !input.targetQueries.every((entry) => typeof entry === "string")
    ) {
      return { ok: false };
    }
    const normalized = normalizeTargetQueries(input.targetQueries);
    if (!normalized.ok) return { ok: false };
    targetQueries = normalized.queries;
  }

  let pageRole: KeywordEvidencePageRole | null = null;
  if (input.pageRole !== undefined) {
    if (typeof input.pageRole !== "string" || !PAGE_ROLES.has(input.pageRole)) {
      return { ok: false };
    }
    pageRole = input.pageRole as KeywordEvidencePageRole;
  }

  let market: string | null = null;
  if (input.market !== undefined) {
    if (
      typeof input.market !== "string" ||
      !/^[A-Za-z]{2}$/.test(input.market)
    ) {
      return { ok: false };
    }
    market = input.market.toUpperCase();
  }

  let language: string | null = null;
  if (input.language !== undefined) {
    // A BCP-47 shape, bounded. Which languages can actually be served is the
    // lookup's business, not this validator's: failing the whole request over
    // a field the crawl never reads would lose the check to keep the context.
    if (
      typeof input.language !== "string" ||
      input.language.length > 16 ||
      !/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(input.language)
    ) {
      return { ok: false };
    }
    language = input.language;
  }

  return {
    ok: true,
    value: { url: input.url, targetQueries, pageRole, market, language },
  };
}
