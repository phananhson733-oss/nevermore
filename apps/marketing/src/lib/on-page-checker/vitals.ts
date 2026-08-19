// @input  -- the target page's extract from one finished run
// @output -- the strip of page facts, as message keys and already-formatted values
// @pos    -- one definition, read by the score card on screen and the copied report
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { SeoAuditTargetPageExtract } from "@sf/public-tools/seo-audit/types";

export interface OnPageVital {
  /** Key under `tools.onPageChecker.vitals`; the caller owns the wording. */
  readonly labelKey: string;
  readonly value: string;
}

/**
 * Why this is shared rather than built where it is shown.
 *
 * The report a visitor copies is meant to be the report a visitor read. Two
 * copies of this list drift the moment one of them learns a new field, and the
 * drift is invisible: both look right on their own, and only someone holding
 * the screen beside the paste would ever see that they disagree.
 *
 * A field is absent, never zero. `staticBodyWords` is null on a page written
 * without spaces between words, where splitting on whitespace would be out by
 * an order of magnitude — printing `0` there would be a measurement nobody made.
 */
export function pageVitals(
  extract: SeoAuditTargetPageExtract,
): readonly OnPageVital[] {
  const declared = extract.declared;
  const response = extract.response;

  return [
    response.finalStatus === null
      ? null
      : { labelKey: "status", value: String(response.finalStatus) },
    response.responseMs === null
      ? null
      : { labelKey: "responseMs", value: `${response.responseMs}ms` },
    declared === null
      ? null
      : {
          labelKey: "htmlSize",
          value: `${Math.round(declared.htmlBytes / 1024)}KB`,
        },
    extract.staticBodyWords === null
      ? null
      : { labelKey: "words", value: String(extract.staticBodyWords) },
    { labelKey: "internalLinks", value: String(response.internalOutlinks) },
    declared === null
      ? null
      : {
          labelKey: "externalLinks",
          value: String(declared.externalLinks.total),
        },
    declared === null
      ? null
      : { labelKey: "images", value: String(declared.images.total) },
    declared?.lang == null
      ? null
      : { labelKey: "lang", value: declared.lang },
  ].filter((entry): entry is OnPageVital => entry !== null);
}
