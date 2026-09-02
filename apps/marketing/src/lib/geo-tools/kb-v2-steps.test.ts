import { describe, expect, it } from "vitest";
import { geoKbV2Steps, type GeoKbV2StepInput } from "./kb-v2-steps.ts";

const base: GeoKbV2StepInput = { busy: false, dirty: false, requiresSave: false, copyStale: false, needsReview: false,
  sourcesActionable: true, rolesActionable: true, prepareActionable: true, canFreeze: false, generationRunning: false,
  hasUsableSourceReceipt: false, hasUsableRoleProposal: false, hasCandidate: false, candidateStale: false,
  reviewed: false, frozenAtCurrentDraft: false };
const byId = (input: Partial<GeoKbV2StepInput>) => Object.fromEntries(geoKbV2Steps({ ...base, ...input }).map(step => [step.id, step]));

describe("GEO knowledge-base progress", () => {
  it("names an unsaved draft as the one thing to resolve first", () => {
    const steps = byId({ dirty: true, sourcesActionable: false, rolesActionable: false, prepareActionable: false });
    expect(steps.save).toMatchObject({ state: "ready" });
    expect(steps.sources).toMatchObject({ state: "blocked", reason: "unsaved" });
    expect(steps.roles).toMatchObject({ state: "blocked", reason: "unsaved" });
    expect(steps.prepare).toMatchObject({ state: "blocked", reason: "unsaved" });
  });
  it("blames a stale Profile copy before an outstanding review", () => {
    const steps = byId({ copyStale: true, needsReview: true, sourcesActionable: false, prepareActionable: false });
    expect(steps.sources?.reason).toBe("copyStale");
    expect(steps.prepare?.reason).toBe("copyStale");
  });
  it("blocks only preparation on an outstanding review", () => {
    const steps = byId({ needsReview: true, prepareActionable: false, hasUsableSourceReceipt: true });
    expect(steps.sources).toMatchObject({ state: "done" });
    expect(steps.roles).toMatchObject({ state: "ready" });
    expect(steps.prepare).toMatchObject({ state: "blocked", reason: "review" });
  });
  it("never blames an outstanding review for a step the review gate does not guard", () => {
    const steps = byId({ needsReview: true, sourcesActionable: false, rolesActionable: false });
    expect(steps.sources?.reason).toBe("unavailable");
    expect(steps.roles?.reason).toBe("unavailable");
  });
  it("says a generation is running rather than inventing a gate", () => {
    const steps = byId({ generationRunning: true, rolesActionable: false, prepareActionable: false });
    expect(steps.roles).toMatchObject({ state: "blocked", reason: "running" });
    expect(steps.prepare?.reason).toBe("running");
  });
  it("never reads available while its button is inoperable", () => {
    expect(byId({ sourcesActionable: false }).sources?.state).toBe("blocked");
    expect(byId({ rolesActionable: false }).roles?.state).toBe("blocked");
    expect(byId({ prepareActionable: false }).prepare?.state).toBe("blocked");
    expect(byId({ dirty: true, busy: true }).save?.state).toBe("blocked");
    expect(byId({ dirty: true, busy: true }).save?.reason).toBe("busy");
    expect(byId({ busy: true }).save?.state).toBe("done");
  });
  it("counts evidence as done only while it is usable against this draft", () => {
    expect(byId({ hasUsableSourceReceipt: false }).sources?.state).not.toBe("done");
    expect(byId({ hasUsableRoleProposal: false }).roles?.state).not.toBe("done");
    expect(byId({ hasUsableSourceReceipt: true, hasUsableRoleProposal: true }).roles?.state).toBe("done");
  });
  it("separates no candidate, a stale candidate and an unconfirmed one", () => {
    expect(byId({}).freeze).toMatchObject({ state: "blocked", reason: "noCandidate" });
    expect(byId({ hasCandidate: true, candidateStale: true }).freeze?.reason).toBe("staleCandidate");
    expect(byId({ hasCandidate: true }).freeze?.reason).toBe("notReviewed");
    expect(byId({ hasCandidate: true, reviewed: true, canFreeze: true }).freeze).toMatchObject({ state: "ready" });
  });
  it("shows a completed run as complete once this exact draft is frozen", () => {
    expect(byId({ frozenAtCurrentDraft: true }).freeze).toMatchObject({ state: "done", reason: null });
    expect(byId({ frozenAtCurrentDraft: false, hasCandidate: true, reviewed: true, canFreeze: true }).freeze?.state).toBe("ready");
  });
  it("marks a stale candidate as still to be prepared rather than done", () => {
    expect(byId({ hasCandidate: true, candidateStale: true }).prepare?.state).toBe("ready");
    expect(byId({ hasCandidate: true }).prepare?.state).toBe("done");
  });
  it("decides busy before a stale copy, a stale copy before unsaved, and unsaved before a running generation", () => {
    expect(byId({ busy: true, copyStale: true, dirty: true, sourcesActionable: false }).sources?.reason).toBe("busy");
    expect(byId({ copyStale: true, dirty: true, rolesActionable: false }).roles?.reason).toBe("copyStale");
    expect(byId({ dirty: true, generationRunning: true, prepareActionable: false }).prepare?.reason).toBe("unsaved");
    expect(byId({ generationRunning: true, needsReview: true, prepareActionable: false }).prepare?.reason).toBe("running");
  });
  it("does not offer saving while the Profile copy is stale, because that save would be refused", () => {
    const step = byId({ copyStale: true, dirty: true }).save;
    expect(step).toMatchObject({ state: "blocked", reason: "copyStale" });
  });
  it("keeps the fixed order the editor enforces", () => {
    expect(geoKbV2Steps(base).map(step => step.id)).toEqual(["save", "sources", "roles", "prepare", "freeze"]);
  });
});
