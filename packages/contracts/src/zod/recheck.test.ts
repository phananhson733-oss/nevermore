import { describe, expect, it } from "vitest";
import {
  ActionRecheckResultsResponse,
  CreateActionRecheckRequest,
  RecheckComparisonState,
  RecheckDisposition,
  RecheckRuleStatus,
  RecheckTargetKind,
} from "./recheck.ts";

const actionId = "00000000-0000-4000-8000-000000000001";
const priorRunId = "00000000-0000-4000-8000-000000000002";
const currentRunId = "00000000-0000-4000-8000-000000000003";

const validRequest = {
  actionId,
  priorRunId,
  targetScope: { kind: "http_status", ref: "404" },
  capabilityContractVersion: "growth-audit.0.3.0",
} as const;

const validResponse = {
  priorRunId,
  currentRunId,
  priorObservedAt: "2026-07-24T00:00:00.000Z",
  currentObservedAt: "2026-07-24T01:00:00.000Z",
  rules: [
    {
      ruleId: "TECH-HTTP-001",
      ruleVersion: 2,
      priorStatus: "candidate",
      currentStatus: "pass",
      state: "verified",
      disposition: "resolved",
      label: "Technical condition verified",
    },
  ],
  limitations: [],
} as const;

describe("CreateActionRecheckRequest", () => {
  it("accepts a fully specified recheck command", () => {
    expect(CreateActionRecheckRequest.parse(validRequest)).toEqual(validRequest);
  });

  it("rejects a missing priorRunId", () => {
    const { priorRunId: _omit, ...rest } = validRequest;
    expect(CreateActionRecheckRequest.safeParse(rest).success).toBe(false);
  });

  it("rejects a missing actionId", () => {
    const { actionId: _omit, ...rest } = validRequest;
    expect(CreateActionRecheckRequest.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-UUID actionId", () => {
    expect(
      CreateActionRecheckRequest.safeParse({
        ...validRequest,
        actionId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("rejects an older capability contract version", () => {
    expect(
      CreateActionRecheckRequest.safeParse({
        ...validRequest,
        capabilityContractVersion: "growth-audit.0.2.0",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown target scope kind", () => {
    expect(
      CreateActionRecheckRequest.safeParse({
        ...validRequest,
        targetScope: { kind: "topic", ref: "x" },
      }).success,
    ).toBe(false);
  });

  it("rejects an empty target scope reference", () => {
    expect(
      CreateActionRecheckRequest.safeParse({
        ...validRequest,
        targetScope: { kind: "url", ref: "" },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    expect(
      CreateActionRecheckRequest.safeParse({
        ...validRequest,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("ActionRecheckResultsResponse", () => {
  it("accepts a resolved technical comparison", () => {
    expect(ActionRecheckResultsResponse.parse(validResponse)).toEqual(
      validResponse,
    );
  });

  it("accepts an observed (unchanged) comparison", () => {
    const observed = {
      ...validResponse,
      rules: [
        {
          ...validResponse.rules[0],
          currentStatus: "candidate",
          state: "observed",
          disposition: "unchanged",
        },
      ],
    };
    expect(ActionRecheckResultsResponse.safeParse(observed).success).toBe(true);
  });

  it("accepts an insufficient_data comparison", () => {
    const insufficient = {
      ...validResponse,
      rules: [
        {
          ...validResponse.rules[0],
          currentStatus: "skipped",
          state: "insufficient_data",
          disposition: "unknown",
        },
      ],
    };
    expect(ActionRecheckResultsResponse.safeParse(insufficient).success).toBe(
      true,
    );
  });

  it("rejects a non-RFC3339 timestamp", () => {
    expect(
      ActionRecheckResultsResponse.safeParse({
        ...validResponse,
        currentObservedAt: "2026-07-24 01:00:00",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown comparison state", () => {
    expect(
      ActionRecheckResultsResponse.safeParse({
        ...validResponse,
        rules: [{ ...validResponse.rules[0], state: "regressed" }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    expect(
      ActionRecheckResultsResponse.safeParse({
        ...validResponse,
        summary: "impact",
      }).success,
    ).toBe(false);
  });
});

describe("recheck enums", () => {
  it("exposes the three comparison states", () => {
    expect(RecheckComparisonState.options).toEqual([
      "verified",
      "observed",
      "insufficient_data",
    ]);
  });

  it("exposes the three dispositions", () => {
    expect(RecheckDisposition.options).toEqual([
      "resolved",
      "unchanged",
      "unknown",
    ]);
  });

  it("exposes the four rule statuses", () => {
    expect(RecheckRuleStatus.options).toEqual([
      "pass",
      "candidate",
      "skipped",
      "inconclusive",
    ]);
  });

  it("exposes the raw finding target kinds", () => {
    expect(RecheckTargetKind.options).toContain("http_status");
    expect(RecheckTargetKind.options).toContain("url");
  });
});
