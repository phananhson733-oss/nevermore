// @input  -- one KeywordOpportunityResult
// @output -- one shared candidate order, plus eligible rows as RFC 4180 CSV and its filename
// @pos    -- keeps UI/export order aligned and preserves the same evidence outside the tab
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  KeywordOpportunityIncomplete,
  KeywordOpportunityResult,
  KeywordOpportunityRow,
  KeywordOpportunityWithheld,
} from "./types.ts";

/**
 * Columns, in order.
 *
 * Stable field ids rather than the localized labels shown on screen: this
 * file gets opened weeks later and pasted into someone else's sheet, and a
 * header row that changes with the reader's language breaks both.
 *
 * `market`/`language` repeat on every row on purpose. Volume means nothing
 * without the market it was priced for, and carrying it only in the filename
 * stops being true the first time someone renames the file.
 */
const COLUMNS = [
  "market",
  "language",
  "lane",
  "keyword",
  "volume",
  "difficulty",
  "weakestDomainRank",
  "weakestDomain",
  "weakestPosition",
  // Tri-state on purpose: "yes" / "no" only when the provider reported the
  // page's element types; empty when it reported none or the page was never
  // sampled. A blank must stay a blank — "no" for an unsampled page would
  // claim an observation nobody made.
  "aiOverviewObserved",
  "coverage",
  "supportingPageUrl",
  "discoveryBasis",
  "clusterId",
  // Stable check codes joined with "|", not the localized sentences: someone
  // filtering the export filters on `verify_weak_site_breakthrough`, and that
  // has to keep working when the page is read in the other language.
  "checks",
  "providerIntent",
  "serpIntent",
  "youngDomainState",
  "youngDomain",
  "youngDomainAgeMonths",
  "lowOrganicTrafficDomainState",
  "lowOrganicTrafficDomain",
  "lowOrganicTrafficDomainEtv",
  "communityResultState",
  "communityResultDomain",
  "communityResultPosition",
  "aiOverviewAvailability",
  "aiOverviewAssessment",
  "aiOverviewDiscount",
  "decisionReason",
] as const;

/**
 * Leading characters Excel and Google Sheets treat as the start of a formula.
 *
 * Keywords come out of a model reading arbitrary websites; `=cmd|…` in a cell
 * is a known execution path. Text cells only — numbers we produced ourselves
 * must stay numbers or the export becomes unsortable.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Byte-order mark, written as an escape.
 *
 * Excel decodes UTF-8 as the local codepage without one, so every non-ASCII
 * keyword opens as mojibake. Escaped rather than typed: a literal BOM in
 * source is invisible in every editor and reads as a stray character to lint.
 */
const BOM = "\uFEFF";

function quote(value: string): string {
  if (!/["\n\r,]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function text(value: string): string {
  return quote(FORMULA_LEAD.test(value) ? `'${value}` : value);
}

/**
 * A number, or an empty cell when there is no number.
 *
 * Never a zero stand-in: an unavailable volume exported as 0 is exactly the
 * conflation the three-state volume design exists to prevent.
 */
function num(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(value);
}

// `undefined` accepted alongside the contract's `null`: a run that started on
// the previous deployment finishes on this one with a payload that predates
// the field, and the export must not crash on it. Both read as "not reported".
function aiOverviewCell(
  itemTypes: readonly string[] | null | undefined,
): string {
  if (itemTypes === null || itemTypes === undefined) return "";
  return itemTypes.includes("ai_overview") ? "yes" : "no";
}

function rowCells(
  result: KeywordOpportunityResult,
  row: KeywordOpportunityRow,
): string {
  const youngDomain = row.signals?.youngDomain;
  const lowTraffic = row.signals?.lowOrganicTrafficDomain;
  const community = row.signals?.communityResult;

  return [
    text(result.marketCode),
    text(result.languageCode),
    text(row.lane),
    text(row.keyword),
    num(row.validation.volume),
    num(row.validation.difficulty),
    num(row.serp.weakestTopTenDomainRank),
    text(row.serp.weakestTopTenDomain ?? ""),
    num(row.serp.weakestTopTenPosition),
    aiOverviewCell(row.serp.pageOneItemTypes),
    text(row.coverage),
    text(row.supportingPageUrl ?? ""),
    text(row.discoveryBasis),
    text(row.clusterId ?? ""),
    text(row.nextChecks.join("|")),
    text(row.validation.providerIntent ?? ""),
    text(row.serpIntent?.intent ?? ""),
    text(youngDomain?.state ?? ""),
    text(youngDomain?.state === "observed" ? youngDomain.observation.domain : ""),
    num(
      youngDomain?.state === "observed"
        ? youngDomain.observation.ageMonths
        : null,
    ),
    text(lowTraffic?.state ?? ""),
    text(lowTraffic?.state === "observed" ? lowTraffic.observation.domain : ""),
    num(
      lowTraffic?.state === "observed"
        ? lowTraffic.observation.organicEtv
        : null,
    ),
    text(community?.state ?? ""),
    text(community?.state === "observed" ? community.observation.domain : ""),
    num(
      community?.state === "observed"
        ? community.observation.position
        : null,
    ),
    text(row.aiOverview?.availability ?? ""),
    text(row.aiOverview?.answerAssessment ?? ""),
    row.decision === undefined
      ? ""
      : row.decision.discounts.includes("ai_overview_answer_discount")
        ? "yes"
        : "no",
    text(row.decision?.basis ?? ""),
  ].join(",");
}

export type KeywordOpportunityDisplayItem =
  | {
      readonly disposition: "eligible";
      readonly candidate: KeywordOpportunityRow;
    }
  | {
      readonly disposition: "excluded";
      readonly candidate: KeywordOpportunityWithheld;
    }
  | {
      readonly disposition: "incomplete";
      readonly candidate: KeywordOpportunityIncomplete;
    };

type KeywordOpportunityDisplayInput = Pick<
  KeywordOpportunityResult,
  "rows" | "withheld" | "incomplete"
>;

const DISPOSITION_ORDER = {
  eligible: 0,
  excluded: 1,
  incomplete: 2,
} as const;

const ELIGIBLE_LANE_ORDER = {
  seo: 0,
  geo: 1,
} as const;

/** Normalize only for deterministic ordering; the original keyword is shown. */
function normalizedKeyword(keyword: string): string {
  return keyword.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function finiteVolume(row: KeywordOpportunityRow): number | null {
  const volume = row.validation.volume;
  return volume !== null && Number.isFinite(volume) ? volume : null;
}

function compareNullableDescending(
  left: number | null,
  right: number | null,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return right - left;
}

function compareEligible(
  left: KeywordOpportunityRow,
  right: KeywordOpportunityRow,
): number {
  // The page renders SEO and GEO as separate sections in this order. CSV is a
  // flattened view of those sections, so lane grouping must precede the v2
  // evidence tuple or a high-signal GEO row would jump above the SEO section.
  const laneOrder =
    ELIGIBLE_LANE_ORDER[left.lane] - ELIGIBLE_LANE_ORDER[right.lane];
  if (laneOrder !== 0) return laneOrder;

  const signalOrder = compareNullableDescending(
    left.decision?.positiveSignals.length ?? null,
    right.decision?.positiveSignals.length ?? null,
  );
  if (signalOrder !== 0) return signalOrder;

  const leftDiscounted =
    left.decision?.discounts.includes("ai_overview_answer_discount") ?? false;
  const rightDiscounted =
    right.decision?.discounts.includes("ai_overview_answer_discount") ?? false;
  if (leftDiscounted !== rightDiscounted) return leftDiscounted ? 1 : -1;

  const volumeOrder = compareNullableDescending(
    finiteVolume(left),
    finiteVolume(right),
  );
  if (volumeOrder !== 0) return volumeOrder;

  return compareText(
    normalizedKeyword(left.keyword),
    normalizedKeyword(right.keyword),
  );
}

function compareReasoned(
  left: KeywordOpportunityWithheld | KeywordOpportunityIncomplete,
  right: KeywordOpportunityWithheld | KeywordOpportunityIncomplete,
): number {
  const keywordOrder = compareText(
    normalizedKeyword(left.keyword),
    normalizedKeyword(right.keyword),
  );
  if (keywordOrder !== 0) return keywordOrder;
  return compareText(left.reason, right.reason);
}

function compareDisplayItems(
  left: KeywordOpportunityDisplayItem,
  right: KeywordOpportunityDisplayItem,
): number {
  const dispositionOrder =
    DISPOSITION_ORDER[left.disposition] - DISPOSITION_ORDER[right.disposition];
  if (dispositionOrder !== 0) return dispositionOrder;

  if (left.disposition === "eligible" && right.disposition === "eligible") {
    return compareEligible(left.candidate, right.candidate);
  }
  if (left.disposition === "excluded" && right.disposition === "excluded") {
    return compareReasoned(left.candidate, right.candidate);
  }
  if (left.disposition === "incomplete" && right.disposition === "incomplete") {
    return compareReasoned(left.candidate, right.candidate);
  }
  return 0;
}

/**
 * One deterministic order across all three v2 result dispositions.
 *
 * Excluded and incomplete rows do not participate in eligible ranking. They
 * are ordered only by normalized keyword and exact reason; no absent or
 * partial metric is converted to zero to make the comparator convenient.
 */
export function keywordOpportunityDisplayItems(
  result: KeywordOpportunityDisplayInput,
): readonly KeywordOpportunityDisplayItem[] {
  for (const candidate of result.rows) {
    if (
      candidate.decision !== undefined &&
      candidate.decision.disposition !== "eligible"
    ) {
      throw new Error(
        `KeywordOpportunityResult.rows contains a ${candidate.decision.disposition} decision`,
      );
    }
  }

  const items: KeywordOpportunityDisplayItem[] = [
    ...result.rows.map(
      (candidate): KeywordOpportunityDisplayItem => ({
        disposition: "eligible",
        candidate,
      }),
    ),
    ...result.withheld.map(
      (candidate): KeywordOpportunityDisplayItem => ({
        disposition: "excluded",
        candidate,
      }),
    ),
    ...(result.incomplete ?? []).map(
      (candidate): KeywordOpportunityDisplayItem => ({
        disposition: "incomplete",
        candidate,
      }),
    ),
  ];
  return items.sort(compareDisplayItems);
}

/**
 * Eligible-only compatibility view of the shared v2 order.
 *
 * Shared by the on-screen tables and the export below because the file and
 * the page are the same claim — a reader who downloads and then compares
 * must not find the two disagreeing about order. Two independent sorts
 * would drift the first time one of them changes.
 */
export function keywordOpportunityDisplayRows(
  rows: readonly KeywordOpportunityRow[],
): readonly KeywordOpportunityRow[] {
  return keywordOpportunityDisplayItems({ rows, withheld: [] }).flatMap(
    (item) =>
      item.disposition === "eligible" ? [item.candidate] : [],
  );
}

/** The shown rows as CSV, in the order the surface displays them. */
export function keywordOpportunityCsv(
  result: KeywordOpportunityResult,
): string {
  const header = COLUMNS.join(",");
  const rows = keywordOpportunityDisplayRows(result.rows).map((row) =>
    rowCells(result, row),
  );
  // CRLF because RFC 4180 specifies it and Excel is the least forgiving
  // reader of the two conventions.
  return `${BOM}${[header, ...rows].join("\r\n")}`;
}

const CODE = /^[A-Za-z]{2}$/;

/**
 * The download filename, carrying the market the volumes were priced for.
 *
 * The codes arrive from an API payload, so they are validated rather than
 * interpolated; an unrecognized pair loses the suffix instead of the file,
 * since both codes are also inside the file itself.
 */
export function keywordOpportunityCsvFilename(result: {
  readonly marketCode: string;
  readonly languageCode: string;
}): string {
  if (!CODE.test(result.marketCode) || !CODE.test(result.languageCode)) {
    return "keyword-opportunity-map.csv";
  }
  return `keyword-opportunity-map-${result.marketCode.toLowerCase()}-${result.languageCode.toLowerCase()}.csv`;
}
