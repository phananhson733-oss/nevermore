import { describe, expect, it } from "vitest";
import { initialProjectState } from "./reducer.ts";
import { PERSISTED_VERSION, parsePersistedState } from "./schema.ts";
import { populatedProjectState } from "./test-fixtures.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };

describe("persisted workbench schema v1", () => {
  it("round-trips the initial state", () => {
    const state = initialProjectState(seed);
    const parsed = parsePersistedState({ v: PERSISTED_VERSION, state });
    expect(parsed).toEqual(state);
  });

  it("round-trips a fully populated state", () => {
    // The initial state leaves every nested shape null or empty, so it never
    // reaches the nested strictObjects. This one does.
    const state = populatedProjectState(seed);
    expect(parsePersistedState({ v: PERSISTED_VERSION, state })).toEqual(state);
  });

  it("rejects a different version", () => {
    expect(parsePersistedState({ v: 0, state: initialProjectState(seed) })).toBeNull();
    expect(parsePersistedState({ v: 2, state: initialProjectState(seed) })).toBeNull();
  });

  it("rejects unknown top-level fields and wrong enum values", () => {
    const state = initialProjectState(seed);
    expect(parsePersistedState({ v: 1, state: { ...state, extra: 1 } })).toBeNull();
    expect(
      parsePersistedState({
        v: 1,
        state: { ...state, saved: [{ q: "x", addedAt: "2026-09-11 10:00", source: "手动" }] },
      }),
    ).toBeNull();
  });

  it("rejects an audit stamp that is not \"YYYY-MM-DD HH:mm\" (SiteCard slices it as MM-DD HH:mm)", () => {
    const state = populatedProjectState(seed);
    const audit = state.audit;
    if (!audit || !state.lastAudit) throw new Error("fixture must carry an audit report");
    expect(audit.at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    for (const bad of ["2026-09-11T10:00:00.000Z", "2026-09-11", "10:00", "t", ""]) {
      expect(
        parsePersistedState({ v: 1, state: { ...state, audit: { ...audit, at: bad } } }),
        bad,
      ).toBeNull();
      expect(
        parsePersistedState({ v: 1, state: { ...state, lastAudit: { ...state.lastAudit, at: bad } } }),
        bad,
      ).toBeNull();
    }
  });

  it("rejects garbage", () => {
    expect(parsePersistedState(null)).toBeNull();
    expect(parsePersistedState("{}")).toBeNull();
    expect(parsePersistedState({ v: 1 })).toBeNull();
  });
});
