// @input  -- PSI loadingExperience (CrUX field data) already returned by
//            fetchFullPageSpeed; an Origin-vs-URL preference flag
// @output -- CruxField (p75 LCP/INP/CLS/TTFB + source level) + shapeCruxField():
//            folds PSI's loadingExperience into a typed p75 field record, or
//            null when CrUX has no field data for this URL (degrade-to-na).
// @pos    -- D1 v2.1 Phase 5 U7 — CrUX field data is FOLDED into the PSI source
//            (PSI's loadingExperience already carries CrUX p75; no separate live
//            CrUX client). 24h Origin cache is a deploy concern (note below).
//            Zero AI; numbers trace to CrUX field data, never fabricated.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * CrUX p75 field metrics for one URL (or its Origin fallback). All values are
 * the 75th-percentile real-user measurements CrUX reports — never lab estimates.
 * `null` for a metric CrUX did not report (degrade-to-na at the rule layer).
 *
 * `source` records which CrUX level the data came from:
 *   "url"    — URL-level field data (preferred; URL-specific p75)
 *   "origin" — Origin-level fallback (CrUX had no URL-level data; aggregate p75)
 *
 * NOTE (deploy concern): CrUX Origin-level data is stable over 24h, so a live
 * integration SHOULD cache Origin responses 24h and URL responses run-bound. The
 * pure shaping here is cache-agnostic; the caller owns caching at the deploy
 * boundary. We never read API keys here.
 */
export interface CruxField {
  readonly lcp: number | null;
  readonly inp: number | null;
  readonly cls: number | null;
  readonly ttfb: number | null;
  readonly source: "url" | "origin";
}

/**
 * The CrUX field-data shape PSI returns under `loadingExperience` /
 * `originLoadingExperience`. Minimal structural type — we only read the p75
 * percentile per metric. PSI keys metrics by these standard CrUX ids.
 */
export interface PsiLoadingExperience {
  readonly metrics?: {
    readonly LARGEST_CONTENTFUL_PAINT_MS?: { percentile?: number };
    readonly INTERACTION_TO_NEXT_PAINT?: { percentile?: number };
    readonly CUMULATIVE_LAYOUT_SHIFT_SCORE?: { percentile?: number };
    readonly EXPERIMENTAL_TIME_TO_FIRST_BYTE?: { percentile?: number };
  };
}

/** True when a loadingExperience block carries at least one p75 metric. */
function hasAnyMetric(le: PsiLoadingExperience | undefined): boolean {
  const m = le?.metrics;
  if (!m) return false;
  return (
    m.LARGEST_CONTENTFUL_PAINT_MS?.percentile !== undefined ||
    m.INTERACTION_TO_NEXT_PAINT?.percentile !== undefined ||
    m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile !== undefined ||
    m.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile !== undefined
  );
}

/** CLS percentile is reported ×100 by CrUX; rescale to the unitless 0..n score. */
function clsScore(percentile: number | undefined): number | null {
  return percentile === undefined ? null : percentile / 100;
}

function p(percentile: number | undefined): number | null {
  return percentile === undefined ? null : percentile;
}

/**
 * Fold PSI's loadingExperience (URL-level) or originLoadingExperience
 * (Origin-level fallback) into a typed CrUX p75 record.
 *
 * Returns `null` when NEITHER level has field data — that URL has no CrUX field
 * data and the perf field checks degrade to `na` (CrUX-missing is excluded from
 * the scoring denominator, never counted as a fabricated 0).
 *
 * Pure over its inputs: same loadingExperience ⇒ same field record.
 */
export function shapeCruxField(
  urlLevel: PsiLoadingExperience | undefined,
  originLevel: PsiLoadingExperience | undefined,
): CruxField | null {
  const useUrl = hasAnyMetric(urlLevel);
  const useOrigin = !useUrl && hasAnyMetric(originLevel);
  if (!useUrl && !useOrigin) return null;

  const le = useUrl ? urlLevel : originLevel;
  const m = le?.metrics ?? {};
  return {
    lcp: p(m.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
    inp: p(m.INTERACTION_TO_NEXT_PAINT?.percentile),
    cls: clsScore(m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile),
    ttfb: p(m.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile),
    source: useUrl ? "url" : "origin",
  };
}
