import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import {
  MAX_TOPIC_CLUSTER_LOOKUP,
  TopicClusterReadRepository,
} from "../repositories/topic-clusters.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

/**
 * `TopicClusterReadRepository` shipped from Task 3 with **no caller anywhere in
 * the product** — `packages/db/src/index.ts` re-exports it and nothing imports
 * it — and no test of any kind. It was invisible to `coverage:unit-gaps` too,
 * until §19.1 declared that report's file universe.
 *
 * That combination is the risk this file addresses. `listSupportingFindings` is
 * a hand-written SQL statement with three left joins, a `distinct`, and five
 * predicates, and **SQL does not typecheck**: a wrong column or a renamed table
 * is caught by nothing until someone wires this up in a later slice. Running it
 * against the migrated schema — even with a scope that matches no rows — makes
 * Postgres parse and plan every identifier in it, which is the assurance no
 * other gate here can give.
 *
 * The guard cases below need no database state either: they are the bounds the
 * repository declares before it ever reaches the executor.
 */
describeDb("TopicClusterReadRepository.listSupportingFindings", () => {
  let handle: DbHandle;
  let repository: TopicClusterReadRepository;
  const scope = { workspaceId: randomUUID(), projectId: randomUUID() };
  const runId = randomUUID();

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL!);
    repository = new TopicClusterReadRepository(handle.db);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("executes against the migrated schema", async () => {
    // The assertion that matters is that this resolves at all. Every column,
    // table and cast in the statement is resolved by Postgres here; an empty
    // result proves the statement is well formed, which is exactly what was
    // unproven while the repository had no caller.
    await expect(
      repository.listSupportingFindings(scope, runId, ["cluster-a"]),
    ).resolves.toEqual([]);
  });

  it("answers an empty key set without querying at all", async () => {
    await expect(
      repository.listSupportingFindings(scope, runId, []),
    ).resolves.toEqual([]);
  });

  it("counts unique keys against the bound, not raw input length", async () => {
    // The repository de-duplicates before bounding, so a caller that repeats
    // one key many times is not refused for a lookup it never asked for.
    const repeated = Array.from(
      { length: MAX_TOPIC_CLUSTER_LOOKUP + 50 },
      () => "cluster-a",
    );
    await expect(
      repository.listSupportingFindings(scope, runId, repeated),
    ).resolves.toEqual([]);
  });

  it("refuses more unique keys than the declared bound", async () => {
    const distinct = Array.from(
      { length: MAX_TOPIC_CLUSTER_LOOKUP + 1 },
      (_unused, index) => `cluster-${index}`,
    );
    await expect(
      repository.listSupportingFindings(scope, runId, distinct),
    ).rejects.toThrow(RangeError);
  });

  it.each([
    ["empty", ""],
    ["untrimmed", " cluster-a"],
    ["trailing space", "cluster-a "],
    ["over the length limit", "c".repeat(201)],
  ])("refuses a %s cluster key", async (_label, key) => {
    await expect(
      repository.listSupportingFindings(scope, runId, [key]),
    ).rejects.toThrow(RangeError);
  });

  it("refuses a blank or oversized run id", async () => {
    await expect(
      repository.listSupportingFindings(scope, "   ", ["cluster-a"]),
    ).rejects.toThrow(RangeError);
    await expect(
      repository.listSupportingFindings(scope, "r".repeat(257), ["cluster-a"]),
    ).rejects.toThrow(RangeError);
  });
});
