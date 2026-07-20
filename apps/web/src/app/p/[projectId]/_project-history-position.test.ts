import { describe, expect, it } from "vitest";
import {
  projectHistoryPosition,
  projectHistoryTraversalDelta,
  withProjectHistoryPosition,
} from "./_project-history-position.ts";

describe("project history positions", () => {
  it("stamps a position without replacing Next history state", () => {
    const stamped = withProjectHistoryPosition(
      { __NA: true, opaque: { tree: true } },
      4,
    );
    expect(stamped).toMatchObject({
      __NA: true,
      opaque: { tree: true },
    });
    expect(projectHistoryPosition(stamped)).toBe(4);
    expect(projectHistoryPosition(null)).toBeNull();
    expect(
      projectHistoryPosition({ __sfProjectHistoryPosition: 1.5 }),
    ).toBeNull();
  });

  it("derives backward and forward deltas from stamped entries", () => {
    expect(
      projectHistoryTraversalDelta(
        3,
        withProjectHistoryPosition({}, 1),
        null,
        null,
      ),
    ).toBe(-2);
    expect(
      projectHistoryTraversalDelta(
        3,
        withProjectHistoryPosition({}, 4),
        null,
        null,
      ),
    ).toBe(1);
  });

  it("falls back to Navigation API indices for unstamped destinations", () => {
    expect(projectHistoryTraversalDelta(3, {}, 8, 6)).toBe(-2);
    expect(projectHistoryTraversalDelta(3, {}, 8, 10)).toBe(2);
    expect(projectHistoryTraversalDelta(null, {}, null, null)).toBeNull();
  });
});
