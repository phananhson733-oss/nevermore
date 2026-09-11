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

/** Known scope: no contenteditable/summary/iframe, and hidden descendants still match. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
