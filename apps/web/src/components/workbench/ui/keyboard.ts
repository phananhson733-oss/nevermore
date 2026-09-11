/**
 * True for a keydown fired while an IME composition is in progress.
 *
 * `isComposing` is the spec'd flag; `keyCode === 229` is the legacy signal
 * browsers still emit for keydowns inside a composition when the flag is
 * missing or not yet set (the first keydown of a composition in some Chromium
 * and WebKit builds). Every keydown handler in the workbench (Dialog, the
 * command palette, the window-level shortcut) returns early on this WITHOUT
 * `preventDefault`, so the IME keeps its own behaviour: Escape cancels the
 * candidate list, Enter commits it, the arrows move within it. None of those
 * keystrokes are for us until the composition has ended.
 */
export function isComposingKey(e: { readonly isComposing?: boolean; readonly keyCode?: number }): boolean {
  return e.isComposing === true || e.keyCode === 229;
}
