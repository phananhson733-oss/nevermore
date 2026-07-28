import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { MeasurementWindow } from "@sf/contracts";
import {
  MeasurementWindowsRepository,
  measurementWindowResultHash,
  type CreateMeasurementRunTransaction,
} from "./measurement-windows.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

class FakeQuery {
  constructor(private readonly owner: FakeExecutor) {}

  private chain(method: string, args: readonly unknown[]): this {
    this.owner.calls.push({ method, args });
    return this;
  }

  from(...args: unknown[]): this {
    return this.chain("from", args);
  }

  innerJoin(...args: unknown[]): this {
    return this.chain("innerJoin", args);
  }

  where(...args: unknown[]): this {
    return this.chain("where", args);
  }

  orderBy(...args: unknown[]): this {
    return this.chain("orderBy", args);
  }

  limit(...args: unknown[]): this {
    return this.chain("limit", args);
  }

  for(...args: unknown[]): this {
    return this.chain("for", args);
  }

  values(...args: unknown[]): this {
    return this.chain("values", args);
  }

  returning(...args: unknown[]): this {
    return this.chain("returning", args);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.owner.take()).then(onFulfilled, onRejected);
  }
}

class FakeExecutor {
  readonly calls: RecordedCall[] = [];
  private readonly results: unknown[] = [];

  enqueue(...results: unknown[]): void {
    this.results.push(...results);
  }

  take(): unknown {
    return this.results.length > 0 ? this.results.shift() : [];
  }

  select(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "select", args });
    return new FakeQuery(this);
  }

  insert(...args: unknown[]): FakeQuery {
    this.calls.push({ method: "insert", args });
    return new FakeQuery(this);
  }

  transaction<T>(
    run: (tx: FakeExecutor) => Promise<T>,
    options?: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push({ method: "transaction", args: [options] });
    return run(this);
  }

  last(method: string): RecordedCall {
    const call = this.calls.findLast((candidate) => candidate.method === method);
    if (!call) throw new Error(`No ${method} call was recorded`);
    return call;
  }
}

const ids = {
  workspace: "91000000-0000-4000-8000-000000000001",
  project: "91000000-0000-4000-8000-000000000002",
  site: "91000000-0000-4000-8000-000000000003",
  sitePage: "91000000-0000-4000-8000-000000000004",
  action: "91000000-0000-4000-8000-000000000005",
  artifact: "91000000-0000-4000-8000-000000000006",
  revision: "91000000-0000-4000-8000-000000000007",
  attempt: "91000000-0000-4000-8000-000000000008",
  change: "91000000-0000-4000-8000-000000000009",
  measurement: "91000000-0000-4000-8000-000000000010",
  asyncRun: "91000000-0000-4000-8000-000000000011",
  gscSource: "91000000-0000-4000-8000-000000000012",
  gscBefore: "91000000-0000-4000-8000-000000000013",
  gscAfter: "91000000-0000-4000-8000-000000000014",
  ga4Source: "91000000-0000-4000-8000-000000000015",
  ga4Before: "91000000-0000-4000-8000-000000000016",
  ga4After: "91000000-0000-4000-8000-000000000017",
  geoSource: "91000000-0000-4000-8000-000000000018",
  geoBefore: "91000000-0000-4000-8000-000000000019",
  geoAfter: "91000000-0000-4000-8000-000000000020",
  direct: "91000000-0000-4000-8000-000000000021",
  assisted: "91000000-0000-4000-8000-000000000022",
  gscBeforeObservation: "91000000-0000-4000-8000-000000000023",
  gscAfterObservation: "91000000-0000-4000-8000-000000000024",
  ga4BeforeObservation: "91000000-0000-4000-8000-000000000025",
  ga4AfterObservation: "91000000-0000-4000-8000-000000000026",
  actor: "91000000-0000-4000-8000-000000000028",
} as const;

const beforeWindow = {
  startAt: "2026-06-01T00:00:00Z",
  endAt: "2026-06-15T00:00:00Z",
} as const;
const afterWindow = {
  startAt: "2026-07-01T00:00:00Z",
  endAt: "2026-07-15T00:00:00Z",
} as const;
const artifactContentHash = "a".repeat(64);
const contentChecksum = "b".repeat(64);

function unavailableSource<
  TProvider extends "gsc" | "ga4" | "geo",
>(
  provider: TProvider,
  sourceRef: string,
  snapshotId: string,
  phase: "before" | "after",
): {
  provider: TProvider;
  sourceRef: string;
  snapshotId: string;
  coveredWindow: typeof beforeWindow | typeof afterWindow;
  observedAt: string;
  freshness: "current";
} {
  return {
    provider,
    sourceRef,
    snapshotId,
    coveredWindow: phase === "before" ? beforeWindow : afterWindow,
    observedAt:
      phase === "before"
        ? "2026-06-16T00:00:00Z"
        : "2026-07-16T00:00:00Z",
    freshness: "current" as const,
  };
}

function fixture(): MeasurementWindow {
  const unavailable = {
    baseline: null,
    outcome: null,
  };
  return {
    measurementWindowId: ids.measurement,
    projectId: ids.project,
    siteId: ids.site,
    target: {
      kind: "url",
      targetRef: `site-page://${ids.sitePage}`,
      sitePageId: ids.sitePage,
    },
    actionId: ids.action,
    artifactId: ids.artifact,
    artifactRevisionId: ids.revision,
    artifactRevision: 3,
    artifactContentHash,
    publicationAttemptId: ids.attempt,
    verifiedChangeReceipt: {
      id: ids.change,
      providerKind: "github",
      providerRequestId: null,
      remoteScopeRef: "installation:42/repository:relayops",
      remoteObjectId: "merge-17",
      remoteRevision: "merge-sha",
      deliveryUrl: "https://github.com/example/relayops/pull/17",
      artifactContentHash,
      contentChecksum,
      remoteFacts: { merge: 17 },
      observedAt: "2026-06-20T12:00:00Z",
      receiptKind: "change_receipt",
      predecessorDeliveryReceiptId:
        "91000000-0000-4000-8000-000000000027",
      remoteObjectKind: "github_merge",
      liveCanonicalUrl:
        "https://relayops.example/blog/customer-onboarding/",
      verificationState: "verified_live",
      evidenceRefs: ["evidence://github/merge/17"],
      limitation: null,
    },
    timelineDeliveryReceipt: null,
    beforeWindow,
    afterWindow,
    timezone: "America/New_York",
    url: "https://relayops.example/blog/customer-onboarding/?ref=launch",
    canonicalUrl:
      "https://relayops.example/blog/customer-onboarding/",
    interpretation: "observational_non_causal",
    state: "unavailable",
    technicalVerificationRef: null,
    limitation: "Configured providers did not return comparable snapshots.",
    dimensions: {
      gsc: {
        provider: "gsc",
        state: "unavailable",
        baselineSource: null,
        outcomeSource: null,
        sampleSize: {
          ...unavailable,
          unit: "impressions",
          coverage: "none",
        },
        limitation: "GSC coverage was unavailable.",
        metrics: {
          clicks: unavailable,
          impressions: unavailable,
          ctr: unavailable,
          averagePosition: unavailable,
        },
      },
      ga4: {
        provider: "ga4",
        state: "unavailable",
        baselineSource: null,
        outcomeSource: null,
        sampleSize: {
          ...unavailable,
          unit: "sessions",
          coverage: "none",
        },
        limitation: "GA4 coverage was unavailable.",
        directConversionDefinition: null,
        assistedConversionDefinition: null,
        metrics: {
          sessions: unavailable,
          engagedSessions: unavailable,
          directConversions: unavailable,
          assistedConversions: unavailable,
        },
        campaigns: [],
      },
      geo: {
        provider: "geo",
        state: "unavailable",
        baselineSource: null,
        outcomeSource: null,
        sampleSize: {
          ...unavailable,
          unit: "tracked_queries",
          coverage: "none",
        },
        limitation: "GEO coverage was unavailable.",
        metrics: {
          trackedQueries: unavailable,
          citedQueries: unavailable,
          citations: unavailable,
          citationRate: unavailable,
        },
      },
    },
    recordedAt: "2026-07-16T01:00:00Z",
  };
}

function appendInput() {
  return {
    asyncRunId: ids.asyncRun,
    window: fixture(),
    observationLineage: {
      gsc: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
      ga4: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
      geo: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
    },
  } as const;
}

function insufficientAppendInput() {
  const window = fixture();
  return {
    asyncRunId: ids.asyncRun,
    window: {
      ...window,
      state: "insufficient_data" as const,
      limitation:
        "Only a canonical GSC baseline observation exists.",
      dimensions: {
        ...window.dimensions,
        gsc: {
          ...window.dimensions.gsc,
          state: "insufficient_data" as const,
          baselineSource: unavailableSource(
            "gsc",
            ids.gscSource,
            ids.gscBefore,
            "before",
          ),
          outcomeSource: null,
          sampleSize: {
            baseline: 0,
            outcome: null,
            unit: "impressions" as const,
            coverage: "partial" as const,
          },
          limitation:
            "The baseline snapshot exists but has no comparable outcome.",
        },
      },
    },
    observationLineage: {
      gsc: {
        baselineObservationId: ids.gscBeforeObservation,
        outcomeObservationId: null,
      },
      ga4: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
      geo: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
    },
  } as const;
}

const requestHash = "d".repeat(64);
const idempotencyKey = "measurement-request-1";
const frozenRunFacts = {
  workspaceId: ids.workspace,
  projectId: ids.project,
  changeReceiptId: ids.change,
  publicationAttemptId: ids.attempt,
  siteId: ids.site,
  sitePageId: ids.sitePage,
  target: {
    kind: "url" as const,
    targetRef: `site-page://${ids.sitePage}`,
    sitePageId: ids.sitePage,
  },
  actionId: ids.action,
  artifactId: ids.artifact,
  artifactRevisionId: ids.revision,
  artifactRevision: 3,
  artifactContentHash,
  contentChecksum,
  timelineDeliveryReceiptId: null,
  url: "https://relayops.example/blog/customer-onboarding/?ref=launch",
  canonicalUrl:
    "https://relayops.example/blog/customer-onboarding/",
  beforeWindow: {
    startAt: "2026-05-23T12:00:00Z",
    endAt: "2026-06-20T12:00:00Z",
  },
  afterWindow: {
    startAt: "2026-06-20T12:00:00Z",
    endAt: "2026-07-18T12:00:00Z",
  },
  timezone: "UTC",
  interpretation: "observational_non_causal" as const,
  startAfter: "2026-07-22T12:00:00Z",
} as const;

const measurementRunRow = {
  id: ids.asyncRun,
  workspace_id: ids.workspace,
  project_id: ids.project,
  kind: "measurement",
  status: "queued",
  active_key: `measurement:${ids.change}`,
  contract_version: "2026-07-28",
  request_payload: {
    operation: "measurement_window",
    idempotencyKey,
    requestHash,
    frozenFacts: frozenRunFacts,
  },
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: "measurement_window",
  result_id: ids.measurement,
  attempt_count: 0,
  initiated_by: ids.actor,
  queued_at: "2026-07-28T00:00:00Z",
  started_at: null,
  completed_at: null,
} as const;

const completedMeasurementRunRow = {
  ...measurementRunRow,
  status: "completed",
  completed_at: "2026-07-28T01:00:00Z",
} as const;

const authorityRows = {
  project: {
    id: ids.project,
    workspace_id: ids.workspace,
    archived_at: null,
  },
  site: {
    id: ids.site,
    workspace_id: ids.workspace,
    project_id: ids.project,
  },
  change: {
    id: ids.change,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    publication_attempt_id: ids.attempt,
    receipt_kind: "change_receipt",
    predecessor_delivery_receipt_id:
      "91000000-0000-4000-8000-000000000027",
    provider_kind: "github",
    remote_scope_ref: "installation:42/repository:relayops",
    artifact_content_hash: artifactContentHash,
    content_checksum: contentChecksum,
    verification_state: "verified_live",
    live_canonical_url:
      "https://relayops.example/blog/customer-onboarding/",
    observed_at: "2026-06-20T12:00:00Z",
  },
  attempt: {
    id: ids.attempt,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    async_run_id: ids.asyncRun,
    action_id: ids.action,
    artifact_id: ids.artifact,
    artifact_revision_id: ids.revision,
    approved_artifact_revision: 3,
    approved_artifact_content_hash: artifactContentHash,
    content_checksum: contentChecksum,
  },
  publicationRun: {
    ...measurementRunRow,
    kind: "publication",
    status: "completed",
    result_type: "publication_attempt",
    result_id: ids.attempt,
  },
  sitePage: {
    id: ids.sitePage,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    normalized_url:
      "https://relayops.example/blog/customer-onboarding/",
  },
  delivery: {
    id: "91000000-0000-4000-8000-000000000027",
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    publication_attempt_id: ids.attempt,
    receipt_kind: "delivery_receipt",
    predecessor_delivery_receipt_id: null,
    provider_kind: "github",
    remote_scope_ref: "installation:42/repository:relayops",
    artifact_content_hash: artifactContentHash,
    content_checksum: contentChecksum,
    observed_at: "2026-06-20T10:00:00Z",
  },
} as const;

describe("measurementWindowResultHash", () => {
  it("binds the final projection, async run, and canonical observation lineage", () => {
    const input = appendInput();
    expect(measurementWindowResultHash(input)).toBe(
      measurementWindowResultHash(structuredClone(input)),
    );
    expect(
      measurementWindowResultHash({
        ...input,
        window: {
          ...input.window,
          limitation: `${input.window.limitation} No causal claim.`,
        },
      }),
    ).not.toBe(measurementWindowResultHash(input));
    const insufficient = insufficientAppendInput();
    expect(
      measurementWindowResultHash({
        ...insufficient,
        observationLineage: {
          ...insufficient.observationLineage,
          gsc: {
            ...insufficient.observationLineage.gsc,
            baselineObservationId:
              "91000000-0000-4000-8000-000000000088",
          },
        },
      }),
    ).not.toBe(measurementWindowResultHash(insufficient));
    expect(
      measurementWindowResultHash({
        ...input,
        asyncRunId: "91000000-0000-4000-8000-000000000089",
      }),
    ).not.toBe(measurementWindowResultHash(input));
  });

  it("uses canonical absolute instants instead of timestamp spelling", () => {
    const input = appendInput();
    expect(
      measurementWindowResultHash({
        ...input,
        window: {
          ...input.window,
          recordedAt: "2026-07-16T01:00:00.000Z",
        },
      }),
    ).toBe(measurementWindowResultHash(input));
  });
});

describe("MeasurementWindowsRepository", () => {
  it("loads every exact canonical provider observation overlapping the requested window without page truncation", async () => {
    const db = new FakeExecutor();
    const evidence = {
      snapshotId: ids.gscBefore,
      sourceConnectionId: ids.gscSource,
      provider: "gsc",
      datasetKey: "gsc.page_query_daily.v1",
      schemaVersion: "gsc-page.v1",
      methodVersion: "gsc-api.v1",
      capturedAt: "2026-07-16T00:00:00.000Z",
      sourceWindow: { start: "2026-05-20", end: "2026-07-15" },
      coveredWindow: {
        startAt: "2026-05-20T00:00:00.000Z",
        endAt: "2026-07-16T00:00:00.000Z",
      },
      snapshotAvailability: "available",
      snapshotLimitation: "Canonical 56-day Search Analytics extract.",
      observationId: ids.gscBeforeObservation,
      sitePageId: ids.sitePage,
      metricKey: "gsc.page.v1",
      subjectType: "url",
      subjectRef:
        "https://relayops.example/blog/customer-onboarding/",
      observedAt: "2026-07-16T00:00:00.000Z",
      observationAvailability: "available",
      valueJson: {
        previous28d: { clicks: 10, impressions: 100 },
        current28d: { clicks: 20, impressions: 150 },
      },
      unit: "page_metrics",
      origin: "gsc_api",
      method: "observed",
      grade: "canonical",
      support: "primary",
      observationLimitation: "No causal attribution.",
    } as const;
    const legacyTimestampEvidence = {
      ...evidence,
      snapshotId: ids.gscAfter,
      observationId: ids.gscAfterObservation,
      sourceWindow: {
        start: "2026-06-01T12:00:00Z",
        end: "2026-07-01T12:00:00Z",
      },
      coveredWindow: {
        startAt: "2026-06-01T12:00:00.000Z",
        endAt: "2026-07-01T12:00:00.000Z",
      },
    } as const;
    db.enqueue([evidence, legacyTimestampEvidence]);

    await expect(
      new MeasurementWindowsRepository(
        db as never,
      ).listRelevantProviderEvidence(
        { workspaceId: ids.workspace, projectId: ids.project },
        {
          siteId: ids.site,
          sitePageId: ids.sitePage,
          provider: "gsc",
          window: {
            startAt: "2026-06-01T00:00:00Z",
            endAt: "2026-07-15T00:00:00Z",
          },
        },
      ),
    ).resolves.toEqual([evidence, legacyTimestampEvidence]);

    const compiled = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        ids.workspace,
        ids.project,
        ids.site,
        ids.sitePage,
        "gsc",
        "gsc.page_query_daily.v1",
        "gsc.page.v1",
        "url",
        "2026-06-01T00:00:00.000Z",
        "2026-07-15T00:00:00.000Z",
      ]),
    );
    expect(
      db.calls.filter((call) => call.method === "limit"),
    ).toEqual([]);
  });

  it("locks and returns only an exact active-project Change Receipt authority chain", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [authorityRows.project],
      [authorityRows.change],
      [authorityRows.attempt],
      [authorityRows.publicationRun],
      [authorityRows.site],
      [authorityRows.sitePage],
      [authorityRows.delivery],
    );

    await expect(
      new MeasurementWindowsRepository(
        db as never,
      ).findChangeReceiptForMeasurement(
        { workspaceId: ids.workspace, projectId: ids.project },
        ids.change,
        { lock: true },
      ),
    ).resolves.toEqual({
      receipt: authorityRows.change,
      attempt: authorityRows.attempt,
      run: authorityRows.publicationRun,
      site: authorityRows.site,
      sitePage: authorityRows.sitePage,
      deliveryReceipt: authorityRows.delivery,
    });

    expect(
      db.calls.filter((call) => call.method === "for"),
    ).toHaveLength(7);
  });

  it("rejects a cross-project final result before touching persistence", async () => {
    const db = new FakeExecutor();
    const repo = new MeasurementWindowsRepository(db as never);

    await expect(
      repo.appendFinal(
        {
          workspaceId: ids.workspace,
          projectId: "91000000-0000-4000-8000-000000000099",
        },
        {
          asyncRunId: ids.asyncRun,
          window: fixture(),
          observationLineage: {
            gsc: {
              baselineObservationId: ids.gscBeforeObservation,
              outcomeObservationId: ids.gscAfterObservation,
            },
            ga4: {
              baselineObservationId: ids.ga4BeforeObservation,
              outcomeObservationId: ids.ga4AfterObservation,
            },
            geo: {
              baselineObservationId: null,
              outcomeObservationId: null,
            },
          },
        },
      ),
    ).rejects.toThrow(/project scope/i);
    expect(db.calls).toEqual([]);
  });

  it("rejects non-UUID canonical observation lineage before persistence", async () => {
    const db = new FakeExecutor();
    const repo = new MeasurementWindowsRepository(db as never);

    await expect(
      repo.appendFinal(
        { workspaceId: ids.workspace, projectId: ids.project },
        {
          asyncRunId: ids.asyncRun,
          window: fixture(),
          observationLineage: {
            gsc: {
              baselineObservationId: "not-a-uuid",
              outcomeObservationId: ids.gscAfterObservation,
            },
            ga4: {
              baselineObservationId: ids.ga4BeforeObservation,
              outcomeObservationId: ids.ga4AfterObservation,
            },
            geo: {
              baselineObservationId: null,
              outcomeObservationId: null,
            },
          },
        },
      ),
    ).rejects.toThrow(/observation lineage/i);
    expect(db.calls).toEqual([]);
  });

  it("filters a by-id read in SQL by workspace and project", async () => {
    const db = new FakeExecutor();
    db.enqueue([]);
    const repo = new MeasurementWindowsRepository(db as never);

    await expect(
      repo.findById(
        { workspaceId: ids.workspace, projectId: ids.project },
        ids.measurement,
      ),
    ).resolves.toBeNull();

    const compiled = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        ids.workspace,
        ids.project,
        ids.measurement,
      ]),
    );
  });

  it("appends unavailable dimensions in the caller transaction without fabricated lineage", async () => {
    const db = new FakeExecutor();
    db.enqueue([]);
    const input = appendInput();

    const result = await new MeasurementWindowsRepository(
      db as never,
    ).appendFinalInTx(
      { workspaceId: ids.workspace, projectId: ids.project },
      input,
    );
    expect(result).toMatchObject({
      window: {
        measurementWindowId: input.window.measurementWindowId,
        recordedAt: "2026-07-16T01:00:00.000Z",
      },
      replayed: false,
    });

    expect(
      db.calls.filter((call) => call.method === "transaction"),
    ).toEqual([]);
    const writes = db.calls
      .filter((call) => call.method === "values")
      .map((call) => call.args[0] as Record<string, unknown>);
    expect(writes).toHaveLength(4);
    for (const dimension of writes.slice(1)) {
      expect(dimension).toMatchObject({
        baseline_source_ref: null,
        baseline_snapshot_id: null,
        baseline_covered_window: null,
        baseline_observed_at: null,
        baseline_freshness: null,
        outcome_source_ref: null,
        outcome_snapshot_id: null,
        outcome_covered_window: null,
        outcome_observed_at: null,
        outcome_freshness: null,
      });
    }
    expect(writes[1]).toMatchObject({
      baseline_observation_id: null,
      outcome_observation_id: null,
    });
    expect(writes[2]).toMatchObject({
      baseline_observation_id: null,
      outcome_observation_id: null,
      direct_conversion_definition_id: null,
      assisted_conversion_definition_id: null,
    });
  });

  it("rejects replay under a different async run even for the same public window", async () => {
    const db = new FakeExecutor();
    const original = appendInput();
    db.enqueue([
      {
        result_hash: measurementWindowResultHash(original),
        async_run_id: original.asyncRunId,
      },
    ]);
    const repo = new MeasurementWindowsRepository(db as never);

    await expect(
      repo.appendFinal(
        { workspaceId: ids.workspace, projectId: ids.project },
        {
          ...original,
          asyncRunId: "91000000-0000-4000-8000-000000000089",
        },
      ),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_REPLAY_CONFLICT",
    });
  });

  it("rejects replay when canonical observation lineage changes", async () => {
    const db = new FakeExecutor();
    const original = insufficientAppendInput();
    db.enqueue([
      {
        result_hash: measurementWindowResultHash(original),
        async_run_id: original.asyncRunId,
      },
    ]);
    const repo = new MeasurementWindowsRepository(db as never);

    await expect(
      repo.appendFinal(
        { workspaceId: ids.workspace, projectId: ids.project },
        {
          ...original,
          observationLineage: {
            ...original.observationLineage,
            gsc: {
              ...original.observationLineage.gsc,
              baselineObservationId:
                "91000000-0000-4000-8000-000000000088",
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_REPLAY_CONFLICT",
    });
  });

  it("lists recent full windows across targets in stable project order", async () => {
    const db = new FakeExecutor();
    const newerId = "91000000-0000-4000-8000-000000000029";
    const olderId = "91000000-0000-4000-8000-000000000010";
    const otherSitePageId =
      "91000000-0000-4000-8000-000000000030";
    db.enqueue([{ id: newerId }, { id: olderId }]);
    const repo = new MeasurementWindowsRepository(db as never);
    const newer = { ...fixture(), measurementWindowId: newerId };
    const older = {
      ...fixture(),
      measurementWindowId: olderId,
      target: {
        kind: "url" as const,
        targetRef: `site-page://${otherSitePageId}`,
        sitePageId: otherSitePageId,
      },
      recordedAt: "2026-07-16T00:30:00Z",
    };
    let activeHydrations = 0;
    let maxActiveHydrations = 0;
    const byId = vi
      .spyOn(repo, "findById")
      .mockImplementation(async (_scope, id) => {
        activeHydrations += 1;
        maxActiveHydrations = Math.max(
          maxActiveHydrations,
          activeHydrations,
        );
        await Promise.resolve();
        activeHydrations -= 1;
        return id === newerId ? newer : older;
      });

    await expect(
      repo.listRecent(
        { workspaceId: ids.workspace, projectId: ids.project },
        { limit: 25 },
      ),
    ).resolves.toEqual([newer, older]);

    const compiledWhere = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(compiledWhere.params).toEqual([
      ids.workspace,
      ids.project,
    ]);
    expect(compiledWhere.params).not.toContain(otherSitePageId);
    const order = db.last("orderBy").args.map((expression) =>
      new PgDialect().sqlToQuery(expression as never).sql,
    );
    expect(order).toEqual([
      expect.stringMatching(/recorded_at.*desc/i),
      expect.stringMatching(/id.*desc/i),
    ]);
    expect(db.last("limit").args).toEqual([25]);
    expect(byId.mock.calls.map((call) => call[1])).toEqual([
      newerId,
      olderId,
    ]);
    expect(maxActiveHydrations).toBe(1);
  });

  it.each([0, 101, 1.5])(
    "rejects invalid recent-list limit %s before querying",
    async (limit) => {
      const db = new FakeExecutor();
      const repo = new MeasurementWindowsRepository(db as never);

      await expect(
        repo.listRecent(
          { workspaceId: ids.workspace, projectId: ids.project },
          { limit },
        ),
      ).rejects.toBeInstanceOf(RangeError);
      expect(db.calls).toEqual([]);
    },
  );

  it("fails closed when a recent-window identity cannot be hydrated", async () => {
    const db = new FakeExecutor();
    db.enqueue([{ id: ids.measurement }]);
    const repo = new MeasurementWindowsRepository(db as never);
    vi.spyOn(repo, "findById").mockResolvedValue(null);

    await expect(
      repo.listRecent(
        { workspaceId: ids.workspace, projectId: ids.project },
        { limit: 25 },
      ),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_INTEGRITY_INVALID",
    });
  });
});

describe("Measurement Window run transaction", () => {
  function dependencies(
    now = "2026-06-20T12:00:00.000Z",
  ) {
    const idsToCreate = [ids.measurement, ids.asyncRun];
    return {
      enqueue: vi.fn(async () => ids.asyncRun),
      clock: {
        now: () => new Date(now),
      },
      newId: () => idsToCreate.shift()!,
    };
  }

  function command(
    resolveCurrentFacts: CreateMeasurementRunTransaction["resolveCurrentFacts"] =
      vi.fn(async () => frozenRunFacts),
  ): CreateMeasurementRunTransaction {
    return {
      workspaceId: ids.workspace,
      projectId: ids.project,
      changeReceiptId: ids.change,
      idempotencyKey,
      requestHash,
      requestedBy: ids.actor,
      contractVersion: "2026-07-28",
      resolveCurrentFacts,
    };
  }

  it("creates the canonical run and delayed measurement job in one read-committed transaction", async () => {
    const db = new FakeExecutor();
    db.enqueue([], [], [], [], [measurementRunRow], []);
    const deps = dependencies();
    const resolveCurrentFacts = vi.fn(async () => frozenRunFacts);

    await expect(
      new MeasurementWindowsRepository(
        db as never,
        deps,
      ).createRunAtomically(command(resolveCurrentFacts)),
    ).resolves.toEqual({
      run: measurementRunRow,
      measurementWindowId: ids.measurement,
      replayed: false,
    });

    expect(resolveCurrentFacts).toHaveBeenCalledTimes(1);
    expect(db.last("transaction").args[0]).toEqual({
      isolationLevel: "read committed",
    });
    expect(deps.enqueue).toHaveBeenCalledWith(
      db,
      {
        runId: ids.asyncRun,
        workspaceId: ids.workspace,
        projectId: ids.project,
        contractVersion: "2026-07-28",
      },
      { startAfter: new Date(frozenRunFacts.startAfter) },
    );
  });

  it("allows a historical verified Change Receipt to enqueue immediately with its original fixed settlement timestamp", async () => {
    const db = new FakeExecutor();
    db.enqueue([], [], [], [], [measurementRunRow], []);
    const deps = dependencies("2026-08-01T00:00:00.000Z");

    await expect(
      new MeasurementWindowsRepository(
        db as never,
        deps,
      ).createRunAtomically(command()),
    ).resolves.toMatchObject({
      measurementWindowId: ids.measurement,
      replayed: false,
    });
    expect(deps.enqueue).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ runId: ids.asyncRun }),
      { startAfter: new Date(frozenRunFacts.startAfter) },
    );
  });

  it.each([
    {
      label: "a 27-day baseline",
      facts: {
        ...frozenRunFacts,
        beforeWindow: {
          startAt: "2026-05-24T12:00:00Z",
          endAt: frozenRunFacts.beforeWindow.endAt,
        },
      },
    },
    {
      label: "a gap between baseline and outcome",
      facts: {
        ...frozenRunFacts,
        afterWindow: {
          startAt: "2026-06-21T12:00:00Z",
          endAt: "2026-07-19T12:00:00Z",
        },
        startAfter: "2026-07-23T12:00:00Z",
      },
    },
    {
      label: "a five-day provider settlement delay",
      facts: {
        ...frozenRunFacts,
        startAfter: "2026-07-23T12:00:00Z",
      },
    },
  ])("rejects frozen authority with $label", async ({ facts }) => {
    const db = new FakeExecutor();
    db.enqueue([], []);
    const deps = dependencies();

    await expect(
      new MeasurementWindowsRepository(
        db as never,
        deps,
      ).createRunAtomically(
        command(vi.fn(async () => facts)),
      ),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_RUN_AUTHORITY_INVALID",
    });
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("permanently replays the exact original result before current-fact resolution", async () => {
    const db = new FakeExecutor();
    db.enqueue([measurementRunRow]);
    const deps = dependencies();
    const resolveCurrentFacts = vi.fn(async () => {
      throw new Error("must not re-resolve a permanent replay");
    });

    await expect(
      new MeasurementWindowsRepository(
        db as never,
        deps,
      ).createRunAtomically(command(resolveCurrentFacts)),
    ).resolves.toEqual({
      run: measurementRunRow,
      measurementWindowId: ids.measurement,
      replayed: true,
    });

    expect(resolveCurrentFacts).not.toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(
      db.calls.filter((call) => call.method === "transaction"),
    ).toEqual([]);
  });

  it("rejects a new key for an already completed Change Receipt without creating a dead queued run", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [],
      [
        {
          run: completedMeasurementRunRow,
          measurementWindowId: ids.measurement,
        },
      ],
    );
    const deps = dependencies();

    await expect(
      new MeasurementWindowsRepository(
        db as never,
        deps,
      ).createRunAtomically({
        ...command(),
        idempotencyKey: "another-measurement-request",
      }),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_RUN_ALREADY_COMPLETED",
      existingRunId: ids.asyncRun,
      measurementWindowId: ids.measurement,
    });

    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(
      db.calls.filter((call) => call.method === "transaction"),
    ).toEqual([]);
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("rechecks completed Change Receipt authority under the creation transaction", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [],
      [],
      [],
      [
        {
          run: completedMeasurementRunRow,
          measurementWindowId: ids.measurement,
        },
      ],
    );
    const deps = dependencies();
    const resolveCurrentFacts = vi.fn(async () => frozenRunFacts);

    await expect(
      new MeasurementWindowsRepository(
        db as never,
        deps,
      ).createRunAtomically({
        ...command(resolveCurrentFacts),
        idempotencyKey: "racing-measurement-request",
      }),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_RUN_ALREADY_COMPLETED",
      existingRunId: ids.asyncRun,
      measurementWindowId: ids.measurement,
    });

    expect(resolveCurrentFacts).not.toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(
      db.calls.filter((call) => call.method === "transaction"),
    ).toHaveLength(1);
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("rolls back a new-key run when an older active-key owner completes while its insert waits", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      [],
      [],
      [],
      [],
      [measurementRunRow],
      [
        {
          run: completedMeasurementRunRow,
          measurementWindowId: ids.measurement,
        },
      ],
    );
    const deps = dependencies();
    const resolveCurrentFacts = vi.fn(async () => frozenRunFacts);

    await expect(
      new MeasurementWindowsRepository(
        db as never,
        deps,
      ).createRunAtomically({
        ...command(resolveCurrentFacts),
        idempotencyKey: "racing-after-active-key-wait",
      }),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_RUN_ALREADY_COMPLETED",
      existingRunId: ids.asyncRun,
      measurementWindowId: ids.measurement,
    });

    expect(resolveCurrentFacts).toHaveBeenCalledTimes(1);
    expect(db.calls.some((call) => call.method === "insert")).toBe(true);
    expect(
      db.calls.filter((call) => call.method === "select"),
    ).toHaveLength(5);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("rejects permanent key reuse with a different request hash", async () => {
    const db = new FakeExecutor();
    db.enqueue([measurementRunRow]);
    const deps = dependencies();

    await expect(
      new MeasurementWindowsRepository(
        db as never,
        deps,
      ).createRunAtomically({
        ...command(),
        requestHash: "e".repeat(64),
      }),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_IDEMPOTENCY_CONFLICT",
    });
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("fails closed when locked authority facts cross the command scope", async () => {
    const db = new FakeExecutor();
    db.enqueue([], []);
    const deps = dependencies();
    const resolveCurrentFacts = vi.fn(async () => ({
      ...frozenRunFacts,
      projectId: "91000000-0000-4000-8000-000000000099",
    }));

    await expect(
      new MeasurementWindowsRepository(
        db as never,
        deps,
      ).createRunAtomically(command(resolveCurrentFacts)),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_RUN_AUTHORITY_INVALID",
    });
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("requires an enqueue dependency instead of committing an orphan run", async () => {
    const db = new FakeExecutor();

    await expect(
      new MeasurementWindowsRepository(db as never).createRunAtomically(
        command(),
      ),
    ).rejects.toMatchObject({
      code: "MEASUREMENT_ENQUEUE_REQUIRED",
    });
    expect(db.calls).toEqual([]);
  });
});
