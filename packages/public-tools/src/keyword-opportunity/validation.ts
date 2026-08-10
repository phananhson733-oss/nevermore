// @input  -- the keywords asked for and the rows the keyword provider sent back
// @output -- one three-state validation per keyword, with silence kept apart from zero
// @pos    -- the only place a missing provider row is turned into a fact
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  KeywordOpportunityValidation,
  KeywordOpportunityVolumeAvailability,
} from "./types.ts";

/** One row exactly as the keyword provider returned it. */
export interface KeywordOpportunityProviderRow {
  readonly keyword: string;
  readonly volume: number | null;
  readonly difficulty: number | null;
  readonly intent: string | null;
  readonly serpFeatures: readonly string[];
}

const NO_DATA: KeywordOpportunityValidation = {
  availability: "provider_no_data",
  volume: null,
  difficulty: null,
  intent: null,
  serpFeatures: [],
};

/**
 * Keys are compared lowercased and space-collapsed.
 *
 * Providers echo terms back with their own casing and spacing, so matching on
 * the raw string silently turns a returned row into a missing one — which in
 * this pipeline means silently inventing a no-data verdict.
 */
export function keywordVolumeKey(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

function availabilityOf(
  volume: number | null,
): KeywordOpportunityVolumeAvailability {
  if (volume === null) return "provider_no_data";
  return volume > 0 ? "available" : "explicit_zero";
}

/**
 * Resolve every requested keyword against the rows that came back.
 *
 * The provider drops terms it has no data for instead of returning them with a
 * zero — 74.9% of candidates in the 2026-08-10 spike. So the set difference
 * between what was asked and what returned *is* the no-data signal, and it has
 * to be computed here rather than inferred later from a missing volume. A row
 * that does come back carrying a null volume is also no-data, not a zero: only
 * an explicit numeric 0 means the provider measured no demand.
 */
export function resolveKeywordValidations(
  requested: readonly string[],
  returned: readonly KeywordOpportunityProviderRow[],
): ReadonlyMap<string, KeywordOpportunityValidation> {
  const byKey = new Map<string, KeywordOpportunityProviderRow>();
  for (const row of returned) {
    byKey.set(keywordVolumeKey(row.keyword), row);
  }

  const resolved = new Map<string, KeywordOpportunityValidation>();
  for (const keyword of requested) {
    const key = keywordVolumeKey(keyword);
    const row = byKey.get(key);
    if (row === undefined) {
      resolved.set(key, NO_DATA);
      continue;
    }
    resolved.set(key, {
      availability: availabilityOf(row.volume),
      volume: row.volume !== null && row.volume > 0 ? row.volume : null,
      difficulty: row.difficulty,
      intent: row.intent,
      serpFeatures: row.serpFeatures,
    });
  }
  return resolved;
}

/** Look a keyword up, defaulting to no-data rather than throwing. */
export function keywordValidationFor(
  validations: ReadonlyMap<string, KeywordOpportunityValidation>,
  keyword: string,
): KeywordOpportunityValidation {
  return validations.get(keywordVolumeKey(keyword)) ?? NO_DATA;
}

/** Whether a term carries measured demand the SEO lane can stand on. */
export function hasMeasuredKeywordDemand(
  validation: KeywordOpportunityValidation,
): boolean {
  return validation.availability === "available";
}
