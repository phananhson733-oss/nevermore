// @input  -- an authenticated request naming one solution kind and the page's own text
// @output -- one preview draft, or a stable code the surface can explain
// @pos    -- server-only boundary; nothing here applies, saves, or deploys anything
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildSolutionDraftPrompt,
  readSolutionDraft,
  SOLUTION_DRAFT_KINDS,
  type SolutionDraft,
  type SolutionDraftInput,
  type SolutionDraftKind,
} from "@sf/public-tools/seo-audit/solution-draft";

import { createHash } from "node:crypto";

import { getServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { createDraftCompletion } from "../tools/quick-wins-drafts.ts";
import { readPublicToolJson } from "../tools/public-tool-request.ts";
import { consumePublicToolQuota } from "../tools/shared-rate-limit.ts";

/**
 * A draft is one model call on text the caller already holds. It is cheap next
 * to a crawl and expensive next to nothing, so the budget is per account and
 * generous enough to work through a report without being a free model endpoint.
 */
export const DRAFT_ACCOUNT_MAX = 30;
export const DRAFT_ACCOUNT_WINDOW_SECONDS = 60 * 60;
/** The whole request's share of the clock; a draft never blocks anything else. */
const DRAFT_BUDGET_MS = 30_000;
const DRAFT_BODY_LIMIT_BYTES = 24 * 1024;
/** Bounds one prompt. Longer inputs are cut, never refused. */
const MAX_TEXT = 2_000;
const MAX_HEADINGS = 24;

/**
 * Every code this endpoint can answer with.
 *
 * A tuple, so the type, the status table and the locale-completeness test all
 * derive from it. A hand-kept list in the test would stay green when an eighth
 * code shipped without copy, and next-intl renders a missing key as its own
 * dotted path rather than throwing — so a visitor would meet the key itself.
 */
export const DRAFT_ERROR_CODES = [
  "auth_required",
  "auth_unavailable",
  "invalid_request",
  "rate_limited",
  "quota_unavailable",
  "drafts_unavailable",
  "draft_provider_unavailable",
  "draft_unusable",
] as const;

export type DraftErrorCode = (typeof DRAFT_ERROR_CODES)[number];

const STATUS: Readonly<Record<DraftErrorCode, number>> = {
  auth_required: 401,
  auth_unavailable: 503,
  invalid_request: 400,
  rate_limited: 429,
  quota_unavailable: 503,
  drafts_unavailable: 503,
  // The model was reached and did not answer. Distinct from a reply we could
  // not read: one is worth retrying and the other is not, and telling a visitor
  // their draft "came back in a format we cannot use" when nothing came back
  // describes a failure that did not happen.
  draft_provider_unavailable: 503,
  draft_unusable: 502,
};

/** Status plus, when signed in, the identity the budget belongs to. */
export type DraftAuthentication =
  | { readonly status: "authenticated"; readonly userId: string }
  | { readonly status: "unauthenticated" }
  | { readonly status: "unavailable" };

export interface DraftHandlerDependencies {
  readonly authenticate: () => Promise<DraftAuthentication>;
  /**
   * Keyed by account, not by address.
   *
   * An IP is both too narrow and too wide for this budget: one visitor rotating
   * addresses gets a fresh allowance each time, while everyone behind one
   * office or carrier NAT shares a single one, so any of them can spend it for
   * the rest.
   */
  readonly consumeQuota: (
    accountKey: string,
  ) => Promise<
    | { readonly kind: "allowed" }
    | { readonly kind: "limited"; readonly retryAfterSeconds: number }
    | { readonly kind: "unavailable" }
  >;
  /** Null when this deployment has no model configured. */
  readonly createCompletion: (
    remainingMs: () => number,
  ) => ((prompt: string) => Promise<{ readonly text: string }>) | null;
}

export const DEFAULT_DRAFT_DEPENDENCIES: DraftHandlerDependencies = {
  authenticate: async () => {
    const user = await getServerAuthenticatedUser();
    return user.status === "authenticated"
      ? { status: "authenticated", userId: user.userId }
      : { status: user.status };
  },
  consumeQuota: async (accountKey) => {
    const outcome = await consumePublicToolQuota(
      `agent-draft:${accountKey}`,
      DRAFT_ACCOUNT_MAX,
      DRAFT_ACCOUNT_WINDOW_SECONDS,
    );
    return outcome.kind === "allowed"
      ? { kind: "allowed" }
      : outcome.kind === "limited"
        ? { kind: "limited", retryAfterSeconds: outcome.retryAfterSeconds }
        : { kind: "unavailable" };
  },
  createCompletion: (remainingMs) => createDraftCompletion({ remainingMs }),
};

function fail(code: DraftErrorCode, retryAfterSeconds?: number): Response {
  return Response.json(
    { error: { code } },
    {
      status: STATUS[code],
      headers:
        retryAfterSeconds === undefined
          ? {}
          : { "retry-after": String(retryAfterSeconds) },
    },
  );
}

/**
 * The exact public URL, or null.
 *
 * Parsed rather than trusted: an unparsed string carries newlines straight into
 * the prompt, where a line of its own reads as another instruction.
 */
function publicUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return null;
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_TEXT);
}

/**
 * Reads the request.
 *
 * Every text field is the page's own, echoed back by the surface that is
 * displaying it. That is deliberate: the draft is stateless, so re-crawling to
 * fetch text the caller is already looking at would spend a request to learn
 * nothing new. Nothing read here is trusted as a fact — it is quoted into a
 * prompt whose output is preview-only and shown to this caller alone.
 */
function readInput(body: unknown): SolutionDraftInput | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  const kind = value.kind;
  if (
    typeof kind !== "string" ||
    !SOLUTION_DRAFT_KINDS.includes(kind as SolutionDraftKind)
  ) {
    return null;
  }
  const url = publicUrl(value.url);
  if (url === null) return null;
  const headings = Array.isArray(value.headings)
    ? value.headings
        .map(text)
        .filter((entry): entry is string => entry !== null)
        .slice(0, MAX_HEADINGS)
    : [];

  const input: SolutionDraftInput = {
    kind: kind as SolutionDraftKind,
    url,
    title: text(value.title),
    metaDescription: text(value.metaDescription),
    headings,
    targetQuery: text(value.targetQuery),
    pageType: text(value.pageType),
    openingText: text(value.openingText),
  };
  // The surface withholds the offer when the page's own text was never
  // collected, and the same rule has to hold here or this is a general-purpose
  // generation endpoint behind a JSON shape. A draft with nothing true to build
  // on is the empty form again, wearing a button.
  const hasPageEvidence =
    input.title !== null ||
    input.metaDescription !== null ||
    input.openingText !== null ||
    input.headings.length > 0;
  return hasPageEvidence ? input : null;
}

export async function handleAgentDraftRequest(
  request: Request,
  dependencies: DraftHandlerDependencies = DEFAULT_DRAFT_DEPENDENCIES,
): Promise<Response> {
  let authentication: DraftAuthentication = { status: "unavailable" };
  try {
    authentication = await dependencies.authenticate();
  } catch {
    return fail("auth_unavailable");
  }
  if (authentication.status === "unauthenticated") return fail("auth_required");
  if (authentication.status !== "authenticated") return fail("auth_unavailable");
  // Hashed, so an account id never becomes a key in the quota store.
  const accountKey = createHash("sha256")
    .update(authentication.userId)
    .digest("hex")
    .slice(0, 32);

  const body = await readPublicToolJson(request, DRAFT_BODY_LIMIT_BYTES);
  if (!body.ok) return fail("invalid_request");
  const input = readInput(body.value);
  if (input === null) return fail("invalid_request");

  // Before the quota, because a deployment with no model configured cannot
  // succeed and should not spend a visitor's hourly budget discovering that.
  const deadline = Date.now() + DRAFT_BUDGET_MS;
  let complete: ((prompt: string) => Promise<{ readonly text: string }>) | null;
  try {
    complete = dependencies.createCompletion(() => deadline - Date.now());
  } catch {
    return fail("drafts_unavailable");
  }
  // A configuration fact, not a failure of this request: the surface says so
  // rather than inviting a retry that cannot succeed.
  if (complete === null) return fail("drafts_unavailable");

  let quota: Awaited<ReturnType<DraftHandlerDependencies["consumeQuota"]>>;
  try {
    quota = await dependencies.consumeQuota(accountKey);
  } catch {
    // The quota store answering with a rejection is the same fact as answering
    // "unavailable"; letting it escape would return an uncontracted 500.
    return fail("quota_unavailable");
  }
  if (quota.kind === "limited") {
    return fail("rate_limited", quota.retryAfterSeconds);
  }
  if (quota.kind === "unavailable") return fail("quota_unavailable");

  let reply: { readonly text: string };
  try {
    reply = await complete(buildSolutionDraftPrompt(input));
  } catch {
    return fail("draft_provider_unavailable");
  }

  // The confirmed query travels with the reply so the reader can say whether
  // the rewrite kept it, rather than leaving the visitor to check by eye the
  // one thing the draft was offered to fix.
  const draft: SolutionDraft | null = readSolutionDraft(
    input.kind,
    reply.text,
    input.targetQuery,
  );
  // A reply that is merely close is refused. Shown beside measured evidence a
  // half-read draft carries the same weight, and a field the model dropped
  // renders as an empty box the reader takes for "nothing to say here".
  if (draft === null) return fail("draft_unusable");

  return Response.json({ data: { draft } }, { status: 200 });
}
