// @input  -- authenticated GEO POST request, confirmed questions, and a paid provider
// @output -- one contract-valid sampled report or a stable auth/budget/provider error
// @pos    -- server-only execution boundary for the GEO Agent run API

import { normalizeSeoAuditUrl } from "@sf/public-tools";
import {
  getServerAuthenticationStatus,
  type ServerAuthenticationStatus,
} from "../auth/server-auth-status.ts";
import { brandTokensForHost } from "../tools/keyword-prompts.ts";
import {
  consumeGeoDailyBudget,
  createGeoCostAccumulator,
  type GeoBudgetOutcome,
} from "./geo-cost-guard.ts";
import {
  createGeoProviderClient,
  type GeoProviderClient,
} from "./geo-provider.ts";
import {
  AGENT_GEO_REPORT_SCHEMA_VERSION,
  geoCoverageAvailability,
  isGeoReportSuccessEnvelope,
  GEO_MAX_QUESTION_LENGTH,
  GEO_QUESTIONS_PER_RUN,
  GEO_SAMPLES_PER_QUESTION,
  type GeoReportData,
} from "./geo-report-contract.ts";
import {
  collectGeoSamples,
  normalizeCitedHost,
  type GeoQuestionInput,
  type GeoSamplingContext,
} from "./geo-sampling.ts";

/** Model pinned server-side; a client-chosen model is a client-chosen price. */
export const GEO_PROVIDER_MODEL = "gpt-5-2025-08-07";

/**
 * Wall-clock budget for one run's provider work.
 *
 * The route allows 300s. This leaves roughly a minute for reading the request,
 * claiming the budget, assembling and persisting — work that happens after the
 * last answer arrives and that would otherwise be what overruns the platform
 * limit. Overrunning costs the whole finished envelope, not just the slow part,
 * and on this route that envelope is 24 answers the visitor already paid for.
 */
export const GEO_RUN_BUDGET_MS = 240_000;

const MAX_BRAND_TOKENS = 6;
const MAX_COMPETITOR_HOSTS = 20;
const MAX_REQUEST_BYTES = 32_768;

export interface GeoRunHandlerDependencies {
  /** Proves a real Supabase user before any part of the request body is read. */
  readonly authenticate: () => Promise<ServerAuthenticationStatus>;
  readonly claimDailyBudget: () => Promise<GeoBudgetOutcome>;
  readonly createProvider: () => GeoProviderClient;
  readonly now: () => number;
}

export const DEFAULT_DEPENDENCIES: GeoRunHandlerDependencies = {
  authenticate: getServerAuthenticationStatus,
  claimDailyBudget: () => consumeGeoDailyBudget(),
  createProvider: () => createGeoProviderClient(),
  now: Date.now,
};

function errorResponse(code: string, status: number): Response {
  return Response.json(
    { error: { code } },
    { status, headers: { "Cache-Control": "no-store, private" } },
  );
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maxLength
    ? value
    : null;
}

interface GeoRunInput {
  readonly targetUrl: string;
  readonly targetHost: string;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly questions: readonly GeoQuestionInput[];
  readonly brandTokens: readonly string[];
  readonly competitorHosts: readonly string[];
}

/**
 * Validate the request without trusting any of it.
 *
 * The questions arrive from the browser because the visitor confirms and may
 * edit them, so every bound the provider enforces is enforced again here: an
 * over-long question is a paid round trip that returns nothing, and an
 * unbounded list is an unbounded bill.
 */
export function parseGeoRunInput(body: unknown): GeoRunInput | null {
  if (!isObject(body)) return null;

  const url = normalizeSeoAuditUrl(body.targetUrl);
  if (!url.ok) return null;
  const targetHost = normalizeCitedHost(url.url);
  if (targetHost === null) return null;

  const marketCode = boundedString(body.marketCode, 2);
  if (marketCode === null || !/^[A-Z]{2}$/.test(marketCode)) return null;
  const languageCode = boundedString(body.languageCode, 35);
  if (languageCode === null) return null;

  if (!Array.isArray(body.questions)) return null;
  if (
    body.questions.length === 0 ||
    body.questions.length > GEO_QUESTIONS_PER_RUN
  ) {
    return null;
  }
  const questions: GeoQuestionInput[] = [];
  for (const candidate of body.questions) {
    if (!isObject(candidate)) return null;
    const questionId = boundedString(candidate.questionId, 64);
    const question = boundedString(candidate.question, GEO_MAX_QUESTION_LENGTH);
    if (questionId === null || question === null) return null;
    questions.push({ questionId, question });
  }
  const ids = questions.map((entry) => entry.questionId);
  if (new Set(ids).size !== ids.length) return null;

  const brandTokens = Array.isArray(body.brandTokens)
    ? body.brandTokens
        .map((token) => boundedString(token, 80))
        .filter((token): token is string => token !== null)
        .slice(0, MAX_BRAND_TOKENS)
    : [];

  const competitorHosts = Array.isArray(body.competitorHosts)
    ? [
        ...new Set(
          body.competitorHosts
            .map((host) =>
              typeof host === "string"
                ? normalizeCitedHost(
                    /^https?:\/\//u.test(host) ? host : `https://${host}`,
                  )
                : null,
            )
            .filter((host): host is string => host !== null),
        ),
      ].slice(0, MAX_COMPETITOR_HOSTS)
    : [];

  return {
    targetUrl: url.url,
    targetHost,
    marketCode,
    languageCode,
    questions,
    // The host's own label is always a brand token: a site cited by name is
    // the case the report exists to catch, and requiring the client to send it
    // would make the answer depend on what the client remembered to include.
    //
    // Derived with the shared helper rather than by taking the penultimate DNS
    // label. That shortcut is wrong for every multi-label public suffix, and
    // wrong in both directions: "acme.com.au" would yield "com", which matches
    // any answer that names some other .com site, and "acme.co.uk" would yield
    // "co", which is dropped for being too short so a real mention is missed.
    // The client sends no tokens by default, so this is the normal path.
    brandTokens: [
      ...new Set([...brandTokens, ...brandTokensForHost(targetHost)]),
    ].filter((token) => token.length > 0),
    competitorHosts: competitorHosts.filter((host) => host !== targetHost),
  };
}

async function readBoundedBody(request: Request): Promise<unknown | null> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/.test(declared.trim()) &&
    Number(declared.trim()) > MAX_REQUEST_BYTES
  ) {
    return null;
  }
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function handleGeoRunRequest(
  request: Request,
  dependencies: GeoRunHandlerDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  // One clock for the whole route, started before anything that can block.
  // Started later, the budget would be handed whole to a request that had
  // already spent part of the platform's limit on the auth round trip.
  const deadlineAt = dependencies.now() + GEO_RUN_BUDGET_MS;
  const remainingMs = (): number => deadlineAt - dependencies.now();

  let authentication: ServerAuthenticationStatus = "unavailable";
  try {
    authentication = await dependencies.authenticate();
  } catch {
    authentication = "unavailable";
  }
  if (authentication === "unavailable") {
    return errorResponse("auth_unavailable", 503);
  }
  if (authentication === "unauthenticated") {
    return errorResponse("auth_required", 401);
  }

  const body = await readBoundedBody(request);

  // Before anything is billed, not after. A tab opened before a deploy runs the
  // previous client, whose guard recomputes the previous contract and refuses
  // this response — so without this check the visitor pays for 24 provider
  // calls and is shown an invalid-report error for a version mismatch that was
  // knowable from the request. The old client sends no version at all, which is
  // exactly the signal, and the answer tells them to reload rather than retry.
  if (
    !isObject(body) ||
    body.schemaVersion !== AGENT_GEO_REPORT_SCHEMA_VERSION
  ) {
    return errorResponse("geo_client_outdated", 409);
  }

  const input = parseGeoRunInput(body);
  if (input === null) return errorResponse("invalid_request", 400);

  // Built before the budget claim, not after. The daily bucket is account-wide
  // and never refunded, so an unconfigured deployment would otherwise let a
  // handful of clicks burn the whole day's allowance for every visitor while
  // making zero provider calls.
  let provider: GeoProviderClient;
  try {
    provider = dependencies.createProvider();
  } catch {
    return errorResponse("geo_provider_unavailable", 503);
  }

  // Claimed before the first paid call, so a refused run has spent nothing.
  const budget = await dependencies.claimDailyBudget();
  if (budget.kind === "exhausted") {
    return errorResponse("geo_budget_exhausted", 429);
  }
  if (budget.kind === "unavailable") {
    return errorResponse("geo_budget_unavailable", 503);
  }

  const costs = createGeoCostAccumulator();
  const context: GeoSamplingContext = {
    targetHost: input.targetHost,
    brandTokens: input.brandTokens,
    competitorHosts: input.competitorHosts,
  };

  const sampledAtMs = dependencies.now();
  const questions = await collectGeoSamples(input.questions, context, {
    provider,
    model: GEO_PROVIDER_MODEL,
    marketCode: input.marketCode,
    // Two independent budgets. Whichever binds first stops the run, and both
    // stop it by degrading to a partial report rather than by discarding what
    // was already paid for.
    remainingMs,
    admitCall: () => costs.admit(),
    settleCall: (costUsd: number | null) => costs.settle(costUsd),
  });

  const samples = questions.flatMap((question) => question.samples);
  const observed = samples.filter(
    (sample) =>
      sample.state !== "search_not_performed" && sample.state !== "unavailable",
  ).length;

  const data: GeoReportData = {
    run: {
      agent: "geo",
      mode: "authenticated_agent",
      persistence: "none",
      schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION,
      sampledAt: new Date(sampledAtMs).toISOString(),
      targetHost: input.targetHost,
      provider: {
        tool: "dataforseo_chat_gpt_llm_responses",
        model: GEO_PROVIDER_MODEL,
        marketCode: input.marketCode,
        languageCode: input.languageCode,
        samplesPerQuestion: GEO_SAMPLES_PER_QUESTION,
        costUsd: costs.spent(),
      },
    },
    coverage: {
      questionsRequested: questions.length,
      samplesAttempted: samples.length,
      samplesObserved: observed,
      samplesSearchNotPerformed: samples.filter(
        (sample) => sample.state === "search_not_performed",
      ).length,
      samplesUnavailable: samples.filter(
        (sample) => sample.state === "unavailable",
      ).length,
      availability: geoCoverageAvailability(samples.length, observed),
    },
    questions,
  };

  // The only record of what this run spent. Without it a run is invisible in
  // the DataForSEO invoice, which is the sibling keyword guard's stated
  // doctrine and the reason its own reporter exists.
  console.info(
    `[geo-run] host=${input.targetHost} questions=${questions.length} samples=${samples.length} observed=${observed} spend=$${costs.spent().toFixed(4)} unpriced=${costs.unpricedCalls()} capped=${String(costs.capped())}`,
  );

  const envelope = { data };
  // Validated against the same guard the client uses. An assembly bug should
  // surface as a refused response, never as a report whose headline numbers
  // disagree with the samples underneath them.
  if (!isGeoReportSuccessEnvelope(envelope)) {
    return errorResponse("geo_report_invalid", 502);
  }

  return Response.json(envelope, {
    status: 200,
    headers: { "Cache-Control": "no-store, private" },
  });
}
