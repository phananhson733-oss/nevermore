import { describe, expect, it } from "vitest";
import {
  ARTIFACT_CONTENT_MAX,
  ARTIFACT_LIMIT,
  ARTIFACT_TITLE_MAX,
  HISTORY_LIMIT,
} from "../types.ts";
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

  it("rejects histories and artifact lists over their limits", () => {
    // The reducer never produces more than these (Task 4); a larger stored
    // list is not ours. An envelope at the limit is fine, one past it is not.
    const state = populatedProjectState(seed);
    const [report] = state.auditHistory;
    const [snapshot] = state.visHistory;
    const [artifact] = state.artifacts;
    if (!report || !snapshot || !artifact) throw new Error("fixture must carry one of each");

    const auditHistory = Array.from({ length: HISTORY_LIMIT }, () => report);
    expect(parsePersistedState({ v: 1, state: { ...state, auditHistory } })).not.toBeNull();
    expect(
      parsePersistedState({ v: 1, state: { ...state, auditHistory: [...auditHistory, report] } }),
    ).toBeNull();

    const visHistory = Array.from({ length: HISTORY_LIMIT }, () => snapshot);
    expect(parsePersistedState({ v: 1, state: { ...state, visHistory } })).not.toBeNull();
    expect(
      parsePersistedState({ v: 1, state: { ...state, visHistory: [...visHistory, snapshot] } }),
    ).toBeNull();

    const artifacts = Array.from({ length: ARTIFACT_LIMIT }, (_, i) => ({ ...artifact, id: `a${i}` }));
    expect(parsePersistedState({ v: 1, state: { ...state, artifacts } })).not.toBeNull();
    expect(
      parsePersistedState({ v: 1, state: { ...state, artifacts: [...artifacts, artifact] } }),
    ).toBeNull();
  });

  it("rejects an artifact whose title, content or filename is out of bounds", () => {
    const state = populatedProjectState(seed);
    const [artifact] = state.artifacts;
    if (!artifact) throw new Error("fixture must carry an artifact");
    const withArtifact = (patch: Partial<typeof artifact>) =>
      parsePersistedState({ v: 1, state: { ...state, artifacts: [{ ...artifact, ...patch }] } });

    expect(withArtifact({ title: "t".repeat(ARTIFACT_TITLE_MAX) })).not.toBeNull();
    expect(withArtifact({ title: "t".repeat(ARTIFACT_TITLE_MAX + 1) })).toBeNull();
    expect(withArtifact({ content: "c".repeat(ARTIFACT_CONTENT_MAX) })).not.toBeNull();
    expect(withArtifact({ content: "c".repeat(ARTIFACT_CONTENT_MAX + 1) })).toBeNull();
    // A bare file name only: nothing that could be read as a path or carry a
    // control character, and nothing longer than 120 characters. Letters of
    // any script pass — the mock content is Chinese, so its titles are too.
    expect(withArtifact({ filename: "Keyword library (2026-09).csv" })).not.toBeNull();
    expect(withArtifact({ filename: "关键词库 (2026-09).csv" })).not.toBeNull();
    for (const bad of ["../x.csv", "a/b.csv", "a\\b.csv", "x\u0000.csv", "", "n".repeat(121), "名单：v2.csv"]) {
      expect(withArtifact({ filename: bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it("rejects garbage", () => {
    expect(parsePersistedState(null)).toBeNull();
    expect(parsePersistedState("{}")).toBeNull();
    expect(parsePersistedState({ v: 1 })).toBeNull();
  });
});
