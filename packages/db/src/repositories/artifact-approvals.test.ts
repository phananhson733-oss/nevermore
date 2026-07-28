import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { contentHash } from "../hash.ts";
import {
  ArtifactApprovalConflictError,
  ArtifactApprovalsRepository,
} from "./artifact-approvals.ts";

interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

class FakeQuery {
  constructor(private readonly owner: FakeExecutor) {}
  private chain(method: string, args: readonly unknown[]): this {
    this.owner.calls.push({ method, args });
    return this;
  }
  from(...args: unknown[]): this { return this.chain("from", args); }
  innerJoin(...args: unknown[]): this { return this.chain("innerJoin", args); }
  where(...args: unknown[]): this { return this.chain("where", args); }
  limit(...args: unknown[]): this { return this.chain("limit", args); }
  for(...args: unknown[]): this { return this.chain("for", args); }
  values(...args: unknown[]): this { return this.chain("values", args); }
  returning(...args: unknown[]): this { return this.chain("returning", args); }
  then<TResult1 = unknown, TResult2 = never>(
    onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.owner.take()).then(onFulfilled, onRejected);
  }
}

class FakeExecutor {
  readonly calls: RecordedCall[] = [];
  private readonly results: unknown[] = [];
  enqueue(...results: unknown[]): void { this.results.push(...results); }
  take(): unknown { return this.results.length > 0 ? this.results.shift() : []; }
  private query(method: string, args: readonly unknown[]): FakeQuery {
    this.calls.push({ method, args });
    return new FakeQuery(this);
  }
  select(...args: unknown[]): FakeQuery { return this.query("select", args); }
  insert(...args: unknown[]): FakeQuery { return this.query("insert", args); }
  last(method: string): RecordedCall {
    const call = this.calls.findLast((candidate) => candidate.method === method);
    if (!call) throw new Error(`No ${method} call`);
    return call;
  }
}

const scope = { workspaceId: "workspace-1", projectId: "project-1" };
const clock = {
  newId: () => "00000000-0000-4000-8000-000000000001",
  now: () => "2026-07-27T09:00:00.000Z",
};
const canonical = {
  artifact_id: "artifact-1",
  artifact_status: "ready",
  artifact_validation_state: "valid",
  artifact_current_revision: 3,
  artifact_content_hash: "a".repeat(64),
  artifact_revision_id: "revision-3",
  artifact_revision: 3,
  revision_content_hash: "a".repeat(64),
};

describe("ArtifactApprovalsRepository", () => {
  it("derives all durable approval facts from the exact current revision", async () => {
    const db = new FakeExecutor();
    const approved = { id: "approval-1", event_kind: "approved" };
    db.enqueue([canonical], [approved]);
    const repo = new ArtifactApprovalsRepository(db as never, clock);
    const qaSnapshot = { verdict: "passed", claims: 8 };

    await expect(
      repo.approveExactRevision({
        ...scope,
        artifactRevisionId: "revision-3",
        expectedArtifactRevision: 3,
        expectedQaGateVersion: "content-shadow.qa.v4",
        actorId: "actor-1",
        qaGate: {
          version: "content-shadow.qa.v4",
          snapshot: qaSnapshot,
        },
        customerAcknowledgementInput: {
          acknowledged: true,
          acknowledgementScope: "exact_artifact_revision_for_publication",
        },
      }),
    ).resolves.toBe(approved);

    expect(db.last("for").args).toEqual(["update"]);
    expect(db.last("values").args[0]).toMatchObject({
      artifact_id: "artifact-1",
      artifact_revision_id: "revision-3",
      artifact_revision: 3,
      artifact_content_hash: "a".repeat(64),
      event_kind: "approved",
      event_actor_id: "actor-1",
      reviewer_actor_id: "actor-1",
      qa_gate_snapshot_hash: contentHash(qaSnapshot),
      customer_acknowledgement: {
        customerAcknowledgementId:
          "00000000-0000-4000-8000-000000000001",
        actorId: "actor-1",
        acknowledgedAt: "2026-07-27T09:00:00.000Z",
        acknowledgementScope: "exact_artifact_revision_for_publication",
      },
    });
  });

  it("fails closed when an old artifact revision is approved", async () => {
    const db = new FakeExecutor();
    db.enqueue([{ ...canonical, artifact_current_revision: 4 }]);
    const repo = new ArtifactApprovalsRepository(db as never, clock);

    await expect(
      repo.approveExactRevision({
        ...scope,
        artifactRevisionId: "revision-3",
        expectedArtifactRevision: 3,
        expectedQaGateVersion: "content-shadow.qa.v4",
        actorId: "actor-1",
        qaGate: {
          version: "content-shadow.qa.v4",
          snapshot: { verdict: "passed" },
        },
        customerAcknowledgementInput: {
          acknowledged: true,
          acknowledgementScope: "exact_artifact_revision_for_publication",
        },
      }),
    ).rejects.toBeInstanceOf(ArtifactApprovalConflictError);
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("terminal events preserve source reviewer lineage and name the real actor", async () => {
    const db = new FakeExecutor();
    const source = {
      id: "approval-1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      artifact_id: "artifact-1",
      artifact_revision_id: "revision-3",
      artifact_revision: 3,
      artifact_content_hash: "a".repeat(64),
      event_kind: "approved",
      event_actor_id: "reviewer-1",
      reviewer_actor_id: "reviewer-1",
      qa_gate_version: "content-shadow.qa.v4",
      qa_gate_snapshot: { verdict: "passed" },
      qa_gate_snapshot_hash: "b".repeat(64),
      customer_acknowledgement: {
        customerAcknowledgementId: "ack-1",
        actorId: "reviewer-1",
        acknowledgedAt: "2026-07-27T08:00:00.000Z",
      },
      customer_acknowledgement_hash: "c".repeat(64),
    };
    const terminal = { id: "revocation-1", event_kind: "revoked" };
    db.enqueue([source], [], [terminal]);
    const repo = new ArtifactApprovalsRepository(db as never, clock);

    await expect(
      repo.invalidateApproval({
        ...scope,
        sourceApprovalEventId: "approval-1",
        eventKind: "revoked",
        actorId: "customer-admin-2",
        reason: "Customer revoked publication approval.",
      }),
    ).resolves.toBe(terminal);

    expect(db.last("values").args[0]).toMatchObject({
      event_kind: "revoked",
      supersedes_approval_event_id: "approval-1",
      supersedes_approval_event_kind: "approved",
      event_actor_id: "customer-admin-2",
      reviewer_actor_id: null,
      artifact_content_hash: "a".repeat(64),
      qa_gate_snapshot_hash: "b".repeat(64),
      customer_acknowledgement_hash: "c".repeat(64),
    });
  });

  it("rejects a second terminal event under the same locked approval", async () => {
    const db = new FakeExecutor();
    db.enqueue([
      {
        ...canonical,
        id: "approval-1",
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        artifact_id: "artifact-1",
        artifact_revision_id: "revision-3",
        artifact_revision: 3,
        artifact_content_hash: "a".repeat(64),
        event_kind: "approved",
        event_actor_id: "reviewer-1",
        reviewer_actor_id: "reviewer-1",
        qa_gate_version: "v1",
        qa_gate_snapshot: {},
        qa_gate_snapshot_hash: "b".repeat(64),
        customer_acknowledgement: {},
        customer_acknowledgement_hash: "c".repeat(64),
      },
    ], [{ id: "terminal-already-exists" }]);
    const repo = new ArtifactApprovalsRepository(db as never, clock);

    await expect(
      repo.invalidateApproval({
        ...scope,
        sourceApprovalEventId: "approval-1",
        eventKind: "superseded",
        actorId: "actor-2",
        reason: "A newer revision has been approved.",
      }),
    ).rejects.toBeInstanceOf(ArtifactApprovalConflictError);
    const predicate = new PgDialect().sqlToQuery(
      db.last("where").args[0] as never,
    );
    expect(predicate.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "approval-1",
      ]),
    );
  });
});
