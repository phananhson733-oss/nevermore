export interface ArtifactEditorValues {
  readonly draft: string;
  readonly note: string;
  readonly savedDraft: string;
}

/** Content and the next revision note are both part of the unsaved edit. */
export function isArtifactEditorDirty({
  draft,
  note,
  savedDraft,
}: ArtifactEditorValues): boolean {
  return draft !== savedDraft || note.length > 0;
}

export interface ArtifactNavigationIntent {
  readonly dirty: boolean;
  readonly willLeaveEditor: boolean;
  readonly button: number;
  readonly modified: boolean;
  readonly opensNewContext: boolean;
  readonly download: boolean;
}

/**
 * Only an ordinary same-tab navigation can discard this editor. Modified
 * clicks, downloads, and links that open a new browsing context leave it live.
 */
export function shouldConfirmArtifactNavigation({
  dirty,
  willLeaveEditor,
  button,
  modified,
  opensNewContext,
  download,
}: ArtifactNavigationIntent): boolean {
  return (
    dirty &&
    willLeaveEditor &&
    button === 0 &&
    !modified &&
    !opensNewContext &&
    !download
  );
}

/** Run the confirmation only when discarding would lose local editor state. */
export function canDiscardArtifactChanges(
  dirty: boolean,
  confirmDiscard: () => boolean,
): boolean {
  return !dirty || confirmDiscard();
}

/**
 * Why "Mark ready" is unavailable, or `null` when it is available.
 *
 * This function CHOOSES A SENTENCE. It does not decide whether a draft may be
 * adopted: `adoptionBlocked` arrives already decided, computed on the server by
 * the one module both write paths consult
 * (`apps/web/src/lib/services/content-shadow-adoption.ts`). A `"blocked"`
 * comparison, a verdict enum or a list of blocking rule ids in this file would
 * be the second copy of a backend invariant that this slice re-introduced more
 * than once, and the copy always drifts toward showing an operator a control
 * that looks safe to press.
 *
 * The order is the pre-existing one with the adoption reason appended, so that
 * every screen state asserted before the read model carried a verdict still
 * shows the sentence it showed then.
 */
export type MarkReadyBlock = "unsaved_edits" | "validation" | "adoption_blocked";

export interface MarkReadyInput {
  readonly dirty: boolean;
  readonly validationState: string;
  readonly validationErrorCount: number;
  readonly adoptionBlocked: boolean;
}

export function markReadyBlock({
  dirty,
  validationState,
  validationErrorCount,
  adoptionBlocked,
}: MarkReadyInput): MarkReadyBlock | null {
  if (dirty) return "unsaved_edits";
  if (validationState === "invalid" || validationErrorCount > 0) {
    return "validation";
  }
  if (adoptionBlocked) return "adoption_blocked";
  return null;
}
