// @input -- the primary GEO category term
// @output -- the exact category forms inserted by the shared question registry
// @pos -- shared generation/admission seam; no truncation or translated replacements
import { geoCategoryStem } from "../agents/geo-category-stem.ts";
import { validateGeoPlaceholderValue } from "../agents/geo-template-registry.ts";

/** The four category forms the calibrated templates expect. */
export function geoCategoryPhrases(value: string): {
  readonly stem: string;
  readonly plural: string;
  readonly singular: string;
  readonly software: string;
} {
  const stem = geoCategoryStem(value);
  if (stem.length === 0) {
    // A category that stems to nothing renders questions with no subject at
    // all ("What are the top tools right now?"), which the calibration showed
    // never reaches the web. The caller refuses such a payload before freezing;
    // this branch only keeps the function total.
    return { stem: "", plural: "tools", singular: "tool", software: "software" };
  }
  return {
    stem,
    plural: `${stem} tools`,
    singular: `${stem} tool`,
    software: `${stem} software`,
  };
}


export function validGeoCategoryPlaceholders(value: string): boolean {
  const phrases = geoCategoryPhrases(value);
  return validateGeoPlaceholderValue("categoryStem", phrases.stem) === null &&
    validateGeoPlaceholderValue("categoryPlural", phrases.plural) === null &&
    validateGeoPlaceholderValue("categorySingular", phrases.singular) === null &&
    validateGeoPlaceholderValue("categorySoftware", phrases.software) === null;
}
