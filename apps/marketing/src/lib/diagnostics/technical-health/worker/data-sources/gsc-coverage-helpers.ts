// @input  -- UrlInspectionSnapshot (search-visibility-v2)
// @output -- inspectionIndexed(snap): whether a URL Inspection snapshot confirms
//            the URL is indexed (verdict PASS or an indexed coverageState).
// @pos    -- D1 v2.1 Phase 4 U6 — pure helper split out of
//            gsc-index-coverage-source.ts to keep that file ≤ 200 lines. Zero AI;
//            the indexed-coverageState set is the GSC vocabulary, not a heuristic.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { UrlInspectionSnapshot } from "@/lib/analysis/search-visibility-v2/types/analyze-and-config";

/** URL Inspection coverageState values that mean "indexed". */
const INDEXED_COVERAGE_STATES: ReadonlySet<string> = new Set([
  "Submitted and indexed",
  "Indexed, not submitted in sitemap",
]);

/**
 * True when a URL Inspection snapshot confirms the URL is indexed: either the
 * overall verdict is PASS or the index coverageState is an indexed state.
 */
export function inspectionIndexed(snap: UrlInspectionSnapshot): boolean {
  if (snap.verdict === "PASS") return true;
  return (
    snap.coverageState !== undefined &&
    INDEXED_COVERAGE_STATES.has(snap.coverageState)
  );
}
