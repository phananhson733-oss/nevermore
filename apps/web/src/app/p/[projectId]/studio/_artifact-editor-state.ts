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
