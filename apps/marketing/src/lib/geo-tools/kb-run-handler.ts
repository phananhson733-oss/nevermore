// @input  -- same-origin authenticated requests naming a knowledge base and, at most, one run of it
// @output -- the run's public state after this invocation; no lease token and no internal capability
// @pos    -- HTTP admission for the single-run update route

/**
 * One HTTP call advances one run by at most one operation.
 *
 * The client keeps calling until the status is `complete` or `blocked`. That is
 * the whole protocol, and it is shaped that way because the alternative --
 * holding one request open for the length of an update -- is how a platform
 * timeout turns a charge into something with no record of where it happened.
 *
 * What the client may NOT do is say what work to perform. The operation list is
 * derived on the server from the owner's own draft; a client-supplied URL would
 * be a request to spend the account's crawl budget on a target of the caller's
 * choosing.
 */

import { z } from "zod";
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { advanceGeoKbRun, type GeoRunAdvanceResult, type GeoRunExecutor } from "./kb-run-advance.ts";
import type { GeoRunLedgerStore, GeoRunOperationRecord, GeoRunOperationSeed, GeoRunRecord } from "./kb-run-ledger.ts";

export const GEO_RUN_REQUEST_BYTES = 1_024;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const runRequest = z
  .object({
    kbId: uuid,
    /** Present to resume a known run. */
    runId: uuid.nullish(),
    /** Present to start one. Exactly one of the two, for `advance`. */
    idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u).nullish(),
    action: z.enum(["advance", "read", "abandon"]).default("advance"),
  })
  .strict();

export interface GeoKbRunHandlerDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  /**
   * What this run should hold, derived from the owner's draft. Returning
   * `missing` means there is nothing to update; `invalid_input` means the draft
   * cannot be run as it stands.
   */
  readonly plan: (input: { readonly userId: string; readonly kbId: string }) => Promise<
    | { readonly kind: "ready"; readonly seed: readonly GeoRunOperationSeed[]; readonly executor: GeoRunExecutor }
    | { readonly kind: "missing" | "invalid_input" | "unavailable" }
  >;
  readonly store: GeoRunLedgerStore;
  readonly abandon: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly runId: string;
  }) => Promise<"abandoned" | "busy" | "finished" | "not_found" | "unavailable">;
  readonly now: () => Date;
}

function publicOperation(operation: GeoRunOperationRecord) {
  return {
    key: operation.key,
    kind: operation.kind,
    state: operation.state,
    reason: operation.reason,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
  };
}

/** The lease token never leaves the server: it is the capability to spend. */
function publicRun(run: GeoRunRecord) {
  return {
    runId: run.runId,
    kbId: run.kbId,
    state: run.state,
    generationInputHash: run.generationInputHash,
    createdAt: run.createdAt,
  };
}

function publicResult(result: GeoRunAdvanceResult) {
  return {
    status: result.status,
    run: result.run === null ? null : publicRun(result.run),
    operations: result.operations.map(publicOperation),
    waiting: result.waiting,
    skipped: result.skipped,
    remaining: String(result.remaining),
    acted: result.acted,
  };
}

const STATUS_CODE: Readonly<Record<string, number>> = {
  not_found: 404,
  invalid: 400,
  unavailable: 503,
};

async function authenticated(
  dependencies: GeoKbRunHandlerDependencies,
): Promise<{ readonly userId: string } | Response> {
  const identity = await dependencies.authenticate().catch(() => ({ status: "unavailable" as const }));
  if (identity.status !== "authenticated") {
    return privateError(
      identity.status === "unauthenticated" ? "auth_required" : "auth_unavailable",
      identity.status === "unauthenticated" ? 401 : 503,
    );
  }
  return { userId: identity.userId };
}

export async function handleGeoKbRun(
  request: Request,
  dependencies: GeoKbRunHandlerDependencies,
): Promise<Response> {
  const identity = await authenticated(dependencies);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, GEO_RUN_REQUEST_BYTES);
  if (!json.ok) return json.response;
  const parsed = runRequest.safeParse(json.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  const input = parsed.data;
  const runId = input.runId ?? null;
  const idempotencyKey = input.idempotencyKey ?? null;

  if (input.action === "read") {
    const read = await dependencies.store
      .readRun({ userId: identity.userId, kbId: input.kbId, runId })
      .catch(() => ({ kind: "unavailable" as const }));
    if (read.kind === "none") return privateJson({ data: { status: "none", run: null, operations: [] } });
    if (read.kind !== "found") return privateError(read.kind === "not_found" ? "not_found" : "store_unavailable", STATUS_CODE[read.kind] ?? 503);
    return privateJson({
      data: {
        status: read.run.state === "running" ? "resumable" : "finished",
        run: publicRun(read.run),
        operations: read.operations.map(publicOperation),
      },
    });
  }

  if (input.action === "abandon") {
    if (runId === null) return privateError("invalid_request", 400);
    const outcome = await dependencies
      .abandon({ userId: identity.userId, kbId: input.kbId, runId })
      .catch(() => "unavailable" as const);
    if (outcome === "unavailable") return privateError("store_unavailable", 503);
    if (outcome === "not_found") return privateError("not_found", 404);
    // A live lease means an executor may be mid-request; refusing is the point.
    if (outcome === "busy") return privateError("run_busy", 409);
    return privateJson({ data: { status: outcome } });
  }

  // Exactly one lookup mode, decided here rather than in the store, so a
  // request carrying both never becomes "whichever the database preferred".
  if ((runId === null) === (idempotencyKey === null)) return privateError("invalid_request", 400);

  const plan = await dependencies
    .plan({ userId: identity.userId, kbId: input.kbId })
    .catch(() => ({ kind: "unavailable" as const }));
  if (plan.kind !== "ready") {
    return privateError(
      plan.kind === "missing" ? "not_found" : plan.kind === "invalid_input" ? "invalid_input" : "store_unavailable",
      plan.kind === "missing" ? 404 : plan.kind === "invalid_input" ? 422 : 503,
    );
  }

  const advanced = await advanceGeoKbRun(
    { userId: identity.userId, kbId: input.kbId, runId, idempotencyKey, seed: plan.seed },
    { store: dependencies.store, executor: plan.executor, now: dependencies.now },
  ).catch(() => null);
  if (advanced === null) return privateError("store_unavailable", 503);
  if (advanced.status === "not_found" || advanced.status === "invalid" || advanced.status === "unavailable") {
    return privateError(
      advanced.status === "unavailable" ? "store_unavailable" : advanced.status === "invalid" ? "invalid_request" : "not_found",
      STATUS_CODE[advanced.status] ?? 503,
    );
  }
  // `busy` and `run_active` are 409: the caller must poll or resume the run
  // that is already open, not start a second one over the same site.
  const status = advanced.status === "busy" || advanced.status === "run_active" ? 409 : 200;
  return privateJson({ data: publicResult(advanced) }, status);
}
