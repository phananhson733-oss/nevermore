/**
 * Column detection and fuzzy header -> canonical-field mapping for the
 * keyword-gap CSV import (spec §7.5). `suggestMapping` produces a best-effort
 * mapping the operator then confirms/edits; `detectColumns` exposes the
 * per-column detection so the preview UI can render suggestions inline.
 *
 * Pure and deterministic. Mapping is by column INDEX (not header text) so
 * duplicate or blank header names cannot collide downstream.
 */

/** Canonical target fields an operator maps CSV columns onto (spec §7.5). */
export type CsvCanonicalField =
  | "keyword"
  | "searchVolume"
  | "cluster"
  | "currentUrl"
  | "currentRank"
  | "competitorDomain"
  | "competitorRank"
  | "marketCode"
  | "languageCode";

/**
 * The operator's column mapping: canonical field -> source column index, or
 * `null` when that field is unmapped.
 */
export interface CsvColumnMapping {
  readonly keyword: number | null;
  readonly searchVolume: number | null;
  readonly cluster: number | null;
  readonly currentUrl: number | null;
  readonly currentRank: number | null;
  readonly competitorDomain: number | null;
  readonly competitorRank: number | null;
  readonly marketCode: number | null;
  readonly languageCode: number | null;
}

/** One detected source column with its best-guess canonical field. */
export interface DetectedColumn {
  readonly index: number;
  readonly header: string;
  readonly normalized: string;
  readonly suggestedField: CsvCanonicalField | null;
}

/** Lowercase, NFKC-fold, and collapse non-alphanumeric runs to single spaces. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Map a normalized header string to a canonical field (most specific first). */
function suggestField(normalized: string): CsvCanonicalField | null {
  if (normalized === "") return null;
  const tokens = new Set(normalized.split(" "));
  const has = (token: string): boolean => tokens.has(token);
  const includes = (phrase: string): boolean => normalized.includes(phrase);

  const isCompetitor =
    has("competitor") || has("competitors") || has("rival") || has("comp");
  const isRank =
    has("rank") || has("ranks") || has("ranking") || has("rankings") ||
    has("position") || has("positions") || has("pos");

  if (isCompetitor && isRank) return "competitorRank";
  if (isCompetitor) return "competitorDomain";
  if (isRank) return "currentRank";
  if (has("cluster") || has("clusterkey") || has("topic") || has("group")) {
    return "cluster";
  }
  if (
    includes("search volume") || includes("monthly searches") ||
    has("volume") || has("vol") || has("sv") || has("msv") || has("searches")
  ) {
    return "searchVolume";
  }
  if (
    has("keyword") || has("keywords") || has("query") || has("queries") ||
    has("term") || has("terms") || has("phrase") || has("kw")
  ) {
    return "keyword";
  }
  if (
    has("url") || has("page") || has("link") || has("permalink") ||
    includes("landing page")
  ) {
    return "currentUrl";
  }
  if (has("domain") || has("website") || has("site") || has("host")) {
    return "competitorDomain";
  }
  if (
    has("market") || has("country") || has("countrycode") || has("geo") ||
    has("region") || has("location") || has("locations")
  ) {
    return "marketCode";
  }
  if (
    has("language") || has("languagecode") || has("locale") || has("lang")
  ) {
    return "languageCode";
  }
  return null;
}

/** Detect every source column with its best-guess canonical field. */
export function detectColumns(headers: readonly string[]): readonly DetectedColumn[] {
  return headers.map((header, index) => {
    const normalized = normalizeHeader(header);
    return { index, header, normalized, suggestedField: suggestField(normalized) };
  });
}

/**
 * Build a best-effort column mapping. For each canonical field the LOWEST
 * matching column index wins; unmatched fields stay `null`.
 */
export function suggestMapping(headers: readonly string[]): CsvColumnMapping {
  const detected = detectColumns(headers);
  const find = (field: CsvCanonicalField): number | null => {
    const column = detected.find((entry) => entry.suggestedField === field);
    return column ? column.index : null;
  };
  return {
    keyword: find("keyword"),
    searchVolume: find("searchVolume"),
    cluster: find("cluster"),
    currentUrl: find("currentUrl"),
    currentRank: find("currentRank"),
    competitorDomain: find("competitorDomain"),
    competitorRank: find("competitorRank"),
    marketCode: find("marketCode"),
    languageCode: find("languageCode"),
  };
}
