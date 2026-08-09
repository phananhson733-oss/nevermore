import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { contentHash } from "../hash.ts";
import {
  TopicModelGenerationRunsRepository,
  type TopicModelGenerationRunRow,
} from "./topic-model-generation-runs.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: RecordedCall[];
  enqueue(...results: unknown[]): void;
} {
  const calls: RecordedCall[] = [];
  const results: unknown[] = [];
  const take = () => (results.length > 0 ? results.shift() : []);
  const query: object = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(take()).then(resolve, reject);
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
        if (property === "execute") {
          return (queryValue: unknown) => {
            calls.push({ method: "execute", args: [queryValue] });
            return Promise.resolve(take());
          };
        }
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
    enqueue: (...values: unknown[]) => results.push(...values),
  };
}

function lastCall(calls: readonly RecordedCall[], method: string): RecordedCall {
  const call = calls.findLast((candidate) => candidate.method === method);
  if (!call) throw new Error(`No ${method} call was recorded`);
  return call;
}

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
};
const runId = "00000000-0000-4000-8000-000000000003";
const parentRunId = "00000000-0000-4000-8000-000000000004";
const resultRevisionId = "00000000-0000-4000-8000-000000000005";
const inputManifest = {
  schemaVersion: "topic-model-generation-input.v1" as const,
  analysisRefreshRunId: parentRunId,
  projectId: scope.projectId,
  market: "US",
  language: "en",
  groups: [
    {
      groupKey: "group-1",
      representativeKeywords: ["topic automation"],
      keywordCount: 1,
      aggregateSearchVolume: 100,
      providerIntentDistribution: {
        informational: 0,
        navigational: 0,
        commercial: 1,
        transactional: 0,
      },
      urls: ["https://example.test/topic-automation"],
    },
  ],
  productProfile: null,
  icp: null,
  keywords: [
    {
      keywordId: "00000000-0000-4000-8000-000000000006",
      expectedGovernanceRevision: 0,
      groupKey: "group-1",
      providerSearchIntent: {
        value: "commercial" as const,
        snapshotId: "00000000-0000-4000-8000-000000000007",
        observationId: "00000000-0000-4000-8000-000000000008",
        observedAt: "2026-08-09T07:00:00.000Z",
      },
    },
  ],
};

const row: TopicModelGenerationRunRow = {
  id: runId,
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  analysis_refresh_run_id: parentRunId,
  generation_version: "topic-model-generation.v1",
  prompt_set_version: "topic-model.prompt.v1",
  input_manifest: inputManifest,
  input_hash: contentHash(inputManifest),
  prompt_input_hash: null,
  result_topic_model_revision_id: null,
  created_at: "2026-08-09T08:00:00.000Z",
};

describe("TopicModelGenerationRunsRepository", () => {
  it("rejects a hash mismatch and non-plain or unbounded manifests before SQL", async () => {
    const fake = fakeExecutor();
    const repository = new TopicModelGenerationRunsRepository(fake.executor);

    await expect(
      repository.insertPlaceholder({
        runId,
        ...scope,
        analysisRefreshRunId: parentRunId,
        generationVersion: row.generation_version,
        promptSetVersion: row.prompt_set_version,
        inputManifest,
        inputHash: "0".repeat(64),
      }),
    ).rejects.toThrow(/hash/i);

    const withHook = structuredClone(inputManifest) as typeof inputManifest & {
      toJSON?: () => unknown;
    };
    Object.defineProperty(withHook, "toJSON", {
      enumerable: false,
      value: () => inputManifest,
    });
    await expect(
      repository.insertPlaceholder({
        runId,
        ...scope,
        analysisRefreshRunId: parentRunId,
        generationVersion: row.generation_version,
        promptSetVersion: row.prompt_set_version,
        inputManifest: withHook,
        inputHash: contentHash(inputManifest),
      }),
    ).rejects.toThrow(/plain JSON|toJSON/i);

    const unbounded = { ...inputManifest, padding: "x".repeat(300_000) };
    await expect(
      repository.insertPlaceholder({
        runId,
        ...scope,
        analysisRefreshRunId: parentRunId,
        generationVersion: row.generation_version,
        promptSetVersion: row.prompt_set_version,
        inputManifest: unbounded,
        inputHash: contentHash(unbounded),
      }),
    ).rejects.toThrow(/bounded/i);
    expect(fake.calls).toEqual([]);
  });

  it("inserts a detached frozen manifest and scopes every read", async () => {
    const fake = fakeExecutor();
    const repository = new TopicModelGenerationRunsRepository(fake.executor);
    fake.enqueue([row], [row], []);

    await expect(
      repository.insertPlaceholder({
        runId,
        ...scope,
        analysisRefreshRunId: parentRunId,
        generationVersion: row.generation_version,
        promptSetVersion: row.prompt_set_version,
        inputManifest,
        inputHash: row.input_hash,
      }),
    ).resolves.toEqual(row);
    expect(lastCall(fake.calls, "values").args[0]).toEqual({
      id: runId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      analysis_refresh_run_id: parentRunId,
      generation_version: row.generation_version,
      prompt_set_version: row.prompt_set_version,
      input_manifest: inputManifest,
      input_hash: row.input_hash,
    });

    await expect(repository.findById(scope, runId)).resolves.toEqual(row);
    await expect(repository.findById(scope, resultRevisionId)).resolves.toBeNull();
    const predicate = new PgDialect().sqlToQuery(
      lastCall(fake.calls, "where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"id" = $3');
  });

  it("fails closed when a stored row no longer matches the shared exact manifest contract", async () => {
    const fake = fakeExecutor();
    const repository = new TopicModelGenerationRunsRepository(fake.executor);
    const malformedManifest = { ...inputManifest, actorId: resultRevisionId };
    fake.enqueue([
      {
        ...row,
        input_manifest: malformedManifest,
        input_hash: contentHash(malformedManifest),
      },
    ]);

    await expect(repository.findById(scope, runId)).rejects.toThrow(
      /invalid Topic Model generation run row/i,
    );
  });

  it("terminalizes only the exact claimed attempt through one database function", async () => {
    const fake = fakeExecutor();
    const repository = new TopicModelGenerationRunsRepository(fake.executor);
    const completed = {
      ...row,
      prompt_input_hash: "b".repeat(64),
      result_topic_model_revision_id: resultRevisionId,
    };
    fake.enqueue({
      rows: [{ result: { kind: "terminalized", run: completed } }],
    });

    await expect(
      repository.terminalize(
        { ...scope, runId, attemptCount: 2 },
        {
          status: "completed",
          resultTopicModelRevisionId: resultRevisionId,
          lastErrorCode: null,
          lastErrorSummary: null,
        },
      ),
    ).resolves.toEqual({ kind: "terminalized", run: completed });

    const compiled = new PgDialect().sqlToQuery(
      lastCall(fake.calls, "execute").args[0] as never,
    );
    expect(compiled.sql).toContain("app.terminalize_topic_model_generation_run");
    expect(compiled.params).toEqual([
      scope.workspaceId,
      scope.projectId,
      runId,
      2,
      "completed",
      resultRevisionId,
      null,
      null,
    ]);
  });
});
