import { randomUUID } from "node:crypto";
import {
  IdempotencyKey,
  MeasurementTarget as MeasurementTargetSchema,
  MeasurementTimezone,
  MeasurementWindow as MeasurementWindowSchema,
  MeasurementWindowInterval,
  PublicationChecksum,
  PublicationHttpUrl,
  Uuid,
  type MeasurementTarget,
  type MeasurementWindow,
} from "@sf/contracts";
import {
  and,
  asc,
  desc,
  eq,
  sql,
} from "drizzle-orm";
import type { DbTx } from "../client.ts";
import {
  contentHash,
  type CanonicalValue,
} from "../hash.ts";
import { canonicalUtcTimestamptz } from "../instant.ts";
import {
  asyncRuns,
  clientProjects,
  dataSnapshots,
  measurementGa4Campaigns,
  measurementGa4Dimensions,
  measurementGeoDimensions,
  measurementGscDimensions,
  measurementUtmIdentities,
  measurementWindows,
  normalizedObservations,
  publicationAttempts,
  publicationReceipts,
  sitePages,
  sites,
} from "../schema.ts";
import type { EnqueueRunOptions, RunJobPayload } from "../queue.ts";
import {
  AsyncRunsRepository,
  type AsyncRunRow,
} from "./async-runs.ts";
import {
  projectPredicate,
  Repository,
  type Executor,
  type ProjectScope,
} from "./base.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DAY_MS = 86_400_000;
const MEASUREMENT_PHASE_MS = 28 * DAY_MS;
const PROVIDER_SETTLEMENT_MS = 4 * DAY_MS;

export const MAX_MEASUREMENT_WINDOW_HISTORY = 100;

export interface MeasurementObservationLineage {
  readonly gsc: {
    readonly baselineObservationId: string | null;
    readonly outcomeObservationId: string | null;
  };
  readonly ga4: {
    readonly baselineObservationId: string | null;
    readonly outcomeObservationId: string | null;
  };
  readonly geo: {
    readonly baselineObservationId: string | null;
    readonly outcomeObservationId: string | null;
  };
}

export interface AppendMeasurementWindowInput {
  readonly asyncRunId: string;
  readonly window: MeasurementWindow;
  readonly observationLineage: MeasurementObservationLineage;
}

export interface AppendMeasurementWindowResult {
  readonly window: MeasurementWindow;
  readonly replayed: boolean;
}

export interface MeasurementWindowHistoryOptions {
  readonly limit: number;
}

export interface MeasurementWindowRecentOptions {
  readonly limit: number;
}

export interface ResolvedMeasurementRunFacts {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly changeReceiptId: string;
  readonly publicationAttemptId: string;
  readonly siteId: string;
  readonly sitePageId: string;
  readonly target: MeasurementTarget;
  readonly actionId: string;
  readonly artifactId: string;
  readonly artifactRevisionId: string;
  readonly artifactRevision: number;
  readonly artifactContentHash: string;
  readonly contentChecksum: string;
  readonly timelineDeliveryReceiptId: string | null;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly beforeWindow: {
    readonly startAt: string;
    readonly endAt: string;
  };
  readonly afterWindow: {
    readonly startAt: string;
    readonly endAt: string;
  };
  readonly timezone: string;
  readonly interpretation: "observational_non_causal";
  readonly startAfter: string;
}

export interface CreateMeasurementRunTransaction {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly changeReceiptId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestedBy: string;
  readonly contractVersion: string;
  readonly resolveCurrentFacts: (
    tx: DbTx,
  ) => Promise<ResolvedMeasurementRunFacts>;
}

export interface MeasurementRunTransactionResult {
  readonly run: AsyncRunRow;
  readonly measurementWindowId: string;
  readonly replayed: boolean;
}

export interface MeasurementRepositoryDependencies {
  readonly enqueue?: (
    tx: DbTx,
    payload: RunJobPayload,
    options: Required<Pick<EnqueueRunOptions, "startAfter">>,
  ) => Promise<string>;
  readonly clock?: {
    now(): Date;
  };
  readonly newId?: () => string;
}

export interface MeasurementAuthorityReadOptions {
  readonly lock?: boolean;
}

export interface MeasurementChangeReceiptAuthority {
  readonly receipt: typeof publicationReceipts.$inferSelect;
  readonly attempt: typeof publicationAttempts.$inferSelect;
  readonly run: typeof asyncRuns.$inferSelect;
  readonly site: typeof sites.$inferSelect;
  readonly sitePage: typeof sitePages.$inferSelect;
  readonly deliveryReceipt: typeof publicationReceipts.$inferSelect;
}

export interface MeasurementProviderEvidenceInput {
  readonly siteId: string;
  readonly sitePageId: string;
  readonly provider: "gsc" | "ga4" | "geo";
  readonly window: {
    readonly startAt: string;
    readonly endAt: string;
  };
}

export interface MeasurementProviderEvidence {
  readonly snapshotId: string;
  readonly sourceConnectionId: string | null;
  readonly provider: string;
  readonly datasetKey: string;
  readonly schemaVersion: string;
  readonly methodVersion: string;
  readonly capturedAt: string;
  readonly sourceWindow: Record<string, unknown>;
  readonly coveredWindow: {
    readonly startAt: string;
    readonly endAt: string;
  };
  readonly snapshotAvailability: string;
  readonly snapshotLimitation: string;
  readonly observationId: string;
  readonly sitePageId: string;
  readonly metricKey: string;
  readonly subjectType: string;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly observationAvailability: string;
  readonly valueJson: unknown;
  readonly unit: string | null;
  readonly origin: string;
  readonly method: string;
  readonly grade: string;
  readonly support: string;
  readonly observationLimitation: string;
}

export class MeasurementRunIdempotencyConflictError extends Error {
  readonly code = "MEASUREMENT_IDEMPOTENCY_CONFLICT";

  constructor() {
    super("Measurement Idempotency-Key is permanently bound to another request");
    this.name = "MeasurementRunIdempotencyConflictError";
  }
}

export class MeasurementRunAlreadyActiveError extends Error {
  readonly code = "MEASUREMENT_RUN_ALREADY_ACTIVE";

  constructor(readonly activeRunId: string | null) {
    super("A measurement run is already active for this Change Receipt");
    this.name = "MeasurementRunAlreadyActiveError";
  }
}

export class MeasurementRunAlreadyCompletedError extends Error {
  readonly code = "MEASUREMENT_RUN_ALREADY_COMPLETED";

  constructor(
    readonly existingRunId: string,
    readonly measurementWindowId: string,
  ) {
    super("This Change Receipt already has a final Measurement Window");
    this.name = "MeasurementRunAlreadyCompletedError";
  }
}

export class MeasurementWindowInvariantError extends Error {
  constructor(
    readonly code:
      | "MEASUREMENT_SCOPE_INVALID"
      | "MEASUREMENT_OBSERVATION_LINEAGE_INVALID"
      | "MEASUREMENT_TRANSACTION_REQUIRED"
      | "MEASUREMENT_REPLAY_CONFLICT"
      | "MEASUREMENT_INTEGRITY_INVALID"
      | "MEASUREMENT_RUN_AUTHORITY_INVALID"
      | "MEASUREMENT_ENQUEUE_REQUIRED"
      | "MEASUREMENT_ATOMIC_TRANSACTION_REQUIRED"
      | "MEASUREMENT_RUN_INPUT_INVALID",
  ) {
    super(
      {
        MEASUREMENT_SCOPE_INVALID:
          "Measurement project scope or async run identity is invalid",
        MEASUREMENT_OBSERVATION_LINEAGE_INVALID:
          "Measurement observation lineage must use canonical UUID references",
        MEASUREMENT_TRANSACTION_REQUIRED:
          "Measurement finalization requires an atomic database transaction",
        MEASUREMENT_REPLAY_CONFLICT:
          "Measurement replay conflicts with immutable persisted evidence",
        MEASUREMENT_INTEGRITY_INVALID:
          "Persisted measurement evidence failed integrity validation",
        MEASUREMENT_RUN_AUTHORITY_INVALID:
          "Locked Change Receipt authority is missing or no longer exact",
        MEASUREMENT_ENQUEUE_REQUIRED:
          "Measurement run creation requires an atomic queue dependency",
        MEASUREMENT_ATOMIC_TRANSACTION_REQUIRED:
          "Measurement run creation requires an atomic database transaction",
        MEASUREMENT_RUN_INPUT_INVALID:
          "Measurement run command or frozen facts are invalid",
      }[code],
    );
    this.name = "MeasurementWindowInvariantError";
  }
}

function canonicalInterval(interval: {
  readonly startAt: string;
  readonly endAt: string;
}) {
  return {
    startAt: canonicalUtcTimestamptz(interval.startAt),
    endAt: canonicalUtcTimestamptz(interval.endAt),
  };
}

function canonicalSourceWindow(value: unknown): {
  readonly startAt: string;
  readonly endAt: string;
} {
  const direct = MeasurementWindowInterval.safeParse(value);
  if (direct.success) return canonicalInterval(direct.data);
  if (
    typeof value !== "object" ||
    value === null ||
    !("start" in value) ||
    !("end" in value)
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_INTEGRITY_INVALID",
    );
  }
  const { start, end } = value as {
    readonly start?: unknown;
    readonly end?: unknown;
  };
  const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
  if (typeof start !== "string" || typeof end !== "string") {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_INTEGRITY_INVALID",
    );
  }
  const startIsDate = datePattern.test(start);
  const endIsDate = datePattern.test(end);
  if (startIsDate !== endIsDate) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_INTEGRITY_INVALID",
    );
  }
  if (!startIsDate) {
    const legacy = MeasurementWindowInterval.safeParse({
      startAt: start,
      endAt: end,
    });
    if (!legacy.success) {
      throw new MeasurementWindowInvariantError(
        "MEASUREMENT_INTEGRITY_INVALID",
      );
    }
    return canonicalInterval(legacy.data);
  }
  const startAt = new Date(`${start}T00:00:00.000Z`);
  const inclusiveEnd = new Date(`${end}T00:00:00.000Z`);
  if (
    !Number.isFinite(startAt.getTime()) ||
    !Number.isFinite(inclusiveEnd.getTime()) ||
    startAt.toISOString().slice(0, 10) !== start ||
    inclusiveEnd.toISOString().slice(0, 10) !== end
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_INTEGRITY_INVALID",
    );
  }
  const endAt = new Date(inclusiveEnd.getTime() + 86_400_000);
  return MeasurementWindowInterval.parse({
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  });
}

function validAbsoluteInstant(value: string): boolean {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    /(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  );
}

function pgConstraint(error: unknown): string | null {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return null;
    const wrapped = candidate as {
      readonly constraint?: unknown;
      readonly cause?: unknown;
    };
    if (typeof wrapped.constraint === "string") {
      return wrapped.constraint;
    }
    candidate = wrapped.cause;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactMeasurementReplay(
  run: AsyncRunRow,
  scope: ProjectScope,
  command: Pick<
    CreateMeasurementRunTransaction,
    "changeReceiptId" | "idempotencyKey" | "requestHash"
  >,
): MeasurementRunTransactionResult {
  const payload = run.request_payload;
  const frozenFacts = payload.frozenFacts;
  if (
    run.workspace_id !== scope.workspaceId ||
    run.project_id !== scope.projectId ||
    run.kind !== "measurement" ||
    payload.operation !== "measurement_window" ||
    payload.idempotencyKey !== command.idempotencyKey ||
    run.result_type !== "measurement_window" ||
    typeof run.result_id !== "string" ||
    !UUID.test(run.result_id) ||
    !isRecord(frozenFacts) ||
    typeof frozenFacts.changeReceiptId !== "string" ||
    !UUID.test(frozenFacts.changeReceiptId)
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_INTEGRITY_INVALID",
    );
  }
  if (
    payload.requestHash !== command.requestHash ||
    frozenFacts.changeReceiptId !== command.changeReceiptId
  ) {
    throw new MeasurementRunIdempotencyConflictError();
  }
  return {
    run,
    measurementWindowId: run.result_id,
    replayed: true,
  };
}

function assertMeasurementRunCommand(
  command: CreateMeasurementRunTransaction,
): void {
  if (
    !Uuid.safeParse(command.workspaceId).success ||
    !Uuid.safeParse(command.projectId).success ||
    !Uuid.safeParse(command.changeReceiptId).success ||
    !Uuid.safeParse(command.requestedBy).success ||
    !IdempotencyKey.safeParse(command.idempotencyKey).success ||
    !PublicationChecksum.safeParse(command.requestHash).success ||
    typeof command.contractVersion !== "string" ||
    command.contractVersion.trim().length < 1 ||
    command.contractVersion.length > 128 ||
    typeof command.resolveCurrentFacts !== "function"
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_RUN_INPUT_INVALID",
    );
  }
}

function assertResolvedMeasurementRunFacts(
  scope: ProjectScope,
  command: CreateMeasurementRunTransaction,
  facts: ResolvedMeasurementRunFacts,
): ResolvedMeasurementRunFacts {
  const before = MeasurementWindowInterval.safeParse(facts.beforeWindow);
  const after = MeasurementWindowInterval.safeParse(facts.afterWindow);
  const target = MeasurementTargetSchema.safeParse(facts.target);
  const startAfter = new Date(facts.startAfter);
  const beforeStart = before.success
    ? Date.parse(before.data.startAt)
    : Number.NaN;
  const beforeEnd = before.success
    ? Date.parse(before.data.endAt)
    : Number.NaN;
  const afterStart = after.success
    ? Date.parse(after.data.startAt)
    : Number.NaN;
  const afterEnd = after.success
    ? Date.parse(after.data.endAt)
    : Number.NaN;
  const uuids = [
    facts.workspaceId,
    facts.projectId,
    facts.changeReceiptId,
    facts.publicationAttemptId,
    facts.siteId,
    facts.sitePageId,
    facts.actionId,
    facts.artifactId,
    facts.artifactRevisionId,
    ...(facts.timelineDeliveryReceiptId
      ? [facts.timelineDeliveryReceiptId]
      : []),
  ];
  if (
    !uuids.every((value) => Uuid.safeParse(value).success) ||
    facts.workspaceId !== scope.workspaceId ||
    facts.projectId !== scope.projectId ||
    facts.changeReceiptId !== command.changeReceiptId ||
    !target.success ||
    target.data.kind !== "url" ||
    target.data.sitePageId !== facts.sitePageId ||
    target.data.targetRef !== `site-page://${facts.sitePageId}` ||
    !Number.isSafeInteger(facts.artifactRevision) ||
    facts.artifactRevision < 1 ||
    !PublicationChecksum.safeParse(facts.artifactContentHash).success ||
    !PublicationChecksum.safeParse(facts.contentChecksum).success ||
    !PublicationHttpUrl.safeParse(facts.url).success ||
    !PublicationHttpUrl.safeParse(facts.canonicalUrl).success ||
    !MeasurementTimezone.safeParse(facts.timezone).success ||
    facts.interpretation !== "observational_non_causal" ||
    !before.success ||
    !after.success ||
    beforeEnd - beforeStart !== MEASUREMENT_PHASE_MS ||
    afterEnd - afterStart !== MEASUREMENT_PHASE_MS ||
    beforeEnd !== afterStart ||
    !validAbsoluteInstant(facts.startAfter) ||
    !Number.isFinite(startAfter.getTime()) ||
    startAfter.getTime() - afterEnd !== PROVIDER_SETTLEMENT_MS
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_RUN_AUTHORITY_INVALID",
    );
  }
  return {
    ...facts,
    target: target.data,
    beforeWindow: canonicalInterval(before.data),
    afterWindow: canonicalInterval(after.data),
    startAfter: startAfter.toISOString(),
  };
}

function canonicalSource<
  TSource extends {
    readonly coveredWindow: {
      readonly startAt: string;
      readonly endAt: string;
    };
    readonly observedAt: string;
  },
>(source: TSource | null) {
  if (source === null) return null;
  return {
    ...source,
    coveredWindow: canonicalInterval(source.coveredWindow),
    observedAt: canonicalUtcTimestamptz(source.observedAt),
  };
}

function canonicalWindow(value: MeasurementWindow): MeasurementWindow {
  const window = MeasurementWindowSchema.parse(value);
  return MeasurementWindowSchema.parse({
    ...window,
    verifiedChangeReceipt: {
      ...window.verifiedChangeReceipt,
      observedAt: canonicalUtcTimestamptz(
        window.verifiedChangeReceipt.observedAt,
      ),
    },
    timelineDeliveryReceipt: window.timelineDeliveryReceipt
      ? {
          ...window.timelineDeliveryReceipt,
          observedAt: canonicalUtcTimestamptz(
            window.timelineDeliveryReceipt.observedAt,
          ),
        }
      : null,
    beforeWindow: canonicalInterval(window.beforeWindow),
    afterWindow: canonicalInterval(window.afterWindow),
    dimensions: {
      gsc: {
        ...window.dimensions.gsc,
        baselineSource: canonicalSource(
          window.dimensions.gsc.baselineSource,
        ),
        outcomeSource: canonicalSource(
          window.dimensions.gsc.outcomeSource,
        ),
      },
      ga4: {
        ...window.dimensions.ga4,
        baselineSource: canonicalSource(
          window.dimensions.ga4.baselineSource,
        ),
        outcomeSource: canonicalSource(
          window.dimensions.ga4.outcomeSource,
        ),
      },
      geo: {
        ...window.dimensions.geo,
        baselineSource: canonicalSource(
          window.dimensions.geo.baselineSource,
        ),
        outcomeSource: canonicalSource(
          window.dimensions.geo.outcomeSource,
        ),
      },
    },
    recordedAt: canonicalUtcTimestamptz(window.recordedAt),
  });
}

export function measurementWindowResultHash(
  input: AppendMeasurementWindowInput,
): string {
  const parsed = canonicalWindow(input.window);
  if (
    !UUID.test(input.asyncRunId) ||
    ![
      input.observationLineage.gsc.baselineObservationId,
      input.observationLineage.gsc.outcomeObservationId,
      input.observationLineage.ga4.baselineObservationId,
      input.observationLineage.ga4.outcomeObservationId,
      input.observationLineage.geo.baselineObservationId,
      input.observationLineage.geo.outcomeObservationId,
    ].every((id) => id === null || UUID.test(id))
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_OBSERVATION_LINEAGE_INVALID",
    );
  }
  return contentHash({
    asyncRunId: input.asyncRunId,
    window: parsed,
    observationLineage: input.observationLineage,
  } as unknown as CanonicalValue);
}

function assertAppendInput(
  scope: ProjectScope,
  input: AppendMeasurementWindowInput,
): MeasurementWindow {
  const window = canonicalWindow(input.window);
  if (
    window.projectId !== scope.projectId ||
    !UUID.test(input.asyncRunId)
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_SCOPE_INVALID",
    );
  }
  const observationIds = [
    input.observationLineage.gsc.baselineObservationId,
    input.observationLineage.gsc.outcomeObservationId,
    input.observationLineage.ga4.baselineObservationId,
    input.observationLineage.ga4.outcomeObservationId,
    input.observationLineage.geo.baselineObservationId,
    input.observationLineage.geo.outcomeObservationId,
  ];
  if (!observationIds.every((id) => id === null || UUID.test(id))) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_OBSERVATION_LINEAGE_INVALID",
    );
  }
  const sourceLineage = [
    {
      source: window.dimensions.gsc.baselineSource,
      observationId:
        input.observationLineage.gsc.baselineObservationId,
    },
    {
      source: window.dimensions.gsc.outcomeSource,
      observationId:
        input.observationLineage.gsc.outcomeObservationId,
    },
    {
      source: window.dimensions.ga4.baselineSource,
      observationId:
        input.observationLineage.ga4.baselineObservationId,
    },
    {
      source: window.dimensions.ga4.outcomeSource,
      observationId:
        input.observationLineage.ga4.outcomeObservationId,
    },
    {
      source: window.dimensions.geo.baselineSource,
      observationId:
        input.observationLineage.geo.baselineObservationId,
    },
    {
      source: window.dimensions.geo.outcomeSource,
      observationId:
        input.observationLineage.geo.outcomeObservationId,
    },
  ];
  if (
    sourceLineage.some(
      ({ source, observationId }) =>
        (source === null) !== (observationId === null),
    ) ||
    (window.dimensions.ga4.baselineSource !== null &&
      window.dimensions.ga4.outcomeSource !== null &&
      (window.dimensions.ga4.baselineSource.snapshotId ===
        window.dimensions.ga4.outcomeSource.snapshotId ||
        input.observationLineage.ga4.baselineObservationId ===
          input.observationLineage.ga4.outcomeObservationId)) ||
    (window.dimensions.geo.baselineSource !== null &&
      window.dimensions.geo.outcomeSource !== null &&
      (window.dimensions.geo.baselineSource.snapshotId ===
        window.dimensions.geo.outcomeSource.snapshotId ||
        input.observationLineage.geo.baselineObservationId ===
          input.observationLineage.geo.outcomeObservationId))
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_OBSERVATION_LINEAGE_INVALID",
    );
  }
  return window;
}

function commonDimensionValues(
  scope: ProjectScope,
  window: MeasurementWindow,
  dimension: MeasurementWindow["dimensions"]["gsc"]
    | MeasurementWindow["dimensions"]["ga4"]
    | MeasurementWindow["dimensions"]["geo"],
) {
  return {
    measurement_window_id: window.measurementWindowId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    state: dimension.state,
    baseline_source_ref: dimension.baselineSource?.sourceRef ?? null,
    baseline_snapshot_id: dimension.baselineSource?.snapshotId ?? null,
    baseline_covered_window:
      dimension.baselineSource?.coveredWindow ?? null,
    baseline_observed_at: dimension.baselineSource?.observedAt ?? null,
    baseline_freshness: dimension.baselineSource?.freshness ?? null,
    outcome_source_ref: dimension.outcomeSource?.sourceRef ?? null,
    outcome_snapshot_id: dimension.outcomeSource?.snapshotId ?? null,
    outcome_covered_window:
      dimension.outcomeSource?.coveredWindow ?? null,
    outcome_observed_at: dimension.outcomeSource?.observedAt ?? null,
    outcome_freshness: dimension.outcomeSource?.freshness ?? null,
    sample_baseline: dimension.sampleSize.baseline,
    sample_outcome: dimension.sampleSize.outcome,
    sample_unit: dimension.sampleSize.unit,
    coverage: dimension.sampleSize.coverage,
    limitation: dimension.limitation,
  } as const;
}

type GscRow = typeof measurementGscDimensions.$inferSelect;
type Ga4Row = typeof measurementGa4Dimensions.$inferSelect;
type GeoRow = typeof measurementGeoDimensions.$inferSelect;
type ReceiptRow = typeof publicationReceipts.$inferSelect;

function receiptProjection(row: ReceiptRow) {
  return {
    id: row.id,
    providerKind: row.provider_kind,
    providerRequestId: row.provider_request_id,
    remoteScopeRef: row.remote_scope_ref,
    remoteObjectId: row.remote_object_id,
    remoteRevision: row.remote_revision,
    deliveryUrl: row.delivery_url,
    artifactContentHash: row.artifact_content_hash,
    contentChecksum: row.content_checksum,
    remoteFacts: row.remote_facts,
    observedAt: canonicalUtcTimestamptz(row.observed_at),
    receiptKind: row.receipt_kind,
    predecessorDeliveryReceiptId:
      row.predecessor_delivery_receipt_id,
    remoteObjectKind: row.remote_object_kind,
    liveCanonicalUrl: row.live_canonical_url,
    verificationState: row.verification_state,
    evidenceRefs: row.evidence_refs,
    limitation: row.limitation,
  };
}

function sourceProjection(
  provider: "gsc" | "ga4" | "geo",
  phase: "baseline" | "outcome",
  row: GscRow | Ga4Row | GeoRow,
) {
  const baseline = phase === "baseline";
  const sourceRef = baseline
    ? row.baseline_source_ref
    : row.outcome_source_ref;
  const snapshotId = baseline
    ? row.baseline_snapshot_id
    : row.outcome_snapshot_id;
  const coveredWindow = baseline
    ? row.baseline_covered_window
    : row.outcome_covered_window;
  const observedAt = baseline
    ? row.baseline_observed_at
    : row.outcome_observed_at;
  const freshness = baseline
    ? row.baseline_freshness
    : row.outcome_freshness;
  if (
    sourceRef === null &&
    snapshotId === null &&
    coveredWindow === null &&
    observedAt === null &&
    freshness === null
  ) {
    return null;
  }
  const parsedCoveredWindow =
    MeasurementWindowInterval.safeParse(coveredWindow);
  if (
    sourceRef === null ||
    snapshotId === null ||
    !parsedCoveredWindow.success ||
    observedAt === null ||
    freshness === null
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_INTEGRITY_INVALID",
    );
  }
  return {
    provider,
    sourceRef,
    snapshotId,
    coveredWindow: canonicalInterval(parsedCoveredWindow.data),
    observedAt: canonicalUtcTimestamptz(observedAt),
    freshness,
  };
}

function conversionDefinitionProjection(
  kind: "direct" | "assisted",
  values: {
    readonly id: string | null;
    readonly eventNames: string[] | null;
    readonly countingMethod: string | null;
    readonly attributionBoundary: string | null;
    readonly lookbackWindowDays: number | null;
  },
) {
  if (
    values.id === null &&
    values.eventNames === null &&
    values.countingMethod === null &&
    values.attributionBoundary === null &&
    values.lookbackWindowDays === null
  ) {
    return null;
  }
  if (
    values.id === null ||
    values.eventNames === null ||
    values.countingMethod === null ||
    values.attributionBoundary === null ||
    values.lookbackWindowDays === null
  ) {
    throw new MeasurementWindowInvariantError(
      "MEASUREMENT_INTEGRITY_INVALID",
    );
  }
  return {
    conversionDefinitionId: values.id,
    kind,
    eventNames: values.eventNames,
    countingMethod: values.countingMethod,
    attributionBoundary: values.attributionBoundary,
    lookbackWindowDays: values.lookbackWindowDays,
  };
}

const campaignSelection = {
  utm_identity_id: measurementGa4Campaigns.utm_identity_id,
  source: measurementUtmIdentities.source,
  medium: measurementUtmIdentities.medium,
  campaign: measurementUtmIdentities.campaign,
  content: measurementUtmIdentities.content,
  sessions_baseline: measurementGa4Campaigns.sessions_baseline,
  sessions_outcome: measurementGa4Campaigns.sessions_outcome,
  direct_conversions_baseline:
    measurementGa4Campaigns.direct_conversions_baseline,
  direct_conversions_outcome:
    measurementGa4Campaigns.direct_conversions_outcome,
  assisted_conversions_baseline:
    measurementGa4Campaigns.assisted_conversions_baseline,
  assisted_conversions_outcome:
    measurementGa4Campaigns.assisted_conversions_outcome,
} as const;

type CampaignRow = {
  readonly [K in keyof typeof campaignSelection]:
    (typeof campaignSelection)[K]["_"]["data"];
};

function validateMeasurementWindowListLimit(limit: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_MEASUREMENT_WINDOW_HISTORY
  ) {
    throw new RangeError(
      `limit must be between 1 and ${MAX_MEASUREMENT_WINDOW_HISTORY}`,
    );
  }
}

export class MeasurementWindowsRepository extends Repository {
  private readonly newId: () => string;

  constructor(
    exec: Executor,
    private readonly dependencies: MeasurementRepositoryDependencies = {},
  ) {
    super(exec);
    this.newId = dependencies.newId ?? randomUUID;
  }

  private async findCompletedByChangeReceipt(
    scope: ProjectScope,
    changeReceiptId: string,
    lock = false,
  ): Promise<{
    readonly run: AsyncRunRow;
    readonly measurementWindowId: string;
  } | null> {
    const query = this.exec
      .select({
        run: asyncRuns,
        measurementWindowId: measurementWindows.id,
      })
      .from(measurementWindows)
      .innerJoin(
        asyncRuns,
        and(
          eq(asyncRuns.id, measurementWindows.async_run_id),
          eq(asyncRuns.workspace_id, measurementWindows.workspace_id),
          eq(asyncRuns.project_id, measurementWindows.project_id),
        ),
      )
      .where(
        and(
          projectPredicate(measurementWindows, scope),
          projectPredicate(asyncRuns, scope),
          eq(
            measurementWindows.verified_change_receipt_id,
            changeReceiptId,
          ),
          eq(asyncRuns.kind, "measurement"),
          sql`${asyncRuns.status} in ('completed','partial')`,
          eq(asyncRuns.result_type, "measurement_window"),
          eq(asyncRuns.result_id, measurementWindows.id),
        ),
      )
      .limit(1);
    const rows = await (lock ? query.for("share") : query);
    const row = rows[0];
    return row
      ? {
          run: row.run as AsyncRunRow,
          measurementWindowId: row.measurementWindowId,
        }
      : null;
  }

  async listRelevantProviderEvidence(
    scope: ProjectScope,
    input: MeasurementProviderEvidenceInput,
  ): Promise<MeasurementProviderEvidence[]> {
    const window = MeasurementWindowInterval.safeParse(input.window);
    if (
      !Uuid.safeParse(input.siteId).success ||
      !Uuid.safeParse(input.sitePageId).success ||
      !window.success
    ) {
      throw new MeasurementWindowInvariantError(
        "MEASUREMENT_RUN_INPUT_INVALID",
      );
    }
    const canonical = canonicalInterval(window.data);
    const metricKey = {
      gsc: "gsc.page.v1",
      ga4: "ga4.landing.v1",
      geo: "geo.page_citations.v1",
    }[input.provider];
    const datasetKey = {
      gsc: "gsc.page_query_daily.v1",
      ga4: "ga4.organic_landing_daily.v1",
      geo: "geo.answer_citations.v1",
    }[input.provider];
    const rows = await this.exec
      .select({
        snapshotId: dataSnapshots.id,
        sourceConnectionId: dataSnapshots.source_connection_id,
        provider: dataSnapshots.provider,
        datasetKey: dataSnapshots.dataset_key,
        schemaVersion: dataSnapshots.schema_version,
        methodVersion: dataSnapshots.method_version,
        capturedAt: dataSnapshots.captured_at,
        sourceWindow: dataSnapshots.source_window,
        snapshotAvailability: dataSnapshots.availability,
        snapshotLimitation: dataSnapshots.limitation,
        observationId: normalizedObservations.id,
        sitePageId: normalizedObservations.site_page_id,
        metricKey: normalizedObservations.metric_key,
        subjectType: normalizedObservations.subject_type,
        subjectRef: normalizedObservations.subject_ref,
        observedAt: normalizedObservations.observed_at,
        observationAvailability: normalizedObservations.availability,
        valueJson: normalizedObservations.value_json,
        unit: normalizedObservations.unit,
        origin: normalizedObservations.origin,
        method: normalizedObservations.method,
        grade: normalizedObservations.grade,
        support: normalizedObservations.support,
        observationLimitation: normalizedObservations.limitation,
      })
      .from(dataSnapshots)
      .innerJoin(
        normalizedObservations,
        and(
          eq(normalizedObservations.snapshot_id, dataSnapshots.id),
          eq(
            normalizedObservations.workspace_id,
            dataSnapshots.workspace_id,
          ),
          eq(
            normalizedObservations.project_id,
            dataSnapshots.project_id,
          ),
        ),
      )
      .innerJoin(
        sitePages,
        and(
          eq(sitePages.id, normalizedObservations.site_page_id),
          eq(sitePages.workspace_id, normalizedObservations.workspace_id),
          eq(sitePages.project_id, normalizedObservations.project_id),
          eq(sitePages.site_id, dataSnapshots.site_id),
          eq(sitePages.normalized_url, normalizedObservations.subject_ref),
        ),
      )
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          projectPredicate(normalizedObservations, scope),
          projectPredicate(sitePages, scope),
          eq(dataSnapshots.site_id, input.siteId),
          eq(dataSnapshots.provider, input.provider),
          eq(dataSnapshots.dataset_key, datasetKey),
          sql`${dataSnapshots.availability} in ('available','partial')`,
          eq(normalizedObservations.provider, input.provider),
          eq(
            normalizedObservations.site_page_id,
            input.sitePageId,
          ),
          eq(normalizedObservations.metric_key, metricKey),
          eq(normalizedObservations.subject_type, "url"),
          eq(normalizedObservations.availability, "available"),
          sql`${dataSnapshots.source_connection_id} is not null`,
          sql`(
            app.normalize_measurement_source_window(
              ${dataSnapshots.source_window}
            ) ->> 'startAt'
          )::timestamptz < ${canonical.endAt}`,
          sql`(
            app.normalize_measurement_source_window(
              ${dataSnapshots.source_window}
            ) ->> 'endAt'
          )::timestamptz > ${canonical.startAt}`,
        ),
      )
      .orderBy(
        desc(dataSnapshots.captured_at),
        desc(normalizedObservations.observed_at),
        desc(normalizedObservations.id),
      );

    return rows.map((row) => {
      if (
        row.sitePageId === null ||
        row.sourceConnectionId === null
      ) {
        throw new MeasurementWindowInvariantError(
          "MEASUREMENT_INTEGRITY_INVALID",
        );
      }
      return {
        ...row,
        sourceWindow: row.sourceWindow as Record<string, unknown>,
        coveredWindow: canonicalSourceWindow(row.sourceWindow),
        capturedAt: canonicalUtcTimestamptz(row.capturedAt),
        observedAt: canonicalUtcTimestamptz(row.observedAt),
        sitePageId: row.sitePageId,
        sourceConnectionId: row.sourceConnectionId,
      };
    });
  }

  async findChangeReceiptForMeasurement(
    scope: ProjectScope,
    changeReceiptId: string,
    options: MeasurementAuthorityReadOptions = {},
  ): Promise<MeasurementChangeReceiptAuthority | null> {
    if (
      !Uuid.safeParse(scope.workspaceId).success ||
      !Uuid.safeParse(scope.projectId).success ||
      !Uuid.safeParse(changeReceiptId).success
    ) {
      return null;
    }
    const projectQuery = this.exec
      .select()
      .from(clientProjects)
      .where(
        and(
          eq(clientProjects.workspace_id, scope.workspaceId),
          eq(clientProjects.id, scope.projectId),
          sql`${clientProjects.archived_at} is null`,
        ),
      )
      .limit(1);
    const projectRows = await (options.lock
      ? projectQuery.for("share")
      : projectQuery);
    if (!projectRows[0]) return null;

    const receiptQuery = this.exec
      .select()
      .from(publicationReceipts)
      .where(
        and(
          projectPredicate(publicationReceipts, scope),
          eq(publicationReceipts.id, changeReceiptId),
          eq(publicationReceipts.receipt_kind, "change_receipt"),
          eq(
            publicationReceipts.verification_state,
            "verified_live",
          ),
          sql`${publicationReceipts.live_canonical_url} is not null`,
        ),
      )
      .limit(1);
    const receiptRows = await (options.lock
      ? receiptQuery.for("share")
      : receiptQuery);
    const receipt = receiptRows[0];
    if (!receipt || receipt.predecessor_delivery_receipt_id === null) {
      return null;
    }

    const attemptQuery = this.exec
      .select()
      .from(publicationAttempts)
      .where(
        and(
          projectPredicate(publicationAttempts, scope),
          eq(publicationAttempts.id, receipt.publication_attempt_id),
          eq(publicationAttempts.site_id, receipt.site_id),
        ),
      )
      .limit(1);
    const attemptRows = await (options.lock
      ? attemptQuery.for("share")
      : attemptQuery);
    const attempt = attemptRows[0];
    if (!attempt) return null;

    const runQuery = this.exec
      .select()
      .from(asyncRuns)
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.id, attempt.async_run_id),
          eq(asyncRuns.kind, "publication"),
          sql`${asyncRuns.status} in ('completed','partial')`,
          eq(asyncRuns.result_type, "publication_attempt"),
          eq(asyncRuns.result_id, attempt.id),
        ),
      )
      .limit(1);
    const runRows = await (options.lock
      ? runQuery.for("share")
      : runQuery);
    const run = runRows[0];
    if (!run) return null;

    const siteQuery = this.exec
      .select()
      .from(sites)
      .where(
        and(
          projectPredicate(sites, scope),
          eq(sites.id, receipt.site_id),
        ),
      )
      .limit(1);
    const siteRows = await (options.lock
      ? siteQuery.for("share")
      : siteQuery);
    const site = siteRows[0];
    if (!site) return null;

    const pageQuery = this.exec
      .select()
      .from(sitePages)
      .where(
        and(
          projectPredicate(sitePages, scope),
          eq(sitePages.site_id, site.id),
          eq(
            sitePages.normalized_url,
            receipt.live_canonical_url!,
          ),
        ),
      )
      .limit(1);
    const pageRows = await (options.lock
      ? pageQuery.for("share")
      : pageQuery);
    const sitePage = pageRows[0];
    if (!sitePage) return null;

    const deliveryQuery = this.exec
      .select()
      .from(publicationReceipts)
      .where(
        and(
          projectPredicate(publicationReceipts, scope),
          eq(
            publicationReceipts.id,
            receipt.predecessor_delivery_receipt_id,
          ),
          eq(
            publicationReceipts.publication_attempt_id,
            attempt.id,
          ),
          eq(publicationReceipts.site_id, site.id),
          eq(publicationReceipts.receipt_kind, "delivery_receipt"),
        ),
      )
      .limit(1);
    const deliveryRows = await (options.lock
      ? deliveryQuery.for("share")
      : deliveryQuery);
    const deliveryReceipt = deliveryRows[0];
    if (
      !deliveryReceipt ||
      attempt.approved_artifact_content_hash !==
        receipt.artifact_content_hash ||
      attempt.content_checksum !== receipt.content_checksum ||
      deliveryReceipt.provider_kind !== receipt.provider_kind ||
      deliveryReceipt.remote_scope_ref !== receipt.remote_scope_ref ||
      deliveryReceipt.artifact_content_hash !==
        receipt.artifact_content_hash ||
      deliveryReceipt.content_checksum !== receipt.content_checksum
      ||
      Date.parse(deliveryReceipt.observed_at) >=
        Date.parse(receipt.observed_at)
    ) {
      return null;
    }
    return {
      receipt,
      attempt,
      run,
      site,
      sitePage,
      deliveryReceipt,
    };
  }

  async createRunAtomically(
    command: CreateMeasurementRunTransaction,
  ): Promise<MeasurementRunTransactionResult> {
    if (!this.dependencies.enqueue) {
      throw new MeasurementWindowInvariantError(
        "MEASUREMENT_ENQUEUE_REQUIRED",
      );
    }
    assertMeasurementRunCommand(command);
    const transactional = this.exec as Executor & {
      transaction?: <T>(
        run: (tx: DbTx) => Promise<T>,
        options?: { isolationLevel?: string },
      ) => Promise<T>;
    };
    if (typeof transactional.transaction !== "function") {
      throw new MeasurementWindowInvariantError(
        "MEASUREMENT_ATOMIC_TRANSACTION_REQUIRED",
      );
    }
    const scope = {
      workspaceId: command.workspaceId,
      projectId: command.projectId,
    };
    const existing =
      await new AsyncRunsRepository(
        this.exec,
      ).findMeasurementByIdempotency(
        scope,
        command.idempotencyKey,
      );
    if (existing) {
      return exactMeasurementReplay(existing, scope, command);
    }
    const completed = await this.findCompletedByChangeReceipt(
      scope,
      command.changeReceiptId,
    );
    if (completed) {
      throw new MeasurementRunAlreadyCompletedError(
        completed.run.id,
        completed.measurementWindowId,
      );
    }

    try {
      return await transactional.transaction(
        async (tx) => {
          const runs = new AsyncRunsRepository(tx);
          const replay = await runs.findMeasurementByIdempotency(
            scope,
            command.idempotencyKey,
          );
          if (replay) {
            return exactMeasurementReplay(replay, scope, command);
          }
          const completedInTx =
            await new MeasurementWindowsRepository(
              tx,
              this.dependencies,
            ).findCompletedByChangeReceipt(
              scope,
              command.changeReceiptId,
              true,
            );
          if (completedInTx) {
            throw new MeasurementRunAlreadyCompletedError(
              completedInTx.run.id,
              completedInTx.measurementWindowId,
            );
          }
          const facts = assertResolvedMeasurementRunFacts(
            scope,
            command,
            await command.resolveCurrentFacts(tx),
          );
          const measurementWindowId = this.newId();
          const runId = this.newId();
          if (
            !Uuid.safeParse(measurementWindowId).success ||
            !Uuid.safeParse(runId).success
          ) {
            throw new MeasurementWindowInvariantError(
              "MEASUREMENT_RUN_INPUT_INVALID",
            );
          }
          const run = await runs.insertQueued({
            runId,
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            kind: "measurement",
            activeKey: `measurement:${command.changeReceiptId}`,
            initiatedBy: command.requestedBy,
            contractVersion: command.contractVersion,
            requestPayload: {
              operation: "measurement_window",
              idempotencyKey: command.idempotencyKey,
              requestHash: command.requestHash,
              frozenFacts: facts as unknown as Record<string, unknown>,
            },
            resultType: "measurement_window",
            resultId: measurementWindowId,
          });
          // `active_key` is the serialization point for one Change Receipt.
          // Under READ COMMITTED, an insert that waited for an older run to
          // become terminal receives a fresh snapshot here and can see the
          // completed Measurement Window committed by that run. Throwing rolls
          // back this newly inserted run before any job can be enqueued.
          const completedAfterInsert =
            await new MeasurementWindowsRepository(
              tx,
              this.dependencies,
            ).findCompletedByChangeReceipt(
              scope,
              command.changeReceiptId,
            );
          if (completedAfterInsert) {
            throw new MeasurementRunAlreadyCompletedError(
              completedAfterInsert.run.id,
              completedAfterInsert.measurementWindowId,
            );
          }
          await this.dependencies.enqueue!(
            tx,
            {
              runId,
              workspaceId: scope.workspaceId,
              projectId: scope.projectId,
              contractVersion: command.contractVersion,
            },
            { startAfter: new Date(facts.startAfter) },
          );
          return {
            run,
            measurementWindowId,
            replayed: false,
          };
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      const constraint = pgConstraint(error);
      if (constraint === "async_runs_measurement_idempotency_idx") {
        const winner = await new AsyncRunsRepository(
          this.exec,
        ).findMeasurementByIdempotency(
          scope,
          command.idempotencyKey,
        );
        if (!winner) {
          throw new MeasurementWindowInvariantError(
            "MEASUREMENT_INTEGRITY_INVALID",
          );
        }
        return exactMeasurementReplay(winner, scope, command);
      }
      if (constraint === "async_runs_one_active_key_idx") {
        const active = await new AsyncRunsRepository(
          this.exec,
        ).findActive(
          scope,
          `measurement:${command.changeReceiptId}`,
        );
        throw new MeasurementRunAlreadyActiveError(active?.id ?? null);
      }
      throw error;
    }
  }

  async appendFinal(
    scope: ProjectScope,
    input: AppendMeasurementWindowInput,
  ): Promise<AppendMeasurementWindowResult> {
    // Reject scope/lineage drift before opening a transaction. The tx-local
    // variant validates again because workers call it directly.
    assertAppendInput(scope, input);
    const transactional = this.exec as Executor & {
      transaction?: <T>(
        run: (tx: DbTx) => Promise<T>,
      ) => Promise<T>;
    };
    if (typeof transactional.transaction !== "function") {
      throw new MeasurementWindowInvariantError(
        "MEASUREMENT_TRANSACTION_REQUIRED",
      );
    }

    return transactional.transaction((tx) =>
      new MeasurementWindowsRepository(
        tx,
        this.dependencies,
      ).appendFinalInTx(scope, input),
    );
  }

  async appendFinalInTx(
    scope: ProjectScope,
    input: AppendMeasurementWindowInput,
  ): Promise<AppendMeasurementWindowResult> {
    const window = assertAppendInput(scope, input);
    const resultHash = measurementWindowResultHash({
      ...input,
      window,
    });
    const tx = this.exec;

    const [existing] = await tx
      .select({
        result_hash: measurementWindows.result_hash,
        async_run_id: measurementWindows.async_run_id,
      })
      .from(measurementWindows)
      .where(
        and(
          projectPredicate(measurementWindows, scope),
          eq(measurementWindows.id, window.measurementWindowId),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.result_hash !== resultHash ||
        existing.async_run_id !== input.asyncRunId
      ) {
        throw new MeasurementWindowInvariantError(
          "MEASUREMENT_REPLAY_CONFLICT",
        );
      }
      const projected = await new MeasurementWindowsRepository(
        tx,
      ).findById(scope, window.measurementWindowId);
      if (!projected) {
        throw new MeasurementWindowInvariantError(
          "MEASUREMENT_INTEGRITY_INVALID",
        );
      }
      return { window: projected, replayed: true };
    }

    await tx.insert(measurementWindows).values({
      id: window.measurementWindowId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: window.siteId,
      async_run_id: input.asyncRunId,
      target_kind: window.target.kind,
      target_ref: window.target.targetRef,
      site_page_id: window.target.sitePageId,
      action_id: window.actionId,
      artifact_id: window.artifactId,
      artifact_revision_id: window.artifactRevisionId,
      artifact_revision: window.artifactRevision,
      artifact_content_hash: window.artifactContentHash,
      content_checksum:
        window.verifiedChangeReceipt.contentChecksum,
      publication_attempt_id: window.publicationAttemptId,
      verified_change_receipt_id:
        window.verifiedChangeReceipt.id,
      timeline_delivery_receipt_id:
        window.timelineDeliveryReceipt?.id ?? null,
      before_start_at: window.beforeWindow.startAt,
      before_end_at: window.beforeWindow.endAt,
      after_start_at: window.afterWindow.startAt,
      after_end_at: window.afterWindow.endAt,
      timezone: window.timezone,
      url: window.url,
      canonical_url: window.canonicalUrl,
      interpretation: window.interpretation,
      state: window.state,
      technical_verification_ref:
        window.technicalVerificationRef,
      limitation: window.limitation,
      result_hash: resultHash,
      recorded_at: window.recordedAt,
    });

    const gsc = window.dimensions.gsc;
    await tx.insert(measurementGscDimensions).values({
      ...commonDimensionValues(scope, window, gsc),
      baseline_observation_id:
        input.observationLineage.gsc.baselineObservationId,
      outcome_observation_id:
        input.observationLineage.gsc.outcomeObservationId,
      clicks_baseline: gsc.metrics.clicks.baseline,
      clicks_outcome: gsc.metrics.clicks.outcome,
      impressions_baseline: gsc.metrics.impressions.baseline,
      impressions_outcome: gsc.metrics.impressions.outcome,
      ctr_baseline: gsc.metrics.ctr.baseline,
      ctr_outcome: gsc.metrics.ctr.outcome,
      average_position_baseline:
        gsc.metrics.averagePosition.baseline,
      average_position_outcome:
        gsc.metrics.averagePosition.outcome,
    });

    const ga4 = window.dimensions.ga4;
    await tx.insert(measurementGa4Dimensions).values({
      ...commonDimensionValues(scope, window, ga4),
      baseline_observation_id:
        input.observationLineage.ga4.baselineObservationId,
      outcome_observation_id:
        input.observationLineage.ga4.outcomeObservationId,
      direct_conversion_definition_id:
        ga4.directConversionDefinition?.conversionDefinitionId ?? null,
      direct_event_names:
        ga4.directConversionDefinition?.eventNames ?? null,
      direct_counting_method:
        ga4.directConversionDefinition?.countingMethod ?? null,
      direct_attribution_boundary:
        ga4.directConversionDefinition?.attributionBoundary ?? null,
      direct_lookback_window_days:
        ga4.directConversionDefinition?.lookbackWindowDays ?? null,
      assisted_conversion_definition_id:
        ga4.assistedConversionDefinition?.conversionDefinitionId ??
        null,
      assisted_event_names:
        ga4.assistedConversionDefinition?.eventNames ?? null,
      assisted_counting_method:
        ga4.assistedConversionDefinition?.countingMethod ?? null,
      assisted_attribution_boundary:
        ga4.assistedConversionDefinition?.attributionBoundary ?? null,
      assisted_lookback_window_days:
        ga4.assistedConversionDefinition?.lookbackWindowDays ?? null,
      sessions_baseline: ga4.metrics.sessions.baseline,
      sessions_outcome: ga4.metrics.sessions.outcome,
      engaged_sessions_baseline:
        ga4.metrics.engagedSessions.baseline,
      engaged_sessions_outcome:
        ga4.metrics.engagedSessions.outcome,
      direct_conversions_baseline:
        ga4.metrics.directConversions.baseline,
      direct_conversions_outcome:
        ga4.metrics.directConversions.outcome,
      assisted_conversions_baseline:
        ga4.metrics.assistedConversions.baseline,
      assisted_conversions_outcome:
        ga4.metrics.assistedConversions.outcome,
    });

    const geo = window.dimensions.geo;
    await tx.insert(measurementGeoDimensions).values({
      ...commonDimensionValues(scope, window, geo),
      baseline_observation_id:
        input.observationLineage.geo.baselineObservationId,
      outcome_observation_id:
        input.observationLineage.geo.outcomeObservationId,
      tracked_queries_baseline:
        geo.metrics.trackedQueries.baseline,
      tracked_queries_outcome:
        geo.metrics.trackedQueries.outcome,
      cited_queries_baseline: geo.metrics.citedQueries.baseline,
      cited_queries_outcome: geo.metrics.citedQueries.outcome,
      citations_baseline: geo.metrics.citations.baseline,
      citations_outcome: geo.metrics.citations.outcome,
      citation_rate_baseline: geo.metrics.citationRate.baseline,
      citation_rate_outcome: geo.metrics.citationRate.outcome,
    });

    for (const campaign of ga4.campaigns) {
      const identityHash = contentHash(
        campaign.identity as unknown as CanonicalValue,
      );
      await tx
        .insert(measurementUtmIdentities)
        .values({
          id: campaign.identity.utmIdentityId,
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          source: campaign.identity.source,
          medium: campaign.identity.medium,
          campaign: campaign.identity.campaign,
          content: campaign.identity.content,
          identity_hash: identityHash,
        })
        .onConflictDoNothing();
      const [identity] = await tx
        .select({
          source: measurementUtmIdentities.source,
          medium: measurementUtmIdentities.medium,
          campaign: measurementUtmIdentities.campaign,
          content: measurementUtmIdentities.content,
          identity_hash: measurementUtmIdentities.identity_hash,
        })
        .from(measurementUtmIdentities)
        .where(
          and(
            projectPredicate(measurementUtmIdentities, scope),
            eq(
              measurementUtmIdentities.id,
              campaign.identity.utmIdentityId,
            ),
          ),
        )
        .limit(1);
      if (
        !identity ||
        identity.identity_hash !== identityHash ||
        identity.source !== campaign.identity.source ||
        identity.medium !== campaign.identity.medium ||
        identity.campaign !== campaign.identity.campaign ||
        identity.content !== campaign.identity.content
      ) {
        throw new MeasurementWindowInvariantError(
          "MEASUREMENT_REPLAY_CONFLICT",
        );
      }
      await tx.insert(measurementGa4Campaigns).values({
        measurement_window_id: window.measurementWindowId,
        utm_identity_id: campaign.identity.utmIdentityId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        sessions_baseline: campaign.metrics.sessions.baseline,
        sessions_outcome: campaign.metrics.sessions.outcome,
        direct_conversions_baseline:
          campaign.metrics.directConversions.baseline,
        direct_conversions_outcome:
          campaign.metrics.directConversions.outcome,
        assisted_conversions_baseline:
          campaign.metrics.assistedConversions.baseline,
        assisted_conversions_outcome:
          campaign.metrics.assistedConversions.outcome,
      });
    }

    return { window, replayed: false };
  }

  async findById(
    scope: ProjectScope,
    measurementWindowId: string,
  ): Promise<MeasurementWindow | null> {
    const [window] = await this.exec
      .select()
      .from(measurementWindows)
      .where(
        and(
          projectPredicate(measurementWindows, scope),
          eq(measurementWindows.id, measurementWindowId),
        ),
      )
      .limit(1);
    if (!window) return null;

    // A transaction executor is backed by one PostgreSQL client. Keep these
    // reads sequential so replay does not issue concurrent queries on it.
    const gscRows = await this.exec
      .select()
      .from(measurementGscDimensions)
      .where(
        and(
          projectPredicate(measurementGscDimensions, scope),
          eq(
            measurementGscDimensions.measurement_window_id,
            measurementWindowId,
          ),
        ),
      )
      .limit(1);
    const ga4Rows = await this.exec
      .select()
      .from(measurementGa4Dimensions)
      .where(
        and(
          projectPredicate(measurementGa4Dimensions, scope),
          eq(
            measurementGa4Dimensions.measurement_window_id,
            measurementWindowId,
          ),
        ),
      )
      .limit(1);
    const geoRows = await this.exec
      .select()
      .from(measurementGeoDimensions)
      .where(
        and(
          projectPredicate(measurementGeoDimensions, scope),
          eq(
            measurementGeoDimensions.measurement_window_id,
            measurementWindowId,
          ),
        ),
      )
      .limit(1);
    const changeRows = await this.exec
      .select()
      .from(publicationReceipts)
      .where(
        and(
          projectPredicate(publicationReceipts, scope),
          eq(
            publicationReceipts.id,
            window.verified_change_receipt_id,
          ),
        ),
      )
      .limit(1);
    const deliveryRows = window.timeline_delivery_receipt_id
      ? await this.exec
          .select()
          .from(publicationReceipts)
          .where(
            and(
              projectPredicate(publicationReceipts, scope),
              eq(
                publicationReceipts.id,
                window.timeline_delivery_receipt_id,
              ),
            ),
          )
          .limit(1)
      : [];
    const campaigns = await this.exec
      .select(campaignSelection)
      .from(measurementGa4Campaigns)
      .innerJoin(
        measurementUtmIdentities,
        and(
          eq(
            measurementUtmIdentities.id,
            measurementGa4Campaigns.utm_identity_id,
          ),
          eq(
            measurementUtmIdentities.workspace_id,
            measurementGa4Campaigns.workspace_id,
          ),
          eq(
            measurementUtmIdentities.project_id,
            measurementGa4Campaigns.project_id,
          ),
        ),
      )
      .where(
        and(
          projectPredicate(measurementGa4Campaigns, scope),
          eq(
            measurementGa4Campaigns.measurement_window_id,
            measurementWindowId,
          ),
        ),
      )
      .orderBy(asc(measurementGa4Campaigns.utm_identity_id));

    const gsc = gscRows[0];
    const ga4 = ga4Rows[0];
    const geo = geoRows[0];
    const change = changeRows[0];
    const delivery = deliveryRows[0] ?? null;
    if (!gsc || !ga4 || !geo || !change) {
      throw new MeasurementWindowInvariantError(
        "MEASUREMENT_INTEGRITY_INVALID",
      );
    }

    const projected = {
      measurementWindowId: window.id,
      projectId: window.project_id,
      siteId: window.site_id,
      target: {
        kind: window.target_kind,
        targetRef: window.target_ref,
        sitePageId: window.site_page_id,
      },
      actionId: window.action_id,
      artifactId: window.artifact_id,
      artifactRevisionId: window.artifact_revision_id,
      artifactRevision: window.artifact_revision,
      artifactContentHash: window.artifact_content_hash,
      publicationAttemptId: window.publication_attempt_id,
      verifiedChangeReceipt: receiptProjection(change),
      timelineDeliveryReceipt: delivery
        ? receiptProjection(delivery)
        : null,
      beforeWindow: {
        startAt: canonicalUtcTimestamptz(window.before_start_at),
        endAt: canonicalUtcTimestamptz(window.before_end_at),
      },
      afterWindow: {
        startAt: canonicalUtcTimestamptz(window.after_start_at),
        endAt: canonicalUtcTimestamptz(window.after_end_at),
      },
      timezone: window.timezone,
      url: window.url,
      canonicalUrl: window.canonical_url,
      interpretation: window.interpretation,
      state: window.state,
      technicalVerificationRef: window.technical_verification_ref,
      limitation: window.limitation,
      dimensions: {
        gsc: {
          provider: "gsc",
          state: gsc.state,
          baselineSource: sourceProjection(
            "gsc",
            "baseline",
            gsc,
          ),
          outcomeSource: sourceProjection(
            "gsc",
            "outcome",
            gsc,
          ),
          sampleSize: {
            baseline: gsc.sample_baseline,
            outcome: gsc.sample_outcome,
            unit: gsc.sample_unit,
            coverage: gsc.coverage,
          },
          limitation: gsc.limitation,
          metrics: {
            clicks: {
              baseline: gsc.clicks_baseline,
              outcome: gsc.clicks_outcome,
            },
            impressions: {
              baseline: gsc.impressions_baseline,
              outcome: gsc.impressions_outcome,
            },
            ctr: {
              baseline: gsc.ctr_baseline,
              outcome: gsc.ctr_outcome,
            },
            averagePosition: {
              baseline: gsc.average_position_baseline,
              outcome: gsc.average_position_outcome,
            },
          },
        },
        ga4: {
          provider: "ga4",
          state: ga4.state,
          baselineSource: sourceProjection(
            "ga4",
            "baseline",
            ga4,
          ),
          outcomeSource: sourceProjection(
            "ga4",
            "outcome",
            ga4,
          ),
          sampleSize: {
            baseline: ga4.sample_baseline,
            outcome: ga4.sample_outcome,
            unit: ga4.sample_unit,
            coverage: ga4.coverage,
          },
          limitation: ga4.limitation,
          directConversionDefinition:
            conversionDefinitionProjection("direct", {
              id: ga4.direct_conversion_definition_id,
              eventNames: ga4.direct_event_names,
              countingMethod: ga4.direct_counting_method,
              attributionBoundary: ga4.direct_attribution_boundary,
              lookbackWindowDays: ga4.direct_lookback_window_days,
            }),
          assistedConversionDefinition:
            conversionDefinitionProjection("assisted", {
              id: ga4.assisted_conversion_definition_id,
              eventNames: ga4.assisted_event_names,
              countingMethod: ga4.assisted_counting_method,
              attributionBoundary:
                ga4.assisted_attribution_boundary,
              lookbackWindowDays:
                ga4.assisted_lookback_window_days,
            }),
          metrics: {
            sessions: {
              baseline: ga4.sessions_baseline,
              outcome: ga4.sessions_outcome,
            },
            engagedSessions: {
              baseline: ga4.engaged_sessions_baseline,
              outcome: ga4.engaged_sessions_outcome,
            },
            directConversions: {
              baseline: ga4.direct_conversions_baseline,
              outcome: ga4.direct_conversions_outcome,
            },
            assistedConversions: {
              baseline: ga4.assisted_conversions_baseline,
              outcome: ga4.assisted_conversions_outcome,
            },
          },
          campaigns: (campaigns as CampaignRow[]).map((campaign) => ({
            identity: {
              utmIdentityId: campaign.utm_identity_id,
              source: campaign.source,
              medium: campaign.medium,
              campaign: campaign.campaign,
              content: campaign.content,
            },
            metrics: {
              sessions: {
                baseline: campaign.sessions_baseline,
                outcome: campaign.sessions_outcome,
              },
              directConversions: {
                baseline: campaign.direct_conversions_baseline,
                outcome: campaign.direct_conversions_outcome,
              },
              assistedConversions: {
                baseline: campaign.assisted_conversions_baseline,
                outcome: campaign.assisted_conversions_outcome,
              },
            },
          })),
        },
        geo: {
          provider: "geo",
          state: geo.state,
          baselineSource: sourceProjection(
            "geo",
            "baseline",
            geo,
          ),
          outcomeSource: sourceProjection(
            "geo",
            "outcome",
            geo,
          ),
          sampleSize: {
            baseline: geo.sample_baseline,
            outcome: geo.sample_outcome,
            unit: geo.sample_unit,
            coverage: geo.coverage,
          },
          limitation: geo.limitation,
          metrics: {
            trackedQueries: {
              baseline: geo.tracked_queries_baseline,
              outcome: geo.tracked_queries_outcome,
            },
            citedQueries: {
              baseline: geo.cited_queries_baseline,
              outcome: geo.cited_queries_outcome,
            },
            citations: {
              baseline: geo.citations_baseline,
              outcome: geo.citations_outcome,
            },
            citationRate: {
              baseline: geo.citation_rate_baseline,
              outcome: geo.citation_rate_outcome,
            },
          },
        },
      },
      recordedAt: canonicalUtcTimestamptz(window.recorded_at),
    };

    const parsed = MeasurementWindowSchema.safeParse(projected);
    if (
      !parsed.success ||
      measurementWindowResultHash({
        asyncRunId: window.async_run_id,
        window: parsed.data,
        observationLineage: {
          gsc: {
            baselineObservationId: gsc.baseline_observation_id,
            outcomeObservationId: gsc.outcome_observation_id,
          },
          ga4: {
            baselineObservationId: ga4.baseline_observation_id,
            outcomeObservationId: ga4.outcome_observation_id,
          },
          geo: {
            baselineObservationId: geo.baseline_observation_id,
            outcomeObservationId: geo.outcome_observation_id,
          },
        },
      }) !== window.result_hash
    ) {
      throw new MeasurementWindowInvariantError(
        "MEASUREMENT_INTEGRITY_INVALID",
      );
    }
    return parsed.data;
  }

  async listByTarget(
    scope: ProjectScope,
    target: MeasurementTarget,
    options: MeasurementWindowHistoryOptions,
  ): Promise<MeasurementWindow[]> {
    validateMeasurementWindowListLimit(options.limit);
    const rows = await this.exec
      .select({ id: measurementWindows.id })
      .from(measurementWindows)
      .where(
        and(
          projectPredicate(measurementWindows, scope),
          eq(measurementWindows.target_kind, target.kind),
          eq(measurementWindows.target_ref, target.targetRef),
          eq(measurementWindows.site_page_id, target.sitePageId),
        ),
      )
      .orderBy(
        desc(measurementWindows.recorded_at),
        desc(measurementWindows.id),
      )
      .limit(options.limit);
    return this.hydrateWindows(scope, rows);
  }

  /**
   * Return complete immutable Measurement Windows across every project target.
   * The ID scan is bounded and deterministically ordered; hydration remains
   * sequential because a transaction executor owns one PostgreSQL client.
   */
  async listRecent(
    scope: ProjectScope,
    options: MeasurementWindowRecentOptions,
  ): Promise<MeasurementWindow[]> {
    validateMeasurementWindowListLimit(options.limit);
    const rows = await this.exec
      .select({ id: measurementWindows.id })
      .from(measurementWindows)
      .where(projectPredicate(measurementWindows, scope))
      .orderBy(
        desc(measurementWindows.recorded_at),
        desc(measurementWindows.id),
      )
      .limit(options.limit);
    return this.hydrateWindows(scope, rows);
  }

  private async hydrateWindows(
    scope: ProjectScope,
    rows: readonly { readonly id: string }[],
  ): Promise<MeasurementWindow[]> {
    const windows: MeasurementWindow[] = [];
    for (const row of rows) {
      const window = await this.findById(scope, row.id);
      if (window === null) {
        throw new MeasurementWindowInvariantError(
          "MEASUREMENT_INTEGRITY_INVALID",
        );
      }
      windows.push(window);
    }
    return windows;
  }
}
