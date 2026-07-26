import { describe, expect, it } from "vitest";
import { RULE_OPPORTUNITY_PROJECTION } from "@sf/contracts";
import type { ArtifactDto } from "./artifact-mappers";
import {
  buildExecutionChain,
  type ExecutionChainActionInput,
  type ExecutionChainFindingInput,
} from "./workspace-view";

/**
 * The Execution chain is a join over persisted rows, and its whole value is
 * that it does not invent any of them: it never re-scores priority, never
 * recomputes the Artifact type, and never writes an Action
 * (`workspace-view.ts:452-456`). Two of its outputs are load-bearing beyond
 * the join, and both are asserted here:
 *
 * - one canonical live Action per Finding (spec §9.1) — picking a second one
 *   would show the operator work against a Finding they never confirmed;
 * - `auditRecheckState` — the screen's only signal that the deliverable was
 *   built against a diagnosis that has since moved. Reporting `current` for a
 *   drifted chain is exactly the "we did not look" -> "we found nothing"
 *   substitution this codebase keeps refusing.
 */

const RULE_ID = "TECH-HTTP-001";
const FIXED_TYPE = RULE_OPPORTUNITY_PROJECTION[RULE_ID].artifactType;
const RUN_ID = "run-1";

const finding = (
  over: Partial<ExecutionChainFindingInput> = {},
): ExecutionChainFindingInput => ({
  id: "finding-1",
  ruleId: RULE_ID,
  reviewState: "confirmed",
  regressed: false,
  resolvedAt: null,
  lastSeenRunId: RUN_ID,
  subjectRefs: ["url:/pricing"],
  ...over,
});

const action = (
  over: Partial<ExecutionChainActionInput> = {},
): ExecutionChainActionInput => ({
  id: "action-1",
  findingId: "finding-1",
  status: "planned",
  sourceDiagnosticRunId: RUN_ID,
  ...over,
});

const artifact = (over: Partial<ArtifactDto> = {}): ArtifactDto =>
  ({
    id: "artifact-1",
    actionId: "action-1",
    artifactType: FIXED_TYPE,
    status: "draft",
    generationMode: "assisted",
    outputLocale: "en",
    currentRevision: 2,
    validationState: "valid",
    current: null,
    activeRun: null,
    adoption: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  }) as ArtifactDto;

describe("a chain exists only for a confirmed opportunity Finding with a live Action", () => {
  it("joins the Finding, its Action and its template-fixed Artifact", () => {
    const chains = buildExecutionChain({
      findings: [finding()],
      actions: [action()],
      artifacts: [artifact()],
    });
    expect(chains).toEqual([
      {
        primaryFindingId: "finding-1",
        ruleId: RULE_ID,
        targetRef: "url:/pricing",
        action: { id: "action-1", status: "planned" },
        fixedArtifactType: FIXED_TYPE,
        artifact: { id: "artifact-1", status: "draft", currentRevision: 2 },
        auditRecheckState: "current",
      },
    ]);
  });

  it("omits a Finding nobody confirmed", () => {
    for (const reviewState of ["unreviewed", "needs_more_data", "ignored"]) {
      expect(
        buildExecutionChain({
          findings: [finding({ reviewState })],
          actions: [action()],
          artifacts: [],
        }),
      ).toEqual([]);
    }
  });

  it("omits a rule that has no Opportunity projection at all", () => {
    // Without this guard the chain would have to guess an artifact type.
    expect(
      buildExecutionChain({
        findings: [finding({ ruleId: "NOT-A-RULE-999" })],
        actions: [action()],
        artifacts: [],
      }),
    ).toEqual([]);
  });

  it("omits a confirmed Finding whose only Action was dismissed", () => {
    expect(
      buildExecutionChain({
        findings: [finding()],
        actions: [action({ status: "dismissed" })],
        artifacts: [artifact()],
      }),
    ).toEqual([]);
  });

  it("takes the first live Action and ignores later ones for the same Finding", () => {
    // Spec §9.1: a confirmed Finding owns exactly one canonical Action. If a
    // second one exists the chain must not silently fan out into two rows of
    // work, and must not switch to the second one just because it came later.
    const chains = buildExecutionChain({
      findings: [finding()],
      actions: [
        action({ id: "dismissed-first", status: "dismissed" }),
        action({ id: "canonical" }),
        action({ id: "second-live" }),
      ],
      artifacts: [],
    });
    expect(chains).toHaveLength(1);
    expect(chains[0]?.action.id).toBe("canonical");
  });
});

describe("auditRecheckState reports drift instead of hiding it", () => {
  it("says `resolved` once the Finding carries a resolution", () => {
    expect(
      buildExecutionChain({
        findings: [finding({ resolvedAt: "2026-07-02T00:00:00.000Z" })],
        actions: [action()],
        artifacts: [],
      })[0]?.auditRecheckState,
    ).toBe("resolved");
  });

  it("says `drifted` when the Finding regressed", () => {
    expect(
      buildExecutionChain({
        findings: [finding({ regressed: true })],
        actions: [action()],
        artifacts: [],
      })[0]?.auditRecheckState,
    ).toBe("drifted");
  });

  it("says `drifted` when the Finding was last seen in a newer diagnosis", () => {
    // The Action froze `sourceDiagnosticRunId`; a Finding seen again in a later
    // run means the deliverable was written against evidence that has moved.
    expect(
      buildExecutionChain({
        findings: [finding({ lastSeenRunId: "run-2" })],
        actions: [action({ sourceDiagnosticRunId: RUN_ID })],
        artifacts: [],
      })[0]?.auditRecheckState,
    ).toBe("drifted");
  });

  it("lets resolution win over drift, because resolved is the terminal answer", () => {
    expect(
      buildExecutionChain({
        findings: [
          finding({
            resolvedAt: "2026-07-02T00:00:00.000Z",
            regressed: true,
            lastSeenRunId: "run-9",
          }),
        ],
        actions: [action()],
        artifacts: [],
      })[0]?.auditRecheckState,
    ).toBe("resolved");
  });
});

describe("the Artifact half of the join is never approximated", () => {
  it("reports no artifact rather than one belonging to another Action", () => {
    expect(
      buildExecutionChain({
        findings: [finding()],
        actions: [action()],
        artifacts: [artifact({ actionId: "someone-elses-action" })],
      })[0]?.artifact,
    ).toBeNull();
  });

  it("reports no artifact when the only candidate is of the wrong type", () => {
    // The type is fixed by the rule; accepting a different one would show work
    // that this rule can never produce.
    expect(
      buildExecutionChain({
        findings: [finding()],
        actions: [action()],
        artifacts: [artifact({ artifactType: "content_brief" })],
      })[0]?.artifact,
    ).toBeNull();
  });

  it("does not resurrect an archived artifact", () => {
    expect(
      buildExecutionChain({
        findings: [finding()],
        actions: [action()],
        artifacts: [artifact({ status: "archived" })],
      })[0]?.artifact,
    ).toBeNull();
  });
});

describe("targetRef names something real or names the rule", () => {
  it("uses the first non-empty subject ref", () => {
    expect(
      buildExecutionChain({
        findings: [finding({ subjectRefs: ["", "url:/docs", "url:/blog"] })],
        actions: [action()],
        artifacts: [],
      })[0]?.targetRef,
    ).toBe("url:/docs");
  });

  it("falls back to the rule id rather than to an empty string", () => {
    for (const subjectRefs of [[], [""], ["", ""]]) {
      expect(
        buildExecutionChain({
          findings: [finding({ subjectRefs })],
          actions: [action()],
          artifacts: [],
        })[0]?.targetRef,
      ).toBe(RULE_ID);
    }
  });
});
