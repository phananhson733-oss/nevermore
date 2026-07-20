import type { ActionStatus } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { describe, expect, it } from "vitest";
import {
  isAllowedActionStatusTransition,
  listProjectActions,
} from "@/lib/services/actions-service";

const STATUSES = [
  "candidate",
  "planned",
  "in_progress",
  "blocked",
  "done",
  "dismissed",
] as const satisfies readonly ActionStatus[];

const ALLOWED = new Set([
  "candidate->planned",
  "candidate->dismissed",
  "planned->in_progress",
  "planned->blocked",
  "planned->dismissed",
  "in_progress->done",
  "blocked->in_progress",
  "done->planned",
  "dismissed->planned",
]);

const CASES = STATUSES.flatMap((current) =>
  STATUSES.map((requested) => ({
    current,
    requested,
    allowed: ALLOWED.has(`${current}->${requested}`),
  })),
);

describe("Action status transitions (implementation spec v0.2 §5.2)", () => {
  it.each(CASES)(
    "$current -> $requested allowed=$allowed",
    ({ current, requested, allowed }) => {
      expect(isAllowedActionStatusTransition(current, requested)).toBe(allowed);
    },
  );

  it("fails closed when a persisted status is outside the frozen enum", () => {
    expect(isAllowedActionStatusTransition("unknown", "planned")).toBe(false);
  });
});

describe("Action list cursor validation", () => {
  it.each([
    "customer-private-malformed-keyset",
    "2026-02-31T00:00:00.000Z 00000000-0000-4000-8000-000000000003",
    "2026-07-19T00:00:00.000Z customer-private-invalid-uuid",
  ])(
    "rejects malformed decoded keyset %j before querying",
    async (privatePayload) => {
      const cursor = Buffer.from(privatePayload).toString("base64url");

      let caught: unknown;
      try {
        await listProjectActions(
          { workspaceId: "00000000-0000-4000-8000-000000000001" },
          "00000000-0000-4000-8000-000000000002",
          { limit: 50, cursor },
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ProblemError);
      expect(caught).toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
      expect((caught as ProblemError).fieldErrors).toEqual([
        {
          pointer: "/cursor",
          code: "invalid_query_value",
          message: "Invalid query parameter.",
        },
      ]);
      expect(JSON.stringify(caught)).not.toContain(privatePayload);
    },
  );
});
