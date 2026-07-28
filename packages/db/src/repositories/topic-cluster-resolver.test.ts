import { describe, expect, it } from "vitest";
import { TopicClusterResolverRepository } from "./topic-cluster-resolver.ts";

class FakeQuery {
  constructor(
    private readonly rows: readonly Record<string, unknown>[],
    readonly calls: string[],
  ) {}

  from(): this {
    this.calls.push("from");
    return this;
  }
  innerJoin(): this {
    this.calls.push("innerJoin");
    return this;
  }
  where(): this {
    this.calls.push("where");
    return this;
  }
  limit(): Promise<readonly Record<string, unknown>[]> {
    this.calls.push("limit");
    return Promise.resolve(this.rows);
  }
}

function executor(rows: readonly Record<string, unknown>[]) {
  const calls: string[] = [];
  return {
    calls,
    select: () => {
      calls.push("select");
      return new FakeQuery(rows, calls);
    },
  };
}

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
};
const topicNodeId = "10000000-0000-4000-8000-000000000003";

describe("TopicClusterResolverRepository", () => {
  it("returns an exact v2 reference only from the requested confirmed revision", async () => {
    const exec = executor([{ topic_node_id: topicNodeId }]);
    const repository = new TopicClusterResolverRepository(exec as never);

    await expect(
      repository.resolveAliasAtConfirmedRevision(
        scope,
        "customer-onboarding",
        4,
      ),
    ).resolves.toEqual({
      version: 2,
      topicNodeId,
      topicModelRevision: 4,
      clusterKeyAtObservation: "customer-onboarding",
    });
    expect(exec.calls.filter((call) => call === "innerJoin")).toHaveLength(2);
  });

  it("returns null for an alias unavailable in that confirmed revision", async () => {
    const repository = new TopicClusterResolverRepository(
      executor([]) as never,
    );
    await expect(
      repository.resolveAliasAtConfirmedRevision(
        scope,
        "future-draft-alias",
        3,
      ),
    ).resolves.toBeNull();
  });

  it("fails closed for overlapping authority rows and invalid inputs", async () => {
    const repository = new TopicClusterResolverRepository(
      executor([
        { topic_node_id: topicNodeId },
        { topic_node_id: topicNodeId },
      ]) as never,
    );
    await expect(
      repository.resolveAliasAtConfirmedRevision(scope, "duplicate", 2),
    ).rejects.toThrow(/overlapping/u);
    await expect(
      repository.resolveAliasAtConfirmedRevision(scope, " bad ", 2),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      repository.resolveAliasAtConfirmedRevision(scope, "valid", 0),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
