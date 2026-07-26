import { afterEach, describe, expect, it } from "vitest";
import {
  clearActiveGenerationFence,
  readActiveGenerationFence,
  writeActiveGenerationFence,
  type ActiveGenerationRecovery,
} from "./_active-generation-fence.ts";

const PROJECT_A = "00000000-0000-4000-8000-0000000000a1";
const PROJECT_B = "00000000-0000-4000-8000-0000000000b2";

function recovery(actionId: string): ActiveGenerationRecovery {
  return {
    key: `${actionId}:technical_ticket`,
    actionId,
    artifactType: "technical_ticket",
    refreshing: false,
  };
}

afterEach(() => clearActiveGenerationFence());

/**
 * The store exists so the 409 fence outlives the page (stop gate §16.7), and
 * the e2e case that proves that runs against a single project. The property
 * this file pins is the other one — the fence must not follow the operator into
 * a different project, where it would suppress a control for a run that is not
 * there. A fence that fences too much is worse than the defect it replaced.
 */
describe("active generation fence store", () => {
  it("has nothing to say about a project it has not seen", () => {
    expect(readActiveGenerationFence(PROJECT_A)).toEqual([]);
  });

  it("returns what was written for the same project", () => {
    const entries = [recovery("action-1")];
    writeActiveGenerationFence(PROJECT_A, entries);
    expect(readActiveGenerationFence(PROJECT_A)).toEqual(entries);
  });

  it("never hands one project's fence to another", () => {
    writeActiveGenerationFence(PROJECT_A, [recovery("action-1")]);
    expect(readActiveGenerationFence(PROJECT_B)).toEqual([]);
  });

  it("drops the previous project's fence rather than accumulating both", () => {
    // One slot on purpose: an operator is in one project at a time, and a store
    // that kept every project's fence would keep suppressing controls in
    // projects the operator has left, with nothing to clear them.
    writeActiveGenerationFence(PROJECT_A, [recovery("action-1")]);
    writeActiveGenerationFence(PROJECT_B, [recovery("action-2")]);
    expect(readActiveGenerationFence(PROJECT_B)).toEqual([recovery("action-2")]);
    expect(readActiveGenerationFence(PROJECT_A)).toEqual([]);
  });

  it("lets a project release its own fence by writing an empty list", () => {
    writeActiveGenerationFence(PROJECT_A, [recovery("action-1")]);
    writeActiveGenerationFence(PROJECT_A, []);
    expect(readActiveGenerationFence(PROJECT_A)).toEqual([]);
  });

  it("forgets everything on clear", () => {
    writeActiveGenerationFence(PROJECT_A, [recovery("action-1")]);
    clearActiveGenerationFence();
    expect(readActiveGenerationFence(PROJECT_A)).toEqual([]);
  });
});
