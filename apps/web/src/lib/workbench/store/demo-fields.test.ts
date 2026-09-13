import { describe, expect, it } from "vitest";
import type { DemoPayload, WorkbenchProjectState } from "../types.ts";
import { demoFields, sameDemoFields, type DemoFields } from "./demo-fields.ts";
import { DEFAULT_NOTIFY, reduce } from "./reducer.ts";
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

  it.each(Object.keys(FIELD_CASES) as (keyof DemoFields)[])("is false once %s holds other content", (key) => {
    const state = populatedProjectState(seed);
    const moved = { ...state, [key]: otherThan(state[key]) } as WorkbenchProjectState;
    expect(sameDemoFields(moved, demoFields(state))).toBe(false);
    expect(sameDemoFields(demoFields(state), moved)).toBe(false);
  });
});

/** What a `storage` event hands the provider: the same bytes parsed again, every object rebuilt. */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * codex S6r3 #2: another tab changed only `notify` and persisted the whole
 * state; the `storage` event re-parsed it, so every field below came back as a
 * new reference with the same content, and a reference-only comparison refused
 * the confirmation and opened the same box again with no explanation.
 */
describe("sameDemoFields: the same content after a JSON round-trip", () => {
  it("is true for a state and its own round-trip", () => {
    const state = populatedProjectState(seed);
    const reparsed = roundTrip(state);
    // Hollow unless the round-trip really replaced the references.
    expect(reparsed.gscRows).not.toBe(state.gscRows);
    expect(reparsed.artifacts).not.toBe(state.artifacts);

    expect(sameDemoFields(reparsed, demoFields(state))).toBe(true);
    expect(sameDemoFields(demoFields(state), reparsed)).toBe(true);
  });

  it("is still true when only notify changed before the round-trip", () => {
    const state = populatedProjectState(seed);
    const reparsed = roundTrip({ ...state, notify: { ...state.notify, weekly: !state.notify.weekly } });
    expect(reparsed.notify.weekly).toBe(!state.notify.weekly);

    expect(sameDemoFields(reparsed, demoFields(state))).toBe(true);
  });

  it("is false once any one of the fields holds other content after the round-trip", () => {
    const state = populatedProjectState(seed);
    const keys = Object.keys(demoFields(state)) as (keyof DemoFields)[];
    expect(keys).toHaveLength(18);

    for (const key of keys) {
      const reparsed = roundTrip(state);
      const changed = { ...reparsed, [key]: otherThan(reparsed[key]) } as WorkbenchProjectState;
      // The change is to content, not only to a reference: otherwise this case proves nothing.
      expect(JSON.stringify(changed[key]), key).not.toBe(JSON.stringify(state[key]));

      expect(sameDemoFields(changed, demoFields(state)), key).toBe(false);
      expect(sameDemoFields(demoFields(state), changed), key).toBe(false);
    }
  });
});

describe("reduce: a confirmation still covers the same content after a JSON round-trip", () => {
  // A payload that differs from the fixture, so a load that landed is visible.
  const { gscRowsSource: _source, ...rest } = demoFields({ ...populatedProjectState(seed), seeds: "sample seeds" });
  const payload: DemoPayload = rest;

  it("loads", () => {
    const own: WorkbenchProjectState = { ...populatedProjectState(seed), demo: false };
    const expected = demoFields(own);
    const reparsed = roundTrip(own);

    const loaded = reduce(reparsed, { type: "loadDemo", payload, expected });

    expect(loaded).not.toBe(reparsed);
    expect(loaded.demo).toBe(true);
    expect(loaded.seeds).toBe("sample seeds");
  });

  it("clears", () => {
    const sample = populatedProjectState(seed);
    expect(sample.demo).toBe(true);
    const expected = demoFields(sample);
    const reparsed = roundTrip(sample);

    const cleared = reduce(reparsed, { type: "clearDemo", expected });

    expect(cleared).not.toBe(reparsed);
    expect(cleared.demo).toBe(false);
    expect(cleared.artifacts).toEqual([]);
  });
});
