import { describe, expect, it } from "vitest";
import type { ArtifactDto } from "@/lib/services/artifact-mappers";
import {
  buildExecutionChain,
  type ExecutionChainActionInput,
  type ExecutionChainFindingInput,
} from "@/lib/services/workspace-view";

/**
 * `buildExecutionChain` is the read-only in-memory join that proves the
 * one-Finding -> one-Action -> template-fixed-Artifact single chain on the
 * Execution surface. It never re-scores priority, never writes an Action, and
 * derives the audit-recheck state purely from persisted run lineage.
 */

const NOW = "2026-07-20T00:00:00.000Z";
const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER_RUN = "22222222-2222-4222-8222-222222222222";

function finding(
  overrides: Partial<ExecutionChainFindingInput> = {},
): ExecutionChainFindingInput {
  return {
    id: "finding-http",
    ruleId: "TECH-HTTP-001",
    reviewState: "confirmed",
    regressed: false,
    resolvedAt: null,
    lastSeenRunId: RUN,
    subjectRefs: ["http_status:https://example.test/gone"],
    ...overrides,
  };
}

function action(
  overrides: Partial<ExecutionChainActionInput> = {},
): ExecutionChainActionInput {
  return {
    id: "action-http",
    findingId: "finding-http",
    status: "planned",
    sourceDiagnosticRunId: RUN,
    ...overrides,
  };
}

function artifact(overrides: Partial<ArtifactDto> = {}): ArtifactDto {
  return {
    id: "artifact-http",
    actionId: "action-http",
    artifactType: "technical_ticket",
    status: "draft",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 1,
    validationState: "valid",
    current: null,
    activeRun: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("buildExecutionChain", () => {
  it("projects one confirmed technical chain with its template-fixed artifact", () => {
    const chains = buildExecutionChain({
      findings: [finding()],
      actions: [action()],
      artifacts: [artifact()],
    });

    expect(chains).toHaveLength(1);
    expect(chains[0]).toEqual({
      primaryFindingId: "finding-http",
      ruleId: "TECH-HTTP-001",
      targetRef: "http_status:https://example.test/gone",
      action: { id: "action-http", status: "planned" },
      fixedArtifactType: "technical_ticket",
      artifact: { id: "artifact-http", status: "draft", currentRevision: 1 },
      auditRecheckState: "current",
    });
  });

  it("omits reviewable (not-yet-confirmed) findings", () => {
    const chains = buildExecutionChain({
      findings: [finding({ reviewState: "unreviewed" })],
      actions: [],
      artifacts: [],
    });
    expect(chains).toEqual([]);
  });

  it("omits confirmed findings whose only action is dismissed", () => {
    const chains = buildExecutionChain({
      findings: [finding()],
      actions: [action({ status: "dismissed" })],
      artifacts: [],
    });
    expect(chains).toEqual([]);
  });

  it("exposes the chain even before the artifact is generated", () => {
    const chains = buildExecutionChain({
      findings: [finding()],
      actions: [action()],
      artifacts: [],
    });
    expect(chains).toHaveLength(1);
    expect(chains[0]?.artifact).toBeNull();
    expect(chains[0]?.fixedArtifactType).toBe("technical_ticket");
  });

  it("marks a chain drifted when the finding moved past the action's frozen run", () => {
    const chains = buildExecutionChain({
      findings: [finding({ lastSeenRunId: OTHER_RUN })],
      actions: [action({ sourceDiagnosticRunId: RUN })],
      artifacts: [artifact()],
    });
    expect(chains[0]?.auditRecheckState).toBe("drifted");
  });

  it("marks a regressed finding drifted", () => {
    const chains = buildExecutionChain({
      findings: [finding({ regressed: true })],
      actions: [action()],
      artifacts: [artifact()],
    });
    expect(chains[0]?.auditRecheckState).toBe("drifted");
  });

  it("marks a resolved finding as resolved even while its action persists", () => {
    const chains = buildExecutionChain({
      findings: [finding({ resolvedAt: NOW, lastSeenRunId: OTHER_RUN })],
      actions: [action()],
      artifacts: [artifact()],
    });
    expect(chains[0]?.auditRecheckState).toBe("resolved");
  });

  it("ignores an archived artifact and keeps the artifact slot empty", () => {
    const chains = buildExecutionChain({
      findings: [finding()],
      actions: [action()],
      artifacts: [artifact({ status: "archived" })],
    });
    expect(chains[0]?.artifact).toBeNull();
  });

  it("falls back to the rule id when the finding has no subject refs", () => {
    const chains = buildExecutionChain({
      findings: [finding({ subjectRefs: [] })],
      actions: [action()],
      artifacts: [],
    });
    expect(chains[0]?.targetRef).toBe("TECH-HTTP-001");
  });
});
