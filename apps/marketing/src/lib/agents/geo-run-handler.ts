// @input  -- an authenticated GEO POST carrying a confirmed context and query set
// @output -- one contract-valid v3 report, or a stable error raised before billing
// @pos    -- server-only execution boundary for the GEO Agent run API

import { normalizeSeoAuditUrl } from "@sf/public-tools";
import {
  getServerAuthenticationStatus,
  type ServerAuthenticationStatus,
} from "../auth/server-auth-status.ts";
import { hasLoneSurrogate, normalizeGeoText } from "./geo-canonical.ts";
import {
  consumeGeoDailyBudget,
  createGeoCostAccumulator,
  type GeoBudgetOutcome,
} from "./geo-cost-guard.ts";
import {
  deriveGeoBrandStance,
  geoAliasMatcherScope,
  geoContextHash,
  isGeoContextSnapshotV1,
  type GeoContextSnapshotV1,
} from "./geo-context.ts";
import {
  createGeoProviderClient,
  type GeoProviderClient,
} from "./geo-provider.ts";
import {
  geoPlannedCallCount,
  geoQuerySetContentHash,
  isGeoQuerySetConfirmed,
  isGeoQuerySetV1,
  isPayableGeoQueryText,
  GEO_PLANNED_CALLS_PER_RUN,
  type GeoQuerySetV1,
  type GeoQueryUnitV1,
} from "./geo-query-contract.ts";
import {
  AGENT_GEO_REPORT_SCHEMA_VERSION,
  isGeoReportSuccessEnvelope,
  type GeoQuestionObservationV3,
  type GeoReportDataV3,
  type GeoRunLimitationCode,
  type GeoSurfaceProvenanceV1,
} from "./geo-report-contract.ts";
import {
  deriveGeoRunCoverage,
  geoReportContentHash,
} from "./geo-report-derive.ts";
import {
  collectGeoSamples,
  GEO_MIN_BUDGET_FOR_CALL_MS,
  type GeoSamplingContext,
} from "./geo-sampling.ts";
import { normalizeGeoHost } from "./geo-url.ts";

export { normalizeGeoHost as normalizeCitedHost } from "./geo-url.ts";

/** Model pinned server-side; a client-chosen model is a client-chosen price. */
export const GEO_PROVIDER_MODEL = "gpt-5-2025-08-07";

/**
 * Wall-clock budget for one run's provider work.
 *
 * The route allows 300s. This leaves roughly a minute for reading the request,
 * claiming the budget and assembling — work that happens after the last answer
 * arrives and that would otherwise be what overruns the platform limit.
 * Overrunning costs the whole finished envelope, not just the slow part, and on
 * this route that envelope is eighteen answers the visitor already paid for.
 */
export const GEO_RUN_BUDGET_MS = 240_000;

const MAX_REQUEST_BYTES = 65_536;

/**
 * Time reserved for the daily-budget claim itself.
 *
 * The claim is a network round trip to the quota store and it is never
 * refunded, so a request that clears the per-call minimum and then spends it
 * all on the claim consumes one of the day's runs and dispatches nothing.
 */
const GEO_BUDGET_CLAIM_ALLOWANCE_MS = 5_000;

export interface GeoRunHandlerDependencies {
  /** Proves a real Supabase user before any part of the request body is read. */
  readonly authenticate: () => Promise<ServerAuthenticationStatus>;
  readonly claimDailyBudget: () => Promise<GeoBudgetOutcome>;
  readonly createProvider: () => GeoProviderClient;
  readonly now: () => number;
  readonly runId: () => string;
}

export const DEFAULT_DEPENDENCIES: GeoRunHandlerDependencies = {
  authenticate: getServerAuthenticationStatus,
  claimDailyBudget: () => consumeGeoDailyBudget(),
  createProvider: () => createGeoProviderClient(),
  now: Date.now,
  runId: () => globalThis.crypto.randomUUID(),
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

export interface GeoRunInput {
  readonly context: GeoContextSnapshotV1;
  readonly querySet: GeoQuerySetV1;
  /** The core cohort, in plan order: exactly what will be billed. */
  readonly paidQueries: readonly GeoQueryUnitV1[];
}

export type GeoRunRejection =
  | "invalid_request"
  | "geo_context_invalid"
  | "geo_query_set_invalid"
  | "geo_query_set_unconfirmed"
  | "geo_query_set_mismatch"
  | "geo_prompt_too_long"
  | "geo_plan_size_mismatch"
  | "geo_brand_stance_mismatch";

/*
 * Every code this route can return is listed in `geo-run-errors.ts`, which the
 * workbench also reads. A code raised here but missing there fails the parity
 * test rather than reaching a visitor as a generic failure.
 */

/**
 * Validate everything before a single call is billed.
 *
 * Order matters and is the point of the function. The provider is not built,
 * the daily budget is not claimed and no prompt is dispatched until the context
 * is a valid snapshot whose fingerprint the server recomputed itself, the query
 * set is valid, confirmed and bound to that context, the paid selection is
 * exactly the eight core questions, and every final rendered prompt fits inside
 * the provider's cap in both counting units. A run refused here has spent
 * nothing; a run refused later has spent everything.
 */
export async function validateGeoRunInput(
  body: unknown,
): Promise<
  | { readonly ok: true; readonly input: GeoRunInput }
  | { readonly ok: false; readonly code: GeoRunRejection }
> {
  if (!isObject(body)) return { ok: false, code: "invalid_request" };

  const context = body.context;
  if (!isGeoContextSnapshotV1(context)) {
    return { ok: false, code: "geo_context_invalid" };
  }
  // Recomputed here rather than trusted. A client-supplied fingerprint proves
  // nothing about the content it travels with.
  if ((await geoContextHash(context)) !== context.contextHash) {
    return { ok: false, code: "geo_context_invalid" };
  }
  // Target URL normalization stays server-authoritative.
  const url = normalizeSeoAuditUrl(context.targetUrl);
  if (!url.ok || normalizeGeoHost(url.url) !== context.targetHost) {
    return { ok: false, code: "geo_context_invalid" };
  }

  const querySet = body.querySet;
  if (!isGeoQuerySetV1(querySet)) {
    return { ok: false, code: "geo_query_set_invalid" };
  }
  if (!isGeoQuerySetConfirmed(querySet)) {
    return { ok: false, code: "geo_query_set_unconfirmed" };
  }
  // The recomputed value is the one used downstream; the supplied one only has
  // to agree, and a disagreement stops the run before the budget claim.
  if (
    (await geoQuerySetContentHash(querySet)) !== querySet.querySetContentHash
  ) {
    return { ok: false, code: "geo_query_set_mismatch" };
  }
  if (
    querySet.contextHash !== context.contextHash ||
    querySet.marketCode !== context.marketCode ||
    querySet.queryLanguageTag !== context.targetQueryLanguage
  ) {
    return { ok: false, code: "geo_query_set_mismatch" };
  }

  // `explore` candidates cannot occupy a core slot, alter a core verdict, or
  // add a paid call. They are dropped from the paid selection rather than
  // billed.
  const paidQueries = querySet.queries.filter(
    (query) => query.cohort === "core",
  );
  // A ceiling, not an equality: an edited retrieval question becomes a
  // one-sample natural-demand question, which is a legitimate cheaper run. What
  // must never happen is a set that bills MORE than the confirm step showed.
  if (geoPlannedCallCount(querySet) > GEO_PLANNED_CALLS_PER_RUN) {
    return { ok: false, code: "geo_plan_size_mismatch" };
  }

  // Every FINAL rendered prompt, wrapper text included, checked against the
  // provider cap before anything is charged. Nothing is truncated after
  // confirmation: a shortened question is a question nobody measured.
  for (const query of paidQueries) {
    if (!isPayableGeoQueryText(renderGeoProviderPrompt(query))) {
      return { ok: false, code: "geo_prompt_too_long" };
    }
    // The stance is derived here, from the text and the confirmed names, and
    // compared with what the client claimed. A question labelled `unbranded`
    // that in fact contains the customer's own name would let three
    // tautological repetitions enter the discovery denominator, and the client
    // is the last party that should be trusted to classify that.
    const derived = deriveGeoBrandStance(
      query.text,
      context.brandAliases,
      context.directCompetitors,
    );
    if (derived !== query.brandStance) {
      return { ok: false, code: "geo_brand_stance_mismatch" };
    }
  }

  return { ok: true, input: { context, querySet, paidQueries } };
}

/**
 * The exact string sent to the provider.
 *
 * There is no wrapper today, and that is a deliberate property rather than an
 * omission: the calibration measured these sentences, and a preamble bolted on
 * in front of them would be a different, unmeasured prompt. The function exists
 * so that the length preflight measures the same string the transport sends —
 * if a wrapper is ever added, it is added here and the preflight follows.
 */
export function renderGeoProviderPrompt(query: GeoQueryUnitV1): string {
  return query.text;
}

function buildProvenance(
  context: GeoContextSnapshotV1,
  modelsObserved: ReadonlySet<string>,
  costMicros: number,
  unknownCostSamples: number,
): GeoSurfaceProvenanceV1 {
  return {
    collector: "dataforseo",
    upstream: "openai",
    surface: "dataforseo_chat_gpt_llm_responses_api",
    searchModeRequested: "web_search_permitted",
    modelRequested: GEO_PROVIDER_MODEL,
    // Sorted deterministically, never in response arrival order: two identical
    // runs must serialize identically. Normalized for the same reason the
    // citation strings are: this is another value the provider names and the
    // report contract will only accept in normalized form, and one stray space
    // in it would refuse a run that had already been billed.
    modelObserved: [
      ...new Set(
        [...modelsObserved]
          .map((model) => normalizeGeoText(model))
          .filter(
            (model) =>
              model.length > 0 &&
              model.length <= 100 &&
              // NFC does not repair an unpaired surrogate and the fingerprint
              // refuses to serialize one, so leaving it here voids the report
              // at hashing time — after the calls have been billed.
              !hasLoneSurrogate(model),
          ),
      ),
    ].sort(),
    maxOutputTokensRequested: 4_096,
    webSearchCountryIsoCodeRequested: context.marketCode,
    calibrationMarket: "US",
    // The wording was calibrated with US settings. Passing another country is
    // supported; claiming it was calibrated is not.
    triggerCalibrationScope:
      context.marketCode === "US"
        ? "calibrated_market"
        : "outside_calibrated_market",
    queryLanguageTag: "en",
    retrievalSamplesPerProbe: 3,
    naturalDemandSamplesPerQuery: 1,
    knownCostUsdMicros: costMicros,
    costComplete: unknownCostSamples === 0,
    unknownCostSamples,
  };
}

/**
 * The limitations every run carries, plus the ones this run earned.
 *
 * The standing four are not boilerplate: each names something a reader could
 * otherwise reasonably assume this product does. The earned ones are derived
 * from the observations so a degraded run cannot render as a clean one.
 */
function buildRunLimitations(
  questions: readonly GeoQuestionObservationV3[],
  provenance: GeoSurfaceProvenanceV1,
  costCeilingReached: boolean,
): readonly GeoRunLimitationCode[] {
  const coverage = deriveGeoRunCoverage(questions);
  const limitations: GeoRunLimitationCode[] = [
    "report_contents_not_persisted",
    "no_paired_recheck",
    "single_surface_chat_gpt_via_dataforseo",
    "sentinel_cohort_not_full_coverage",
    "recommendation_not_evaluated",
  ];
  if (coverage.triggerFailedProbes > 0 || coverage.degradedProbes > 0) {
    limitations.push("degraded_retrieval_trigger");
  }
  if (coverage.totals.unavailableSamples > 0) limitations.push("partial_run");
  if (!provenance.costComplete) limitations.push("cost_incomplete");
  // A run that hit its own spend ceiling stopped issuing calls, and the reader
  // is entitled to know that the missing samples are a budget decision rather
  // than a provider failure. Without this the only record was a server log.
  if (costCeilingReached) limitations.push("cost_ceiling_reached");
  if (provenance.triggerCalibrationScope === "outside_calibrated_market") {
    limitations.push("outside_calibrated_market");
  }
  return limitations;
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
  // this response — so without this check the visitor pays for eighteen
  // provider calls and is shown an invalid-report error for a version mismatch
  // that was knowable from the request.
  if (
    !isObject(body) ||
    body.schemaVersion !== AGENT_GEO_REPORT_SCHEMA_VERSION
  ) {
    return errorResponse("geo_client_outdated", 409);
  }

  const validated = await validateGeoRunInput(body);
  if (!validated.ok) return errorResponse(validated.code, 400);
  const { context, querySet, paidQueries } = validated.input;

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

  // Refused before the account-wide claim, which is never refunded. A request
  // that spent its whole budget getting here would otherwise consume one of the
  // day's runs and then dispatch nothing at all.
  // With a margin for the claim itself, which is a network round trip: a check
  // that only cleared the per-call minimum could still leave nothing once the
  // claim returned, and the claim is never refunded.
  if (
    remainingMs() <
    GEO_MIN_BUDGET_FOR_CALL_MS + GEO_BUDGET_CLAIM_ALLOWANCE_MS
  ) {
    return errorResponse("geo_time_budget_exhausted", 503);
  }

  // Claimed before the first paid call, so a refused run has spent nothing.
  // This atomic claim plus the client's double-submit guard is the whole
  // double-spend backstop in P0: a dedicated idempotency-key record would need
  // server state this build deliberately does not have, so the residual
  // duplicate-billing window is a documented limitation rather than a solved
  // problem.
  let budget: GeoBudgetOutcome;
  try {
    budget = await dependencies.claimDailyBudget();
  } catch {
    // A rejected quota promise is the same operational fact as an unavailable
    // quota store, and the visitor gets the same stable code either way rather
    // than a framework 500 without the route's own headers.
    return errorResponse("geo_budget_unavailable", 503);
  }
  if (budget.kind === "exhausted") {
    return errorResponse("geo_budget_exhausted", 429);
  }
  if (budget.kind === "unavailable") {
    return errorResponse("geo_budget_unavailable", 503);
  }

  const costs = createGeoCostAccumulator();
  const modelsObserved = new Set<string>();
  const samplingContext: GeoSamplingContext = {
    targetHost: context.targetHost,
    brandAliases: context.brandAliases,
    aliasScope: geoAliasMatcherScope(context.brandAliases),
  };

  const sampledAtMs = dependencies.now();
  let questions: readonly GeoQuestionObservationV3[];
  try {
    questions = await collectGeoSamples(paidQueries, samplingContext, {
      provider,
      model: GEO_PROVIDER_MODEL,
      marketCode: context.marketCode,
      // Two independent budgets. Whichever binds first stops the run, and both
      // stop it by degrading to a partial report rather than by discarding what
      // was already paid for.
      remainingMs,
      admitCall: () => costs.admit(),
      settleCall: (costUsd: number | null) => costs.settle(costUsd),
      noteModel: (model: string) => modelsObserved.add(model),
    });
  } finally {
    // In a `finally`, because by the time anything here can throw the calls have
    // already been dispatched and settled. A run that spent money and then hit
    // an assembly error must still appear in the only record of what it spent.
    //
    // The host is deliberately absent: the response promises report contents
    // are not persisted server-side and application logs are persistent
    // storage, so the line carries the billing metadata §7.1 already says is
    // retained — a context-fingerprint prefix and the spend — and nothing else.
    console.info(
      `[geo-run] context=${context.contextHash.slice(7, 19)} questions=${paidQueries.length} planned=${GEO_PLANNED_CALLS_PER_RUN} spendMicros=${costs.spentMicros()} unpriced=${costs.unpricedCalls()} capped=${String(costs.capped())}`,
    );
  }

  const provenance = buildProvenance(
    context,
    modelsObserved,
    costs.spentMicros(),
    costs.unpricedCalls(),
  );
  const limitations = buildRunLimitations(
    questions,
    provenance,
    costs.capped(),
  );
  const runIdentity = {
    schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION,
    runId: dependencies.runId(),
    sampledAt: new Date(sampledAtMs).toISOString(),
    targetHost: context.targetHost,
    contextHash: context.contextHash,
    // The server's own recomputed value, never the one the client sent.
    querySetContentHash: querySet.querySetContentHash,
    provenance,
  };

  let reportContentHash: string;
  try {
    reportContentHash = await geoReportContentHash(
      runIdentity,
      questions,
      limitations,
    );
  } catch {
    // Fingerprinting fails closed on anything it cannot serialize. A refused
    // response is the right outcome; a report whose digest silently described
    // different content would not be.
    return errorResponse("geo_report_invalid", 502);
  }

  const data: GeoReportDataV3 = {
    run: {
      agent: "geo",
      mode: "authenticated_agent",
      persistence: "report_contents_not_persisted",
      ...runIdentity,
      reportContentHash,
    },
    coverage: deriveGeoRunCoverage(questions),
    questions,
    limitations,
  };

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
