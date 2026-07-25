import { describe, expect, it, vi } from "vitest";
import {
  canDiscardArtifactChanges,
  isArtifactEditorDirty,
  markReadyBlock,
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

/**
 * Which sentence the "Mark ready" control shows, and why there is no rule here.
 *
 * `adoption` arrives decided from the server, computed by the one module both
 * write paths consult. This function chooses between reasons; it never decides
 * whether a draft is adoptable. A `blocked` literal in this file would be the
 * second copy of a backend invariant that this slice kept re-introducing.
 */
describe("Studio mark-ready block", () => {
  const clean = {
    dirty: false,
    validationState: "valid",
    validationErrorCount: 0,
    adoptionBlocked: false,
  } as const;

  it("lets a clean, valid, unblocked draft through", () => {
    expect(markReadyBlock(clean)).toBeNull();
  });

  it("reports an unsaved edit before anything else", () => {
    expect(markReadyBlock({ ...clean, dirty: true })).toBe("unsaved_edits");
    expect(
      markReadyBlock({ ...clean, dirty: true, adoptionBlocked: true }),
    ).toBe("unsaved_edits");
  });

  it("keeps the validation reason ahead of the adoption reason", () => {
    // Both are true and both are actionable; the pre-existing precedence is
    // preserved so no assertion written before this change moves.
    expect(markReadyBlock({ ...clean, validationState: "invalid" })).toBe(
      "validation",
    );
    expect(markReadyBlock({ ...clean, validationErrorCount: 2 })).toBe(
      "validation",
    );
    expect(
      markReadyBlock({
        ...clean,
        validationErrorCount: 1,
        adoptionBlocked: true,
      }),
    ).toBe("validation");
  });

  it("reports the adoption refusal the server would raise", () => {
    expect(markReadyBlock({ ...clean, adoptionBlocked: true })).toBe(
      "adoption_blocked",
    );
  });
});
