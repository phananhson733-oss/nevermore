/**
 * Browser-local bridge between the Context editor and the persistent project
 * navigation. The editor owns the state; navigation only reads it at the moment
 * a user activates a link. Nothing is persisted or shared with the server.
 */

let unsavedContextChanges = false;

export function setUnsavedContextChanges(dirty: boolean): void {
  unsavedContextChanges = dirty;
}

export function hasUnsavedContextChanges(): boolean {
  return unsavedContextChanges;
}

interface ContextNavigationIntent {
  readonly dirty: boolean;
  readonly current: boolean;
  readonly button: number;
  readonly modified: boolean;
}

/**
 * Modified/middle clicks open another browsing context and therefore do not
 * discard the current editor. Activating the already-current Context link is
 * likewise safe; only ordinary navigation away needs confirmation.
 */
export function shouldConfirmContextNavigation({
  dirty,
  current,
  button,
  modified,
}: ContextNavigationIntent): boolean {
  return dirty && !current && button === 0 && !modified;
}
