import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { contentHash } from "../hash.ts";
import { ProductProfileRunsRepository } from "./product-profile-runs.ts";

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

function lastCall(
  calls: readonly RecordedCall[],
  method: string,
): RecordedCall {
  const call = calls.findLast((candidate) => candidate.method === method);
  if (!call) throw new Error(`No ${method} call was recorded`);
  return call;
}

const scope = { workspaceId: "workspace-1", projectId: "project-1" };
const inputManifest = {
  schemaVersion: "product-profile-synthesis-input.0.3.0",
  selectionPolicyVersion: "product-profile-page-selection.0.3.0",
  projectId: "00000000-0000-4000-8000-000000000001",
  siteId: "00000000-0000-4000-8000-000000000002",
  sourcePageUrl: "https://relayops.com/product",
  baseProfile: {
    id: "00000000-0000-4000-8000-000000000003",
    version: 1,
    contentHash: "a".repeat(64),
    status: "draft",
  },
  crawlSnapshot: {
    id: "00000000-0000-4000-8000-000000000004",
    collectionRunId: "00000000-0000-4000-8000-000000000005",
    sourceConnectionId: "00000000-0000-4000-8000-000000000006",
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.3.0",
    methodVersion: "crawl.site_graph.v2",
    capturedAt: "2026-07-22T08:00:00.000Z",
    checksum: "b".repeat(64),
    availability: "available",
    rowCount: 1,
    limitation: "Bounded crawl source.",
  },
  pages: [
    {
      pageSnapshotId: "00000000-0000-4000-8000-000000000007",
      sitePageId: "00000000-0000-4000-8000-000000000008",
      dataSnapshotId: "00000000-0000-4000-8000-000000000004",
      normalizedUrl: "https://relayops.com/product",
      normalizedUrlHash: "c".repeat(64),
      contentHash: "d".repeat(64),
      capturedAt: "2026-07-22T08:00:00.000Z",
    },
  ],
};

describe("ProductProfileRunsRepository", () => {
  it("rejects a caller hash mismatch before touching PostgreSQL", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileRunsRepository(fake.executor);

    await expect(
      repository.insertPlaceholder({
        runId: "run-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        baseIcpProfileId: "profile-1",
        baseIcpProfileVersion: 1,
        baseIcpProfileContentHash: "a".repeat(64),
        sourceSnapshotId: "snapshot-1",
        synthesisVersion: "product-profile-synthesis.0.3.0",
        promptSetVersion: "product-profile-prompts.0.3.0",
        inputManifest,
        inputHash: "0".repeat(64),
      }),
    ).rejects.toThrow(/input hash does not match its frozen manifest/i);
    expect(fake.calls).toEqual([]);
  });

  it.each([
    ["stale schema", { ...inputManifest, schemaVersion: "product-profile-input.0.3.0" }],
    [
      "missing selection policy",
      Object.fromEntries(
        Object.entries(inputManifest).filter(
          ([key]) => key !== "selectionPolicyVersion",
        ),
      ),
    ],
    [
      "missing source URL",
      Object.fromEntries(
        Object.entries(inputManifest).filter(([key]) => key !== "sourcePageUrl"),
      ),
    ],
    ["zero pages", { ...inputManifest, pages: [] }],
  ])("rejects a %s manifest before touching PostgreSQL", async (_label, invalid) => {
    const fake = fakeExecutor();
    const repository = new ProductProfileRunsRepository(fake.executor);

    await expect(
      repository.insertPlaceholder({
        runId: "run-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        baseIcpProfileId: "profile-1",
        baseIcpProfileVersion: 1,
        baseIcpProfileContentHash: "a".repeat(64),
        sourceSnapshotId: "snapshot-1",
        synthesisVersion: "product-profile-synthesis.0.3.0",
        promptSetVersion: "product-profile-prompts.0.3.0",
        inputManifest: invalid,
        inputHash: contentHash(invalid),
      }),
    ).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it("inserts the exact frozen manifest and exposes only project-scoped reads", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileRunsRepository(fake.executor);
    const inputHash = contentHash(inputManifest);
    const row = {
      id: "run-1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      base_icp_profile_id: "profile-1",
      base_icp_profile_version: 1,
      base_icp_profile_content_hash: "a".repeat(64),
      source_snapshot_id: "snapshot-1",
      synthesis_version: "product-profile-synthesis.0.3.0",
      prompt_set_version: "product-profile-prompts.0.3.0",
      input_manifest: inputManifest,
      input_hash: inputHash,
      prompt_input_hash: null,
      result_icp_profile_id: null,
      created_at: "2026-07-22T08:00:00.000Z",
    };
    fake.enqueue([row], [row], []);

    await expect(
      repository.insertPlaceholder({
        runId: row.id,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        siteId: row.site_id,
        baseIcpProfileId: row.base_icp_profile_id,
        baseIcpProfileVersion: row.base_icp_profile_version,
        baseIcpProfileContentHash: row.base_icp_profile_content_hash,
        sourceSnapshotId: row.source_snapshot_id,
        synthesisVersion: row.synthesis_version,
        promptSetVersion: row.prompt_set_version,
        inputManifest,
        inputHash,
      }),
    ).resolves.toEqual(row);
    expect(lastCall(fake.calls, "values").args[0]).toEqual({
      id: row.id,
      workspace_id: row.workspace_id,
      project_id: row.project_id,
      site_id: row.site_id,
      base_icp_profile_id: row.base_icp_profile_id,
      base_icp_profile_version: row.base_icp_profile_version,
      base_icp_profile_content_hash: row.base_icp_profile_content_hash,
      source_snapshot_id: row.source_snapshot_id,
      synthesis_version: row.synthesis_version,
      prompt_set_version: row.prompt_set_version,
      input_manifest: inputManifest,
      input_hash: inputHash,
    });

    await expect(repository.findById(scope, row.id)).resolves.toEqual(row);
    await expect(repository.findById(scope, "missing")).resolves.toBeNull();
    const predicate = new PgDialect().sqlToQuery(
      lastCall(fake.calls, "where").args[0] as never,
    );
    expect(predicate.sql).toContain('"workspace_id" = $1');
    expect(predicate.sql).toContain('"project_id" = $2');
    expect(predicate.sql).toContain('"id" = $3');
  });

  it("rejects caller toJSON tricks before touching PostgreSQL", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileRunsRepository(fake.executor);
    const callerManifest = structuredClone(inputManifest) as typeof inputManifest & {
      toJSON?: () => unknown;
    };
    Object.defineProperty(callerManifest, "toJSON", {
      enumerable: false,
      value: () => ({ schemaVersion: "malicious" }),
    });
    await expect(
      repository.insertPlaceholder({
        runId: "run-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        baseIcpProfileId: "profile-1",
        baseIcpProfileVersion: 1,
        baseIcpProfileContentHash: "a".repeat(64),
        sourceSnapshotId: "snapshot-1",
        synthesisVersion: "product-profile-synthesis.0.3.0",
        promptSetVersion: "product-profile-prompts.0.3.0",
        inputManifest: callerManifest,
        inputHash: contentHash(inputManifest),
      }),
    ).rejects.toThrow(/plain JSON|toJSON/i);
    expect(fake.calls).toEqual([]);
  });

  it("rejects Proxy mutation tricks before touching PostgreSQL", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileRunsRepository(fake.executor);
    const proxiedManifest = new Proxy(structuredClone(inputManifest), {});

    await expect(
      repository.insertPlaceholder({
        runId: "run-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        baseIcpProfileId: "profile-1",
        baseIcpProfileVersion: 1,
        baseIcpProfileContentHash: "a".repeat(64),
        sourceSnapshotId: "snapshot-1",
        synthesisVersion: "product-profile-synthesis.0.3.0",
        promptSetVersion: "product-profile-prompts.0.3.0",
        inputManifest: proxiedManifest,
        inputHash: contentHash(inputManifest),
      }),
    ).rejects.toThrow(/stable plain JSON/i);
    expect(fake.calls).toEqual([]);
  });

  it("persists a detached canonical manifest before yielding", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileRunsRepository(fake.executor);
    const callerManifest = structuredClone(inputManifest);
    const inputHash = contentHash(inputManifest);
    fake.enqueue([{ input_manifest: inputManifest }]);

    const pending = repository.insertPlaceholder({
      runId: "run-1",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId: "site-1",
      baseIcpProfileId: "profile-1",
      baseIcpProfileVersion: 1,
      baseIcpProfileContentHash: "a".repeat(64),
      sourceSnapshotId: "snapshot-1",
      synthesisVersion: "product-profile-synthesis.0.3.0",
      promptSetVersion: "product-profile-prompts.0.3.0",
      inputManifest: callerManifest,
      inputHash,
    });
    callerManifest.pages[0]!.normalizedUrl = "https://relayops.com/mutated";
    await pending;

    const persistedManifest = (
      lastCall(fake.calls, "values").args[0] as {
        input_manifest: typeof inputManifest;
      }
    ).input_manifest;
    expect(persistedManifest).toEqual(inputManifest);
    expect(persistedManifest).not.toBe(callerManifest);
    expect(persistedManifest.pages[0]).not.toBe(callerManifest.pages[0]);
  });

  it("hashes and persists the parsed canonical object rather than the caller shape", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileRunsRepository(fake.executor);
    const callerManifest = {
      ...structuredClone(inputManifest),
      crawlSnapshot: {
        ...structuredClone(inputManifest.crawlSnapshot),
        schemaVersion: "  0.3.0  ",
      },
    };
    const parsedHash = contentHash(inputManifest);
    expect(contentHash(callerManifest)).not.toBe(parsedHash);
    fake.enqueue([{ input_manifest: inputManifest, input_hash: parsedHash }]);

    await repository.insertPlaceholder({
      runId: "run-1",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId: "site-1",
      baseIcpProfileId: "profile-1",
      baseIcpProfileVersion: 1,
      baseIcpProfileContentHash: "a".repeat(64),
      sourceSnapshotId: "snapshot-1",
      synthesisVersion: "product-profile-synthesis.0.3.0",
      promptSetVersion: "product-profile-prompts.0.3.0",
      inputManifest: callerManifest,
      inputHash: parsedHash,
    });

    expect(
      (
        lastCall(fake.calls, "values").args[0] as {
          input_manifest: typeof inputManifest;
        }
      ).input_manifest,
    ).toEqual(inputManifest);
  });

  it("binds one prompt-input hash idempotently without changing the manifest hash", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileRunsRepository(fake.executor);
    fake.enqueue([{ id: "run-1" }], [{ id: "run-1" }], []);

    await expect(
      repository.setPromptInputHash(scope, "run-1", "e".repeat(64)),
    ).resolves.toBe(true);
    expect(lastCall(fake.calls, "set").args[0]).toEqual({
      prompt_input_hash: "e".repeat(64),
    });
    expect(
      new PgDialect().sqlToQuery(lastCall(fake.calls, "where").args[0] as never)
        .sql,
    ).toContain('"prompt_input_hash" is null');

    await expect(
      repository.setPromptInputHash(scope, "run-1", "e".repeat(64)),
    ).resolves.toBe(true);
    await expect(
      repository.setPromptInputHash(scope, "run-1", "f".repeat(64)),
    ).resolves.toBe(false);
  });

  it("sets a project-scoped result only while the pointer is null", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileRunsRepository(fake.executor);
    fake.enqueue([{ id: "run-1" }], []);

    await expect(
      repository.setResult(scope, "run-1", "profile-2"),
    ).resolves.toBe(true);
    expect(lastCall(fake.calls, "set").args[0]).toEqual({
      result_icp_profile_id: "profile-2",
    });
    const firstPredicate = new PgDialect().sqlToQuery(
      lastCall(fake.calls, "where").args[0] as never,
    );
    expect(firstPredicate.sql).toContain('"workspace_id" = $1');
    expect(firstPredicate.sql).toContain('"project_id" = $2');
    expect(firstPredicate.sql).toContain('"id" = $3');
    expect(firstPredicate.sql).toContain('"result_icp_profile_id" is null');

    await expect(
      repository.setResult(scope, "run-1", "profile-3"),
    ).resolves.toBe(false);
  });
});
