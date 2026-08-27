// @input  -- final Search Console rows plus optional fresh daily/hourly trend reads
// @output -- the schema-versioned, non-persistent daily briefing contract
// @pos    -- public type boundary for the deterministic daily briefing core

import type { PublicToolResultEnvelope } from "../contract.ts";
import type {
  GscPageRow,
  GscQueryPageRow,
} from "../gsc-analytics/page-reader.ts";
import type {
  PropertyTotals,
  QueryRowsRead,
} from "../gsc-analytics/reader.ts";
import type { GscReadPaging } from "../gsc-analytics/types.ts";
import type { GscWindow } from "../gsc-analytics/window.ts";
import type { GscQueryRow } from "../site-baseline/types.ts";

export type DailyBriefingCadence = "daily" | "weekly";

/**
 * Which briefing the property can actually support this run.
 *
 * Claimed from measured capability, never from what the tool wishes it had.
 * `change_detection` requires that at least one strict change lane had the
 * paired evidence to ask its question. `position_observation` says no strict
 * lane could be asked but some queries carry a prior window large enough to
 * watch a position move provisionally. `current_position_watchlist` says only
 * the current window can be described at all.
 *
 * `unavailable` is not a fourth kind of briefing: it says the query rows could
 * not be read, so no claim can be made. Calling that `change_detection` put a
 * mode the data never supported in front of the reader, and let the cadence
 * promise a daily one.
 */
export type DailyBriefingMode =
  | "change_detection"
  | "position_observation"
  | "current_position_watchlist"
  | "unavailable";

export type DailyBriefingEvidenceState =
  | "observed"
  | "not_observed"
  | "partial"
  | "unavailable";

export type DailyBriefingChangeKind =
  | "click_opportunity"
  | "stable_position_click_decline"
  | "average_position_crossed_page_one_band"
  | "actionable_position_decline"
  | "first_observed"
  | "first_observed_leading";

/**
 * Signals read from the page dimension rather than the query dimension.
 *
 * Search Console anonymizes low-volume *queries*, not pages, so on a small
 * property the page rows carry click evidence the query rows will never show:
 * one measured run saw 9 of 37 weekly clicks at query level and all 37 at page
 * level. These lanes exist to read that remainder.
 *
 * They are deliberately weaker than the query lanes about *why*: a page's
 * average position is blended across every query it ranks for, so these say
 * what moved and hand the cause to the next tool.
 */
export type DailyBriefingPageChangeKind =
  | "page_click_decline"
  | "page_impression_collapse"
  | "page_first_observed";

/**
 * Whether a lane produced evidence, could not apply, or could not be read.
 *
 * `not_applicable` and `unavailable` both yield zero signals and must stay
 * distinguishable: the first says the property has nothing this lane could
 * ever measure, the second says we could not look.
 */
export type DailyBriefingLaneState =
  | "evaluated"
  | "not_applicable"
  | "unavailable";

/**
 * A page lane's state, which has one more case than a query lane's.
 *
 * `not_applicable` asserts the property has nothing this lane could ever
 * measure. A window that returned records this run could not read has not
 * established that, and neither has it established "we could not look" while
 * other records in the same window were read and judged. `partially_readable`
 * is that middle: the lane ran on what it could read and cannot speak for the
 * rest.
 */
export type DailyBriefingPageLaneState =
  | DailyBriefingLaneState
  | "partially_readable";

/** Why the CTR opportunity lane could not run, in the operator's terms. */
export type DailyBriefingCtrLaneBlocker =
  | "brand_terms_not_confirmed"
  | "insufficient_band_impressions"
  | "insufficient_band_queries"
  | "no_position_band_coverage";

export type DailyBriefingActionDestination =
  | "seo-quick-wins"
  | "traffic-drop-diagnosis"
  | "on-page-seo-check";

export interface DailyBriefingDateRow {
  readonly date: string;
  readonly clicks: number;
  readonly impressions: number;
  /** Impression-weighted average position reported by Search Console. */
  readonly position: number;
}

export interface DailyBriefingKpis {
  readonly clicks: number;
  readonly impressions: number;
  /** Null when impressions are zero. */
  readonly ctr: number | null;
  /** Null when impressions are zero. */
  readonly position: number | null;
}

export interface DailyBriefingKpiDelta {
  readonly clicks: number | null;
  readonly clicksRatio: number | null;
  readonly impressions: number | null;
  readonly impressionsRatio: number | null;
  readonly ctr: number | null;
  readonly position: number | null;
}

export interface DailyBriefingKpiComparison {
  readonly evidence: "observed" | "unavailable";
  readonly current: DailyBriefingKpis | null;
  readonly previous: DailyBriefingKpis | null;
  readonly delta: DailyBriefingKpiDelta;
}

/** One all-property metric point plotted in the Daily Briefing trend chart. */
export interface DailyBriefingTrendPoint {
  /** PT calendar day for daily points, or Search Console's hour key for hourly points. */
  readonly key: string;
  readonly clicks: number;
  readonly impressions: number;
  /** Null when the point has no impressions. */
  readonly ctr: number | null;
  /**
   * Null when the point has no impressions, or when none was measured.
   *
   * Search Console cannot weight a position over impressions nobody received,
   * and the reader leaves 0 where the field was missing — both reach here as
   * null, so a number in this field is always a measured position.
   */
  readonly position: number | null;
}

export interface DailyBriefingTrendSeries {
  /** `not_observed` means the read succeeded but returned no usable points. */
  readonly evidence: "observed" | "not_observed" | "partial" | "unavailable";
  readonly points: readonly DailyBriefingTrendPoint[];
  /** The first incomplete PT day, reported by Search Console when available. */
  readonly firstIncompleteDate: string | null;
  /** The first incomplete PT hour, reported by Search Console when available. */
  readonly firstIncompleteHour: string | null;
}

/**
 * Fresh visualisation evidence, deliberately separate from finalised action
 * evidence. A partial hourly point can inform the chart but cannot dispatch
 * an SEO action.
 */
export interface DailyBriefingTrend {
  readonly daily: DailyBriefingTrendSeries;
  readonly hourly: DailyBriefingTrendSeries;
}

export interface DailyBriefingTrendRead {
  readonly rows: readonly {
    readonly key: string;
    readonly clicks: number;
    readonly impressions: number;
    readonly position: number;
  }[];
  readonly firstIncompleteDate: string | null;
  readonly firstIncompleteHour: string | null;
}

export interface DailyBriefingWindows {
  readonly latestDay: GscWindow;
  readonly previousDay: GscWindow;
  readonly current7Days: GscWindow;
  readonly previous7Days: GscWindow;
  /** The single required date-dimension read. */
  readonly readRange: GscWindow;
}

export interface DailyBriefingQueryPageRead {
  readonly rows: readonly GscQueryPageRow[];
  /**
   * Records the response carried that could not be turned into a pair.
   *
   * Carried so a lane whose pairs all arrived unattributable can say it could
   * not look, rather than that there was nothing to look at. Without it an
   * attachment that returned only rows missing a query or page key was
   * indistinguishable from one that returned nothing.
   */
  readonly unreadableRows: number;
  readonly paging: GscReadPaging;
  readonly responseAggregationType: string | null;
}

export interface DailyBriefingPageRead {
  readonly rows: readonly GscPageRow[];
  /** Records the response carried that could not be turned into a page row. */
  readonly unreadableRows: number;
  readonly paging: GscReadPaging;
  readonly responseAggregationType: string | null;
}

export interface DailyBriefingQueryEvidence {
  readonly queryRead: QueryRowsRead | null;
  readonly queryPageRead: DailyBriefingQueryPageRead | null;
  /**
   * The page dimension on its own. Null means it was not read.
   *
   * Not derivable from `queryPageRead`: Search Console drops rows from the
   * `[query,page]` split, so summing that split understates every page by the
   * anonymized remainder. The two reads answer different questions and the
   * page lanes must use this one.
   */
  readonly pageRead: DailyBriefingPageRead | null;
  readonly propertyTotals: PropertyTotals | null;
}

export interface DailyBriefingWindowCoverage {
  readonly evidence: Exclude<DailyBriefingEvidenceState, "not_observed">;
  readonly queryRows: number;
  readonly queryPageRows: number;
  readonly eligibleQueries: number;
  readonly coveredQueries: number;
  readonly minimumQueryPageCoverage: number;
}

export interface DailyBriefingCoverage {
  readonly current: DailyBriefingWindowCoverage;
  readonly previous: DailyBriefingWindowCoverage;
}

export interface DailyBriefingAnonymization {
  readonly evidence: Exclude<DailyBriefingEvidenceState, "not_observed">;
  readonly queryImpressions: number | null;
  readonly propertyImpressions: number | null;
  readonly missingImpressionShare: number | null;
  readonly queryClicks: number | null;
  readonly propertyClicks: number | null;
  readonly missingClickShare: number | null;
}

export interface DailyBriefingAnonymizationWindows {
  readonly current: DailyBriefingAnonymization;
  readonly previous: DailyBriefingAnonymization;
}

export interface DailyBriefingChange {
  readonly kind: DailyBriefingChangeKind;
  readonly evidence: "observed" | "not_observed";
  readonly query: string;
  /**
   * The page carrying the query, or null when page evidence is withheld.
   *
   * A query signal and its page attribution are separate facts. Withholding
   * the page must not delete the query signal that was observed.
   */
  readonly page: string | null;
  readonly pageEvidence: "observed" | "unavailable";
  /** Query totals for query-level changes; exact pair metrics for first_observed. */
  readonly current: GscQueryRow;
  /** Null means this exact query/page pair was not observed in the prior read. */
  readonly previous: GscQueryRow | null;
  readonly clickChange: number | null;
  readonly clickChangeRatio: number | null;
  readonly positionDelta: number | null;
  /** Populated only for click_opportunity. */
  readonly baselineCtr: number | null;
  /** Populated only for click_opportunity. */
  readonly clickGap: number | null;
}

export interface DailyBriefingAction {
  readonly kind: DailyBriefingChangeKind;
  readonly destination: DailyBriefingActionDestination;
  readonly query: string;
  readonly page: string;
}

/**
 * A page-dimension change. It names a page and never a query.
 *
 * Kept in its own array rather than widened into `DailyBriefingChange` so the
 * query field there can stay required: a page signal that filled it with null
 * would look like a query signal whose query went missing.
 */
export interface DailyBriefingPageChange {
  readonly kind: DailyBriefingPageChangeKind;
  readonly evidence: "observed";
  readonly page: string;
  /**
   * Null only for `page_impression_collapse`, and only when the current
   * window returned no row for this page at all.
   *
   * The other two lanes are anchored on a current row and always carry one.
   * A collapse is anchored on the prior row instead: the strongest form of
   * the signal is a page that stopped being shown, which is precisely the
   * case with nothing current to point at. Absence is read as zero
   * impressions only after the window is shown to be complete; the position
   * stays unrepresented, because Search Console cannot weight a position
   * over impressions nobody received.
   */
  readonly current: GscPageRow | null;
  /** Null when the page carried no comparable prior window. */
  readonly previous: GscPageRow | null;
  readonly clickChange: number | null;
  readonly clickChangeRatio: number | null;
  readonly impressionChange: number | null;
  readonly impressionChangeRatio: number | null;
  readonly positionDelta: number | null;
  /**
   * Populated for lanes measured on a count; null for lanes that are not.
   *
   * `page_first_observed` has no prior base to take a square root of, so it
   * carries null here rather than a floor it was never asked to clear.
   */
  readonly noiseFloor: DailyBriefingNoiseFloor | null;
}

export interface DailyBriefingPageAction {
  readonly kind: DailyBriefingPageChangeKind;
  /**
   * Narrower than the query destinations on purpose.
   *
   * `seo-quick-wins` ranks query opportunities, and a page signal carries no
   * query for it to rank. Stating that here rather than only in the lane table
   * means a downstream contract cannot be widened by accident.
   */
  readonly destination: Extract<
    DailyBriefingActionDestination,
    "traffic-drop-diagnosis" | "on-page-seo-check"
  >;
  readonly page: string;
}

/**
 * A property-level move large enough to hand off.
 *
 * These three spellings license the words "material decline" and "material
 * gain". Nothing else does.
 */
export type DailyBriefingPropertyActionKind =
  | "sitewide_click_decline"
  | "sitewide_visibility_decline"
  | "sitewide_visibility_gain";

/**
 * A property-level move that stayed inside its own counting noise.
 *
 * The earlier contract encoded these as declines and let the noise floor
 * decide only whether to dispatch a diagnosis, so a headline asserted a
 * material decline and the sentence under it withdrew the claim. The kind
 * itself now carries what the sample can support.
 */
export type DailyBriefingPropertyObservationKind =
  | "sitewide_click_observation"
  | "sitewide_visibility_observation";

export type DailyBriefingPropertyChangeKind =
  | DailyBriefingPropertyActionKind
  | DailyBriefingPropertyObservationKind;

export interface DailyBriefingPropertyChange {
  readonly kind: DailyBriefingPropertyChangeKind;
  readonly evidence: "observed";
  readonly query: null;
  readonly page: null;
  readonly current: DailyBriefingKpis;
  readonly previous: DailyBriefingKpis;
  readonly clickChange: number;
  readonly clickChangeRatio: number | null;
  readonly impressionChange: number;
  readonly impressionChangeRatio: number | null;
  readonly positionDelta: number | null;
}

/**
 * The counting-noise floor a change must clear before it drives an action.
 *
 * Clicks and impressions are counts, so their run-to-run spread grows with the
 * square root of the base. A fifteen percent move on twenty-one clicks sits
 * inside that spread; calling it a material decline and dispatching a
 * diagnosis is a claim the sample cannot support. Applied to property totals
 * and to page rows alike — it scales with whatever base it is given, which is
 * why no fixed volume threshold sits in front of it.
 */
export interface DailyBriefingNoiseFloor {
  readonly basis: "clicks" | "impressions";
  readonly observedChange: number;
  readonly minimumForAction: number;
  readonly cleared: boolean;
}

export interface DailyBriefingPropertyTrend {
  readonly change: DailyBriefingPropertyChange | null;
  /** Null when the change was observed but stayed inside the noise floor. */
  readonly action: {
    readonly kind: DailyBriefingPropertyActionKind;
    readonly destination: "traffic-drop-diagnosis" | "seo-quick-wins";
  } | null;
  readonly noiseFloor: DailyBriefingNoiseFloor | null;
}

export interface DailyBriefingCtrLane {
  readonly state: DailyBriefingLaneState;
  readonly blockers: readonly DailyBriefingCtrLaneBlocker[];
  /** Position bands whose own rows can serve as a baseline, or null when unread. */
  readonly usableBaselineBands: number | null;
}

/**
 * Which lanes this property can support, measured rather than assumed.
 *
 * The action-eligible query count cannot answer this: a query sitting at
 * average position ninety with a hundred impressions clears that floor and
 * still cannot produce a single click signal.
 */
export interface DailyBriefingLaneCapability {
  readonly evidence: "observed" | "partial" | "unavailable";
  /** Queries with a comparable prior window carrying at least the click floor. */
  readonly clickDeclineCapableQueries: number | null;
  /** Queries the CTR lane could measure against a usable band baseline. */
  readonly ctrOpportunityCapableQueries: number | null;
  /**
   * Queries a strict position lane could ask about: both windows at the
   * sample floor, both average positions readable.
   */
  readonly strictPairedPositionQueries: number | null;
  /**
   * Queries whose prior window carries 50-99 impressions.
   *
   * Enough to watch a position move, never enough to call it a change. Kept
   * separate so a provisional observation can never be counted as strict
   * capability.
   */
  readonly provisionalPairedPositionQueries: number | null;
  /** Queries at the current sample floor with no comparable prior window. */
  readonly currentFloorOnlyQueries: number | null;
  readonly ctrLane: DailyBriefingCtrLane;
  readonly lanes: Readonly<Record<DailyBriefingChangeKind, DailyBriefingLaneState>>;
  /**
   * Pages present in both windows at the sample floor.
   *
   * A separate denominator from every query count above it. Pages and queries
   * are different populations, and one run's numbers are not comparable to the
   * other's; adding them would invent a total that measures nothing.
   */
  readonly pairedPageRows: number | null;
  /** Current-window page rows that cleared the sample floor. */
  readonly pageFloorRows: number | null;
  readonly pageLanes: Readonly<
    Record<DailyBriefingPageChangeKind, DailyBriefingPageLaneState>
  >;
}

export interface DailyBriefingSignalFunnel {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly observedQueryRows: number | null;
  /** Current query rows with 50–99 impressions; never action-eligible. */
  readonly observationCandidates: number | null;
  /** Current query rows at the existing 100-impression sample floor. */
  readonly actionEligibleQueries: number | null;
  readonly ctrBaselineRows: number | null;
  readonly clickOpportunityCandidates: number | null;
  readonly stableDeclineCandidates: number | null;
  readonly pageOneBandCandidates: number | null;
  readonly positionDeclineCandidates: number | null;
  readonly firstObservedCandidates: number | null;
  /** Counted apart: it is selected against its own budget, not the action one. */
  readonly firstObservedLeadingCandidates: number | null;
  /** Position moves seen only against a 50-99 impression prior window. */
  readonly provisionalMoveCandidates: number | null;
  readonly pageAttributionWithheld: number | null;
  readonly selectedQueryChanges: number;
  readonly propertyTrendShown: boolean;
}

/** What one lane did with the current window's query rows. */
export interface DailyBriefingLaneRowCounts {
  /** Rows this lane had no way to ask about. */
  readonly notEvaluated: number;
  /** Rows this lane asked about and found nothing in. */
  readonly evaluatedNoSignal: number;
  /** Rows this lane produced a candidate from. */
  readonly candidates: number;
}

/**
 * Where the current window's query rows ended up, per lane.
 *
 * The single `filteredObservedRows` count this replaces could only be read as
 * "rows that formed no candidate", and the copy above it read it as "rows that
 * failed a threshold" - which most of them were never tested against. Rows a
 * lane never evaluated and rows it evaluated and rejected are different facts
 * and are now reported as different numbers.
 */
export interface DailyBriefingRowAccounting {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly observedRows: number | null;
  /** Rows that produced a candidate but lost the display budget. */
  readonly notSelectedVisibleRows: number | null;
  readonly byLane: Readonly<
    Record<DailyBriefingChangeKind, DailyBriefingLaneRowCounts>
  > | null;
}

/**
 * Where the current window's PAGE rows ended up, per page lane.
 *
 * Deliberately not merged into `DailyBriefingRowAccounting`: that one counts
 * query rows, this one counts page rows, and a single table summing both would
 * present two populations as one. The two `observedRows` are both correct and
 * are not addends.
 */
/** Why the page-level zero-click check could not run, in operator terms. */
export type DailyBriefingPageCheckBlocker =
  | "brand_terms_not_confirmed"
  | "query_rows_unavailable"
  | "property_totals_unavailable"
  | "aggregation_basis_mismatch"
  | "no_property_impressions";

/**
 * The property's own click-through rate, and what it was computed from.
 *
 * Deliberately one number for the whole property rather than the banded curve
 * the CTR opportunity lane uses. That curve needs five hundred impressions and
 * five queries inside a single position band before it will speak, which the
 * properties this tool serves rarely reach; a property-wide rate needs only
 * the property totals, which are read on every run. It is the coarser
 * instrument and it is stated as such: it answers "would this many impressions
 * normally have produced a click here", not "what should this query earn".
 */
export interface DailyBriefingPageCheckBaseline {
  readonly ctr: number;
  /** Non-brand impressions the rate was divided from. */
  readonly impressions: number;
  readonly clicks: number;
  /** Brand rows subtracted from the property totals before dividing. */
  readonly brandQueriesExcluded: number;
}

export interface DailyBriefingPageCheck {
  readonly page: string;
  readonly impressions: number;
  readonly position: number;
  /** Clicks the property's own rate expects from this many impressions. */
  readonly expectedClicks: number;
  readonly destination: Extract<
    DailyBriefingActionDestination,
    "on-page-seo-check"
  >;
}

/**
 * Pages shown often enough that drawing no clicks is worth a look.
 *
 * A state, not a change: nothing here is claimed to have moved between the two
 * windows, which is why these are checks and sit apart from `pageChanges`. It
 * is the page-scoped counterpart of `DailyBriefingSuggestedChecks`, kept as its
 * own population for the same reason page rows are kept apart from query rows.
 */
export interface DailyBriefingPageChecks {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly baseline: DailyBriefingPageCheckBaseline | null;
  readonly blockers: readonly DailyBriefingPageCheckBlocker[];
  readonly items: readonly DailyBriefingPageCheck[];
  /**
   * Every usable current page row this check read, `items` included.
   *
   * Not the rejected count: the sentence built on it says N were read and the
   * rest were left out for a stated reason, which only holds if N is the whole
   * population rather than the remainder.
   */
  readonly examinedRows: number | null;
}

export interface DailyBriefingPageAccounting {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly observedRows: number | null;
  /**
   * Records the prior window returned; the collapse lane's denominator.
   *
   * Beside `observedRows` rather than folded into it, for the same reason the
   * page total sits beside the query one: they count different windows and a
   * sum would measure neither. Only `page_impression_collapse` is counted
   * against this one, because only it reads the prior window as its
   * population — a page that stopped being shown appears in no current-row
   * total, so its lane cannot be balanced against one.
   */
  readonly previousObservedRows: number | null;
  /** Page rows that produced a candidate but lost the display budget. */
  readonly notSelectedVisibleRows: number | null;
  readonly unreadableRows: number | null;
  readonly byLane: Readonly<
    Record<DailyBriefingPageChangeKind, DailyBriefingLaneRowCounts>
  > | null;
}

/**
 * The sample state of an observation.
 *
 * `sample_floor_reached` says only that the row cleared the impression floor.
 * It does not claim any lane evaluated it, which is why the earlier
 * `evaluation_eligible` spelling had to go.
 */
export type DailyBriefingQueryObservationKind =
  | "sample_floor_reached"
  | "sample_building";

/** Actionability band of an observation's current average position. */
export type DailyBriefingObservationBand =
  | "page_one"
  | "near_page_one"
  | "mid"
  | "far";

export interface DailyBriefingQueryObservation {
  readonly kind: DailyBriefingQueryObservationKind;
  readonly band: DailyBriefingObservationBand;
  readonly query: string;
  readonly page: string | null;
  readonly pageEvidence: "observed" | "unavailable";
  readonly current: GscQueryRow;
  /** Null when no prior window exists, or when it is too small to compare. */
  readonly previous: GscQueryRow | null;
  /**
   * Prior-window impressions when a row existed but was too small to compare.
   *
   * Without it the page reports "not observed" for a query Search Console did
   * observe, which is the same substitution the tool refuses everywhere else.
   */
  readonly previousBelowFloor: number | null;
  readonly positionDelta: number | null;
}

export interface DailyBriefingQueryWatchlist {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly items: readonly DailyBriefingQueryObservation[];
  /** Observations that qualified before the display budget was applied. */
  readonly candidates: number | null;
  /**
   * Qualified observations the display budget left out, by band.
   *
   * Without this the page called the rows it dropped "below the threshold",
   * when several of them had cleared every threshold and simply lost the cut.
   */
  readonly withheldByBand: Readonly<
    Record<DailyBriefingObservationBand, number>
  > | null;
  /**
   * Withheld observations by sample tier.
   *
   * The band alone cannot say whether a dropped row had cleared the strict
   * sample floor, and "they are not below a threshold" is true of one tier and
   * false of the other.
   */
  readonly withheldByKind: Readonly<
    Record<DailyBriefingQueryObservationKind, number>
  > | null;
}

/**
 * A page worth opening today on the strength of where it currently sits.
 *
 * A check is not a weak action, it is a different kind of statement. An action
 * says "this changed, and here is the evidence". A check says "nothing here is
 * known to have changed; this is where the property currently stands, and the
 * standing is worth a look". Nothing in a check is a causal claim, which is
 * what lets it be offered on evidence no lane could turn into a change.
 *
 * This exists because the honest answer for a small property was arriving as
 * a contradiction: three rows the page had just called worth looking at, above
 * a heading that said nothing was worth doing. Both sentences were true and
 * the pair read as a broken tool.
 */
export interface DailyBriefingSuggestedCheck {
  readonly query: string;
  readonly page: string;
  readonly band: DailyBriefingObservationBand;
  /** Which sample tier the observation came from; never a claim of evidence. */
  readonly sampleKind: DailyBriefingQueryObservationKind;
  readonly destination: "on-page-seo-check";
}

export interface DailyBriefingSuggestedChecks {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly items: readonly DailyBriefingSuggestedCheck[];
  /**
   * Displayed watchlist rows that could NOT become a check, and so are absent.
   *
   * A count of the checks themselves would only ever restate `items.length`,
   * which explains nothing. This one explains the shortfall the reader can
   * see: three rows above, two checks, one row too far down to be worth
   * opening or carrying no page to open.
   */
  readonly notCheckable: number | null;
}

/**
 * A position move seen against a prior window too small to call it a change.
 *
 * The strict lanes require both windows at the 100-impression floor because an
 * impression-weighted average position over a handful of impressions is not a
 * stable quantity. Dropping that floor would reopen the low-sample door this
 * tool closed on purpose. Reporting the move as an observation - never as a
 * change, never as an action - is the honest middle.
 */
export type DailyBriefingProvisionalMoveKind =
  | "provisional_page_one_band_entry"
  | "provisional_actionable_position_decline";

export interface DailyBriefingProvisionalMove {
  readonly kind: DailyBriefingProvisionalMoveKind;
  readonly evidence: "observed";
  readonly query: string;
  readonly page: string | null;
  readonly pageEvidence: "observed" | "unavailable";
  readonly current: GscQueryRow;
  readonly previous: GscQueryRow;
  readonly positionDelta: number;
}

export interface DailyBriefingProvisionalMoves {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly items: readonly DailyBriefingProvisionalMove[];
  /** Provisional moves found before the display budget was applied. */
  readonly candidates: number | null;
  /** The prior-window impression range that makes these provisional. */
  readonly priorWindowImpressionRange: readonly [number, number];
}

export type DailyBriefingLimitationCode =
  | "daily_data_incomplete"
  | "daily_rows_omitted"
  | "query_evidence_unavailable"
  | "property_totals_unavailable"
  | "query_evidence_partial"
  | "query_page_coverage_below_floor"
  | "aggregation_basis_mismatch"
  | "anonymization_gap_uncomputable"
  | "brand_terms_not_confirmed"
  | "property_change_inside_noise_floor"
  | "page_evidence_unavailable";

export interface DailyBriefingResult {
  readonly windows: DailyBriefingWindows;
  readonly day: DailyBriefingKpiComparison;
  readonly weekly: DailyBriefingKpiComparison;
  /** Fresh daily/hourly display evidence. It does not alter the action lanes. */
  readonly trend: DailyBriefingTrend;
  readonly mode: DailyBriefingMode;
  readonly cadence: DailyBriefingCadence;
  readonly laneCapability: DailyBriefingLaneCapability;
  readonly changes: readonly DailyBriefingChange[];
  readonly actions: readonly DailyBriefingAction[];
  /** Page-dimension changes; a separate population from `changes`. */
  readonly pageChanges: readonly DailyBriefingPageChange[];
  readonly pageActions: readonly DailyBriefingPageAction[];
  /** Always evaluated; never suppressed by query-level signals. */
  readonly propertyTrend: DailyBriefingPropertyTrend;
  readonly signalFunnel: DailyBriefingSignalFunnel;
  readonly queryWatchlist: DailyBriefingQueryWatchlist;
  /** Position moves reported as observations, never as changes or actions. */
  readonly provisionalMoves: DailyBriefingProvisionalMoves;
  readonly rowAccounting: DailyBriefingRowAccounting;
  readonly pageAccounting: DailyBriefingPageAccounting;
  readonly pageChecks: DailyBriefingPageChecks;
  /** Offered on current standing; never claims anything changed. */
  readonly suggestedChecks: DailyBriefingSuggestedChecks;
  readonly coverage: DailyBriefingCoverage;
  readonly anonymization: DailyBriefingAnonymizationWindows;
  readonly limitations: readonly DailyBriefingLimitationCode[];
}

export type DailyBriefingEnvelope = PublicToolResultEnvelope<
  DailyBriefingResult,
  "daily_search_briefing",
  "property"
>;

export interface BuildDailyBriefingInput {
  readonly now: Date;
  readonly dateRows: readonly DailyBriefingDateRow[];
  /** Optional trend reads may independently be unavailable without failing the briefing. */
  readonly trend?: {
    readonly daily: DailyBriefingTrendRead | null;
    readonly hourly: DailyBriefingTrendRead | null;
  };
  readonly currentQueryEvidence?: DailyBriefingQueryEvidence | null;
  readonly previousQueryEvidence?: DailyBriefingQueryEvidence | null;
  readonly brandTerms: readonly string[];
  readonly brandTermsConfirmed: boolean;
}
