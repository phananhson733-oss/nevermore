import type { ActionStatus } from "@/lib/api/hooks-plan";
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
      expect(allowedActionStatusTargets(current).includes(target)).toBe(allowed);
    },
  );

  it.each(STATUSES)("never offers the current %s state as a transition", (status) => {
    expect(allowedActionStatusTargets(status)).not.toContain(status);
  });
});
