import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_TOPIC_INSIGHT_NODES,
  TopicModelInsightsConflictError,
  TopicModelInsightsIntegrityError,
  TopicModelInsightsRepository,
} from "./topic-model-insights.ts";

class FakeExecutor {
  readonly statements: unknown[] = [];
  private readonly results: unknown[][] = [];

  enqueue(...rows: unknown[][]): void {
    this.results.push(...rows);
  }

  async execute(statement: unknown): Promise<{ rows: unknown[] }> {
    this.statements.push(statement);
    return { rows: this.results.shift() ?? [] };
  }

  compiled(index = 0) {
    const statement = this.statements[index];
    if (!statement) throw new Error("No SQL statement was captured.");
    return new PgDialect().sqlToQuery(statement as never);
  }
}

const ids = {
  workspace: "94000000-0000-4000-8000-000000000001",
  project: "94000000-0000-4000-8000-000000000002",
  model: "94000000-0000-4000-8000-000000000003",
  node: "94000000-0000-4000-8000-000000000004",
} as const;
const scope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    project_exists: true,
    project_id: ids.project,
    model_id: ids.model,
    model_workspace_id: ids.workspace,
    model_project_id: ids.project,
    topic_model_revision: 4,
    model_status: "confirmed",
    topic_node_id: ids.node,
    node_workspace_id: ids.workspace,
    node_project_id: ids.project,
    node_topic_model_revision: 4,
    node_label: "Customer Onboarding",
    node_lifecycle_state: "active",
    keyword_count: 3,
    approved_keyword_count: 2,
    review_pending_keyword_count: 1,
    existing_page_keyword_count: 2,
    new_asset_keyword_count: 1,
    unassigned_keyword_count: 0,
    mapped_page_count: 2,
    conflicting_intent_count: 0,
    missing_decision_count: 0,
    mirror_divergence_count: 0,
    decision_shape_invalid_count: 0,
    non_excluded_keyword_count: 3,
    unassigned_topic_keyword_count: 0,
    orphan_assignment_count: 0,
    invalidated_assignment_count: 0,
    ...overrides,
  };
}

function noModelRow(overrides: Record<string, unknown> = {}) {
  return row({
    model_id: null,
    model_workspace_id: null,
    model_project_id: null,
    topic_model_revision: null,
    model_status: null,
    topic_node_id: null,
    node_workspace_id: null,
    node_project_id: null,
    node_topic_model_revision: null,
    node_label: null,
    node_lifecycle_state: null,
    keyword_count: 0,
    approved_keyword_count: 0,
    review_pending_keyword_count: 0,
    existing_page_keyword_count: 0,
    new_asset_keyword_count: 0,
    unassigned_keyword_count: 0,
    mapped_page_count: 0,
    conflicting_intent_count: 0,
    non_excluded_keyword_count: 0,
    ...overrides,
  });
}

describe("TopicModelInsightsRepository", () => {
  it("loads active nodes and current Keyword authority in one bounded scoped SQL statement", async () => {
    const db = new FakeExecutor();
    db.enqueue([row()]);

    await expect(
      new TopicModelInsightsRepository(db as never).readLatestConfirmed(
        scope,
      ),
    ).resolves.toEqual({
      state: "confirmed",
      projectId: ids.project,
      topicModelRevision: 4,
      nodes: [
        {
          topicNodeId: ids.node,
          topicModelRevision: 4,
          label: "Customer Onboarding",
          keywordCount: 3,
          approvedKeywordCount: 2,
          reviewPendingKeywordCount: 1,
          existingPageKeywordCount: 2,
          newAssetKeywordCount: 1,
          unassignedKeywordCount: 0,
          mappedPageCount: 2,
          conflictingIntentCount: 0,
        },
      ],
      nonExcludedKeywordCount: 3,
      unassignedTopicKeywordCount: 0,
      orphanAssignmentCount: 0,
      invalidatedAssignmentCount: 0,
    });

    expect(db.statements).toHaveLength(1);
    const query = db.compiled();
    expect(query.sql).toContain("latest_confirmed as materialized");
    expect(query.sql).toContain("where model.status = 'confirmed'");
    expect(query.sql).toContain(
      "order by model.revision desc, model.id desc",
    );
    expect(query.sql).toContain("active_nodes as materialized");
    expect(query.sql).toContain(
      "where node.lifecycle_state = 'active'",
    );
    expect(query.sql).toContain("left join lateral");
    expect(query.sql).toContain(
      "latest.governance_revision desc",
    );
    expect(query.sql).toContain("mirror_divergence_count");
    expect(query.sql).toContain(
      "app.normalize_keyword_relation_semantic",
    );
    expect(query.sql).toContain("'topic_retire'");
    expect(query.sql).toContain(
      "count(\n          distinct keyword.decision_mapped_site_page_id",
    );
    expect(query.params).toContain(scope.workspaceId);
    expect(query.params).toContain(scope.projectId);
    expect(query.params).toContain(
      MAX_ACTIVE_TOPIC_INSIGHT_NODES + 1,
    );
  });

  it("returns explicit missing confirmed authority instead of synthetic zero-valued Topics", async () => {
    const db = new FakeExecutor();
    db.enqueue([noModelRow()]);

    await expect(
      new TopicModelInsightsRepository(db as never).readLatestConfirmed(
        scope,
      ),
    ).resolves.toEqual({
      state: "no_confirmed_model",
      projectId: ids.project,
    });
  });

  it("treats an empty SQL result as a scoped archived-or-missing project", async () => {
    const db = new FakeExecutor();
    db.enqueue([]);

    await expect(
      new TopicModelInsightsRepository(db as never).readLatestConfirmed(
        scope,
      ),
    ).rejects.toBeInstanceOf(TopicModelInsightsConflictError);
  });

  it("fails closed instead of truncating more than 500 active nodes", async () => {
    const db = new FakeExecutor();
    db.enqueue(
      Array.from(
        { length: MAX_ACTIVE_TOPIC_INSIGHT_NODES + 1 },
        (_, index) =>
          row({
            topic_node_id:
              `94000000-0000-4000-8001-${String(index).padStart(12, "0")}`,
          }),
      ),
    );

    await expect(
      new TopicModelInsightsRepository(db as never).readLatestConfirmed(
        scope,
      ),
    ).rejects.toMatchObject({
      code: "ACTIVE_NODE_LIMIT_EXCEEDED",
    });
  });

  it.each([
    ["missing current decision", { missing_decision_count: 1 }],
    ["legacy mirror divergence", { mirror_divergence_count: 1 }],
    [
      "malformed current decision",
      { decision_shape_invalid_count: 1 },
    ],
  ])("fails closed on %s", async (_name, drift) => {
    const db = new FakeExecutor();
    db.enqueue([row(drift)]);

    await expect(
      new TopicModelInsightsRepository(db as never).readLatestConfirmed(
        scope,
      ),
    ).rejects.toMatchObject({
      code: "KEYWORD_AUTHORITY_DIVERGED",
    });
  });

  it("returns explicit unassigned and orphan counts instead of silently omitting them", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      row({
        keyword_count: 1,
        approved_keyword_count: 1,
        review_pending_keyword_count: 0,
        existing_page_keyword_count: 1,
        new_asset_keyword_count: 0,
        mapped_page_count: 1,
        non_excluded_keyword_count: 3,
        unassigned_topic_keyword_count: 1,
        orphan_assignment_count: 1,
      }),
    ]);

    await expect(
      new TopicModelInsightsRepository(db as never).readLatestConfirmed(
        scope,
      ),
    ).resolves.toMatchObject({
      state: "confirmed",
      nonExcludedKeywordCount: 3,
      unassignedTopicKeywordCount: 1,
      orphanAssignmentCount: 1,
    });
  });

  it("fails closed when node mapping counts or project-wide scope counts do not partition", async () => {
    for (const invalid of [
      row({ new_asset_keyword_count: 2 }),
      row({ non_excluded_keyword_count: 4 }),
      row({
        invalidated_assignment_count: 2,
        review_pending_keyword_count: 1,
      }),
    ]) {
      const db = new FakeExecutor();
      db.enqueue([invalid]);
      await expect(
        new TopicModelInsightsRepository(db as never).readLatestConfirmed(
          scope,
        ),
      ).rejects.toBeInstanceOf(TopicModelInsightsIntegrityError);
    }
  });

  it("rejects foreign, draft, superseded, or duplicate node projection rows", async () => {
    for (const invalid of [
      row({ model_status: "draft" }),
      row({ node_workspace_id: ids.project }),
      row({ node_lifecycle_state: "superseded" }),
      [
        row(),
        row({
          node_label: "Duplicated stable identity",
          non_excluded_keyword_count: 6,
        }),
      ],
    ]) {
      const db = new FakeExecutor();
      db.enqueue(Array.isArray(invalid) ? invalid : [invalid]);
      await expect(
        new TopicModelInsightsRepository(db as never).readLatestConfirmed(
          scope,
        ),
      ).rejects.toBeInstanceOf(TopicModelInsightsIntegrityError);
    }
  });

  it("rejects malformed scope before SQL access", async () => {
    const db = new FakeExecutor();

    await expect(
      new TopicModelInsightsRepository(db as never).readLatestConfirmed({
        workspaceId: ids.workspace,
        projectId: "customer-private-project",
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(db.statements).toEqual([]);
  });
});
