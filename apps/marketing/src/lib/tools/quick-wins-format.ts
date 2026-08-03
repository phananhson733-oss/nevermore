// @input  -- a number (or the absence of one) and the locale of the page showing it
// @output -- the string the evidence table renders
// @pos    -- the only place quick-wins numbers become text
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * What an unavailable number looks like.
 *
 * Never "0", never an empty cell. A rate we could not compute and a rate of
 * zero are different claims, and the whole report is built on not confusing
 * them.
 */
export const UNAVAILABLE = "—";

/** Below this a probability is shown as a floor, never as a bare 0. */
const TAIL_FLOOR = 0.0001;

/**
 * `Intl.NumberFormat` construction is expensive enough to matter across a few
 * hundred table cells, and the options are drawn from a fixed set.
 */
const CACHE = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = `${locale}|${JSON.stringify(options)}`;
  const hit = CACHE.get(cacheKey);
  if (hit !== undefined) return hit;

  // The locale arrives from a route segment. A tag `Intl` refuses should cost
  // a thousands separator, not the results table.
  let made: Intl.NumberFormat;
  try {
    made = new Intl.NumberFormat(locale, options);
  } catch {
    made = new Intl.NumberFormat(undefined, options);
  }
  CACHE.set(cacheKey, made);
  return made;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** A whole count, grouped for the page's language. */
export function formatCount(value: number | null, locale: string): string {
  if (!finite(value)) return UNAVAILABLE;
  return formatter(locale, { maximumFractionDigits: 0 }).format(
    Math.round(value),
  );
}

/**
 * A rate, as a percentage.
 *
 * Two decimals by default. The site the tool was evaluated against earns 0.51%
 * at positions 4-10; rounded to a whole percent that reads as 1%, which is
 * nearly double, and the entire point of the table is the size of a gap.
 */
export function formatPercent(
  value: number | null,
  locale: string,
  digits = 2,
): string {
  if (!finite(value)) return UNAVAILABLE;
  return formatter(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * A tail probability, floored rather than allowed to print as 0.
 *
 * Double precision runs out of exponent long before a probability becomes an
 * impossibility. Printing the literal 0 would tell a reader the observation
 * cannot happen, when what happened is that we cannot write the number down.
 */
export function formatTail(value: number | null, locale: string): string {
  if (!finite(value)) return UNAVAILABLE;
  if (value < TAIL_FLOOR) {
    return `< ${formatter(locale, { maximumFractionDigits: 4 }).format(TAIL_FLOOR)}`;
  }
  return formatter(locale, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

/**
 * A click gap, always signed.
 *
 * The sign is the whole reading: positive is below the site's own curve,
 * negative is above it. An unsigned "4" in a column where both happen is
 * ambiguous at a glance.
 */
export function formatGap(value: number | null, locale: string): string {
  if (!finite(value)) return UNAVAILABLE;
  return formatter(locale, {
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(Math.round(value));
}

/**
 * An average position, to one decimal.
 *
 * Kept fractional on purpose: this is an impression-weighted average over the
 * window, not a rank. "8" would read as a placement the page held.
 */
export function formatPosition(value: number | null, locale: string): string {
  if (!finite(value)) return UNAVAILABLE;
  return formatter(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}
