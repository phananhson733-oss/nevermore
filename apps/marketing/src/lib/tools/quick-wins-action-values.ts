// @input  -- one QuickWinAction and the locale of the page showing it
// @output -- the interpolation values its title and body reference
// @pos    -- the only place an action's measures become text
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { QuickWinAction } from "@sf/public-tools";
import { UNAVAILABLE, formatCount, formatPercent } from "./quick-wins-format";

/**
 * How each measure key reads as text.
 *
 * Keyed by the engine's own measure key rather than inferred from the value,
 * because 0.0193 is a plausible rate and a plausible click count and only the
 * key knows which. A key missing from here falls back to a plain count, which
 * is wrong-looking rather than silently misleading.
 */
const MEASURE_FORMAT: Readonly<
  Record<string, "count" | "share" | "rate" | "clicks">
> = {
  candidateCount: "count",
  serpRowCount: "count",
  largestGapClicks: "clicks",
  // A share of a property, rounded whole. "43.00% of impressions" in a
  // sentence claims a precision the underlying subtraction does not have, and
  // matches the wording used elsewhere on the page for the same quantity.
  withheldImpressionShare: "share",
  withheldClickShare: "share",
  belowFloorCount: "count",
  measuredRowCount: "count",
  lowBandCount: "count",
  lowBandRowCount: "count",
  // Two decimals, because these are the numbers being compared to each other.
  // Rounded whole, 0.48% and 1.93% both become "0%" and "2%", and the sentence
  // built on the difference between them stops making sense.
  higherBandCtr: "rate",
  lowerBandCtr: "rate",
  totalGapClicks: "clicks",
};

/**
 * A click count in a sentence, unsigned.
 *
 * Deliberately not `formatGap`, which signs its output: the table column
 * carries both directions, so an unsigned 4 in a cell is ambiguous. In prose
 * the direction is already in the words around it, and "+214 clicks" reads as
 * an increase — the exact opposite of the sentence it sits in.
 */
function clicks(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return UNAVAILABLE;
  return formatCount(Math.abs(value), locale);
}

/**
 * Everything an action's copy may interpolate.
 *
 * Every key is always present, including the ones a given action's message
 * never mentions: next-intl throws on a referenced-but-missing value, and an
 * action list that throws is worse than one whose copy carries an unused
 * value. Absent numbers arrive as the unavailable dash rather than as 0 —
 * `size_the_withheld_share` fires precisely when the share could not be
 * computed, and a 0% there would be the one answer we know is false.
 */
export function actionValues(
  action: QuickWinAction,
  locale: string,
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const key of Object.keys(MEASURE_FORMAT)) values[key] = UNAVAILABLE;

  for (const measure of action.measures) {
    const kind = MEASURE_FORMAT[measure.key] ?? "count";
    values[measure.key] =
      kind === "share"
        ? formatPercent(measure.value, locale, 0)
        : kind === "rate"
          ? formatPercent(measure.value, locale)
          : kind === "clicks"
            ? clicks(measure.value, locale)
            : formatCount(measure.value, locale);
  }

  values["bands"] = action.bands.join(", ");
  values["firstBand"] = action.bands[0] ?? UNAVAILABLE;
  values["secondBand"] = action.bands[1] ?? UNAVAILABLE;
  values["queryCount"] = formatCount(action.queries.length, locale);

  return values;
}
