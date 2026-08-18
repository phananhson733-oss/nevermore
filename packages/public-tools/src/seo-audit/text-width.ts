// @input  -- a title or description string, from either audit
// @output -- its approximate rendered width, and the bounds both tools judge by
// @pos    -- the single place a length threshold for search snippets is defined
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Approximate rendered width, in half-widths. CJK counts as two.
 *
 * Google truncates a title or description by rendered pixel width, not by
 * character count, so neither number is the real thing. A width that charges a
 * full-width character twice is much the closer proxy: a 30-character Chinese
 * title occupies about the same space as a 60-character English one, and a raw
 * `.length` bound reads the first as comfortably short.
 *
 * Kept here because two audits used to answer this question differently — the
 * checker at 15–60 on width, the site-wide audit at 15–70 on `.length` — so one
 * title was flagged by one tool and cleared by the other, in the same product,
 * with no way for a reader to tell which was right. Neither range was measured
 * against the other; this one is the closer proxy, so it is the one that stays.
 */
export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd)
        ? 2
        : 1;
  }
  return width;
}

/**
 * Reviewed working ranges in `displayWidth` units, not official limits.
 *
 * They only flag lengths far enough outside common practice to be worth a look.
 * Both audits read them from here; a second copy is how the two ended up
 * disagreeing in the first place.
 */
export const SNIPPET_TITLE_WIDTH = { min: 15, max: 60 } as const;
export const SNIPPET_DESCRIPTION_WIDTH = { min: 50, max: 160 } as const;

/**
 * Cut to a width budget, the same way the bounds are measured.
 *
 * Used by the snippet preview, which used to clip on `.length`: a Chinese title
 * was flagged as "width 90, outside 15–60, likely truncated" directly above a
 * preview that showed it whole and called itself a truncation sketch.
 */
export function clipToWidth(value: string, maxWidth: number): string {
  if (displayWidth(value) <= maxWidth) return value;
  let width = 0;
  let kept = "";
  for (const char of value) {
    const next = width + displayWidth(char);
    if (next > maxWidth - 1) break;
    width = next;
    kept += char;
  }
  return `${kept.trimEnd()}…`;
}
