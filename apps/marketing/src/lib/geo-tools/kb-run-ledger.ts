// @input  -- rows returned by the marketing_geo_*_kb_run* RPCs
// @output -- parsed, owner-scoped run and operation records plus the store contract both sides speak
// @pos    -- pure parsing and types; holds no transport, so the orchestrator can be tested without a database

/**
 * The durable side of one knowledge base update.
 *
 * `kb-run-plan.ts` decides what to do with an operation; this file is what an
 * operation looks like once it has been written down, and the contract the
 * orchestrator uses to read and write it. Keeping the two apart is what lets
 * the money-safety rules be tested against fakes: nothing here reaches a
 * network, and nothing here decides anything.
 */

import { z } from "zod";
import type { GeoRunOperation, GeoRunOperationKind } from "./kb-run-plan.ts";

export const GEO_RUN_SCHEMA_VERSION = "marketing-geo-kb-run.v1";
export const GEO_RUN_OPERATION_SCHEMA_VERSION =
  "marketing-geo-kb-run-operation.v1";

export const GEO_RUN_STATES = ["running", "complete", "abandoned"] as const;
export type GeoRunState = (typeof GEO_RUN_STATES)[number];

/**
 * Why an operation ended where it did.
 *
 * `outcome_unknown` is the only one that is also a state: it means we
 * dispatched something and never learned what happened, which is not a failure
 * we may retry -- it is a charge we cannot see.
 */
export const GEO_RUN_OPERATION_REASONS = [
  "outcome_unknown",
  "lease_expired",
  "rate_limited",
  "quota_unavailable",
  "gate_closed",
  "provider_rejected",
  "invalid_output",
  "model_unavailable",
  "fetch_failed",
  "blocked",
  "timeout",
  "not_found",
  "unsupported",
  "store_unavailable",
] as const;
export type GeoRunOperationReason = (typeof GEO_RUN_OPERATION_REASONS)[number];

/**
 * A UUID with no version nibble pinned.
 *
 * Entity ids in this product are UUIDv8. A validator written as `[1-5]` -- what
 * `z.string().uuid()` meant for years, and what one shipped constraint in this
 * schema still says -- rejects every id this codebase mints.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const uuid = z.string().regex(UUID);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)));
/** Counts cross this boundary as decimal strings; this payload domain carries no JSON numbers. */
const countString = z.string().regex(/^(0|[1-9][0-9]{0,3})$/u);

const runSchema = z
  .object({
    schemaVersion: z.literal(GEO_RUN_SCHEMA_VERSION),
    runId: uuid,
    userId: uuid,
    kbId: uuid,
    idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u),
    state: z.enum(GEO_RUN_STATES),
    generationInputHash: sha256.nullable(),
    leaseExpiresAt: timestamp,
    createdAt: timestamp,
  })
  .strict();

export type GeoRunRecord = z.infer<typeof runSchema>;

const operationSchema = z
  .object({
    schemaVersion: z.literal(GEO_RUN_OPERATION_SCHEMA_VERSION),
    key: z.string().min(3).max(2_048),
    kind: z.enum(["fetch", "serp", "gsc", "model"]),
    state: z.enum([
      "not_started",
      "claimed",
      "dispatched",
      "succeeded",
      "failed_retryable",
      "failed_permanent",
      "outcome_unknown",
    ]),
    resultRef: z.string().min(1).max(200).nullable(),
    reason: z.enum(GEO_RUN_OPERATION_REASONS).nullable(),
    probeCount: countString,
    startedAt: timestamp.nullable(),
    finishedAt: timestamp.nullable(),
    leaseExpiresAt: timestamp.nullable(),
  })
  .strict();

/**
 * One operation as stored. It is a `GeoRunOperation` with the bookkeeping the
 * planner deliberately does not look at, so it can be handed to `planGeoRun`
 * unchanged rather than mapped -- a mapping step is a place for the stored
 * state and the planned state to drift apart.
 */
export interface GeoRunOperationRecord extends GeoRunOperation {
  readonly reason: GeoRunOperationReason | null;
  readonly probeCount: number;
  readonly finishedAt: string | null;
}

export function parseGeoRunRecord(value: unknown): GeoRunRecord {
  return runSchema.parse(value);
}

export function parseGeoRunOperationRecord(
  value: unknown,
): GeoRunOperationRecord {
  const row = operationSchema.parse(value);
  // The pairing rules the table enforces, re-checked on the way out: a row that
  // crossed a network and a schema cache claiming to be `succeeded` with no
  // result pointer would otherwise be reused as if its result were readable.
  if ((row.state === "succeeded") !== (row.resultRef !== null)) {
    throw new Error("Only a succeeded run operation has a result reference");
  }
  if (row.state === "outcome_unknown" && row.reason !== "outcome_unknown") {
    throw new Error("An unknown outcome names itself");
  }
  if ((row.state === "claimed") !== (row.leaseExpiresAt !== null)) {
    throw new Error("Only a claimed run operation is leased");
  }
  // The kind is inside the key (`geoRunOperationKey` builds it that way), so a
  // row where they disagree is one whose identity does not describe its work.
  if (!row.key.startsWith(`${row.kind}:`))
    throw new Error("Run operation kind does not match its key");
  return {
    key: row.key,
    kind: row.kind,
    state: row.state,
    resultRef: row.resultRef,
    startedAt: row.startedAt,
    leaseExpiresAt: row.leaseExpiresAt,
    reason: row.reason,
    probeCount: Number(row.probeCount),
    finishedAt: row.finishedAt,
  };
}

export function parseGeoRunOperationRecords(
  value: unknown,
): readonly GeoRunOperationRecord[] {
  const rows = z
    .array(z.unknown())
    .max(400)
    .parse(value)
    .map(parseGeoRunOperationRecord);
  if (new Set(rows.map((row) => row.key)).size !== rows.length) {
    throw new Error("Duplicate run operation key");
  }
  return rows;
}

/** What a caller asks the ledger to hold, before any of it has been attempted. */
export interface GeoRunOperationSeed {
  readonly key: string;
  readonly kind: GeoRunOperationKind;
}

/** The terminal values a write may set. Deliberately not the full state list. */
export type GeoRunOperationOutcome =
  | { readonly state: "succeeded"; readonly resultRef: string }
  | {
      readonly state: "failed_retryable" | "failed_permanent";
      readonly reason: GeoRunOperationReason;
    }
  | { readonly state: "outcome_unknown" };

export type GeoRunLedgerFailure = "not_found" | "invalid" | "unavailable";

export type GeoRunClaimResult =
  | {
      readonly kind: "claimed";
      readonly run: GeoRunRecord;
      readonly operations: readonly GeoRunOperationRecord[];
      readonly leaseToken: string;
    }
  /** Another executor holds a live lease on this run, or another run is open on this site. */
  | {
      readonly kind: "busy" | "run_active" | "finished";
      readonly run: GeoRunRecord;
      readonly operations: readonly GeoRunOperationRecord[];
    }
  | { readonly kind: GeoRunLedgerFailure };

export type GeoRunReadResult =
  | {
      readonly kind: "found";
      readonly run: GeoRunRecord;
      readonly operations: readonly GeoRunOperationRecord[];
    }
  | { readonly kind: "none" }
  | { readonly kind: GeoRunLedgerFailure };

export type GeoRunWriteResult =
  | { readonly kind: "ok"; readonly operation: GeoRunOperationRecord }
  /** The stored state is not the one the plan was computed from. Re-read; do not force it. */
  | {
      readonly kind: "conflict";
      readonly operation: GeoRunOperationRecord | null;
    }
  | { readonly kind: "stale_lease" }
  | { readonly kind: GeoRunLedgerFailure };

export type GeoRunUpdateResult =
  | { readonly kind: "ok"; readonly run: GeoRunRecord }
  | { readonly kind: "conflict"; readonly run: GeoRunRecord | null }
  | { readonly kind: "stale_lease" }
  | { readonly kind: GeoRunLedgerFailure };

export interface GeoRunScope {
  readonly userId: string;
  readonly runId: string;
  readonly leaseToken: string;
}

/**
 * Every durable move a run can make. The split between `finishOperation` and
 * `probeOperation` is the important one and is not a convenience: finishing
 * reports an outcome we saw for a request we sent, probing reports what we
 * could find out about one we may have been billed for. Only the first may
 * ever mark an operation retryable.
 */
export interface GeoRunLedgerStore {
  readonly claimRun: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly runId: string | null;
    readonly idempotencyKey: string | null;
    readonly operations: readonly GeoRunOperationSeed[];
  }) => Promise<GeoRunClaimResult>;
  readonly readRun: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly runId: string | null;
  }) => Promise<GeoRunReadResult>;
  readonly appendOperations: (
    scope: GeoRunScope,
    operations: readonly GeoRunOperationSeed[],
  ) => Promise<GeoRunReadResult>;
  readonly claimOperation: (
    scope: GeoRunScope,
    key: string,
  ) => Promise<GeoRunWriteResult>;
  readonly dispatchOperation: (
    scope: GeoRunScope,
    key: string,
  ) => Promise<GeoRunWriteResult>;
  readonly finishOperation: (
    scope: GeoRunScope,
    key: string,
    outcome: GeoRunOperationOutcome,
  ) => Promise<GeoRunWriteResult>;
  readonly probeOperation: (
    scope: GeoRunScope,
    key: string,
    outcome: GeoRunOperationOutcome,
  ) => Promise<GeoRunWriteResult>;
  readonly bindGenerationInput: (
    scope: GeoRunScope,
    generationInputHash: string,
  ) => Promise<GeoRunUpdateResult>;
  readonly releaseRun: (scope: GeoRunScope) => Promise<GeoRunUpdateResult>;
  readonly finishRun: (scope: GeoRunScope) => Promise<GeoRunUpdateResult>;
}
