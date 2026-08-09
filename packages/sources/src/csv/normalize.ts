/**
 * CONFIRM phase of the two-phase keyword-gap CSV import (spec §7.5). Given the
 * operator's final column mapping (plus optional whole-import market/language
 * fallbacks), produce one `csv.keyword_gap.v1` observation per accepted row and
 * a list of rejected rows with a stable reason.
 *
 * Evidence honesty (spec §1.3, §7.5): an EMPTY searchVolume/rank cell becomes
 * `null` (unavailable), NEVER 0. A row whose searchVolume is empty is still an
 * AVAILABLE observation — only the `searchVolume` field inside the projection is
 * null. Rows are rejected only for a missing/oversize keyword, an underivable
 * cluster key, or an invalid/missing market or language code (spec §7.5).
 */

import { isBcp47LanguageTag } from "@sf/contracts";
import {
  buildObservation,
  METRIC_CSV_KEYWORD_GAP,
  type CsvKeywordProjection,
} from "../observations.ts";
import { SourceError, type NormalizedObservation } from "../adapter.ts";
import { parseCsv } from "./parse.ts";
import { clusterKey } from "./cluster-key.ts";
import type { CsvColumnMapping } from "./mapping.ts";

/** Maximum accepted keyword length (spec §7.5). */
const MAX_KEYWORD_LENGTH = 500;

/**
 * The limitation carried by every CSV snapshot + observation (spec §1.3, §7.5).
 * Must be NON-EMPTY: `data_snapshots.limitation` and
 * `normalized_observations.limitation` both CHECK `length(btrim(...)) >= 1`.
 */
export const CSV_LIMITATION =
  "Keyword-gap search volumes and ranks are user-provided CSV data; clustering is a heuristic over the imported rows.";

/** ISO 3166-1 alpha-2: exactly two ASCII letters. */
const MARKET_CODE_RE = /^[A-Za-z]{2}$/;

/** A DNS hostname with at least one dot (LDH labels, <= 253 chars). */
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface NormalizeCsvOptions {
  /** Applied when a row has no market column value (spec §7.5). */
  readonly marketFallback?: string;
  /** Applied when a row has no language column value (spec §7.5). */
  readonly languageFallback?: string;
  /** Observation timestamp; the confirm service passes ctx.capturedAt. */
  readonly observedAt?: string;
}

export interface RejectedRow {
  /** 0-based index into the parsed data rows. */
  readonly rowIndex: number;
  readonly reason: string;
}

export interface NormalizeCsvResult {
  readonly observations: readonly NormalizedObservation[];
  readonly rejectedRows: readonly RejectedRow[];
}

type RowOutcome =
  | {
      readonly kind: "observation";
      readonly observation: NormalizedObservation;
    }
  | { readonly kind: "rejected"; readonly reason: string };

const reject = (reason: string): RowOutcome => ({ kind: "rejected", reason });

const isMarketCode = (value: string): boolean => MARKET_CODE_RE.test(value);
const isLanguageTag = (value: string): boolean =>
  isBcp47LanguageTag(value);

/** Parse a non-negative integer cell; empty or invalid -> null (never 0). */
function parseSearchVolume(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (cleaned === "" || !/^\d+$/.test(cleaned)) return null;
  const value = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/** Parse a non-negative rank cell; empty or invalid -> null (never 0). */
function parseRank(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Normalize an absolute http(s) URL, or null when absent/invalid. */
function normalizeAbsoluteUrl(raw: string): string | null {
  if (raw === "") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Normalize a bare hostname or a URL's host, or null when absent/invalid. */
function normalizeHostname(raw: string): string | null {
  if (raw === "") return null;
  let candidate = raw.toLowerCase();
  if (candidate.includes("://")) {
    try {
      candidate = new URL(raw).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return HOSTNAME_RE.test(candidate) ? candidate : null;
}

/** Fail fast (spec §7.5) when required columns/fallbacks are absent or invalid. */
function assertMappingComplete(
  mapping: CsvColumnMapping,
  marketFallback: string | null,
  languageFallback: string | null,
): void {
  if (mapping.keyword === null) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "keyword column is not mapped",
    );
  }
  if (mapping.searchVolume === null) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "searchVolume column is not mapped",
    );
  }
  if (mapping.marketCode === null && marketFallback === null) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "marketCode column is not mapped and no market fallback was provided",
    );
  }
  if (mapping.languageCode === null && languageFallback === null) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "languageCode column is not mapped and no language fallback was provided",
    );
  }
  if (marketFallback !== null && !isMarketCode(marketFallback)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "market fallback is not a valid ISO 3166-1 alpha-2 code",
    );
  }
  if (languageFallback !== null && !isLanguageTag(languageFallback)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "language fallback is not a valid BCP-47 language tag",
    );
  }
}

function normalizeRow(
  row: readonly string[],
  mapping: CsvColumnMapping,
  marketFallback: string | null,
  languageFallback: string | null,
  observedAt: string,
): RowOutcome {
  const cell = (index: number | null): string =>
    index === null ? "" : (row[index] ?? "").trim();

  const keyword = cell(mapping.keyword);
  if (keyword === "") return reject("keyword_missing");
  if (keyword.length > MAX_KEYWORD_LENGTH) return reject("keyword_too_long");

  const providedCluster = cell(mapping.cluster);
  const cluster =
    providedCluster !== "" ? providedCluster : clusterKey(keyword);
  if (cluster === null) return reject("cluster_no_tokens");

  const marketRaw = cell(mapping.marketCode) || (marketFallback ?? "");
  if (marketRaw === "") return reject("market_missing");
  const marketCode = marketRaw.toUpperCase();
  if (!isMarketCode(marketCode)) return reject("market_invalid");

  const languageCode = cell(mapping.languageCode) || (languageFallback ?? "");
  if (languageCode === "") return reject("language_missing");
  if (!isLanguageTag(languageCode)) return reject("language_invalid");

  const projection: CsvKeywordProjection = {
    keyword,
    clusterKey: cluster,
    searchVolume: parseSearchVolume(cell(mapping.searchVolume)),
    keywordDifficulty: null,
    providerSearchIntent: null,
    currentUrl: normalizeAbsoluteUrl(cell(mapping.currentUrl)),
    currentRank: parseRank(cell(mapping.currentRank)),
    competitorDomain: normalizeHostname(cell(mapping.competitorDomain)),
    competitorRank: parseRank(cell(mapping.competitorRank)),
    marketCode,
    languageCode,
  };

  const observation = buildObservation({
    provider: "csv",
    metricKey: METRIC_CSV_KEYWORD_GAP,
    subjectType: "keyword_cluster",
    subjectRef: cluster,
    observedAt,
    availability: "available",
    value: { json: projection },
    limitation: CSV_LIMITATION,
  });
  return { kind: "observation", observation };
}

/**
 * Confirm-phase transform: parse the CSV, apply the operator mapping, and emit
 * observations for accepted rows plus a reason for each rejected row.
 */
export function normalizeCsv(
  text: string,
  mapping: CsvColumnMapping,
  options?: NormalizeCsvOptions,
): NormalizeCsvResult {
  const observedAt = options?.observedAt ?? new Date().toISOString();
  const marketFallback = options?.marketFallback ?? null;
  const languageFallback = options?.languageFallback ?? null;
  assertMappingComplete(mapping, marketFallback, languageFallback);

  const { rows } = parseCsv(text);
  const observations: NormalizedObservation[] = [];
  const rejectedRows: RejectedRow[] = [];

  rows.forEach((row, rowIndex) => {
    const outcome = normalizeRow(
      row,
      mapping,
      marketFallback,
      languageFallback,
      observedAt,
    );
    if (outcome.kind === "rejected") {
      rejectedRows.push({ rowIndex, reason: outcome.reason });
    } else {
      observations.push(outcome.observation);
    }
  });

  return { observations, rejectedRows };
}
