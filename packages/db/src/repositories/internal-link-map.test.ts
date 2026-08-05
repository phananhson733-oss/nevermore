import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  InternalLinkMapIntegrityError,
  InternalLinkMapRepository,
  MAX_INTERNAL_LINK_MAP_EXECUTION_ROWS,
  MAX_INTERNAL_LINK_MAP_OBSERVATIONS,
  MAX_INTERNAL_LINK_MAP_PAGE_LOOKUP,
  MAX_INTERNAL_LINK_MAP_TOPIC_MAPPINGS,
} from "./internal-link-map.ts";

interface Call {
  readonly statement: unknown;
}

function fakeExecutor() {
  const calls: Call[] = [];
  const results: unknown[][] = [];
  const executor = {
    execute(statement: unknown) {
      calls.push({ statement });
      return Promise.resolve({ rows: results.shift() ?? [] });
    },
  };
  return {
    executor: executor as never,
    calls,
    enqueue(...rows: readonly unknown[][]) {
      results.push(...rows);
    },
    lastSql() {
      const call = calls.at(-1);
      if (!call) throw new Error("No SQL call was recorded");
      return new PgDialect().sqlToQuery(call.statement as never);
    },
  };
}

const ids = {
  workspace: "98000000-0000-4000-8000-000000000001",
  project: "98000000-0000-4000-8000-000000000002",
  run: "98000000-0000-4000-8000-000000000003",
  snapshot: "98000000-0000-4000-8000-000000000004",
  pageA: "98000000-0000-4000-8000-000000000005",
  pageB: "98000000-0000-4000-8000-000000000006",
  observation: "98000000-0000-4000-8000-000000000007",
  finding: "98000000-0000-4000-8000-000000000008",
  action: "98000000-0000-4000-8000-000000000009",
  topicA: "98000000-0000-4000-8000-000000000010",
  topicB: "98000000-0000-4000-8000-000000000011",
} as const;

const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};

function repository() {
  const db = fakeExecutor();
  return {
    db,
    repo: new InternalLinkMapRepository(db.executor),
  };
}

describe("InternalLinkMapRepository", () => {
  it("reads only bounded crawl.page.v1 observations frozen by one readable diagnostic", async () => {
    const { db, repo } = repository();
    const row = {
      observation_id: ids.observation,
      workspace_id: ids.workspace,
      project_id: ids.project,
      snapshot_id: ids.snapshot,
      site_page_id: ids.pageA,
      subject_ref: "https://example.com/a",
      observed_at: new Date("2026-07-28T08:00:00.000Z"),
      normalized_url: "https://example.com/a/",
    };
    db.enqueue([row]);

    await expect(
      repo.listFrozenCrawlObservations(scope, {
        diagnosticRunId: ids.run,
        crawlSnapshotId: ids.snapshot,
      }),
    ).resolves.toEqual([
      {
        ...row,
        observed_at: "2026-07-28T08:00:00.000Z",
      },
    ]);

    const query = db.lastSql();
    expect(query.sql).toContain('from "app"."diagnostic_runs"');
    expect(query.sql).toContain('inner join "app"."async_runs"');
    expect(query.sql).toContain("jsonb_array_elements");
    expect(query.sql).toContain("snapshot_entry ->> 'snapshotId'");
    expect(query.sql).toContain("snapshot_entry ->> 'provider'");
    expect(query.sql).toContain('inner join "app"."data_snapshots"');
    expect(query.sql).toContain('inner join "app"."normalized_observations"');
    expect(query.sql).toContain('left join "app"."site_pages"');
    expect(query.sql).toMatch(
      /"app"\."data_snapshots"\."site_id"\s*=\s*"app"\."diagnostic_runs"\."site_id"/u,
    );
    expect(query.sql).toMatch(
      /"app"\."site_pages"\."site_id"\s*=\s*frozen_crawl\.site_id/u,
    );
    expect(query.sql).toContain("\"kind\" = 'diagnostic'");
    expect(query.sql).toContain("\"status\" in ('completed', 'partial')");
    expect(query.sql).toContain("\"provider\" = 'crawl'");
    expect(query.sql).toContain("\"metric_key\" = 'crawl.page.v1'");
    expect(query.sql).toContain("\"subject_type\" = 'url'");
    expect(query.sql).toMatch(
      /order by\s+"app"\."normalized_observations"\."subject_ref" asc/u,
    );
    expect(query.sql).toContain(`"app"."site_pages"."normalized_url" asc`);
    expect(query.sql).toContain(`"app"."normalized_observations"."id" asc`);
    expect(query.params.at(-1)).toBe(MAX_INTERNAL_LINK_MAP_OBSERVATIONS + 1);
    expect(query.params).toContain(ids.run);
    expect(query.params).toContain(ids.snapshot);
    for (const table of [
      "diagnostic_runs",
      "async_runs",
      "data_snapshots",
      "normalized_observations",
      "site_pages",
    ]) {
      expect(query.sql).toMatch(
        new RegExp(`"app"\\."${table}"\\."workspace_id"\\s*=\\s*\\$`, "u"),
      );
      expect(query.sql).toMatch(
        new RegExp(`"app"\\."${table}"\\."project_id"\\s*=\\s*\\$`, "u"),
      );
    }
  });

  it("fails closed when the frozen crawl observation bound is exceeded", async () => {
    const { db, repo } = repository();
    db.enqueue(
      Array.from(
        { length: MAX_INTERNAL_LINK_MAP_OBSERVATIONS + 1 },
        (_, index) => ({
          observation_id: `row-${index}`,
        }),
      ),
    );

    await expect(
      repo.listFrozenCrawlObservations(scope, {
        diagnosticRunId: ids.run,
        crawlSnapshotId: ids.snapshot,
      }),
    ).rejects.toEqual(
      new InternalLinkMapIntegrityError("CRAWL_OBSERVATION_LIMIT_EXCEEDED"),
    );
  });

  it("returns only real current-run TECH-LINKGRAPH-005 Finding and active Action refs", async () => {
    const { db, repo } = repository();
    const row = {
      site_page_id: ids.pageA,
      finding_id: ids.finding,
      action_id: ids.action,
    };
    db.enqueue([row]);

    await expect(
      repo.listExecutionRefs(scope, ids.run, 3, [
        ids.pageB,
        ids.pageA,
        ids.pageA,
      ]),
    ).resolves.toEqual([row]);

    const query = db.lastSql();
    expect(query.sql).toContain('from "app"."finding_targets"');
    expect(query.sql).toContain('inner join "app"."findings"');
    expect(query.sql).toContain('left join "app"."actions"');
    expect(query.sql).toContain("\"resolution_state\" = 'resolved'");
    expect(query.sql).toContain("\"rule_id\" = 'TECH-LINKGRAPH-005'");
    expect(query.sql).toMatch(/"rule_version"\s*=\s*\$/u);
    expect(query.params).toContain(3);
    expect(query.sql).toMatch(/"last_seen_run_id"\s*=\s*\$/u);
    expect(query.sql).toContain('"active" = true');
    expect(query.sql).toContain("\"status\" <> 'dismissed'");
    expect(query.sql).toContain("\"relation\" = 'affected_by_page_set'");
    expect(query.sql).toContain("\"basis_kind\" = 'crawl_exact_fetch'");
    expect(query.sql).toMatch(
      /order by\s+"app"\."finding_targets"\."site_page_id" asc/u,
    );
    expect(query.params.filter((value) => value === ids.pageA)).toHaveLength(1);
    expect(query.params.filter((value) => value === ids.pageB)).toHaveLength(1);
    expect(query.params.at(-1)).toBe(MAX_INTERNAL_LINK_MAP_EXECUTION_ROWS + 1);
  });

  it("reads same-page Topic mappings only from the latest confirmed model and current Keyword ledger", async () => {
    const { db, repo } = repository();
    db.enqueue([
      {
        project_exists: true,
        topic_model_revision: 3,
        site_page_id: ids.pageA,
        topic_node_id: ids.topicA,
        topic_label: "Customer onboarding",
        missing_decision_count: 0,
        mirror_divergence_count: 0,
        invalid_decision_count: 0,
      },
      {
        project_exists: true,
        topic_model_revision: 3,
        site_page_id: ids.pageB,
        topic_node_id: ids.topicB,
        topic_label: "Implementation",
        missing_decision_count: 0,
        mirror_divergence_count: 0,
        invalid_decision_count: 0,
      },
    ]);

    await expect(
      repo.readConfirmedPageTopics(scope, [ids.pageB, ids.pageA]),
    ).resolves.toEqual({
      state: "confirmed",
      projectId: ids.project,
      topicModelRevision: 3,
      mappings: [
        {
          sitePageId: ids.pageA,
          topicNodeId: ids.topicA,
          topicModelRevision: 3,
          topicLabel: "Customer onboarding",
        },
        {
          sitePageId: ids.pageB,
          topicNodeId: ids.topicB,
          topicModelRevision: 3,
          topicLabel: "Implementation",
        },
      ],
    });

    const query = db.lastSql();
    expect(query.sql).toContain('from "app"."client_projects"');
    expect(query.sql).toContain('"archived_at" is null');
    expect(query.sql).toContain('from "app"."topic_model_revisions"');
    expect(query.sql).toContain("where model.status = 'confirmed'");
    expect(query.sql).toContain('from "app"."topic_node_revisions"');
    expect(query.sql).toContain("where node.lifecycle_state = 'active'");
    expect(query.sql).toContain('from "app"."keyword_entities"');
    expect(query.sql).toContain('from "app"."keyword_review_decisions"');
    expect(query.sql).toContain("order by latest.governance_revision desc");
    expect(query.sql).toContain(
      "authority.decision_mapping_decision = 'existing_page'",
    );
    expect(query.sql).toContain(
      "authority.decision_review_state = 'confirmed'",
    );
    expect(query.sql).toContain("authority.assignment_invalidated_by is null");
    expect(query.sql).toContain(
      "authority.decision_topic_model_revision = model.revision",
    );
    expect(query.sql).toMatch(/order by\s+mapping\.site_page_id asc/u);
    expect(query.params.filter((value) => value === ids.pageA)).toHaveLength(1);
    expect(query.params.filter((value) => value === ids.pageB)).toHaveLength(1);
    expect(query.params.at(-1)).toBe(MAX_INTERNAL_LINK_MAP_TOPIC_MAPPINGS + 1);
  });

  it("fails closed when execution or Topic mapping result bounds are exceeded", async () => {
    const execution = repository();
    execution.db.enqueue(
      Array.from({ length: MAX_INTERNAL_LINK_MAP_EXECUTION_ROWS + 1 }, () => ({
        site_page_id: ids.pageA,
        finding_id: ids.finding,
        action_id: null,
      })),
    );
    await expect(
      execution.repo.listExecutionRefs(scope, ids.run, 2, [ids.pageA]),
    ).rejects.toEqual(
      new InternalLinkMapIntegrityError("EXECUTION_REF_LIMIT_EXCEEDED"),
    );

    const topics = repository();
    topics.db.enqueue(
      Array.from({ length: MAX_INTERNAL_LINK_MAP_TOPIC_MAPPINGS + 1 }, () => ({
        project_exists: true,
        topic_model_revision: 3,
        site_page_id: ids.pageA,
        topic_node_id: ids.topicA,
        topic_label: "Customer onboarding",
        missing_decision_count: 0,
        mirror_divergence_count: 0,
        invalid_decision_count: 0,
      })),
    );
    await expect(
      topics.repo.readConfirmedPageTopics(scope, [ids.pageA]),
    ).rejects.toEqual(
      new InternalLinkMapIntegrityError("TOPIC_MAPPING_LIMIT_EXCEEDED"),
    );
  });

  it("distinguishes no confirmed Topic Model from corrupt Keyword authority", async () => {
    const noModel = repository();
    noModel.db.enqueue([
      {
        project_exists: true,
        topic_model_revision: null,
        site_page_id: null,
        topic_node_id: null,
        topic_label: null,
        missing_decision_count: 0,
        mirror_divergence_count: 0,
        invalid_decision_count: 0,
      },
    ]);
    await expect(
      noModel.repo.readConfirmedPageTopics(scope, [ids.pageA]),
    ).resolves.toEqual({
      state: "no_confirmed_model",
      projectId: ids.project,
    });

    const corrupt = repository();
    corrupt.db.enqueue([
      {
        project_exists: true,
        topic_model_revision: 3,
        site_page_id: null,
        topic_node_id: null,
        topic_label: null,
        missing_decision_count: 1,
        mirror_divergence_count: 0,
        invalid_decision_count: 0,
      },
    ]);
    await expect(
      corrupt.repo.readConfirmedPageTopics(scope, [ids.pageA]),
    ).rejects.toEqual(
      new InternalLinkMapIntegrityError("KEYWORD_AUTHORITY_DIVERGED"),
    );
  });

  it("short-circuits empty reads and rejects malformed or unbounded identities before SQL", async () => {
    const { db, repo } = repository();
    await expect(
      repo.listExecutionRefs(scope, ids.run, 2, []),
    ).resolves.toEqual([]);
    await expect(
      repo.listExecutionRefs(scope, ids.run, 0, [ids.pageA]),
    ).rejects.toThrow(/ruleVersion/u);
    await expect(
      repo.listExecutionRefs(scope, ids.run, 2.5, [ids.pageA]),
    ).rejects.toThrow(/ruleVersion/u);
    await expect(repo.readConfirmedPageTopics(scope, [])).resolves.toEqual({
      state: "not_requested",
      projectId: ids.project,
    });

    await expect(
      repo.listFrozenCrawlObservations(scope, {
        diagnosticRunId: "not-a-run",
        crawlSnapshotId: ids.snapshot,
      }),
    ).rejects.toThrow(/diagnosticRunId/i);
    await expect(
      repo.listExecutionRefs(
        scope,
        ids.run,
        2,
        Array.from(
          { length: MAX_INTERNAL_LINK_MAP_PAGE_LOOKUP + 1 },
          (_, index) =>
            `98000000-0000-4000-8000-${String(index + 10_000).padStart(12, "0")}`,
        ),
      ),
    ).rejects.toThrow(/at most/i);
    expect(db.calls).toEqual([]);
  });
});
