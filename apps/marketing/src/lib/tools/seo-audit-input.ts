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

  return { ok: true, value: { url: input.url, targetQueries, pageRole } };
}
