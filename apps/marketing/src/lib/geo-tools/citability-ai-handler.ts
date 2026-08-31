// @input -- authenticated same-origin review request naming a raw-HTML snapshot
// @output -- one paid semantic review or safe, non-retryable evidence/admission errors
// @pos -- durable admission and refetch identity boundary; never trusts client page text
import { createHash } from "node:crypto";
import { normalizeSeoAuditUrl } from "@sf/public-tools";
import { fetchPublicResource } from "@sf/sources/public-http";
import { getServerAuthenticatedUser, type ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { extractClientIp } from "../rate-limit.ts";
import { readPublicToolJson } from "../tools/public-tool-request.ts";
import { consumePublicToolQuota, type PublicToolQuotaOutcome } from "../tools/shared-rate-limit.ts";
import { parseCitabilityAiReview, type CitabilityAiContext, type CitabilityAiReview } from "./citability-ai-contract.ts";
import { createCitabilityAiContext } from "./citability-ai-evidence.ts";
import { buildCitabilityAiTask, CitabilityAiProviderError, isCitabilityAiProviderConfigured,
  resolveCitabilityAiModel, reviewCitabilityWithDataForSeo } from "./citability-ai-provider.ts";
import { CITABILITY_FETCH_TIMEOUT_MS, CITABILITY_MAX_BODY_BYTES, CITABILITY_MAX_QUESTION_CHARS } from "./citability-contract.ts";

const REQUEST_BODY_BYTES = 4096;
const ALLOWED_KEYS = new Set(["url", "question", "rawSha256"]);
export type CitabilityAiErrorCode = "auth_required" | "auth_unavailable" | "invalid_origin" | "invalid_request"
  | "payload_too_large" | "unsupported_media_type" | "invalid_url" | "provider_unconfigured"
  | "fetch_blocked" | "fetch_timeout" | "fetch_failed" | "page_not_ok" | "not_html" | "not_utf8"
  | "evidence_incomplete" | "evidence_changed" | "rate_limited" | "quota_unavailable" | "review_already_requested"
  | "input_budget_exceeded" | "evidence_invalid" | "provider_invalid_response" | "provider_error"
  | "provider_timeout" | "provider_network_error" | "internal_error";

export interface CitabilityAiHandlerDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly normalizeUrl: typeof normalizeSeoAuditUrl;
  readonly extractClientIp: (headers: Headers) => string;
  readonly providerConfigured: () => boolean;
  readonly providerModel: () => string;
  readonly fetchResource: typeof fetchPublicResource;
  readonly consumeQuota: (key: string, max: number, windowSeconds: number) => Promise<PublicToolQuotaOutcome>;
  readonly preflight: (context: CitabilityAiContext, model: string) => unknown;
  readonly review: (context: CitabilityAiContext, model: string) => Promise<CitabilityAiReview>;
  readonly now: () => Date;
}

export const DEFAULT_CITABILITY_AI_HANDLER_DEPENDENCIES: CitabilityAiHandlerDependencies = {
  authenticate: getServerAuthenticatedUser,
  normalizeUrl: normalizeSeoAuditUrl,
  extractClientIp,
  providerConfigured: isCitabilityAiProviderConfigured,
  providerModel: resolveCitabilityAiModel,
  fetchResource: fetchPublicResource,
  consumeQuota: (key, max, seconds) => consumePublicToolQuota(key, max, seconds),
  preflight: buildCitabilityAiTask,
  review: (context, model) => reviewCitabilityWithDataForSeo(context, { model, timeoutMs: 120_000 }),
  now: () => new Date(),
};

function json(body: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private", ...headers } });
}
function fail(code: CitabilityAiErrorCode, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return json({ error: { code } }, status, headers);
}
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function readInput(value: unknown): { readonly url: unknown; readonly question: string | null; readonly rawSha256: string } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Readonly<Record<string, unknown>>;
  if (!Object.hasOwn(input, "url") || Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))
    || typeof input.rawSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(input.rawSha256)
    || (input.question !== undefined && typeof input.question !== "string")) return null;
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (question.length > CITABILITY_MAX_QUESTION_CHARS) return null;
  return { url: input.url, question: question || null, rawSha256: input.rawSha256.toLowerCase() };
}

async function admit(dependencies: CitabilityAiHandlerDependencies, key: string, max: number, seconds: number, snapshot = false): Promise<Response | null> {
  let outcome: PublicToolQuotaOutcome;
  try { outcome = await dependencies.consumeQuota(key, max, seconds); }
  catch { return fail("quota_unavailable", 503, { "Retry-After": "60" }); }
  if (outcome.kind === "unavailable") return fail("quota_unavailable", 503, { "Retry-After": "60" });
  if (outcome.kind === "limited") {
    return fail(snapshot ? "review_already_requested" : "rate_limited", snapshot ? 409 : 429,
      { "Retry-After": String(outcome.retryAfterSeconds) });
  }
  return null;
}

function providerFailure(error: unknown, attempted: boolean): Response {
  if (!(error instanceof CitabilityAiProviderError)) {
    return attempted
      ? json({ error: { code: "provider_error" }, outcomeUnknown: true, costUsd: null, providerTaskId: null }, 502)
      : fail("evidence_invalid", 422);
  }
  const codes: Readonly<Record<CitabilityAiProviderError["code"], readonly [CitabilityAiErrorCode, number]>> = {
    invalid_configuration: ["provider_unconfigured", 503], invalid_context: ["evidence_invalid", 422],
    input_budget_exceeded: ["input_budget_exceeded", 422], invalid_response: ["provider_invalid_response", 502],
    provider_error: ["provider_error", 502], network_error: ["provider_network_error", 502], timeout: ["provider_timeout", 504],
  };
  const [code, status] = codes[error.code];
  if (!attempted) return fail(code, status);
  return json({ error: { code }, outcomeUnknown: error.outcomeUnknown,
    costUsd: typeof error.costUsd === "number" && Number.isFinite(error.costUsd) && error.costUsd >= 0 ? error.costUsd : null,
    providerTaskId: typeof error.providerTaskId === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(error.providerTaskId) ? error.providerTaskId : null,
  }, status);
}

export async function handleCitabilityAiRequest(request: Request, dependencies: CitabilityAiHandlerDependencies = DEFAULT_CITABILITY_AI_HANDLER_DEPENDENCIES): Promise<Response> {
  let user: ServerAuthenticatedUser;
  try { user = await dependencies.authenticate(); }
  catch { return fail("auth_unavailable", 503); }
  if (user.status === "unauthenticated") return fail("auth_required", 401);
  if (user.status !== "authenticated") return fail("auth_unavailable", 503);
  if (request.headers.get("Origin") !== new URL(request.url).origin) return fail("invalid_origin", 403);

  const body = await readPublicToolJson(request, REQUEST_BODY_BYTES);
  if (!body.ok) return fail(body.code, body.code === "payload_too_large" ? 413 : body.code === "unsupported_media_type" ? 415 : 400);
  const input = readInput(body.value);
  if (input === null) return fail("invalid_request", 400);
  const normalized = dependencies.normalizeUrl(input.url);
  if (!normalized.ok) return fail("invalid_url", 400);
  let model: string;
  try {
    if (!dependencies.providerConfigured()) return fail("provider_unconfigured", 503);
    model = dependencies.providerModel();
  } catch { return fail("provider_unconfigured", 503); }

  // General admission protects the refetch as well as provider spend. No
  // admission is refunded: partial/failed attempts still used this capacity.
  const userKey = `citability-ai:v1:user:${user.userId}`;
  const ipKey = `citability-ai:v1:ip:${sha256(dependencies.extractClientIp(request.headers))}`;
  for (const [key, max, seconds] of [[`${userKey}:hour`, 3, 3600], [`${userKey}:day`, 10, 86400], [ipKey, 10, 3600]] as const) {
    const refused = await admit(dependencies, key, max, seconds);
    if (refused !== null) return refused;
  }

  let page: Awaited<ReturnType<typeof fetchPublicResource>>;
  try {
    page = await dependencies.fetchResource(normalized.url, {
      timeoutMs: CITABILITY_FETCH_TIMEOUT_MS, maxBodyBytes: CITABILITY_MAX_BODY_BYTES, maxRedirects: 0,
    });
  } catch { return fail("fetch_failed", 502); }
  if (page.kind === "error") {
    if (page.code === "redirect_limit") return fail("evidence_changed", 409);
    if (page.code === "timeout") return fail("fetch_timeout", 504);
    if (["blocked", "cross_origin", "invalid_redirect"].includes(page.code)) return fail("fetch_blocked", 422);
    return fail("fetch_failed", 502);
  }
  if (page.finalUrl !== normalized.url) return fail("evidence_changed", 409);
  if (page.finalStatus < 200 || page.finalStatus >= 300) return fail("page_not_ok", 422);
  if (!page.bodyComplete) return fail("evidence_incomplete", 422);
  const mediaType = (page.contentType ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") return fail("not_html", 422);
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(page.contentType ?? "")?.[1]?.toLowerCase();
  if ((charset !== undefined && !["utf-8", "utf8", "us-ascii", "ascii"].includes(charset))
    || (page.body.length > 0 && (page.body.match(/\ufffd/gu) ?? []).length / page.body.length > 0.02)) return fail("not_utf8", 422);
  if (sha256(page.body) !== input.rawSha256) return fail("evidence_changed", 409);

  let context: CitabilityAiContext;
  try {
    context = createCitabilityAiContext({ finalUrl: page.finalUrl, rawHtml: page.body, targetQuestion: input.question,
      capturedAt: dependencies.now().toISOString(), checks: [] });
    dependencies.preflight(context, model);
  } catch (error) { return providerFailure(error, false); }

  // Capture time is deliberately excluded: refetching the same bytes is not
  // permission to purchase the same review again. The shared atomic counter,
  // not an isolate-local flag, prevents two requests from both dispatching.
  const snapshotKey = `${userKey}:snapshot:${sha256(JSON.stringify([page.finalUrl, input.question, input.rawSha256]))}`;
  const refused = await admit(dependencies, snapshotKey, 1, 3600, true);
  if (refused !== null) return refused;
  try {
    const candidate = await dependencies.review(context, model);
    const review = parseCitabilityAiReview(candidate);
    if (review === null || review.rawSha256 !== context.rawSha256 || review.inputFingerprint !== context.inputFingerprint
      || review.finalUrl !== context.finalUrl || review.targetQuestion !== context.question || review.capturedAt !== context.capturedAt
      || review.requestedModel !== model || review.totalBodyChars !== context.totalBodyChars || review.includedBodyChars !== context.includedBodyChars
      || review.coverage !== context.coverage || JSON.stringify(review.excerpts) !== JSON.stringify(context.excerpts)) {
      throw new CitabilityAiProviderError("invalid_response", candidate.costUsd, candidate.providerTaskId);
    }
    return json({ review }, 200);
  }
  catch (error) { return providerFailure(error, true); }
}
