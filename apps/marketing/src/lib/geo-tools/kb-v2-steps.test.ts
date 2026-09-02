import { describe, expect, it } from "vitest";
import { geoKbV2Steps, type GeoKbV2StepInput } from "./kb-v2-steps.ts";

const base: GeoKbV2StepInput = { busy: false, dirty: false, requiresSave: false, copyStale: false, needsReview: false,
  canGenerate: true, canPrepare: true, canFreeze: false, hasSourceReceipt: false, hasRoleProposal: false,
  hasCandidate: false, candidateStale: false, reviewed: false };
const byId = (input: GeoKbV2StepInput) => Object.fromEntries(geoKbV2Steps(input).map(step => [step.id, step]));

describe("GEO knowledge-base progress", () => {
  it("names an unsaved draft as the one thing to resolve first", () => {
    const steps = byId({ ...base, dirty: true, canGenerate: false, canPrepare: false });
    expect(steps.save).toMatchObject({ state: "ready" });
    expect(steps.sources).toMatchObject({ state: "blocked", reason: "unsaved" });
    expect(steps.roles).toMatchObject({ state: "blocked", reason: "unsaved" });
    expect(steps.prepare).toMatchObject({ state: "blocked", reason: "unsaved" });
  });
  it("blames a stale Profile copy before an outstanding review", () => {
    const steps = byId({ ...base, copyStale: true, needsReview: true, canGenerate: false, canPrepare: false });
    expect(steps.sources?.reason).toBe("copyStale");
    expect(steps.prepare?.reason).toBe("copyStale");
  });
  it("blocks only preparation on an outstanding review", () => {
    const steps = byId({ ...base, needsReview: true, canPrepare: false, hasSourceReceipt: true });
    expect(steps.sources).toMatchObject({ state: "done" });
    expect(steps.roles).toMatchObject({ state: "ready" });
    expect(steps.prepare).toMatchObject({ state: "blocked", reason: "review" });
  });
  it("separates no candidate, a stale candidate and an unconfirmed one", () => {
    expect(byId(base).freeze).toMatchObject({ state: "blocked", reason: "noCandidate" });
    expect(byId({ ...base, hasCandidate: true, candidateStale: true }).freeze?.reason).toBe("staleCandidate");
    expect(byId({ ...base, hasCandidate: true }).freeze?.reason).toBe("notReviewed");
    expect(byId({ ...base, hasCandidate: true, reviewed: true, canFreeze: true }).freeze).toMatchObject({ state: "ready" });
  });
  it("marks a stale candidate as still to be prepared rather than done", () => {
    expect(byId({ ...base, hasCandidate: true, candidateStale: true }).prepare?.state).toBe("ready");
    expect(byId({ ...base, hasCandidate: true }).prepare?.state).toBe("done");
  });
  it("says work is in flight rather than inventing a gate", () => {
    const steps = byId({ ...base, busy: true, canGenerate: false, canPrepare: false });
    expect(steps.sources).toMatchObject({ state: "blocked", reason: "busy" });
    expect(steps.roles?.reason).toBe("busy");
  });
  it("keeps the fixed order the editor enforces", () => {
    expect(geoKbV2Steps(base).map(step => step.id)).toEqual(["save", "sources", "roles", "prepare", "freeze"]);
  });
});
