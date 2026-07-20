import { describe, expect, it, vi } from "vitest";
import {
  canDiscardArtifactChanges,
  isArtifactEditorDirty,
  shouldConfirmArtifactNavigation,
} from "./_artifact-editor-state.ts";

describe("Studio artifact editor state", () => {
  it("tracks content and note changes against the saved content", () => {
    expect(
      isArtifactEditorDirty({
        draft: "saved",
        note: "",
        savedDraft: "saved",
      }),
    ).toBe(false);
    expect(
      isArtifactEditorDirty({
        draft: "edited",
        note: "",
        savedDraft: "saved",
      }),
    ).toBe(true);
    expect(
      isArtifactEditorDirty({
        draft: "saved",
        note: "revision note",
        savedDraft: "saved",
      }),
    ).toBe(true);
  });

  it("guards only same-tab navigation that leaves a dirty editor", () => {
    const intent = {
      dirty: true,
      willLeaveEditor: true,
      button: 0,
      modified: false,
      opensNewContext: false,
      download: false,
    };
    expect(shouldConfirmArtifactNavigation(intent)).toBe(true);
    expect(
      shouldConfirmArtifactNavigation({ ...intent, dirty: false }),
    ).toBe(false);
    expect(
      shouldConfirmArtifactNavigation({ ...intent, willLeaveEditor: false }),
    ).toBe(false);
    expect(
      shouldConfirmArtifactNavigation({ ...intent, modified: true }),
    ).toBe(false);
    expect(
      shouldConfirmArtifactNavigation({ ...intent, button: 1 }),
    ).toBe(false);
    expect(
      shouldConfirmArtifactNavigation({ ...intent, opensNewContext: true }),
    ).toBe(false);
    expect(
      shouldConfirmArtifactNavigation({ ...intent, download: true }),
    ).toBe(false);
  });

  it("does not ask for confirmation when the editor is clean", () => {
    const confirmDiscard = vi.fn(() => false);
    expect(canDiscardArtifactChanges(false, confirmDiscard)).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(canDiscardArtifactChanges(true, confirmDiscard)).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();
  });
});
