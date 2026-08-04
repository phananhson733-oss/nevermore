// @input  -- the finished evidence table, the site curve, and what the run could not measure
// @output -- the ordered action list, each gated on evidence present in the same result
// @pos    -- the "what do I do with this" layer; still emits no verdict about any query
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  POSITION_BUCKETS,
  type CtrBucket,
  type SiteCtrCurve,
} from "../site-baseline/types.ts";
import type {
  QuickWinAction,
  QuickWinActionId,
  QuickWinAnonymization,
  QuickWinEvidenceRow,
  QuickWinExclusionCounts,
} from "./types.ts";

/**
 * Every action id, as a value, in the order they are emitted.
 *
 * The type is a union, which no test can iterate. An id with no copy behind it
 * throws when it renders, and only for the visitors whose data happens to fire
 * that rule — so the list exists so a test can find the missing message first.
 */
export const QUICK_WIN_ACTION_IDS = [
  "apply_wording_candidates",
  "open_serps_for_top_gaps",
  "size_the_withheld_share",
  "check_pages_report",
  "read_low_band_as_one_finding",
  "avoid_curve_as_law",
  "avoid_gap_as_forecast",
] as const satisfies readonly QuickWinActionId[];

/**
 * How many queries an action names before it stops naming them.
 *
 * A worklist someone can finish in a sitting. Twenty queries in a chip list is
 * a wall, and a wall gets skipped whole — the count in `measures` still says
 * how many there were, so nothing is hidden by the cap.
 */
export const ACTION_QUERY_CAP = 5;

/**
 * Share of excluded queries that must sit below the impression floor before the
 * page report is worth recommending.
 *
 * Below this the exclusions are a mix and the advice would be a guess about
 * which mix. At two thirds it is one story: this property's search demand is
 * spread thinner than a per-query view can resolve.
 */
export const FLOOR_DOMINANCE_THRESHOLD = 2 / 3;

export interface QuickWinActionInput {
  readonly rows: readonly QuickWinEvidenceRow[];
  readonly curve: SiteCtrCurve;
  readonly lowCtrBands: readonly CtrBucket[];
  readonly excluded: QuickWinExclusionCounts;
  readonly anonymization: QuickWinAnonymization | null;
  /** Queries a wording candidate was written for. */
  readonly draftedQueries: readonly string[];
  /** Threshold above which the withheld share changes how the table reads. */
  readonly anonymizationGapThreshold: number;
}

/**
 * The rows on one path, largest shortfall first.
 *
 * Sorted here rather than trusted from the caller. The rows do arrive in gap
 * order today — `buildEvidenceTable` sorts them and `withTracks` preserves it —
 * but "the top five" and "the largest shortfall here is N" are claims about
 * ordering, and an action that quietly means "the first five we happened to be
 * handed" is wrong the moment anything re-sorts upstream. Ties break on query
 * so a re-run of the same window names the same five.
 */
function rowsOnTrack(
  rows: readonly QuickWinEvidenceRow[],
  track: QuickWinEvidenceRow["track"],
): readonly QuickWinEvidenceRow[] {
  return [...rows]
    .filter((row) => row.track === track)
    .sort((a, b) => b.clickGap - a.clickGap || a.query.localeCompare(b.query));
}

/**
 * A band that earns more than a band ranking above it.
 *
 * Returns the higher-ranked band and the lower-ranked one that beat it, or null
 * when the usable bands descend the way a CTR curve is supposed to. Only
 * `usable` bands are compared: an under-sampled band out-earning its neighbour
 * is a sample-size artefact, and reporting it as a shape in the curve would be
 * inventing a finding out of four queries.
 *
 * This is not a corner case. It reproduced on the evaluated site, where the
 * 11-16 band earned four times what 8-11 did.
 */
export function firstCurveInversion(
  curve: SiteCtrCurve,
): { readonly higher: CtrBucket; readonly lower: CtrBucket } | null {
  const order = POSITION_BUCKETS.map((bucket) => bucket.id);
  const usable = curve.buckets
    .filter(
      (bucket) =>
        bucket.quality === "usable" &&
        bucket.ctr !== null &&
        Number.isFinite(bucket.ctr),
    )
    .sort((a, b) => order.indexOf(a.bucketId) - order.indexOf(b.bucketId));

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const higher = usable[i];
      const lower = usable[j];
      // The nulls are filtered above; the guard is here because
      // noUncheckedIndexedAccess types the lookups as possibly undefined and
      // a non-null assertion would hide a real ordering bug later.
      if (higher?.ctr == null || lower?.ctr == null) continue;
      if (lower.ctr > higher.ctr) return { higher, lower };
    }
  }
  return null;
}

/**
 * What to do next, in the order someone acts.
 *
 * `do` first — the things the evidence in this same result already supports.
 * `external_data` next — the looks this tool cannot take and the visitor can.
 * `avoid` last, because a warning only lands once the reader knows what they
 * were about to do.
 *
 * Every rule is gated on evidence carried in the same `QuickWinsResult`, so an
 * action can never be on screen without the numbers behind it being on screen
 * too. Nothing here says a rewrite would recover clicks; `avoid_gap_as_forecast`
 * exists to say the opposite, and it fires on every run that produced rows.
 */
export function buildQuickWinActions(
  input: QuickWinActionInput,
): readonly QuickWinAction[] {
  const actions: QuickWinAction[] = [];
  const drafted = input.draftedQueries;

  if (drafted.length > 0) {
    actions.push({
      id: "apply_wording_candidates",
      kind: "do",
      queries: drafted.slice(0, ACTION_QUERY_CAP),
      bands: [],
      measures: [{ key: "candidateCount", value: drafted.length }],
    });
  }

  const serpRows = rowsOnTrack(input.rows, "read_the_serp");
  if (serpRows.length > 0) {
    // The largest shortfall among them, so the reader knows the size of what
    // they are being sent to look at before they spend the time.
    const largest = serpRows[0];
    actions.push({
      id: "open_serps_for_top_gaps",
      kind: "external_data",
      queries: serpRows.slice(0, ACTION_QUERY_CAP).map((row) => row.query),
      bands: [],
      measures: [
        { key: "serpRowCount", value: serpRows.length },
        { key: "largestGapClicks", value: largest?.clickGap ?? null },
      ],
    });
  }

  if (
    input.anonymization === null ||
    input.anonymization.missingImpressionShare === null ||
    input.anonymization.missingImpressionShare > input.anonymizationGapThreshold
  ) {
    actions.push({
      id: "size_the_withheld_share",
      kind: "external_data",
      queries: [],
      bands: [],
      // Null when we could not size it, which is the case this action exists
      // for. It must not become 0: a 0% withheld share is the one answer we
      // know to be false.
      measures: [
        {
          key: "withheldImpressionShare",
          value: input.anonymization?.missingImpressionShare ?? null,
        },
        {
          key: "withheldClickShare",
          value: input.anonymization?.missingClickShare ?? null,
        },
      ],
    });
  }

  const excludedTotal = Object.values(input.excluded).reduce(
    (sum, count) => sum + count,
    0,
  );
  const belowFloor = input.excluded.below_impression_floor;
  if (
    excludedTotal > 0 &&
    belowFloor / excludedTotal >= FLOOR_DOMINANCE_THRESHOLD
  ) {
    actions.push({
      id: "check_pages_report",
      kind: "external_data",
      queries: [],
      bands: [],
      measures: [
        { key: "belowFloorCount", value: belowFloor },
        { key: "measuredRowCount", value: input.rows.length },
      ],
    });
  }

  if (input.lowCtrBands.length > 0) {
    const bandIds = input.lowCtrBands.map((bucket) => bucket.bucketId);
    // Rows in the band that are actually below its baseline. The copy says
    // every one of them falls short for the same structural reason, and a row
    // in a low band that beats the band's own rate is not one of them —
    // counting it would make a sentence that is otherwise exactly true false
    // for one row, on a page whose whole argument is that it does not overstate.
    const affected = input.rows.filter(
      (row) => bandIds.includes(row.bucketId) && row.clickGap > 0,
    ).length;
    actions.push({
      id: "read_low_band_as_one_finding",
      kind: "avoid",
      queries: [],
      bands: bandIds,
      measures: [
        { key: "lowBandCount", value: input.lowCtrBands.length },
        { key: "lowBandRowCount", value: affected },
      ],
    });
  }

  const inversion = firstCurveInversion(input.curve);
  if (inversion !== null) {
    actions.push({
      id: "avoid_curve_as_law",
      kind: "avoid",
      queries: [],
      bands: [inversion.higher.bucketId, inversion.lower.bucketId],
      measures: [
        { key: "higherBandCtr", value: inversion.higher.ctr },
        { key: "lowerBandCtr", value: inversion.lower.ctr },
      ],
    });
  }

  if (input.rows.length > 0) {
    // Unconditional on every run with rows. The gap column is the number a
    // reader most wants to be a promise, so the sentence that says it is not
    // one cannot be conditional — an absent warning reads as permission.
    const shortfall = input.rows
      .filter((row) => row.clickGap > 0)
      .reduce((sum, row) => sum + row.clickGap, 0);
    actions.push({
      id: "avoid_gap_as_forecast",
      kind: "avoid",
      queries: [],
      bands: [],
      measures: [{ key: "totalGapClicks", value: shortfall }],
    });
  }

  return actions;
}
