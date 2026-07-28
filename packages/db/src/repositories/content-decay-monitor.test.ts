import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  ContentDecayMonitorIntegrityError,
  ContentDecayMonitorRepository,
  MAX_CONTENT_DECAY_CHECKPOINTS,
  MAX_CONTENT_DECAY_PAGE_LOOKUP,
} from "./content-decay-monitor.ts";

function fakeExecutor() {
  const calls: unknown[] = [];
  const results: unknown[][] = [];
  const executor = {
    execute(statement: unknown) {
      calls.push(statement);
      return Promise.resolve({ rows: results.shift() ?? [] });
    },
  };
  return {
    executor: executor as never,
    enqueue(...rows: readonly unknown[][]) {
      results.push(...rows);
    },
    query(index = calls.length - 1) {
      const call = calls[index];
      if (!call) throw new Error("No SQL call was recorded");
      return new PgDialect().sqlToQuery(call as never);
    },
  };
}

const ids = {
  workspace: "91000000-0000-4000-8000-000000000001",
  project: "91000000-0000-4000-8000-000000000002",
  site: "91000000-0000-4000-8000-000000000003",
  snapshot: "91000000-0000-4000-8000-000000000004",
  connection: "91000000-0000-4000-8000-000000000005",
  page: "91000000-0000-4000-8000-000000000006",
  observation: "91000000-0000-4000-8000-000000000007",
} as const;
const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};

describe("ContentDecayMonitorRepository", () => {
  it("selects bounded monthly GSC snapshot authorities before availability evaluation with stable window/end/time/UUID order", async () => {
    const db = fakeExecutor();
    db.enqueue([
      {
        snapshot_id: ids.snapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
        source_connection_id: ids.connection,
        provider: "gsc",
        dataset_key: "gsc.page_query_daily.v1",
        method_version: "gsc.page_query_daily.v1",
        availability: "available",
        captured_at: new Date("2026-06-29T08:00:00.000Z"),
        source_window: { start: "2026-05-02", end: "2026-06-26" },
        provider_timezone: "Europe/London",
      },
    ]);
    const repository = new ContentDecayMonitorRepository(db.executor);

    await expect(
      repository.listMonthlyCheckpoints(scope, {
        siteId: ids.site,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-06-30T00:00:00.000Z",
      }),
    ).resolves.toEqual([
      {
        snapshotId: ids.snapshot,
        workspaceId: ids.workspace,
        projectId: ids.project,
        siteId: ids.site,
        sourceConnectionId: ids.connection,
        provider: "gsc",
        datasetKey: "gsc.page_query_daily.v1",
        methodVersion: "gsc.page_query_daily.v1",
        availability: "available",
        capturedAt: "2026-06-29T08:00:00.000Z",
        sourceWindow: { start: "2026-05-02", end: "2026-06-26" },
        providerTimeZone: "Europe/London",
      },
    ]);

    const query = db.query();
    expect(query.sql).toContain('from "app"."data_snapshots"');
    expect(query.sql).toContain('left join "app"."source_connections"');
    expect(query.sql).toContain("row_number() over");
    expect(query.sql).toMatch(
      /partition by substring\(\s*"app"\."data_snapshots"\."source_window" ->> 'end'/u,
    );
    expect(query.sql).toContain(
      "\"app\".\"data_snapshots\".\"source_window\" ->> 'end' desc",
    );
    expect(query.sql).toContain(
      '"app"."data_snapshots"."captured_at" desc',
    );
    expect(query.sql).toContain('"app"."data_snapshots"."id" asc');
    expect(query.sql).toMatch(/"provider"\s*=\s*'gsc'/u);
    expect(query.sql).toMatch(
      /"dataset_key"\s*=\s*'gsc\.page_query_daily\.v1'/u,
    );
    expect(query.sql).not.toMatch(
      /"data_snapshots"\."availability"\s*=\s*'available'/u,
    );
    expect(query.sql).toMatch(/authority_rank\s*=\s*1/u);
    expect(query.params).toContain(scope.workspaceId);
    expect(query.params).toContain(scope.projectId);
    expect(query.params).toContain(ids.site);
    expect(query.params.at(-1)).toBe(MAX_CONTENT_DECAY_CHECKPOINTS + 1);
  });

  it("reads exact page-linked observations without filtering partial or duplicate facts into zero", async () => {
    const db = fakeExecutor();
    db.enqueue([
      {
        observation_id: ids.observation,
        snapshot_id: ids.snapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_page_id: ids.page,
        normalized_url: "https://example.com/blog/retention",
        subject_ref: "https://example.com/blog/retention",
        provider: "gsc",
        metric_key: "gsc.page.v1",
        availability: "partial",
        observed_at: new Date("2026-06-29T08:00:00.000Z"),
        value_json: {
          current28d: {
            clicks: null,
            impressions: null,
            position: null,
          },
        },
      },
    ]);
    const repository = new ContentDecayMonitorRepository(db.executor);

    await expect(
      repository.listPageObservations(
        scope,
        [ids.snapshot],
        [ids.page, ids.page],
      ),
    ).resolves.toEqual([
      {
        observationId: ids.observation,
        snapshotId: ids.snapshot,
        workspaceId: ids.workspace,
        projectId: ids.project,
        sitePageId: ids.page,
        normalizedUrl: "https://example.com/blog/retention",
        subjectRef: "https://example.com/blog/retention",
        provider: "gsc",
        metricKey: "gsc.page.v1",
        availability: "partial",
        observedAt: "2026-06-29T08:00:00.000Z",
        current28d: {
          clicks: null,
          impressions: null,
          position: null,
        },
      },
    ]);

    const query = db.query();
    expect(query.sql).toContain('from "app"."normalized_observations"');
    expect(query.sql).toContain('inner join "app"."data_snapshots"');
    expect(query.sql).toContain('inner join "app"."site_pages"');
    expect(query.sql).toContain("\"provider\" = 'gsc'");
    expect(query.sql).toContain("\"metric_key\" = 'gsc.page.v1'");
    expect(query.sql).toContain("\"subject_type\" = 'url'");
    expect(query.sql).not.toContain(
      "\"normalized_observations\".\"availability\" = 'available'",
    );
    expect(query.params.filter((value) => value === ids.page)).toHaveLength(
      1,
    );
    expect(query.params).toContain(scope.workspaceId);
    expect(query.params).toContain(scope.projectId);
  });

  it("rejects malformed windows and invalid chronology instead of reinterpreting them", async () => {
    const db = fakeExecutor();
    db.enqueue([
      {
        snapshot_id: ids.snapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
        source_connection_id: null,
        provider: "gsc",
        dataset_key: "gsc.page_query_daily.v1",
        method_version: "gsc.page_query_daily.v1",
        availability: "available",
        captured_at: "not-an-instant",
        source_window: { start: "2026-05-02" },
        provider_timezone: null,
      },
    ]);

    await expect(
      new ContentDecayMonitorRepository(
        db.executor,
      ).listMonthlyCheckpoints(scope, {
        siteId: ids.site,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-06-30T00:00:00.000Z",
      }),
    ).rejects.toEqual(
      new ContentDecayMonitorIntegrityError(
        "CHECKPOINT_LINEAGE_INVALID",
      ),
    );
  });

  it("rejects a checkpoint row whose site lineage escapes the requested site", async () => {
    const db = fakeExecutor();
    db.enqueue([
      {
        snapshot_id: ids.snapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: "91000000-0000-4000-8000-000000000099",
        source_connection_id: null,
        provider: "gsc",
        dataset_key: "gsc.page_query_daily.v1",
        method_version: "gsc.page_query_daily.v1",
        availability: "available",
        captured_at: "2026-06-29T08:00:00.000Z",
        source_window: { start: "2026-05-02", end: "2026-06-26" },
        provider_timezone: null,
      },
    ]);

    await expect(
      new ContentDecayMonitorRepository(
        db.executor,
      ).listMonthlyCheckpoints(scope, {
        siteId: ids.site,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-06-30T00:00:00.000Z",
      }),
    ).rejects.toEqual(
      new ContentDecayMonitorIntegrityError(
        "CHECKPOINT_LINEAGE_INVALID",
      ),
    );
  });

  it("enforces bounded checkpoint and page lookups", async () => {
    const db = fakeExecutor();
    db.enqueue(
      Array.from(
        { length: MAX_CONTENT_DECAY_CHECKPOINTS + 1 },
        (_, index) => ({ snapshot_id: `snapshot-${index}` }),
      ),
    );
    const repository = new ContentDecayMonitorRepository(db.executor);

    await expect(
      repository.listMonthlyCheckpoints(scope, {
        siteId: ids.site,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-06-30T00:00:00.000Z",
      }),
    ).rejects.toEqual(
      new ContentDecayMonitorIntegrityError(
        "CHECKPOINT_LIMIT_EXCEEDED",
      ),
    );

    await expect(
      repository.listPageObservations(
        scope,
        [ids.snapshot],
        Array.from(
          { length: MAX_CONTENT_DECAY_PAGE_LOOKUP + 1 },
          (_, index) =>
            `91000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        ),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
