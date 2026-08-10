import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  KeywordReviewSuggestionsRepository,
  type KeywordReviewSuggestionRow,
} from "./keyword-review-suggestions.ts";

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor() {
  const calls: Call[] = [];
  const results: unknown[] = [];
  const take = () => results.shift() ?? [];
  const query: object = new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (resolve: (value: unknown) => unknown) =>
          Promise.resolve(take()).then(resolve);
      }
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args });
        return query;
      };
    },
  });
  const executor = new Proxy({}, {
    get(_target, property) {
      if (property === "execute") {
        return (value: unknown) => {
          calls.push({ method: "execute", args: [value] });
          return Promise.resolve(take());
        };
      }
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args });
        return query;
      };
    },
  });
  return {
    executor: executor as never,
    calls,
    enqueue: (...values: unknown[]) => results.push(...values),
  };
}

function last(calls: readonly Call[], method: string): Call {
  const call = calls.findLast((entry) => entry.method === method);
  if (!call) throw new Error(`missing ${method}`);
  return call;
}

const ids = {
  workspace: "53000000-0000-4000-8000-000000000001",
  project: "53000000-0000-4000-8000-000000000002",
  run: "53000000-0000-4000-8000-000000000003",
  keyword: "53000000-0000-4000-8000-000000000004",
  suggestion: "53000000-0000-4000-8000-000000000005",
  invocation: "53000000-0000-4000-8000-000000000006",
} as const;
const scope = { workspaceId: ids.workspace, projectId: ids.project };
const item = {
  suggestionId: ids.suggestion,
  ordinal: 1,
  keywordId: ids.keyword,
  expectedGovernanceRevision: 0,
  suggestionVersion: "keyword-governance-suggestion.v1" as const,
  status: "approved" as const,
  intent: "commercial",
  buyerStage: "decision",
  topicNodeId: null,
  topicModelRevision: null,
  mappingDecision: "unassigned" as const,
  mappedSitePageId: null,
  reason: "The confirmed evidence supports approval.",
  intentAuthority: "llm_generated" as const,
  intentSnapshotId: null,
  intentObservationId: null,
  intentObservedAt: null,
} as const;
const row: KeywordReviewSuggestionRow = {
  id: ids.suggestion,
  workspace_id: ids.workspace,
  project_id: ids.project,
  keyword_entity_id: ids.keyword,
  generation_run_id: ids.run,
  output_ordinal: 1,
  expected_governance_revision: 0,
  suggestion_version: "keyword-governance-suggestion.v1",
  generation_version: "keyword-governance-suggestion-generation.v1",
  prompt_set_version: "keyword-governance-suggestion.prompt.v1",
  input_hash: "a".repeat(64),
  output_hash: "b".repeat(64),
  status: "pending",
  suggested_status: "approved",
  suggested_intent: "commercial",
  suggested_buyer_stage: "decision",
  suggested_topic_node_id: null,
  suggested_topic_model_revision: null,
  suggested_mapping_decision: "unassigned",
  suggested_mapped_site_page_id: null,
  suggested_reason: "The confirmed evidence supports approval.",
  analysis_invocation_id: ids.invocation,
  intent_authority: "llm_generated",
  intent_snapshot_id: null,
  intent_observation_id: null,
  intent_observed_at: null,
  resolution_mode: null,
  keyword_review_decision_id: null,
  superseded_by_suggestion_id: null,
  created_at: "2026-08-10T01:00:00.000Z",
  resolved_at: null,
};

describe("KeywordReviewSuggestionsRepository", () => {
  it("persists one exact bounded batch through the atomic database routine", async () => {
    const fake = fakeExecutor();
    fake.enqueue({
      rows: [{ result: { kind: "inserted", suggestions: [row] } }],
    });
    const repo = new KeywordReviewSuggestionsRepository(fake.executor);
    await expect(repo.insertBatch(scope, {
      generationRunId: ids.run,
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      analysisInvocationId: ids.invocation,
      suggestions: [item],
    })).resolves.toEqual({ kind: "inserted", suggestions: [row] });
    const compiled = new PgDialect().sqlToQuery(
      last(fake.calls, "execute").args[0] as never,
    );
    expect(compiled.sql).toContain(
      "app.insert_keyword_review_suggestions_batch",
    );
    expect(compiled.params.slice(0, 6)).toEqual([
      ids.workspace,
      ids.project,
      ids.run,
      "a".repeat(64),
      "b".repeat(64),
      ids.invocation,
    ]);
    expect(JSON.parse(compiled.params[6] as string)).toEqual([item]);
  });

  it("rejects duplicate identities and malformed lineage before SQL", async () => {
    const fake = fakeExecutor();
    const repo = new KeywordReviewSuggestionsRepository(fake.executor);
    await expect(repo.insertBatch(scope, {
      generationRunId: ids.run,
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      analysisInvocationId: ids.invocation,
      suggestions: [item, { ...item, ordinal: 2 }],
    })).rejects.toThrow(/identities conflict/u);
    await expect(repo.insertBatch(scope, {
      generationRunId: ids.run,
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      analysisInvocationId: ids.invocation,
      suggestions: [{ ...item, intentAuthority: "provider_observed" }],
    })).rejects.toThrow(/invalid Keyword review suggestion batch/u);
    await expect(repo.insertBatch(scope, {
      generationRunId: ids.run,
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      analysisInvocationId: ids.invocation,
      suggestions: [{ ...item, mappingDecision: "new_asset" }],
    })).rejects.toThrow(/invalid Keyword review suggestion batch/u);
    await expect(repo.insertBatch(scope, {
      generationRunId: ids.run,
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      analysisInvocationId: ids.invocation,
      suggestions: [{ ...item, buyerStage: "research" as never }],
    })).rejects.toThrow(/invalid Keyword review suggestion batch/u);
    expect(fake.calls).toEqual([]);
  });

  it.each([
    "stale",
    "stale_authority",
    "concurrent_human",
    "conflict",
  ] as const)("returns the typed %s batch result", async (kind) => {
    const fake = fakeExecutor();
    fake.enqueue({ rows: [{ result: { kind } }] });
    await expect(new KeywordReviewSuggestionsRepository(
      fake.executor,
    ).insertBatch(scope, {
      generationRunId: ids.run,
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      analysisInvocationId: ids.invocation,
      suggestions: [item],
    })).resolves.toEqual({ kind });
  });

  it("fails closed on partial/malformed DB output and scopes current reads", async () => {
    const partial = fakeExecutor();
    partial.enqueue({
      rows: [{ result: { kind: "inserted", suggestions: [] } }],
    });
    await expect(new KeywordReviewSuggestionsRepository(
      partial.executor,
    ).insertBatch(scope, {
      generationRunId: ids.run,
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      analysisInvocationId: ids.invocation,
      suggestions: [item],
    })).rejects.toThrow(/partial/u);

    const fake = fakeExecutor();
    fake.enqueue([row]);
    await expect(new KeywordReviewSuggestionsRepository(
      fake.executor,
    ).findCurrentPending(scope, ids.keyword, 0)).resolves.toEqual(row);
    const compiled = new PgDialect().sqlToQuery(
      last(fake.calls, "where").args[0] as never,
    );
    expect(compiled.params).toEqual([
      ids.workspace,
      ids.project,
      ids.keyword,
      "pending",
      0,
    ]);
  });

  it("returns one scoped readiness projection with public-safe Topic/Page labels", async () => {
    const fake = fakeExecutor();
    fake.enqueue({
      rows: [{
        suggestion: row,
        suggested_topic_label: null,
        suggested_page_title: null,
        authority_current: true,
      }],
    });
    await expect(new KeywordReviewSuggestionsRepository(
      fake.executor,
    ).findCurrentPendingReadiness(scope, ids.keyword)).resolves.toEqual({
      kind: "ready",
      suggestion: row,
      topicLabel: null,
      mappedSitePageTitle: null,
    });
    const compiled = new PgDialect().sqlToQuery(
      last(fake.calls, "execute").args[0] as never,
    );
    expect(compiled.sql).toContain("suggested_topic_label");
    expect(compiled.sql).toContain("suggested_page_title");
    expect(compiled.sql).toContain(
      "app.current_keyword_governance_suggestion_occurrence_ids",
    );
    expect(compiled.sql).toContain("project.default_delivery_locale");
    expect(compiled.sql).toContain("primary_site.market_codes");
    expect(compiled.sql).toContain("primary_site.language_codes");
    expect(compiled.sql).toContain("attempt.status = 'succeeded'");
    expect(compiled.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      ids.keyword,
    ]);
  });

  it("finds exact completed/current pending reuse and invalidates bounded pending sets", async () => {
    const fake = fakeExecutor();
    fake.enqueue(
      {
        rows: [{
          result: {
            kind: "reusable",
            generationRunId: ids.run,
            inputHash: "a".repeat(64),
            resultOutputHash: "b".repeat(64),
            suggestions: [row],
          },
        }],
      },
      {
        rows: [{
          result: {
            kind: "reusable",
            generationRunId: ids.run,
            inputHash: "a".repeat(64),
            resultOutputHash: "b".repeat(64),
            suggestions: [row],
          },
        }],
      },
      { rows: [{ changed: 1 }] },
      { rows: [{ changed: 0 }] },
    );
    const repo = new KeywordReviewSuggestionsRepository(fake.executor);
    await expect(repo.findReusableCompletedBatch(
      scope,
      "a".repeat(64),
    )).resolves.toEqual({
      kind: "reusable",
      generationRunId: ids.run,
      inputHash: "a".repeat(64),
      resultOutputHash: "b".repeat(64),
      suggestions: [row],
    });
    const reuseSql = new PgDialect().sqlToQuery(
      fake.calls.find((call) => call.method === "execute")!.args[0] as never,
    );
    expect(reuseSql.sql).toContain("generation.input_hash");
    expect(reuseSql.sql).toContain("suggestion.status <> 'pending'");
    expect(reuseSql.sql).toContain("sourceOccurrenceIds");
    expect(reuseSql.params).toEqual([
      ids.workspace,
      ids.project,
      "a".repeat(64),
    ]);
    await expect(repo.findCurrentReusableCompletedBatch(scope)).resolves.toEqual({
      kind: "reusable",
      generationRunId: ids.run,
      inputHash: "a".repeat(64),
      resultOutputHash: "b".repeat(64),
      suggestions: [row],
    });
    const currentReuseSql = new PgDialect().sqlToQuery(
      fake.calls.filter((call) => call.method === "execute")[1]!.args[0] as never,
    );
    expect(currentReuseSql.params).toEqual([
      ids.workspace,
      ids.project,
    ]);
    expect(currentReuseSql.sql).toContain("authority_primary_site_id");
    expect(currentReuseSql.sql).toContain("current_decision");
    expect(currentReuseSql.sql).toContain("attempt.status = 'succeeded'");

    await expect(repo.supersedePendingForKeywords(
      scope,
      [ids.keyword],
    )).resolves.toBe(1);
    await expect(repo.supersedeAllPendingForProject(scope)).resolves.toBe(0);
    const executeCalls = fake.calls.filter((call) => call.method === "execute");
    const keywordsSql = new PgDialect().sqlToQuery(
      executeCalls[2]!.args[0] as never,
    );
    expect(keywordsSql.sql).toContain(
      "app.supersede_keyword_review_suggestions_for_keywords",
    );
    expect(keywordsSql.params).toEqual([
      ids.workspace,
      ids.project,
      ids.keyword,
    ]);
    const projectSql = new PgDialect().sqlToQuery(
      executeCalls[3]!.args[0] as never,
    );
    expect(projectSql.sql).toContain(
      "app.supersede_keyword_review_suggestions_for_project",
    );
  });
});
