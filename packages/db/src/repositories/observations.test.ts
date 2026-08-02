import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  ObservationsRepository,
  type ObservationInsert,
} from "./observations.ts";

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: Call[];
  last(method: string): Call;
} {
  const calls: Call[] = [];
  const query: object = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (resolve: (value: unknown) => unknown) =>
            Promise.resolve([]).then(resolve);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  const executor = new Proxy(
    {},
    {
      get(_target, property) {
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  return {
    executor: executor as never,
    calls,
    last(method: string): Call {
      const found = calls.findLast((call) => call.method === method);
      if (!found) throw new Error(`No ${method} call`);
      return found;
    },
  };
}

function observation(
  overrides: Partial<ObservationInsert> = {},
): ObservationInsert {
  return {
    metricKey: "gsc.page.v1",
    subjectType: "url",
    subjectRef: "https://example.test/pricing",
    observedAt: "2026-07-22T06:07:08.901Z",
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: { current28d: { clicks: 12 } },
    unit: null,
    origin: "first_party",
    grade: "A",
    support: "supports",
    limitation: "Exact provider observation fixture.",
    ...overrides,
  };
}

describe("ObservationsRepository SitePage lineage", () => {
  it("persists the explicitly resolved SitePage id on the same append-only observation", async () => {
    const fake = fakeExecutor();
    const sitePageId = "00000000-0000-4000-8000-000000000004";

    await expect(
      new ObservationsRepository(fake.executor).insertMany(
        {
          workspaceId: "00000000-0000-4000-8000-000000000001",
          projectId: "00000000-0000-4000-8000-000000000002",
        },
        "00000000-0000-4000-8000-000000000003",
        "gsc",
        [observation({ sitePageId })],
      ),
    ).resolves.toBe(1);

    expect(fake.last("values").args[0]).toEqual([
      expect.objectContaining({
        site_page_id: sitePageId,
        subject_type: "url",
        subject_ref: "https://example.test/pricing",
      }),
    ]);
  });

  it("writes a truthful null when no unambiguous SitePage lineage was resolved", async () => {
    const fake = fakeExecutor();

    await new ObservationsRepository(fake.executor).insertMany(
      {
        workspaceId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
      },
      "00000000-0000-4000-8000-000000000003",
      "gsc",
      [observation({ sitePageId: null })],
    );

    expect(fake.last("values").args[0]).toEqual([
      expect.objectContaining({ site_page_id: null }),
    ]);
  });
});

describe("ObservationsRepository source metric summaries", () => {
  const scope = {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
  };
  const snapshotId = "00000000-0000-4000-8000-000000000003";

  function summaryRepository(rows: readonly Record<string, unknown>[]) {
    const statements: unknown[] = [];
    const executor = {
      execute(statement: unknown) {
        statements.push(statement);
        return Promise.resolve({ rows });
      },
    };
    return {
      repository: new ObservationsRepository(executor as never),
      statements,
    };
  }

  it("aggregates GSC clicks and impressions only inside the exact project snapshot", async () => {
    const { repository, statements } = summaryRepository([
      { landing_page_count: 63, clicks: "4", impressions: "4634" },
    ]);

    await expect(repository.summarizeGscSnapshot(scope, snapshotId)).resolves.toEqual({
      landingPageCount: 63,
      clicks: "4",
      impressions: "4634",
    });

    const query = new PgDialect().sqlToQuery(statements[0] as never);
    expect(query.sql).toContain("observation.workspace_id = $1::uuid");
    expect(query.sql).toContain("observation.project_id = $2::uuid");
    expect(query.sql).toContain("observation.snapshot_id = $3::uuid");
    expect(query.sql).toContain("observation.metric_key = 'gsc.page.v1'");
    expect(query.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      snapshotId,
    ]);
  });

  it("keeps unavailable GA4 key events null while preserving measured sessions", async () => {
    const { repository } = summaryRepository([
      { landing_page_count: 7, sessions: "91", key_events: null },
    ]);

    await expect(repository.summarizeGa4Snapshot(scope, snapshotId)).resolves.toEqual({
      landingPageCount: 7,
      sessions: "91",
      keyEvents: null,
    });
  });

  it("returns null when the snapshot has no valid normalized observations", async () => {
    const { repository } = summaryRepository([
      { landing_page_count: 0, clicks: null, impressions: null },
    ]);

    await expect(repository.summarizeGscSnapshot(scope, snapshotId)).resolves.toBeNull();
  });
});
