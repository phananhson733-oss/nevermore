// @input  -- an authenticated owner, a run id or idempotency key, and an internal lease capability
// @output -- validated durable run and operation records; never a provider call and never a secret
// @pos    -- service-role-only SQL transport for the run ledger

/**
 * The transport half of the run ledger. It validates on the way in (so a
 * malformed call never reaches the database as a half-written state) and parses
 * on the way out (so a row that crossed a schema cache is not trusted because
 * it arrived).
 *
 * Every failure it cannot classify becomes `unavailable`, which the
 * orchestrator treats as "do not act". That is deliberate: for a ledger whose
 * whole job is to stop a second charge, a transport that guesses is worse than
 * one that stops.
 */

import { z } from "zod";
import { createAdminSupabaseClient } from "../supabase/admin.ts";
import {
  parseGeoRunOperationRecord,
  parseGeoRunOperationRecords,
  parseGeoRunRecord,
  type GeoRunClaimResult,
  type GeoRunLedgerStore,
  type GeoRunOperationOutcome,
  type GeoRunOperationSeed,
  type GeoRunReadResult,
  type GeoRunScope,
  type GeoRunUpdateResult,
  type GeoRunWriteResult,
} from "./kb-run-ledger.ts";

export interface GeoRunRpcTransport {
  readonly callRpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ readonly data: unknown; readonly error: unknown }>;
}

export const DEFAULT_GEO_RUN_RPC_TRANSPORT: GeoRunRpcTransport = {
  callRpc: async (name, params) =>
    await createAdminSupabaseClient().rpc(name, params),
};

/** No version nibble: this product's ids are UUIDv8. */
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const idempotencyKey = z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const seedSchema = z
  .array(
    z
      .object({
        key: z.string().min(3).max(2_048),
        kind: z.enum(["fetch", "serp", "gsc", "model"]),
      })
      .strict()
      .refine(
        (seed) => seed.key.startsWith(`${seed.kind}:`),
        "Key must carry its kind",
      ),
  )
  .max(400)
  .refine(
    (rows) => new Set(rows.map((row) => row.key)).size === rows.length,
    "Duplicate key",
  );

function one(value: unknown): Record<string, unknown> {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    value[0] === null ||
    typeof value[0] !== "object"
  ) {
    throw new Error("Invalid run RPC envelope");
  }
  return value[0] as Record<string, unknown>;
}

/** Ownership is proved by the RPC; this refuses a row that came back anyway. */
function ownedRun(
  value: unknown,
  scope: {
    readonly userId: string;
    readonly kbId?: string;
    readonly runId?: string;
  },
) {
  const run = parseGeoRunRecord(value);
  if (
    run.userId !== scope.userId ||
    (scope.kbId !== undefined && run.kbId !== scope.kbId) ||
    (scope.runId !== undefined && run.runId !== scope.runId)
  ) {
    throw new Error("Foreign run record");
  }
  return run;
}

function outcomeParams(
  outcome: GeoRunOperationOutcome,
): Record<string, unknown> {
  return {
    p_state: outcome.state,
    p_result_ref: outcome.state === "succeeded" ? outcome.resultRef : null,
    p_reason:
      outcome.state === "succeeded"
        ? null
        : outcome.state === "outcome_unknown"
          ? "outcome_unknown"
          : outcome.reason,
  };
}

export function createGeoRunLedgerStore(
  transport: GeoRunRpcTransport = DEFAULT_GEO_RUN_RPC_TRANSPORT,
): GeoRunLedgerStore {
  const writeOperation = async (
    rpc: string,
    scope: GeoRunScope,
    key: string,
    extra: Record<string, unknown>,
  ): Promise<GeoRunWriteResult> => {
    try {
      uuid.parse(scope.userId);
      uuid.parse(scope.runId);
      uuid.parse(scope.leaseToken);
      z.string().min(3).max(2_048).parse(key);
      const response = await transport.callRpc(rpc, {
        p_user_id: scope.userId,
        p_run_id: scope.runId,
        p_lease_token: scope.leaseToken,
        p_operation_key: key,
        ...extra,
      });
      if (response.error) return { kind: "unavailable" };
      const row = one(response.data);
      if (row.outcome === "stale_lease") return { kind: "stale_lease" };
      if (row.outcome === "not_found") return { kind: "not_found" };
      if (row.outcome === "invalid") return { kind: "invalid" };
      if (row.outcome === "conflict") {
        const operation =
          row.operation === null || row.operation === undefined
            ? null
            : parseGeoRunOperationRecord(row.operation);
        if (operation !== null && operation.key !== key)
          return { kind: "unavailable" };
        return { kind: "conflict", operation };
      }
      if (
        row.outcome !== "claimed" &&
        row.outcome !== "dispatched" &&
        row.outcome !== "existing" &&
        row.outcome !== "finished" &&
        row.outcome !== "probed"
      ) {
        return { kind: "unavailable" };
      }
      const operation = parseGeoRunOperationRecord(row.operation);
      if (operation.key !== key) return { kind: "unavailable" };
      return { kind: "ok", operation };
    } catch {
      return { kind: "unavailable" };
    }
  };

  const updateRun = async (
    rpc: string,
    scope: GeoRunScope,
  ): Promise<GeoRunUpdateResult> => {
    try {
      uuid.parse(scope.userId);
      uuid.parse(scope.runId);
      uuid.parse(scope.leaseToken);
      const response = await transport.callRpc(rpc, {
        p_user_id: scope.userId,
        p_run_id: scope.runId,
        p_lease_token: scope.leaseToken,
      });
      if (response.error) return { kind: "unavailable" };
      const row = one(response.data);
      if (row.outcome === "stale_lease") return { kind: "stale_lease" };
      if (row.outcome === "not_found") return { kind: "not_found" };
      if (row.outcome === "invalid") return { kind: "invalid" };
      if (
        row.outcome === "incomplete" ||
        row.outcome === "finished" ||
        row.outcome === "released"
      ) {
        const run = ownedRun(row.run, {
          userId: scope.userId,
          runId: scope.runId,
        });
        // `finished` from the finish RPC is success; from the release RPC it
        // means the run was already closed, which is equally settled.
        return row.outcome === "incomplete"
          ? { kind: "conflict", run }
          : { kind: "ok", run };
      }
      return { kind: "unavailable" };
    } catch {
      return { kind: "unavailable" };
    }
  };

  return {
    claimRun: async (input): Promise<GeoRunClaimResult> => {
      try {
        uuid.parse(input.userId);
        uuid.parse(input.kbId);
        if (input.runId !== null) uuid.parse(input.runId);
        if (input.idempotencyKey !== null)
          idempotencyKey.parse(input.idempotencyKey);
        // Exactly one lookup mode. Passing both would leave which one wins to
        // the database, and passing neither would create a run with no name.
        if ((input.runId === null) === (input.idempotencyKey === null))
          return { kind: "invalid" };
        seedSchema.parse(input.operations);
        const response = await transport.callRpc("marketing_geo_claim_kb_run", {
          p_user_id: input.userId,
          p_kb_id: input.kbId,
          p_run_id: input.runId,
          p_idempotency_key: input.idempotencyKey,
          p_operations: input.operations,
        });
        if (response.error) return { kind: "unavailable" };
        const row = one(response.data);
        if (row.outcome === "not_found") return { kind: "not_found" };
        if (row.outcome === "invalid") return { kind: "invalid" };
        if (
          row.outcome === "busy" ||
          row.outcome === "run_active" ||
          row.outcome === "finished"
        ) {
          return {
            kind: row.outcome,
            run: ownedRun(row.run, { userId: input.userId, kbId: input.kbId }),
            operations: parseGeoRunOperationRecords(row.operations),
          };
        }
        if (row.outcome !== "claimed") return { kind: "unavailable" };
        const run = ownedRun(row.run, {
          userId: input.userId,
          kbId: input.kbId,
        });
        if (run.state !== "running") return { kind: "unavailable" };
        return {
          kind: "claimed",
          run,
          operations: parseGeoRunOperationRecords(row.operations),
          leaseToken: uuid.parse(row.lease_token),
        };
      } catch {
        return { kind: "unavailable" };
      }
    },
    readRun: async (input): Promise<GeoRunReadResult> => {
      try {
        uuid.parse(input.userId);
        uuid.parse(input.kbId);
        if (input.runId !== null) uuid.parse(input.runId);
        const response = await transport.callRpc("marketing_geo_read_kb_run", {
          p_user_id: input.userId,
          p_kb_id: input.kbId,
          p_run_id: input.runId,
        });
        if (response.error) return { kind: "unavailable" };
        const row = one(response.data);
        if (row.outcome === "not_found") return { kind: "not_found" };
        if (row.outcome === "none") return { kind: "none" };
        if (row.outcome !== "found") return { kind: "unavailable" };
        return {
          kind: "found",
          run: ownedRun(row.run, { userId: input.userId, kbId: input.kbId }),
          operations: parseGeoRunOperationRecords(row.operations),
        };
      } catch {
        return { kind: "unavailable" };
      }
    },
    appendOperations: async (
      scope: GeoRunScope,
      operations: readonly GeoRunOperationSeed[],
    ): Promise<GeoRunReadResult> => {
      try {
        uuid.parse(scope.userId);
        uuid.parse(scope.runId);
        uuid.parse(scope.leaseToken);
        seedSchema.parse(operations);
        const response = await transport.callRpc(
          "marketing_geo_append_kb_run_operations",
          {
            p_user_id: scope.userId,
            p_run_id: scope.runId,
            p_lease_token: scope.leaseToken,
            p_operations: operations,
          },
        );
        if (response.error) return { kind: "unavailable" };
        const row = one(response.data);
        if (row.outcome === "not_found") return { kind: "not_found" };
        if (row.outcome === "invalid") return { kind: "invalid" };
        if (row.outcome !== "appended") return { kind: "unavailable" };
        return {
          kind: "found",
          run: ownedRun(row.run, { userId: scope.userId, runId: scope.runId }),
          operations: parseGeoRunOperationRecords(row.operations),
        };
      } catch {
        return { kind: "unavailable" };
      }
    },
    claimOperation: async (scope, key) =>
      await writeOperation(
        "marketing_geo_claim_kb_run_operation",
        scope,
        key,
        {},
      ),
    dispatchOperation: async (scope, key) =>
      await writeOperation(
        "marketing_geo_dispatch_kb_run_operation",
        scope,
        key,
        {},
      ),
    finishOperation: async (scope, key, outcome) =>
      await writeOperation(
        "marketing_geo_finish_kb_run_operation",
        scope,
        key,
        outcomeParams(outcome),
      ),
    probeOperation: async (scope, key, outcome) =>
      await writeOperation(
        "marketing_geo_probe_kb_run_operation",
        scope,
        key,
        outcomeParams(outcome),
      ),
    bindGenerationInput: async (
      scope,
      generationInputHash,
    ): Promise<GeoRunUpdateResult> => {
      try {
        uuid.parse(scope.userId);
        uuid.parse(scope.runId);
        uuid.parse(scope.leaseToken);
        sha256.parse(generationInputHash);
        const response = await transport.callRpc(
          "marketing_geo_bind_kb_run_input",
          {
            p_user_id: scope.userId,
            p_run_id: scope.runId,
            p_lease_token: scope.leaseToken,
            p_generation_input_hash: generationInputHash,
          },
        );
        if (response.error) return { kind: "unavailable" };
        const row = one(response.data);
        if (row.outcome === "stale_lease") return { kind: "stale_lease" };
        if (row.outcome === "not_found") return { kind: "not_found" };
        if (row.outcome === "invalid") return { kind: "invalid" };
        if (row.outcome === "conflict") {
          return {
            kind: "conflict",
            run: ownedRun(row.run, {
              userId: scope.userId,
              runId: scope.runId,
            }),
          };
        }
        if (row.outcome !== "bound") return { kind: "unavailable" };
        const run = ownedRun(row.run, {
          userId: scope.userId,
          runId: scope.runId,
        });
        if (run.generationInputHash !== generationInputHash)
          return { kind: "unavailable" };
        return { kind: "ok", run };
      } catch {
        return { kind: "unavailable" };
      }
    },
    releaseRun: async (scope) =>
      await updateRun("marketing_geo_release_kb_run", scope),
    finishRun: async (scope) =>
      await updateRun("marketing_geo_finish_kb_run", scope),
  };
}

export const DEFAULT_GEO_RUN_LEDGER_STORE: GeoRunLedgerStore =
  createGeoRunLedgerStore();

/** Read-only view for the "continue update" affordance, which holds no lease. */
export async function readGeoKbRun(
  input: {
    readonly userId: string;
    readonly kbId: string;
    readonly runId: string | null;
  },
  store: GeoRunLedgerStore = DEFAULT_GEO_RUN_LEDGER_STORE,
): Promise<GeoRunReadResult> {
  return await store.readRun(input);
}

/**
 * Give up on a run whose executor is gone.
 *
 * Takes no lease token because the situation it exists for is "nobody holds
 * the lease"; the RPC refuses while one is live, so this cannot shove a
 * working executor aside. No operation is rewritten: an abandoned run's
 * charges stay on the record.
 */
export async function abandonGeoKbRun(
  input: {
    readonly userId: string;
    readonly kbId: string;
    readonly runId: string;
  },
  transport: GeoRunRpcTransport = DEFAULT_GEO_RUN_RPC_TRANSPORT,
): Promise<"abandoned" | "busy" | "finished" | "not_found" | "unavailable"> {
  try {
    uuid.parse(input.userId);
    uuid.parse(input.runId);
    const response = await transport.callRpc("marketing_geo_abandon_kb_run", {
      p_user_id: input.userId,
      p_run_id: input.runId,
    });
    if (response.error) return "unavailable";
    const row = one(response.data);
    if (
      row.outcome === "abandoned" ||
      row.outcome === "busy" ||
      row.outcome === "finished"
    ) {
      const run = ownedRun(row.run, {
        userId: input.userId,
        kbId: input.kbId,
        runId: input.runId,
      });
      return row.outcome === "abandoned" && run.state !== "abandoned"
        ? "unavailable"
        : row.outcome;
    }
    if (row.outcome === "not_found") return "not_found";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
