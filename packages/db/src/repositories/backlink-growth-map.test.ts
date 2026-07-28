import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  BacklinkAuthorityIntegrityError,
  BacklinkGrowthMapRepository,
  MAX_BACKLINK_AUTHORITY_SNAPSHOTS,
} from "./backlink-growth-map.ts";

function fakeExecutor() {
  const calls: unknown[] = [];
  const results: unknown[][] = [];
  return {
    executor: {
      execute(statement: unknown) {
        calls.push(statement);
        return Promise.resolve({ rows: results.shift() ?? [] });
      },
    } as never,
    enqueue(rows: unknown[]) {
      results.push(rows);
    },
    query() {
      const statement = calls.at(-1);
      if (!statement) throw new Error("No SQL recorded");
      return new PgDialect().sqlToQuery(statement as never);
    },
  };
}

const ids = {
  workspace: "a1000000-0000-4000-8000-000000000001",
  project: "a1000000-0000-4000-8000-000000000002",
  site: "a1000000-0000-4000-8000-000000000003",
  competitor: "a1000000-0000-4000-8000-000000000004",
  snapshot: "a1000000-0000-4000-8000-000000000005",
  page: "a1000000-0000-4000-8000-000000000006",
  fact: "a1000000-0000-4000-8000-000000000007",
} as const;
const scope = { workspaceId: ids.workspace, projectId: ids.project };

function authorityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.snapshot,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    competitor_id: null,
    subject_kind: "primary_site",
    subject_name: "RelayOps",
    domain: "relayops.example",
    source_kind: "provider_import",
    provider: "ahrefs",
    captured_at: new Date("2026-07-28T00:00:00.000Z"),
    availability: "available",
    index_scope: "provider_index",
    total_backlinks: "120",
    total_referring_domains: "40",
    observed_backlinks: "120",
    observed_referring_domains: "40",
    authority_metric_kind: "domain_rating",
    authority_metric_value: "42",
    source_ref: "ahrefs:relayops:2026-07",
    checksum: "a".repeat(64),
    row_count: 120,
    import_preview_id: null,
    limitation: null,
    ...overrides,
  };
}

describe("BacklinkGrowthMapRepository", () => {
  it("selects the latest authority for every source/provider of the primary site and approved competitors", async () => {
    const db = fakeExecutor();
    db.enqueue([authorityRow()]);

    await expect(
      new BacklinkGrowthMapRepository(
        db.executor,
      ).listLatestAuthoritySnapshots(scope),
    ).resolves.toEqual([
      {
        ...authorityRow(),
        captured_at: "2026-07-28T00:00:00.000Z",
        total_backlinks: 120,
        total_referring_domains: 40,
        observed_backlinks: 120,
        observed_referring_domains: 40,
        authority_metric_value: 42,
      },
    ]);

    const query = db.query();
    expect(query.sql).toContain("row_number() over");
    expect(query.sql).toContain("snapshot.captured_at desc");
    expect(query.sql).toContain("snapshot.id asc");
    expect(query.sql).toContain("snapshot.source_kind");
    expect(query.sql).toContain("snapshot.provider");
    expect(query.sql).toContain("competitor.review_status = 'approved'");
    expect(query.sql).toContain("then project.project_name");
    expect(query.sql).toContain("authority_rank = 1");
    expect(query.params).toContain(scope.workspaceId);
    expect(query.params).toContain(scope.projectId);
  });

  it("does not fall back behind a latest unavailable snapshot or turn it into zero", async () => {
    const db = fakeExecutor();
    db.enqueue([
      authorityRow({
        availability: "unavailable",
        index_scope: "unavailable",
        total_backlinks: null,
        total_referring_domains: null,
        observed_backlinks: null,
        observed_referring_domains: null,
        authority_metric_kind: null,
        authority_metric_value: null,
        limitation: "Provider snapshot unavailable.",
      }),
    ]);

    const rows = await new BacklinkGrowthMapRepository(
      db.executor,
    ).listLatestAuthoritySnapshots(scope);
    expect(rows[0]?.total_backlinks).toBeNull();
    expect(db.query().sql).not.toMatch(/availability\s*=\s*'available'/u);
  });

  it("reads page counts only when explicitly persisted by the exact snapshot", async () => {
    const db = fakeExecutor();
    db.enqueue([
      {
        snapshot_id: ids.snapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_page_id: ids.page,
        normalized_url: "https://relayops.example/customer-onboarding/",
        title: "Customer onboarding",
        backlink_count: "0",
        referring_domain_count: "0",
        metric_semantics: "provider_index_total",
      },
    ]);

    const rows = await new BacklinkGrowthMapRepository(
      db.executor,
    ).listPageMetrics(scope, ids.snapshot);
    expect(rows[0]).toMatchObject({
      backlink_count: 0,
      referring_domain_count: 0,
      metric_semantics: "provider_index_total",
    });
    const query = db.query();
    expect(query.sql).toContain("metric.snapshot_id =");
    expect(query.sql).toContain("snapshot.subject_kind = 'primary_site'");
    expect(query.params).toContain(ids.snapshot);
  });

  it("reads fact provenance without authority scores on non-provider rows", async () => {
    const db = fakeExecutor();
    db.enqueue([
      {
        id: ids.fact,
        snapshot_id: ids.snapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        referring_domain: "example.org",
        source_url: "https://example.org/review",
        target_url: "https://relayops.example/",
        target_site_page_id: ids.page,
        source_authority_metric_kind: null,
        source_authority_metric_value: null,
      },
    ]);

    const rows = await new BacklinkGrowthMapRepository(
      db.executor,
    ).listFacts(scope, [ids.snapshot, ids.snapshot]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source_authority_metric_value).toBeNull();
    const query = db.query();
    expect(query.sql).toContain("competitor.review_status = 'approved'");
    expect(query.params).toContain(ids.snapshot);
  });

  it("fails closed instead of truncating authority entities", async () => {
    const db = fakeExecutor();
    db.enqueue(
      Array.from(
        { length: MAX_BACKLINK_AUTHORITY_SNAPSHOTS + 1 },
        (_, index) =>
          authorityRow({
            id: `a2000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          }),
      ),
    );

    await expect(
      new BacklinkGrowthMapRepository(
        db.executor,
      ).listLatestAuthoritySnapshots(scope),
    ).rejects.toEqual(
      new BacklinkAuthorityIntegrityError("AUTHORITY_LIMIT_EXCEEDED"),
    );
  });
});
