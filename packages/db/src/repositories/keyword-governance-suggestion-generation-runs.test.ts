import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { contentHash } from "../hash.ts";
import {
  KeywordGovernanceSuggestionGenerationRunsRepository,
  type KeywordGovernanceSuggestionGenerationRunRow,
} from "./keyword-governance-suggestion-generation-runs.ts";

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
  workspace: "51000000-0000-4000-8000-000000000001",
  project: "51000000-0000-4000-8000-000000000002",
  run: "51000000-0000-4000-8000-000000000003",
  profile: "51000000-0000-4000-8000-000000000004",
  topicRevision: "51000000-0000-4000-8000-000000000005",
  keyword: "51000000-0000-4000-8000-000000000006",
  occurrence: "51000000-0000-4000-8000-000000000007",
} as const;

const manifest = {
  schemaVersion: "keyword-governance-suggestion-input.v1" as const,
  generationVersion: "keyword-governance-suggestion-generation.v1" as const,
  promptSetVersion: "keyword-governance-suggestion.prompt.v1" as const,
  workspaceId: ids.workspace,
  projectId: ids.project,
  marketCode: "US",
  languageTag: "en-US",
  confirmedProductProfile: {
    productProfileId: ids.profile,
    version: 1,
    contentHash: "a".repeat(64),
    facts: {
      productName: "RelayOps",
      category: "Automation",
      valueProposition: "Turn signals into action.",
      targetAudience: "B2B product teams",
      buyerRoles: [],
      pains: [],
      outcomes: [],
    },
  },
  confirmedTopicModel: {
    topicModelRevisionId: ids.topicRevision,
    revision: 1,
    contentHash: "b".repeat(64),
  },
  topicAllowlist: [],
  pageAllowlist: [],
  candidates: [{
    ordinal: 1,
    keywordKey: "keyword-1",
    keywordId: ids.keyword,
    queryKind: "search_query" as const,
    expectedGovernanceRevision: 0,
    displayKeyword: "product automation",
    normalizedKeyword: "product automation",
    deterministicEvidence: {
      sourceOccurrenceIds: [ids.occurrence],
      providerSearchIntent: null,
      currentTopicKey: null,
      currentPageKey: null,
    },
  }],
};
const row: KeywordGovernanceSuggestionGenerationRunRow = {
  id: ids.run,
  workspace_id: ids.workspace,
  project_id: ids.project,
  generation_version: "keyword-governance-suggestion-generation.v1",
  prompt_set_version: "keyword-governance-suggestion.prompt.v1",
  input_manifest: manifest,
  input_hash: contentHash(manifest),
  prompt_input_hash: null,
  result_output_hash: null,
  created_at: "2026-08-10T01:00:00.000Z",
};

describe("KeywordGovernanceSuggestionGenerationRunsRepository", () => {
  it("rejects hash/scope drift and non-plain input before SQL", async () => {
    const fake = fakeExecutor();
    const repo = new KeywordGovernanceSuggestionGenerationRunsRepository(
      fake.executor,
    );
    await expect(repo.insertPlaceholder({
      runId: ids.run,
      workspaceId: ids.workspace,
      projectId: ids.project,
      inputManifest: manifest,
      inputHash: "0".repeat(64),
    })).rejects.toThrow(/hash scope mismatch/u);
    const hooked = structuredClone(manifest) as typeof manifest & {
      toJSON?: () => unknown;
    };
    Object.defineProperty(hooked, "toJSON", {
      enumerable: false,
      value: () => manifest,
    });
    await expect(repo.insertPlaceholder({
      runId: ids.run,
      workspaceId: ids.workspace,
      projectId: ids.project,
      inputManifest: hooked,
      inputHash: row.input_hash,
    })).rejects.toThrow(/plain JSON/u);
    expect(fake.calls).toEqual([]);
  });

  it("persists the exact manifest/hash and scopes reads", async () => {
    const fake = fakeExecutor();
    const repo = new KeywordGovernanceSuggestionGenerationRunsRepository(
      fake.executor,
    );
    fake.enqueue([row], [row]);
    await expect(repo.insertPlaceholder({
      runId: ids.run,
      workspaceId: ids.workspace,
      projectId: ids.project,
      inputManifest: manifest,
      inputHash: row.input_hash,
    })).resolves.toEqual(row);
    expect(last(fake.calls, "values").args[0]).toEqual({
      id: ids.run,
      workspace_id: ids.workspace,
      project_id: ids.project,
      generation_version: manifest.generationVersion,
      prompt_set_version: manifest.promptSetVersion,
      input_manifest: manifest,
      input_hash: row.input_hash,
    });
    await expect(repo.findById({
      workspaceId: ids.workspace,
      projectId: ids.project,
    }, ids.run)).resolves.toEqual(row);
    const compiled = new PgDialect().sqlToQuery(
      last(fake.calls, "where").args[0] as never,
    );
    expect(compiled.params).toEqual([ids.workspace, ids.project, ids.run]);
  });

  it("reads the bounded freezer authority once and looks up exact input hashes", async () => {
    const fake = fakeExecutor();
    const repo = new KeywordGovernanceSuggestionGenerationRunsRepository(
      fake.executor,
    );
    fake.enqueue({ rows: [] }, [row]);
    await expect(repo.readFreezeAuthority({
      workspaceId: ids.workspace,
      projectId: ids.project,
    }, {
      marketCode: "US",
      languageTag: "en-US",
    })).resolves.toEqual({ kind: "unavailable" });
    const freezerSql = new PgDialect().sqlToQuery(
      last(fake.calls, "execute").args[0] as never,
    );
    expect(freezerSql.sql).toContain("limit 101");
    expect(freezerSql.sql).toContain(
      "app.current_keyword_governance_suggestion_occurrence_ids",
    );
    expect(freezerSql.sql).toContain("pending.status = 'pending'");
    expect(freezerSql.sql).toContain(
      "keyword.normalized_keyword, keyword.display_keyword, keyword.id",
    );
    expect(freezerSql.params).toEqual([
      ids.workspace,
      ids.project,
      "US",
      "en-US",
    ]);

    await expect(repo.findLatestByInputHash({
      workspaceId: ids.workspace,
      projectId: ids.project,
    }, row.input_hash)).resolves.toEqual(row);
    const whereCalls = fake.calls.filter((call) => call.method === "where");
    const hashSql = new PgDialect().sqlToQuery(
      whereCalls.at(-1)!.args[0] as never,
    );
    expect(hashSql.params).toEqual([
      ids.workspace,
      ids.project,
      row.input_hash,
    ]);
    expect(fake.calls.filter((call) => call.method === "execute")).toHaveLength(1);
  });

  it("terminalizes only through the attempt-fenced database routine", async () => {
    const terminal = { ...row, result_output_hash: "c".repeat(64) };
    const fake = fakeExecutor();
    fake.enqueue({ rows: [{ result: { kind: "terminalized", run: terminal } }] });
    const repo = new KeywordGovernanceSuggestionGenerationRunsRepository(
      fake.executor,
    );
    await expect(repo.terminalize({
      workspaceId: ids.workspace,
      projectId: ids.project,
      runId: ids.run,
      attemptCount: 1,
    }, {
      status: "completed",
      resultOutputHash: terminal.result_output_hash,
      lastErrorCode: null,
      lastErrorSummary: null,
    })).resolves.toEqual({ kind: "terminalized", run: terminal });
    const compiled = new PgDialect().sqlToQuery(
      last(fake.calls, "execute").args[0] as never,
    );
    expect(compiled.sql).toContain(
      "app.terminalize_keyword_governance_suggestion_generation_run",
    );
    expect(compiled.params).toEqual([
      ids.workspace,
      ids.project,
      ids.run,
      1,
      "completed",
      "c".repeat(64),
      null,
      null,
    ]);
  });

  it("projects one exact active generation for a scoped Keyword", async () => {
    const fake = fakeExecutor();
    fake.enqueue({
      rows: [{
        ...row,
        async_status: "queued",
        safe_terminal_code: null,
        frozen_candidate: manifest.candidates[0],
        authority_current: true,
        has_suggestion: false,
        active_generation_count: 1,
      }],
    });
    const repo = new KeywordGovernanceSuggestionGenerationRunsRepository(
      fake.executor,
    );
    await expect(repo.findCurrentGenerationForKeyword({
      workspaceId: ids.workspace,
      projectId: ids.project,
    }, ids.keyword)).resolves.toEqual({
      suggestionId: ids.run,
      generationRunId: ids.run,
      keywordId: ids.keyword,
      expectedGovernanceRevision: 0,
      createdAt: row.created_at,
      status: "queued",
      safeTerminalCode: null,
      authorityCurrent: true,
      hasSuggestion: false,
    });
    const compiled = new PgDialect().sqlToQuery(
      last(fake.calls, "execute").args[0] as never,
    );
    expect(compiled.sql).toContain(
      "app.current_keyword_governance_suggestion_occurrence_ids",
    );
    expect(compiled.sql).toContain("active_generation_count");
    expect(compiled.sql).not.toContain("last_error_summary");
    expect(compiled.params).toContain(ids.workspace);
    expect(compiled.params).toContain(ids.project);
    expect(compiled.params).toContain(ids.keyword);
  });

  it("projects only safe latest terminal state and fails closed on duplicate active runs", async () => {
    const fake = fakeExecutor();
    fake.enqueue(
      {
        rows: [{
          ...row,
          async_status: "cancelled",
          safe_terminal_code:
            "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
          frozen_candidate: manifest.candidates[0],
          authority_current: false,
          has_suggestion: false,
          active_generation_count: 0,
        }],
      },
      {
        rows: [{
          ...row,
          async_status: "queued",
          safe_terminal_code: null,
          frozen_candidate: manifest.candidates[0],
          authority_current: true,
          has_suggestion: false,
          active_generation_count: 2,
        }],
      },
      { rows: [] },
    );
    const repo = new KeywordGovernanceSuggestionGenerationRunsRepository(
      fake.executor,
    );
    await expect(repo.findLatestGenerationForKeyword({
      workspaceId: ids.workspace,
      projectId: ids.project,
    }, ids.keyword)).resolves.toEqual({
      suggestionId: ids.run,
      generationRunId: ids.run,
      keywordId: ids.keyword,
      expectedGovernanceRevision: 0,
      createdAt: row.created_at,
      status: "cancelled",
      safeTerminalCode:
        "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
      authorityCurrent: false,
      hasSuggestion: false,
    });
    await expect(repo.findLatestGenerationForKeyword({
      workspaceId: ids.workspace,
      projectId: ids.project,
    }, ids.keyword)).rejects.toThrow(/multiple active/u);
    await expect(repo.findLatestGenerationForKeyword({
      workspaceId: ids.workspace,
      projectId: ids.project,
    }, ids.keyword)).resolves.toBeNull();
  });
});
