// @input  -- a finished brief, and the ceiling it has to fit under
// @output -- its size in the unit a paste limit is actually expressed in
// @pos    -- shared so two briefs cannot disagree about what "16KB" means

/**
 * Why bytes, and why this is a shared function rather than a `.length`.
 *
 * A paste limit, a request body and a context window are all counted in bytes
 * or tokens; none of them is counted in UTF-16 code units. Measuring with
 * `.length` gave one of these briefs a cap of "16KB" that a Chinese report
 * could exceed threefold before the check fired — every CJK character is three
 * UTF-8 bytes and one `.length`. The number in the constant meant something
 * different depending on who was reading the report.
 */
export function briefByteLength(markdown: string): number {
  return new TextEncoder().encode(markdown).length;
}

/** Whether this brief fits, measured the way the receiving end measures. */
export function withinBriefBudget(markdown: string, maxBytes: number): boolean {
  return briefByteLength(markdown) <= maxBytes;
}
