// @input  -- nothing; the reviewed bands two surfaces judge page shape by
// @output -- one definition per threshold, shared by the catalogue and the checker
// @pos    -- the single source both judgements read, so they cannot drift apart

/**
 * Why these live here rather than beside either caller.
 *
 * The Agent catalogue and the On-Page Checker both grade the same measured
 * facts. When each kept its own copy of a band, the two surfaces answered the
 * same question differently for the same page, and nothing failed -- the reader
 * simply got two numbers and no way to tell which was meant. One definition,
 * imported by both, makes a disagreement impossible rather than unlikely.
 */

/**
 * How much bigger the script payload may be than the visible text before the
 * document stops carrying its own content.
 *
 * A ratio, not a byte count: a large page with proportionally large text is
 * doing its job, and a tiny page dominated by script is not.
 */
export const SCRIPT_DOMINANCE = 5;

/** Transferred markup size, in bytes. */
export const HTML_BYTES = { large: 200_000, huge: 500_000 } as const;

/**
 * Reviewed body-text bands, in text units.
 *
 * Units rather than words, so a page written without inter-word spaces is
 * measured on the same scale as one written with them.
 */
export const BODY_UNITS = { thin: 300, low: 600, good: 1200 } as const;
