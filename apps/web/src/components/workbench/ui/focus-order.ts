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
 * Known scope: no contenteditable/summary/iframe, and hidden descendants still
 * match. `tabindex="-1"` is excluded on EVERY branch, not just the generic one:
 * a natively focusable element (the palette's `role="option"` buttons) opts out
 * of the Tab order the same way, and the trap must honour that.
 */
export const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';
