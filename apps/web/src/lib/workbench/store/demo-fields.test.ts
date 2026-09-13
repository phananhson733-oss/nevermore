import { describe, expect, it } from "vitest";
import type { WorkbenchProjectState } from "../types.ts";
import { demoFields, sameDemoFields, type DemoFields } from "./demo-fields.ts";
import { DEFAULT_NOTIFY } from "./reducer.ts";
import { otherThan, populatedProjectState } from "./test-fixtures.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };

/**
 * One key per overwritable field. A `Record` keyed by `keyof DemoFields`, so a
 * field added to the snapshot without a case here is a compile error.
 */
const FIELD_CASES = {
  conns: true, gscRows: true, gscRowsSource: true, seeds: true, built: true, saved: true,
  audit: true, auditHistory: true, lastAudit: true, visResults: true, visHistory: true, lastVis: true,
  compData: true, plans: true, targets: true, kb: true, artifacts: true, profileDoc: true,
} as const satisfies Readonly<Record<keyof DemoFields, true>>;

describe("demoFields", () => {
  it("holds exactly the overwritable fields, by reference", () => {
    const state = populatedProjectState(seed);
    const snapshot = demoFields(state);

    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(FIELD_CASES).sort());
    for (const key of Object.keys(FIELD_CASES) as (keyof DemoFields)[]) {
      expect(snapshot[key], key).toBe(state[key]);
    }
  });
});

describe("sameDemoFields", () => {
  it("is true for a state and its own snapshot", () => {
    const state = populatedProjectState(seed);
    expect(sameDemoFields(state, demoFields(state))).toBe(true);
  });

  it("ignores every field outside the snapshot: a settings toggle does not void a confirmation", () => {
    const state = populatedProjectState(seed);
    const expected = demoFields(state);
    const unrelated: readonly WorkbenchProjectState[] = [
      { ...state, notify: { ...DEFAULT_NOTIFY, weekly: !DEFAULT_NOTIFY.weekly } },
      { ...state, profile: { ...state.profile, positioning: "rewritten" } },
      { ...state, visPartial: !state.visPartial },
      { ...state, demo: !state.demo },
    ];
    for (const other of unrelated) {
      expect(sameDemoFields(other, expected)).toBe(true);
    }
  });

  it.each(Object.keys(FIELD_CASES) as (keyof DemoFields)[])("is false once %s is a different reference", (key) => {
    const state = populatedProjectState(seed);
    const moved = { ...state, [key]: otherThan(state[key]) } as WorkbenchProjectState;
    expect(sameDemoFields(moved, demoFields(state))).toBe(false);
    expect(sameDemoFields(demoFields(state), moved)).toBe(false);
  });

  it("compares by reference: equal content that was rebuilt is a change", () => {
    const state = populatedProjectState(seed);
    const reparsed = JSON.parse(JSON.stringify(state)) as WorkbenchProjectState;
    expect(reparsed).toEqual(state);
    expect(sameDemoFields(reparsed, demoFields(state))).toBe(false);
  });
});
