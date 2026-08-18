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

import {
  getServerAuthenticationStatus,
  type ServerAuthenticationStatus,
} from "../auth/server-auth-status.ts";
import { extractClientIp } from "../rate-limit.ts";
import { createDraftCompletion } from "../tools/quick-wins-drafts.ts";
import { readPublicToolJson } from "../tools/public-tool-request.ts";
import { consumePublicToolQuota } from "../tools/shared-rate-limit.ts";

/**
 * A draft is one model call on text the caller already holds. It is cheap next
 * to a crawl and expensive next to nothing, so the budget is per visitor and
 * generous enough to work through a report without being a free model endpoint.
 */
export const DRAFT_IP_MAX = 30;
export const DRAFT_IP_WINDOW_SECONDS = 60 * 60;
/** The whole request's share of the clock; a draft never blocks anything else. */
const DRAFT_BUDGET_MS = 30_000;
const DRAFT_BODY_LIMIT_BYTES = 24 * 1024;
/** Bounds one prompt. Longer inputs are cut, never refused. */
const MAX_TEXT = 2_000;
const MAX_HEADINGS = 24;

export type DraftErrorCode =
  | "auth_required"
  | "auth_unavailable"
  | "invalid_request"
  | "rate_limited"
  | "quota_unavailable"
  | "drafts_unavailable"
  | "draft_unusable";

const STATUS: Readonly<Record<DraftErrorCode, number>> = {
  auth_required: 401,
  auth_unavailable: 503,
  invalid_request: 400,
  rate_limited: 429,
  quota_unavailable: 503,
  drafts_unavailable: 503,
  draft_unusable: 502,
};

export interface DraftHandlerDependencies {
  readonly authenticate: () => Promise<ServerAuthenticationStatus>;
  readonly consumeQuota: (
    clientIp: string,
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
  authenticate: getServerAuthenticationStatus,
  consumeQuota: async (clientIp) => {
    const outcome = await consumePublicToolQuota(
      `agent-draft:${clientIp}`,
      DRAFT_IP_MAX,
      DRAFT_IP_WINDOW_SECONDS,
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
  const url = text(value.url);
  if (url === null) return null;
  const headings = Array.isArray(value.headings)
    ? value.headings
        .map(text)
        .filter((entry): entry is string => entry !== null)
        .slice(0, MAX_HEADINGS)
    : [];

  return {
    kind: kind as SolutionDraftKind,
    url,
    title: text(value.title),
    metaDescription: text(value.metaDescription),
    headings,
    targetQuery: text(value.targetQuery),
    pageType: text(value.pageType),
    openingText: text(value.openingText),
  };
}

export async function handleAgentDraftRequest(
  request: Request,
  dependencies: DraftHandlerDependencies = DEFAULT_DRAFT_DEPENDENCIES,
): Promise<Response> {
  let authentication: ServerAuthenticationStatus = "unavailable";
  try {
    authentication = await dependencies.authenticate();
  } catch {
    return fail("auth_unavailable");
  }
  if (authentication === "unauthenticated") return fail("auth_required");
  if (authentication !== "authenticated") return fail("auth_unavailable");

  const body = await readPublicToolJson(request, DRAFT_BODY_LIMIT_BYTES);
  if (!body.ok) return fail("invalid_request");
  const input = readInput(body.value);
  if (input === null) return fail("invalid_request");

  const quota = await dependencies.consumeQuota(extractClientIp(request.headers));
  if (quota.kind === "limited") {
    return fail("rate_limited", quota.retryAfterSeconds);
  }
  if (quota.kind === "unavailable") return fail("quota_unavailable");

  const deadline = Date.now() + DRAFT_BUDGET_MS;
  const complete = dependencies.createCompletion(() => deadline - Date.now());
  // A deployment with no model configured offers no drafts. That is a
  // configuration fact, not a failure of this request, and the surface says so
  // rather than inviting a retry that cannot succeed.
  if (complete === null) return fail("drafts_unavailable");

  let reply: { readonly text: string };
  try {
    reply = await complete(buildSolutionDraftPrompt(input));
  } catch {
    return fail("draft_unusable");
  }

  const draft: SolutionDraft | null = readSolutionDraft(input.kind, reply.text);
  // A reply that is merely close is refused. Shown beside measured evidence a
  // half-read draft carries the same weight, and a field the model dropped
  // renders as an empty box the reader takes for "nothing to say here".
  if (draft === null) return fail("draft_unusable");

  return Response.json({ data: { draft } }, { status: 200 });
}
