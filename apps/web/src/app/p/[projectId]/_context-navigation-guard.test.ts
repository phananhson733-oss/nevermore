import { afterEach, describe, expect, it } from "vitest";
import {
  hasUnsavedContextChanges,
  setUnsavedContextChanges,
  shouldConfirmContextNavigation,
} from "./_context-navigation-guard.ts";

afterEach(() => setUnsavedContextChanges(false));

describe("Context navigation guard", () => {
  it("tracks and clears the current Context dirty state", () => {
    expect(hasUnsavedContextChanges()).toBe(false);
    setUnsavedContextChanges(true);
    expect(hasUnsavedContextChanges()).toBe(true);
    setUnsavedContextChanges(false);
    expect(hasUnsavedContextChanges()).toBe(false);
  });

  it("guards only ordinary navigation away from a dirty Context", () => {
    expect(
      shouldConfirmContextNavigation({
        dirty: true,
        current: false,
        button: 0,
        modified: false,
      }),
    ).toBe(true);
    expect(
      shouldConfirmContextNavigation({
        dirty: false,
        current: false,
        button: 0,
        modified: false,
      }),
    ).toBe(false);
    expect(
      shouldConfirmContextNavigation({
        dirty: true,
        current: true,
        button: 0,
        modified: false,
      }),
    ).toBe(false);
    expect(
      shouldConfirmContextNavigation({
        dirty: true,
        current: false,
        button: 0,
        modified: true,
      }),
    ).toBe(false);
    expect(
      shouldConfirmContextNavigation({
        dirty: true,
        current: false,
        button: 1,
        modified: false,
      }),
    ).toBe(false);
  });
});
