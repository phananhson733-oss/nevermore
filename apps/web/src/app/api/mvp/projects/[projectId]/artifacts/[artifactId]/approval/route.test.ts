import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  assertWorkspaceRateLimit: vi.fn(),
  appendArtifactApprovalEvent: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.getOperatorContext,
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));
vi.mock("@/lib/services/artifact-approval", () => ({
  appendArtifactApprovalEvent: mocks.appendArtifactApprovalEvent,
}));

const { POST } = await import("./route.ts");

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000002",
  project: "10000000-0000-4000-8000-000000000003",
  artifact: "10000000-0000-4000-8000-000000000004",
  revision: "10000000-0000-4000-8000-000000000005",
  approval: "10000000-0000-4000-8000-000000000006",
  acknowledgement: "10000000-0000-4000-8000-000000000007",
} as const;

const contentHash = "a".repeat(64);
const qaHash = "b".repeat(64);
const recordedAt = "2026-07-27T10:00:00.000Z";
const idempotencyKey = "approve-artifact-revision-3";
const params = {
  params: Promise.resolve({
    projectId: ids.project,
    artifactId: ids.artifact,
  }),
};

const approveBody = {
  eventKind: "approved" as const,
  artifactRevisionId: ids.revision,
  expectedArtifactRevision: 3,
  expectedQaGateVersion: "artifact-validation.1",
  customerAcknowledgementInput: {
    acknowledged: true as const,
    acknowledgementScope:
      "exact_artifact_revision_for_publication" as const,
  },
};

const approvedEvent = {
  approvalEventId: ids.approval,
  eventKind: "approved" as const,
  supersedesApprovalEventId: null,
  eventActorId: ids.actor,
  artifactId: ids.artifact,
  artifactRevisionId: ids.revision,
  artifactRevision: 3,
  artifactContentHash: contentHash,
  reviewerActorId: ids.actor,
  qaGateVersion: "artifact-validation.1",
  qaGateSnapshot: {
    authority: "artifact_revision_validation",
    validationState: "valid",
  },
  qaGateSnapshotHash: qaHash,
  customerAcknowledgement: {
    customerAcknowledgementId: ids.acknowledgement,
    actorId: ids.actor,
    acknowledgedAt: recordedAt,
    acknowledgementScope:
      "exact_artifact_revision_for_publication" as const,
  },
  reason: null,
  recordedAt,
};

function request(
  body: unknown,
  options: {
    idempotencyKey?: string | null;
    origin?: string;
  } = {},
): NextRequest {
  const key =
    options.idempotencyKey === undefined
      ? idempotencyKey
      : options.idempotencyKey;
  return new NextRequest(
    `http://localhost/api/mvp/projects/${ids.project}/artifacts/${ids.artifact}/approval`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: options.origin ?? "http://localhost",
        "X-Request-Id": "request-artifact-approval",
        ...(key === null ? {} : { "Idempotency-Key": key }),
      },
      body: JSON.stringify(body),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.getOperatorContext.mockResolvedValue({
    userId: ids.actor,
    workspaceId: ids.workspace,
  });
  mocks.appendArtifactApprovalEvent.mockResolvedValue(approvedEvent);
});

// The first test must not depend on afterEach having run.
mocks.getOperatorContext.mockResolvedValue({
  userId: ids.actor,
  workspaceId: ids.workspace,
});
mocks.appendArtifactApprovalEvent.mockResolvedValue(approvedEvent);

describe("POST artifact approval event", () => {
  it("returns the server-authored event as a 201 customer receipt", async () => {
    const response = await POST(request(approveBody), params);

    expect(response.status).toBe(201);
    expect(response.headers.get("X-Request-Id")).toBe(
      "request-artifact-approval",
    );
    await expect(response.json()).resolves.toEqual({ data: approvedEvent });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      ids.workspace,
      {
        idempotencyKey,
        scope: "artifact_approval",
        maxAttempts: 60,
        windowMs: 15 * 60 * 1000,
      },
    );
    expect(mocks.appendArtifactApprovalEvent).toHaveBeenCalledWith(
      { workspaceId: ids.workspace },
      ids.project,
      ids.artifact,
      ids.actor,
      idempotencyKey,
      approveBody,
    );
  });

  it.each(["revoked", "superseded"] as const)(
    "passes a %s command without accepting a browser-authored reviewer or timestamp",
    async (eventKind) => {
      const event = {
        ...approvedEvent,
        approvalEventId:
          eventKind === "revoked"
            ? "10000000-0000-4000-8000-000000000008"
            : "10000000-0000-4000-8000-000000000009",
        eventKind,
        supersedesApprovalEventId: ids.approval,
        eventActorId: ids.actor,
        reviewerActorId: null,
        reason: "Customer withdrew publication approval.",
      };
      mocks.appendArtifactApprovalEvent.mockResolvedValueOnce(event);
      const body = {
        eventKind,
        supersedesApprovalEventId: ids.approval,
        reason: "Customer withdrew publication approval.",
      };

      const response = await POST(request(body), params);

      expect(response.status).toBe(201);
      expect(mocks.appendArtifactApprovalEvent).toHaveBeenCalledWith(
        { workspaceId: ids.workspace },
        ids.project,
        ids.artifact,
        ids.actor,
        idempotencyKey,
        body,
      );
    },
  );

  it.each([
    ["eventActorId", ids.actor],
    ["reviewerActorId", ids.actor],
    ["artifactContentHash", contentHash],
    ["qaGateSnapshot", { verdict: "passed" }],
    ["acknowledgedAt", recordedAt],
  ])(
    "rejects browser-authored server fact %s before reaching the service",
    async (field, value) => {
      const response = await POST(
        request({ ...approveBody, [field]: value }),
        params,
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
      });
      expect(mocks.appendArtifactApprovalEvent).not.toHaveBeenCalled();
    },
  );

  it("requires the exact publication acknowledgement literal", async () => {
    const response = await POST(
      request({
        ...approveBody,
        customerAcknowledgementInput: {
          acknowledged: false,
          acknowledgementScope:
            "exact_artifact_revision_for_publication",
        },
      }),
      params,
    );

    expect(response.status).toBe(422);
    expect(mocks.appendArtifactApprovalEvent).not.toHaveBeenCalled();
  });

  it("rejects acknowledgement ids, actors, and timestamps authored by the browser", async () => {
    const response = await POST(
      request({
        ...approveBody,
        customerAcknowledgementInput: {
          ...approveBody.customerAcknowledgementInput,
          customerAcknowledgementId: ids.acknowledgement,
          actorId: ids.actor,
          acknowledgedAt: recordedAt,
        },
      }),
      params,
    );

    expect(response.status).toBe(422);
    expect(mocks.appendArtifactApprovalEvent).not.toHaveBeenCalled();
  });

  it("requires a valid Idempotency-Key before rate limiting or writing", async () => {
    const response = await POST(
      request(approveBody, { idempotencyKey: null }),
      params,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.appendArtifactApprovalEvent).not.toHaveBeenCalled();
  });

  it("treats malformed project and artifact path identities as absent", async () => {
    const response = await POST(request(approveBody), {
      params: Promise.resolve({
        projectId: "not-a-project",
        artifactId: ids.artifact,
      }),
    });
    expect(response.status).toBe(404);
    expect(mocks.appendArtifactApprovalEvent).not.toHaveBeenCalled();

    const artifactResponse = await POST(request(approveBody), {
      params: Promise.resolve({
        projectId: ids.project,
        artifactId: "not-an-artifact",
      }),
    });
    expect(artifactResponse.status).toBe(404);
    expect(mocks.appendArtifactApprovalEvent).not.toHaveBeenCalled();
  });

  it("requires an authenticated reviewer", async () => {
    mocks.getOperatorContext.mockResolvedValueOnce(null);

    const response = await POST(request(approveBody), params);

    expect(response.status).toBe(401);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.appendArtifactApprovalEvent).not.toHaveBeenCalled();
  });

  it("does not write when the workspace approval budget is exhausted", async () => {
    const error = Object.assign(
      new Error("rate limit"),
      { code: "RATE_LIMITED", status: 429 },
    );
    // The route wrapper only maps the product ProblemError class. Import it
    // here instead of teaching the test a second error-shape convention.
    const { ProblemError } = await import("@sf/observability");
    mocks.assertWorkspaceRateLimit.mockRejectedValueOnce(
      new ProblemError("RATE_LIMITED", error.message),
    );

    const response = await POST(request(approveBody), params);

    expect(response.status).toBe(429);
    expect(mocks.appendArtifactApprovalEvent).not.toHaveBeenCalled();
  });
});
