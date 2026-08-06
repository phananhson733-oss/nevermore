import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  GrowthMapReadRepository,
  MAX_GROWTH_MAP_ENTITY_LOOKUP,
  MAX_GROWTH_MAP_SEARCH_LENGTH,
  MAX_GROWTH_MAP_SNAPSHOT_LOOKUP,
  MAX_GROWTH_MAP_URL_PAGE_SIZE,
} from "./growth-map.ts";

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: Call[];
  enqueue(...rows: readonly unknown[][]): void;
  lastSql(): { readonly sql: string; readonly params: unknown[] };
} {
  const calls: Call[] = [];
  const results: unknown[][] = [];
  const executor = {
    execute(statement: unknown) {
      calls.push({ method: "execute", args: [statement] });
      return Promise.resolve({ rows: results.shift() ?? [] });
    },
  };
  return {
    executor: executor as never,
    calls,
    enqueue: (...rows) => results.push(...rows),
    lastSql() {
      const call = calls.findLast(
        (candidate) => candidate.method === "execute",
      );
      if (!call) throw new Error("No execute call was recorded");
      return new PgDialect().sqlToQuery(call.args[0] as never);
    },
  };
}

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
};
const runId = "00000000-0000-4000-8000-000000000003";
const uuidV7RunId = "7a000000-0000-7000-8000-00000000000a";
const pageId = "00000000-0000-4000-8000-000000000004";
const secondPageId = "00000000-0000-4000-8000-000000000005";

function repository() {
  const db = fakeExecutor();
  return {
    db,
    repo: new GrowthMapReadRepository(db.executor),
  };
}

describe("GrowthMapReadRepository", () => {
  it("selects only the current 0.3.1 publication for latest Growth Audit reads", async () => {
    const { db, repo } = repository();
    const row = {
      id: runId,
      run_status: "partial",
      run_completed_at: "2026-07-22T01:00:00.000Z",
    };
    db.enqueue([row]);

    await expect(repo.findLatestReadableRun(scope)).resolves.toBe(row);

    const query = db.lastSql();
    expect(query.sql).toContain(
      "with canonical_completed_collection_steps as",
    );
    expect(query.sql).toContain("publishable_analysis_refreshes as");
    expect(query.sql).toContain(
      "collection_child.status in ('completed', 'partial')",
    );
    expect(query.sql).toContain(
      "collection_child.result_type = 'collection_run'",
    );
    expect(query.sql).toContain(
      "result_snapshot.availability in ('available', 'partial')",
    );
    for (const [ordinal, stepKey] of [
      [1, "crawl"],
      [2, "gsc"],
      [3, "ga4"],
      [4, "dataforseo"],
      [5, "growth_audit"],
    ] as const) {
      expect(query.sql).toContain(
        `"app"."analysis_refresh_steps"."ordinal" = ${ordinal}`,
      );
      expect(query.sql).toContain(
        `"app"."analysis_refresh_steps"."step_key" = '${stepKey}'`,
      );
    }
    expect(query.sql).toContain(
      "\"app\".\"analysis_refresh_steps\".\"state\" in ('completed', 'skipped', 'failed')",
    );
    expect(query.sql).toContain('from "app"."async_runs"');
    expect(query.sql).toContain('from "app"."diagnostic_runs"');
    expect(query.sql).toContain('inner join "app"."async_runs"');
    expect(query.sql).toContain(
      'inner join "app"."analysis_refresh_steps"',
    );
    expect(query.sql).toContain(
      'inner join "app"."analysis_refresh_runs"',
    );
    expect(query.sql).toContain(
      "inner join publishable_analysis_refreshes",
    );
    expect(query.sql).toContain('inner join "app"."audit_runs"');
    expect(query.sql).toContain(
      'publishable_analysis_refreshes.id = "app"."analysis_refresh_runs"."id"',
    );
    expect(query.sql).toContain(
      '"app"."audit_runs"."projection_version" = $',
    );
    expect(query.sql).not.toMatch(
      /"app"\."audit_runs"\."projection_version" in \(\$\d+, \$\d+\)/u,
    );
    expect(query.sql).toContain(
      '"app"."analysis_refresh_steps"."child_async_run_id" = "app"."diagnostic_runs"."id"',
    );
    expect(query.sql).toContain(
      "\"app\".\"analysis_refresh_steps\".\"step_key\" = 'growth_audit'",
    );
    expect(query.sql).toContain(
      "\"app\".\"analysis_refresh_steps\".\"state\" = 'completed'",
    );
    expect(query.sql).toContain(
      '"app"."analysis_refresh_runs"."id" = "app"."analysis_refresh_steps"."analysis_refresh_run_id"',
    );
    expect(query.sql).toContain(
      '"app"."analysis_refresh_runs"."site_id" = "app"."diagnostic_runs"."site_id"',
    );
    expect(query.sql).toContain(
      '"app"."analysis_refresh_runs"."icp_profile_id" = "app"."diagnostic_runs"."icp_profile_id"',
    );
    expect(query.sql).toContain(
      "\"app\".\"async_runs\".\"kind\" = 'diagnostic'",
    );
    expect(
      query.sql.match(
        /"app"\."async_runs"\."status" in \('completed', 'partial'\)/gu,
      ),
    ).toHaveLength(2);
    expect(query.sql).toContain(
      "\"app\".\"async_runs\".\"result_type\" = 'diagnostic_run'",
    );
    expect(query.sql).toContain(
      '"app"."async_runs"."result_id" = "app"."diagnostic_runs"."id"',
    );
    expect(query.sql).toContain(
      "\"app\".\"async_runs\".\"kind\" = 'analysis_refresh'",
    );
    expect(query.sql).toContain(
      "\"app\".\"async_runs\".\"result_type\" = 'analysis_refresh_run'",
    );
    expect(query.sql).toContain(
      '"app"."async_runs"."result_id" = "app"."async_runs"."id"',
    );
    expect(query.sql).toContain(
      '"app"."async_runs"."completed_at" as completed_at',
    );
    expect(query.sql).toContain(
      '"app"."async_runs"."completed_at" is not null',
    );
    expect(query.sql).toContain('"app"."audit_runs"."projection_version"');
    expect(query.sql).toContain(
      "\"app\".\"audit_runs\".\"scope_kind\" = 'site'",
    );
    expect(query.sql).toContain(
      '"app"."audit_runs"."scope_key" = "app"."diagnostic_runs"."site_id"::text',
    );
    for (const table of [
      "diagnostic_runs",
      "analysis_refresh_steps",
      "analysis_refresh_runs",
      "audit_runs",
    ]) {
      expect(query.sql).toContain(`"app"."${table}"."workspace_id" = $`);
      expect(query.sql).toContain(`"app"."${table}"."project_id" = $`);
    }
    expect(
      query.sql.match(/"app"\."async_runs"\."workspace_id" = \$/gu),
    ).toHaveLength(2);
    expect(
      query.sql.match(/"app"\."async_runs"\."project_id" = \$/gu),
    ).toHaveLength(2);
    expect(query.sql).toContain(
      "order by\n        publishable_analysis_refreshes.completed_at desc",
    );
    expect(query.sql).toContain("publishable_analysis_refreshes.id desc");
    expect(query.sql).toContain('"app"."diagnostic_runs"."id" desc');
    expect(query.sql).not.toContain(
      'order by "app"."diagnostic_runs"."created_at" desc',
    );
    expect(query.params).toContain("growth-audit.0.3.1");
    expect(query.params).not.toContain("growth-audit.0.3.0");
    expect(query.params).not.toContain("growth-audit-recheck.0.3.0");
  });

  it("returns null when no completed or partial diagnostic is readable", async () => {
    const { db, repo } = repository();
    db.enqueue([]);
    await expect(repo.findLatestReadableRun(scope)).resolves.toBeNull();
  });

  it("recognizes exact five-step v1 and six-step v2 publication lineage", async () => {
    const { db, repo } = repository();
    db.enqueue([]);

    await expect(repo.findLatestReadableRun(scope)).resolves.toBeNull();

    const query = db.lastSql();
    expect(query.sql).toContain("analysis-refresh.plan.v1");
    expect(query.sql).toContain("analysis-refresh.plan.v2");
    expect(query.sql).toContain(
      "collection_step.step_key = 'dataforseo_backlinks'",
    );
    expect(query.sql).toContain(
      'result_snapshot.provider = case collection_step.step_key',
    );
    expect(query.sql).toContain(
      "when 'dataforseo_backlinks' then 'dataforseo'",
    );
    expect(query.sql).toContain('inner join "app"."collection_runs"');
    expect(query.sql).toContain(
      "collection_run.operation = 'search_landscape'",
    );
    expect(query.sql).toContain(
      "collection_run.method_version = 'dataforseo.search_landscape.v1'",
    );
    expect(query.sql).toContain(
      "result_snapshot.dataset_key = 'dataforseo.search_landscape.v1'",
    );
    expect(query.sql).toContain(
      "result_snapshot.schema_version = 'dataforseo.search_landscape.v1'",
    );
    expect(query.sql).toContain(
      "result_snapshot.method_version = 'dataforseo.search_landscape.v1'",
    );
    expect(query.sql).toContain(
      "collection_run.method_version = 'dataforseo.search_landscape.v2'",
    );
    expect(query.sql).toContain(
      "result_snapshot.dataset_key = 'dataforseo.search_landscape.v2'",
    );
    expect(query.sql).toContain(
      "result_snapshot.schema_version = 'dataforseo.search_landscape.v2'",
    );
    expect(query.sql).toContain(
      "result_snapshot.method_version = 'dataforseo.search_landscape.v2'",
    );
    expect(query.sql).toMatch(
      /collection_run\.method_version = 'dataforseo\.search_landscape\.v1'\s+and result_snapshot\.dataset_key = 'dataforseo\.search_landscape\.v1'\s+and result_snapshot\.schema_version = 'dataforseo\.search_landscape\.v1'\s+and result_snapshot\.method_version = 'dataforseo\.search_landscape\.v1'\s+\)\s+or\s+\(\s+collection_run\.method_version = 'dataforseo\.search_landscape\.v2'\s+and result_snapshot\.dataset_key = 'dataforseo\.search_landscape\.v2'\s+and result_snapshot\.schema_version = 'dataforseo\.search_landscape\.v2'\s+and result_snapshot\.method_version = 'dataforseo\.search_landscape\.v2'/u,
    );
    expect(query.sql).toContain(
      "collection_run.operation = 'backlinks'",
    );
    expect(query.sql).toContain(
      "collection_run.method_version = 'dataforseo.backlinks.v1'",
    );
    expect(query.sql).toContain(
      "result_snapshot.dataset_key = 'dataforseo.backlinks.v1'",
    );
    expect(query.sql).toContain(
      '"app"."analysis_refresh_steps"."ordinal" = 6',
    );
  });

  it("admits only known current or legacy projections for an exact diagnostic pin", async () => {
    const { db, repo } = repository();
    const row = {
      id: runId,
      run_status: "completed",
      run_completed_at: "2026-07-22T01:00:00.000Z",
    };
    db.enqueue([row], []);

    await expect(repo.findReadableRunById(scope, runId)).resolves.toBe(row);

    let query = db.lastSql();
    expect(query.sql).toContain(
      "with canonical_completed_collection_steps as",
    );
    expect(query.sql).toContain("publishable_analysis_refreshes as");
    expect(query.sql).toContain('inner join "app"."analysis_refresh_steps"');
    expect(query.sql).toContain(
      '"app"."analysis_refresh_steps"."child_async_run_id" = "app"."diagnostic_runs"."id"',
    );
    expect(query.sql).toContain(
      "\"app\".\"analysis_refresh_steps\".\"step_key\" = 'growth_audit'",
    );
    expect(query.sql).toContain(
      "\"app\".\"analysis_refresh_steps\".\"state\" = 'completed'",
    );
    expect(query.sql).toContain(
      "\"app\".\"async_runs\".\"kind\" = 'analysis_refresh'",
    );
    expect(query.sql).toContain(
      "\"app\".\"async_runs\".\"status\" in ('completed', 'partial')",
    );
    expect(query.sql).toContain(
      "\"app\".\"async_runs\".\"result_type\" = 'analysis_refresh_run'",
    );
    expect(query.sql).toContain(
      '"app"."async_runs"."result_id" = "app"."async_runs"."id"',
    );
    expect(query.sql).toContain(
      '"app"."analysis_refresh_runs"."site_id" = "app"."diagnostic_runs"."site_id"',
    );
    expect(query.sql).toContain(
      '"app"."audit_runs"."diagnostic_run_id" = "app"."diagnostic_runs"."id"',
    );
    expect(query.sql).toContain('"app"."audit_runs"."projection_version"');
    expect(query.sql).toMatch(
      /"app"\."audit_runs"\."projection_version" in \(\$\d+, \$\d+\)/u,
    );
    expect(query.sql).toContain('"app"."diagnostic_runs"."id" = $');
    expect(query.sql).not.toContain("order by");
    expect(query.sql).toContain("limit 1");
    expect(query.params).toContain("growth-audit.0.3.1");
    expect(query.params).toContain("growth-audit.0.3.0");
    expect(query.params).not.toContain("growth-audit.0.2.9");
    expect(query.params).not.toContain("growth-audit-recheck.0.3.0");
    expect(query.params.at(-1)).toBe(runId);

    await expect(
      repo.findReadableRunById(scope, secondPageId),
    ).resolves.toBeNull();
    query = db.lastSql();
    expect(query.params.at(-1)).toBe(secondPageId);
  });

  it("rejects a malformed exact diagnostic identity before issuing SQL", async () => {
    const { db, repo } = repository();

    await expect(
      repo.findReadableRunById(scope, "not-a-diagnostic-run"),
    ).rejects.toThrow(/diagnosticRunId/i);
    expect(db.calls).toEqual([]);
  });

  it("accepts a canonical lowercase UUIDv7 and rejects uppercase identity before SQL", async () => {
    const accepted = repository();
    accepted.db.enqueue([]);

    await expect(
      accepted.repo.findReadableRunById(scope, uuidV7RunId),
    ).resolves.toBeNull();
    expect(accepted.db.lastSql().params.at(-1)).toBe(uuidV7RunId);

    const rejected = repository();
    await expect(
      rejected.repo.findReadableRunById(scope, uuidV7RunId.toUpperCase()),
    ).rejects.toThrow(/diagnosticRunId/i);
    expect(rejected.db.calls).toEqual([]);
  });

  it("filters parent publishability before ordering and limiting eligible generations", async () => {
    const { db, repo } = repository();
    const eligibleGeneration = {
      id: runId,
      run_status: "completed",
      run_completed_at: "2026-07-22T01:00:00.000Z",
    };
    db.enqueue([eligibleGeneration]);

    await expect(repo.findLatestReadableRun(scope)).resolves.toBe(
      eligibleGeneration,
    );

    const query = db.lastSql();
    const parentKindFilter = query.sql.indexOf(
      "\"app\".\"async_runs\".\"kind\" = 'analysis_refresh'",
    );
    const parentTerminalFilter = query.sql.indexOf(
      "\"app\".\"async_runs\".\"status\" in ('completed', 'partial')",
      parentKindFilter,
    );
    const eligibleGenerationOrder = query.sql.indexOf(
      "order by\n        publishable_analysis_refreshes.completed_at desc",
    );
    const parentIdTieBreak = query.sql.indexOf(
      "publishable_analysis_refreshes.id desc",
      eligibleGenerationOrder,
    );
    const childIdTieBreak = query.sql.indexOf(
      '"app"."diagnostic_runs"."id" desc',
      parentIdTieBreak,
    );
    const limit = query.sql.lastIndexOf("limit 1");
    expect(parentTerminalFilter).toBeGreaterThan(-1);
    expect(eligibleGenerationOrder).toBeGreaterThan(parentTerminalFilter);
    expect(parentIdTieBreak).toBeGreaterThan(eligibleGenerationOrder);
    expect(childIdTieBreak).toBeGreaterThan(parentIdTieBreak);
    expect(limit).toBeGreaterThan(childIdTieBreak);
    expect(query.sql).not.toContain(
      "\"app\".\"async_runs\".\"status\" in ('failed', 'cancelled')",
    );
  });

  it("builds current-run URL membership only from frozen Crawl pages union resolved analytics URL observations", async () => {
    const { db, repo } = repository();
    const row = {
      site_page_id: pageId,
      site_page_created_at: "2026-07-22T01:00:00.000Z",
      normalized_url: "https://example.com/product",
      page_snapshot_id: "00000000-0000-4000-8000-000000000006",
      crawl_snapshot_id: "00000000-0000-4000-8000-000000000007",
    };
    db.enqueue([row]);

    await expect(
      repo.listCurrentRunUrls(scope, runId, {
        limit: 2,
        cursor: null,
        search: "Product_100%",
      }),
    ).resolves.toEqual({ rows: [row], nextCursor: null });

    const query = db.lastSql();
    expect(query.sql).toContain("jsonb_array_elements");
    expect(query.sql).toContain("snapshot_entry ->> 'snapshotId'");
    expect(query.sql).toContain("snapshot_entry ->> 'provider'");
    expect(query.sql).toContain('from "app"."diagnostic_runs"');
    expect(query.sql).toContain('join "app"."data_snapshots"');
    expect(query.sql).toContain('join "app"."page_snapshots"');
    expect(query.sql).toContain('join "app"."normalized_observations"');
    expect(query.sql).toContain("union");
    expect(query.sql).toContain("provider in ('gsc', 'ga4')");
    expect(query.sql).toContain("\"subject_type\" = 'url'");
    expect(query.sql).toContain("gsc.page.v1");
    expect(query.sql).toContain("ga4.landing.v1");
    expect(query.sql).toContain("position(lower($");
    expect(query.sql).not.toMatch(/like|ilike/iu);
    expect(query.sql).toContain("null::text as template_key");
    expect(query.sql).not.toContain('"app"."site_pages"."template_key"');
    expect(query.sql).not.toContain('"app"."site_pages"."updated_at"');
    expect(query.sql).toContain("opportunity_coverage_count desc");
    expect(query.sql).toContain("opportunity_priority_rank asc");
    expect(query.sql).toContain("opportunity_finding_count desc");
    expect(query.sql).toContain("site_page_created_at asc");
    expect(query.sql).toContain("site_page_id asc");
    expect(query.sql).toContain(
      "coalesce(opportunity_sort.finding_count, 0) > 0",
    );
    expect(query.params).toContain(runId);
    expect(query.params).toContain("Product_100%");
    // Every physical project-scoped table in the projection is scoped in SQL.
    for (const table of [
      "diagnostic_runs",
      "async_runs",
      "data_snapshots",
      "page_snapshots",
      "normalized_observations",
      "site_pages",
    ]) {
      expect(query.sql).toContain(`"app"."${table}"."workspace_id" = $`);
      expect(query.sql).toContain(`"app"."${table}"."project_id" = $`);
    }
  });

  it("uses the full coverage, priority, finding-count, and SitePage keyset across pages", async () => {
    const { db, repo } = repository();
    const first = {
      site_page_id: pageId,
      site_page_created_at: "2026-07-22T01:00:00.000Z",
      opportunity_coverage_count: 17,
      opportunity_priority_rank: 1,
      opportunity_finding_count: 7,
    };
    const second = {
      site_page_id: secondPageId,
      site_page_created_at: "2026-07-22T02:00:00.000Z",
      opportunity_coverage_count: 11,
      opportunity_priority_rank: 2,
      opportunity_finding_count: 3,
    };
    db.enqueue([first, second]);

    const page = await repo.listCurrentRunUrls(scope, runId, {
      limit: 1,
      cursor: null,
    });
    expect(page.rows).toEqual([first]);
    expect(page.nextCursor).toEqual(expect.any(String));

    db.enqueue([]);
    await repo.listCurrentRunUrls(scope, runId, {
      limit: 1,
      cursor: page.nextCursor,
    });
    const query = db.lastSql();
    expect(query.sql).toContain(
      "coalesce(opportunity_sort.coverage_count, 0) < $",
    );
    expect(query.sql).toContain(
      "coalesce(opportunity_sort.priority_rank, 4) > $",
    );
    expect(query.sql).toContain(
      "coalesce(opportunity_sort.finding_count, 0) < $",
    );
    expect(query.sql).toContain("site_page_created_at > $");
    expect(query.sql).toContain("site_page_id > $");
    expect(query.params).toContain(first.opportunity_coverage_count);
    expect(query.params).toContain(first.opportunity_priority_rank);
    expect(query.params).toContain(first.opportunity_finding_count);
    expect(query.params).toContain(first.site_page_created_at);
    expect(query.params).toContain(first.site_page_id);
    expect(query.params.at(-1)).toBe(2);
  });

  it("can retain the full frozen URL inventory for non-Opportunity consumers", async () => {
    const { db, repo } = repository();
    db.enqueue([]);

    await repo.listCurrentRunUrls(scope, runId, {
      limit: 10,
      cursor: null,
      opportunitiesOnly: false,
    });

    const query = db.lastSql();
    expect(query.sql).not.toContain(
      "and coalesce(opportunity_sort.finding_count, 0) > 0",
    );
    expect(query.sql).toContain("and true");
  });

  it("rejects malformed cursors and unbounded URL options before issuing SQL", async () => {
    const { db, repo } = repository();
    await expect(
      repo.listCurrentRunUrls(scope, runId, {
        limit: 10,
        cursor: "not-a-canonical-cursor",
      }),
    ).rejects.toThrow(/cursor/i);
    await expect(
      repo.listCurrentRunUrls(scope, runId, {
        limit: 0,
        cursor: null,
      }),
    ).rejects.toThrow(/limit/i);
    await expect(
      repo.listCurrentRunUrls(scope, runId, {
        limit: MAX_GROWTH_MAP_URL_PAGE_SIZE + 1,
        cursor: null,
      }),
    ).rejects.toThrow(/limit/i);
    await expect(
      repo.listCurrentRunUrls(scope, runId, {
        limit: 10,
        cursor: null,
        search: "x".repeat(MAX_GROWTH_MAP_SEARCH_LENGTH + 1),
      }),
    ).rejects.toThrow(/search/i);
    expect(db.calls).toEqual([]);
  });

  it("finds selected URL only through the same frozen current-run inventory", async () => {
    const { db, repo } = repository();
    const row = {
      site_page_id: pageId,
      site_page_created_at: "2026-07-22T01:00:00.000Z",
      normalized_url: "https://example.com/product",
    };
    db.enqueue([row], []);

    await expect(repo.findCurrentRunUrl(scope, runId, pageId)).resolves.toBe(
      row,
    );
    let query = db.lastSql();
    expect(query.sql).toContain("jsonb_array_elements");
    expect(query.sql).toContain('join "app"."page_snapshots"');
    expect(query.sql).toContain('join "app"."normalized_observations"');
    expect(query.sql).toContain("status\" in ('completed', 'partial')");
    expect(query.sql).toContain("where site_page_id = $");
    expect(query.sql).toContain("limit 1");
    expect(query.params).toContain(runId);
    expect(query.params.at(-1)).toBe(pageId);
    expect(query.sql).not.toContain("subject_refs");

    await expect(
      repo.findCurrentRunUrl(scope, runId, secondPageId),
    ).resolves.toBeNull();
    query = db.lastSql();
    expect(query.params.at(-1)).toBe(secondPageId);
  });

  it("rejects malformed selected URL identities before issuing SQL", async () => {
    const { db, repo } = repository();

    await expect(
      repo.findCurrentRunUrl(scope, "not-a-run", pageId),
    ).rejects.toThrow(/diagnosticRunId/i);
    await expect(
      repo.findCurrentRunUrl(scope, runId, "not-a-page"),
    ).rejects.toThrow(/sitePageId/i);
    expect(db.calls).toEqual([]);
  });

  it("loads only the bounded frozen-snapshot and SitePage observation intersection", async () => {
    const { db, repo } = repository();
    const observation = { id: "observation-1" };
    db.enqueue([observation]);

    await expect(
      repo.listObservations(scope, {
        snapshotIds: [runId, runId],
        sitePageIds: [pageId, pageId, secondPageId],
      }),
    ).resolves.toEqual([observation]);

    const query = db.lastSql();
    expect(query.sql).toContain('from "app"."normalized_observations"');
    expect(query.sql).toContain('"workspace_id" = $');
    expect(query.sql).toContain('"project_id" = $');
    expect(query.sql).toContain('"snapshot_id" in');
    expect(query.sql).toContain('"site_page_id" in');
    expect(query.sql).toMatch(
      /order by\s+"app"\."normalized_observations"\."site_page_id" asc/u,
    );
    expect(query.params.filter((value) => value === runId)).toHaveLength(1);
    expect(query.params.filter((value) => value === pageId)).toHaveLength(1);
  });

  it("loads resolved Finding target membership for exactly one diagnostic run", async () => {
    const { db, repo } = repository();
    const target = { id: "target-1" };
    db.enqueue([target]);

    await expect(
      repo.listResolvedTargets(scope, runId, [pageId, pageId]),
    ).resolves.toEqual([target]);

    const query = db.lastSql();
    expect(query.sql).toContain('from "app"."finding_targets"');
    expect(query.sql).toContain('"diagnostic_run_id" = $');
    expect(query.sql).toContain("\"resolution_state\" = 'resolved'");
    expect(query.sql).toContain('"site_page_id" in');
    expect(query.params.filter((value) => value === runId)).toHaveLength(1);
    expect(query.params.filter((value) => value === pageId)).toHaveLength(1);
    expect(query.sql).not.toContain("subject_refs");
    expect(query.sql).toMatch(
      /order by\s+"app"\."finding_targets"\."site_page_id" asc/u,
    );
  });

  it("loads bounded Findings, active Actions, and Artifacts in deterministic order", async () => {
    const { db, repo } = repository();
    const findingId = "00000000-0000-4000-8000-000000000006";
    const actionId = "00000000-0000-4000-8000-000000000007";
    db.enqueue([{ id: findingId }], [{ id: actionId }], [{ id: "artifact-1" }]);

    await expect(
      repo.listFindings(scope, runId, [findingId]),
    ).resolves.toHaveLength(1);
    expect(db.lastSql().sql).toContain(
      '"app"."findings"."last_seen_run_id" = $',
    );
    expect(db.lastSql().sql).toContain('order by "app"."findings"."id" asc');

    await expect(
      repo.listActiveActions(scope, [findingId]),
    ).resolves.toHaveLength(1);
    let query = db.lastSql();
    expect(query.sql).toContain("\"status\" <> 'dismissed'");
    expect(query.sql).toContain(
      'order by "app"."actions"."source_finding_id" asc',
    );

    await expect(repo.listArtifacts(scope, [actionId])).resolves.toHaveLength(
      1,
    );
    query = db.lastSql();
    expect(query.sql).toContain("\"status\" <> 'archived'");
    expect(query.sql).toMatch(
      /order by\s+"app"\."execution_artifacts"\."action_id" asc/u,
    );
  });

  it("short-circuits empty lookups and rejects all unique-ID bounds", async () => {
    const { db, repo } = repository();
    await expect(
      repo.listObservations(scope, { snapshotIds: [], sitePageIds: [pageId] }),
    ).resolves.toEqual([]);
    await expect(repo.listResolvedTargets(scope, runId, [])).resolves.toEqual(
      [],
    );
    await expect(repo.listFindings(scope, runId, [])).resolves.toEqual([]);
    await expect(repo.listActiveActions(scope, [])).resolves.toEqual([]);
    await expect(repo.listArtifacts(scope, [])).resolves.toEqual([]);

    await expect(
      repo.listObservations(scope, {
        snapshotIds: Array.from(
          { length: MAX_GROWTH_MAP_SNAPSHOT_LOOKUP + 1 },
          (_, index) => `snapshot-${index}`,
        ),
        sitePageIds: [pageId],
      }),
    ).rejects.toThrow(/snapshot/i);
    for (const call of [
      () =>
        repo.listObservations(scope, {
          snapshotIds: [runId],
          sitePageIds: Array.from(
            { length: MAX_GROWTH_MAP_ENTITY_LOOKUP + 1 },
            (_, index) => `page-${index}`,
          ),
        }),
      () =>
        repo.listResolvedTargets(
          scope,
          runId,
          Array.from(
            { length: MAX_GROWTH_MAP_ENTITY_LOOKUP + 1 },
            (_, index) => `page-${index}`,
          ),
        ),
      () =>
        repo.listFindings(
          scope,
          runId,
          Array.from(
            { length: MAX_GROWTH_MAP_ENTITY_LOOKUP + 1 },
            (_, index) => `finding-${index}`,
          ),
        ),
      () =>
        repo.listActiveActions(
          scope,
          Array.from(
            { length: MAX_GROWTH_MAP_ENTITY_LOOKUP + 1 },
            (_, index) => `finding-${index}`,
          ),
        ),
      () =>
        repo.listArtifacts(
          scope,
          Array.from(
            { length: MAX_GROWTH_MAP_ENTITY_LOOKUP + 1 },
            (_, index) => `action-${index}`,
          ),
        ),
    ]) {
      await expect(call()).rejects.toThrow(/at most/i);
    }
    expect(db.calls).toEqual([]);
  });
});
