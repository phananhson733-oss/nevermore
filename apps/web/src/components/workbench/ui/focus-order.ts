/** Which element receives focus on Tab / Shift+Tab inside a trap (design §4.3). */
export function nextTrapIndex(
  count: number,
  activeIndex: number,
  backwards: boolean,
): number {
  if (count === 0) return -1;
  if (activeIndex < 0) return backwards ? count - 1 : 0;
  if (backwards) return activeIndex === 0 ? count - 1 : activeIndex - 1;
  return activeIndex === count - 1 ? 0 : activeIndex + 1;
}

/**
 * Known scope: no contenteditable/summary/iframe. A selector cannot see
 * `hidden` or `inert` on an ancestor, a disabled `<fieldset>` around a control,
 * or layout, so this is only the first cut: `focusCandidates` filters on those.
 * `tabindex="-1"` and `[disabled]` are excluded on EVERY branch, not
 * just the generic one: a natively focusable element (the palette's
 * `role="option"` buttons) opts out of the Tab order with `tabindex="-1"`, and
 * a disabled control carrying an explicit `tabindex` would otherwise be a trap
 * candidate whose `.focus()` silently fails, stranding Tab on the panel.
 */
export const FOCUSABLE =
  'a[href]:not([disabled]):not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([disabled]):not([tabindex="-1"])';

/**
 * Whether the document has laid `el` out. `offsetParent` is not used: it is
 * null for fixed-position elements too.
 *
 * Under jsdom nothing has a box, so this is false for every element there.
 * That is why `isFocusCandidate` consults it only when the scope itself has a
 * box, which an open dialog panel always does in a browser: without that guard
 * every control would be ruled out under jsdom and every trap test would
 * quietly degrade to "focus the panel".
 */
export function hasLayout(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/**
 * Whether `el` can take focus as far as the DOM can say before trying: not
 * under `hidden`, not under `inert`, not disabled (a disabled `<fieldset>`
 * included), and, when `layoutKnown`, rendered. `display: none` from a class
 * shows up only as a missing box. `focus()` can still fail after all of this
 * (`visibility: hidden`), so callers read `document.activeElement` back.
 */
export function isFocusCandidate(el: HTMLElement, layoutKnown: boolean): boolean {
  if (el.closest("[hidden]") !== null) return false;
  if (el.closest("[inert]") !== null) return false;
  if (el.matches(":disabled")) return false;
  return !layoutKnown || hasLayout(el);
}

/**
 * The Tab stops inside `scope`, read now rather than at open: the `FOCUSABLE`
 * matches that pass `isFocusCandidate`, in document order.
 */
export function focusCandidates(scope: HTMLElement): readonly HTMLElement[] {
  const layoutKnown = hasLayout(scope);
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) =>
    isFocusCandidate(el, layoutKnown),
  );
}
