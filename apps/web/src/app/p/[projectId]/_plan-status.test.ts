import type { ActionStatus } from "@/lib/api/hooks-plan";
import { isAllowedActionStatusTransition } from "@/lib/services/actions-service";
import { describe, expect, it } from "vitest";
import { allowedActionStatusTargets } from "./_action-status-transitions";

const STATUSES = [
  "candidate",
  "planned",
  "in_progress",
  "blocked",
  "done",
  "dismissed",
] as const satisfies readonly ActionStatus[];

const EXPECTED: Readonly<Record<ActionStatus, readonly ActionStatus[]>> = {
  candidate: ["planned", "dismissed"],
  planned: ["in_progress", "blocked", "dismissed"],
  in_progress: ["done"],
  blocked: ["in_progress"],
  done: ["planned"],
  dismissed: ["planned"],
};

const CASES = STATUSES.flatMap((current) =>
  STATUSES.map((target) => ({
    current,
    target,
    allowed: EXPECTED[current].includes(target),
  })),
);

describe("Plan Action status targets (implementation spec v0.2 §5.2)", () => {
  it.each(CASES)(
    "$current -> $target allowed=$allowed",
    ({ current, target, allowed }) => {
      expect(allowedActionStatusTargets(current).includes(target)).toBe(
        allowed,
      );
    },
  );

  it.each(STATUSES)(
    "never offers the current %s state as a transition",
    (status) => {
      expect(allowedActionStatusTargets(status)).not.toContain(status);
    },
  );
});

/**
 * The status graph exists twice on purpose: the client copy renders the
 * override dropdown, the server copy (`actions-service.ts`) rejects the PATCH.
 * Merging them would make the client module a server dependency, which is a
 * server-side change and out of scope. This exhaustive pairwise sweep is the
 * minimum drift fence: any divergence between the two maps fails one concrete
 * `current -> target` case instead of surfacing as an unexplainable 409 loop
 * in the override UI.
 */
describe("client/server Action status graph parity", () => {
  it.each(CASES)(
    "$current -> $target agrees with the server transition guard",
    ({ current, target }) => {
      expect(allowedActionStatusTargets(current).includes(target)).toBe(
        isAllowedActionStatusTransition(current, target),
      );
    },
  );
});
