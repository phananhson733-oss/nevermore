// @input  -- nothing; the reviewed bands two surfaces judge page shape by
// @output -- one definition per threshold, shared by the catalogue and the checker
// @pos    -- the single source both judgements read, so they cannot drift apart

/**
 * Why these live here rather than beside either caller.
 *
 * The Agent catalogue and the On-Page Checker both grade the same measured
 * facts. When each kept its own copy of a band, the two surfaces answered the
 * same question differently for the same page, and nothing failed -- the reader
 * simply got two numbers and no way to tell which was meant.
 *
 * Bands alone were not enough: a shared constant applied by two different rules
 * still disagrees. Where the rule itself has more than one clause it lives here
 * too, as a function both sides call.
 */

/**
 * How much bigger the script payload may be than the visible text before the
 * document stops carrying its own content.
 *
 * A ratio, not a byte count: a large page with proportionally large text is
 * doing its job, and a tiny page dominated by script is not.
 */
export const SCRIPT_DOMINANCE = 5;

/**
 * Below this much visible text, a document is not carrying its own content.
 *
 * Half of the rule, not a threshold of its own: a page reads as client
 * rendered only when it is BOTH short on visible text and dominated by script.
 * A long page with a proportionally large script bundle is an ordinary
 * application page, and calling it empty would be a confident wrong answer
 * about the pages this matters most for.
 */
export const STATIC_TEXT_FLOOR_BYTES = 600;

/**
 * The whole rule, in one place, so the two surfaces cannot answer differently.
 *
 * Sharing the constants was not enough: the checker applied both halves and
 * the catalogue applied only the ratio, so a page with 5 KB of visible text
 * and 30 KB of script passed on one surface and drew a Tip on the other.
 */
export function readsAsClientRendered(facts: {
  readonly visibleTextBytes: number;
  readonly scriptBytes: number;
}): boolean {
  return (
    facts.visibleTextBytes < STATIC_TEXT_FLOOR_BYTES &&
    facts.scriptBytes > facts.visibleTextBytes * SCRIPT_DOMINANCE
  );
}

/** Transferred markup size, in bytes. */
export const HTML_BYTES = { large: 200_000, huge: 500_000 } as const;

/**
 * Reviewed body-text bands, in text units.
 *
 * Units rather than words, so a page written without inter-word spaces is
 * measured on the same scale as one written with them.
 */
export const BODY_UNITS = { thin: 300, low: 600, good: 1200 } as const;
