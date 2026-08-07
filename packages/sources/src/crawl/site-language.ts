import { SourceError } from "../adapter.ts";

/**
 * This is an independent snapshot-summary projection, not a field in the
 * frozen `crawl.site_graph.v2` raw payload or `crawl.page.v1` observation.
 */
export const CRAWL_SITE_LANGUAGE_SUMMARY_VERSION_V1 =
  "crawl.site-language-summary.v1" as const;
/**
 * v2 adds `tagCounts` + `dominantTag`. The literal is bumped rather than the
 * members made optional because the reader validates an EXACT key set: one
 * version literal has to name exactly one shape, or every consumer has to guess
 * which generation it is holding. v1 payloads keep their own frozen shape and
 * are never backfilled with counts they never carried.
 */
export const CRAWL_SITE_LANGUAGE_SUMMARY_VERSION =
  "crawl.site-language-summary.v2" as const;
export const CRAWL_SITE_LANGUAGE_EVIDENCE_LIMIT = 50;
const MAX_LANGUAGE_TAG_CHARS = 128;

export interface HtmlLanguageDeclaration {
  /** Trimmed declaration exactly as observed, bounded for persistence. */
  readonly declaredTag: string;
  /** Canonical BCP-47 tag, or null when the declaration is invalid. */
  readonly canonicalTag: string | null;
}

export interface CrawlPageLanguageEvidence {
  readonly fetchUrl: string;
  readonly declaration: HtmlLanguageDeclaration | null;
}

export type CrawlSiteLanguageStatus =
  | "resolved"
  | "missing"
  | "invalid"
  | "conflicting";

export interface CrawlSiteLanguageEvidenceSample {
  readonly fetchUrl: string;
  readonly declaredTag: string;
  readonly canonicalTag: string | null;
}

export interface CrawlSiteLanguageTagCount {
  readonly canonicalTag: string;
  readonly declaredPageCount: number;
}

export interface CrawlSiteLanguageSummary {
  readonly schemaVersion:
    | typeof CRAWL_SITE_LANGUAGE_SUMMARY_VERSION
    | typeof CRAWL_SITE_LANGUAGE_SUMMARY_VERSION_V1;
  readonly status: CrawlSiteLanguageStatus;
  readonly languageTag: string | null;
  readonly pagesAnalyzed: number;
  readonly declaredPageCount: number;
  readonly missingPageCount: number;
  readonly invalidDeclarationCount: number;
  readonly canonicalTags: readonly string[];
  /**
   * The canonical tag declared by the most pages; ties resolve to the
   * ASCII-lowest tag so this stays a deterministic function of the evidence.
   * `null` when no page carried a valid declaration, and on a historical v1
   * summary that never counted declarations per tag.
   */
  readonly dominantTag: string | null;
  /**
   * One entry per member of `canonicalTags`, in the same order. `null` — not
   * `[]` — on a v1 summary: unknown is not zero.
   */
  readonly tagCounts: readonly CrawlSiteLanguageTagCount[] | null;
  readonly evidence: readonly CrawlSiteLanguageEvidenceSample[];
  readonly omittedEvidenceCount: number;
}

function boundCodePoints(value: string, limit: number): string {
  return [...value].slice(0, limit).join("");
}

function canonicalLanguageTag(value: string): string | null {
  if (value.length === 0 || value.length > MAX_LANGUAGE_TAG_CHARS) return null;
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    return canonical ?? null;
  } catch {
    return null;
  }
}

/** Parse only the `<html lang>` declaration; no language is guessed from text. */
export function parseHtmlLanguageDeclaration(
  rawValue: string | null,
): HtmlLanguageDeclaration | null {
  const trimmed = rawValue?.trim() ?? "";
  if (trimmed === "") return null;
  const declaredTag = boundCodePoints(trimmed, MAX_LANGUAGE_TAG_CHARS);
  return {
    declaredTag,
    canonicalTag:
      trimmed.length > MAX_LANGUAGE_TAG_CHARS
        ? null
        : canonicalLanguageTag(trimmed),
  };
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Pick the most-declared tag from ASCII-ordered counts. Only a strictly higher
 * count wins, so an exact tie keeps the ASCII-lowest tag and the answer never
 * depends on crawl order.
 */
function dominantLanguageTag(
  tagCounts: readonly CrawlSiteLanguageTagCount[],
): string | null {
  let dominant: CrawlSiteLanguageTagCount | null = null;
  for (const entry of tagCounts) {
    if (
      dominant === null ||
      entry.declaredPageCount > dominant.declaredPageCount
    ) {
      dominant = entry;
    }
  }
  return dominant?.canonicalTag ?? null;
}

/**
 * The one site language this Crawl may project onto its Site.
 *
 * A single-language site simply resolves. A multilingual site stays
 * `conflicting` — the summary never relabels its own evidence — but when one
 * tag is declared by strictly more pages than every other, that plurality is an
 * observed fact about the site rather than an inference, and is safe to offer
 * as the site's primary language. An exact tie is a coin flip and returns null:
 * that call belongs to the Owner. Historical v1 summaries carry no counts and
 * are never reinterpreted.
 */
export function projectableSiteLanguageTag(
  summary: CrawlSiteLanguageSummary,
): string | null {
  if (summary.status === "resolved") return summary.languageTag;
  if (summary.status !== "conflicting" || summary.tagCounts === null) {
    return null;
  }
  const dominant = dominantLanguageTag(summary.tagCounts);
  if (dominant === null) return null;
  const [best, runnerUp] = [...summary.tagCounts]
    .map((entry) => entry.declaredPageCount)
    .sort((left, right) => right - left);
  return best !== undefined && runnerUp !== undefined && best > runnerUp
    ? dominant
    : null;
}

/**
 * Fold all retained Crawl pages into one fail-closed site language decision.
 * Missing declarations do not contradict a valid declaration; any invalid
 * declaration or more than one canonical tag prevents RESOLUTION. A site that
 * declares several languages still reports every tag with its page count, so a
 * reader can tell a bilingual site apart from an undecidable one without the
 * status pretending the site speaks one language.
 */
export function buildCrawlSiteLanguageSummary(
  pages: readonly CrawlPageLanguageEvidence[],
): CrawlSiteLanguageSummary {
  const ordered = [...pages].sort((left, right) =>
    compareAscii(left.fetchUrl, right.fetchUrl),
  );
  const declarations = ordered.filter(
    (
      page,
    ): page is CrawlPageLanguageEvidence & {
      readonly declaration: HtmlLanguageDeclaration;
    } => page.declaration !== null,
  );
  const invalidDeclarationCount = declarations.filter(
    (page) => page.declaration.canonicalTag === null,
  ).length;
  const declaredPagesByTag = new Map<string, number>();
  for (const page of declarations) {
    const tag = page.declaration.canonicalTag;
    if (tag === null) continue;
    declaredPagesByTag.set(tag, (declaredPagesByTag.get(tag) ?? 0) + 1);
  }
  const canonicalTags = [...declaredPagesByTag.keys()].sort(compareAscii);
  const tagCounts = canonicalTags.map((canonicalTag) => ({
    canonicalTag,
    declaredPageCount: declaredPagesByTag.get(canonicalTag) ?? 0,
  }));
  const status: CrawlSiteLanguageStatus =
    invalidDeclarationCount > 0
      ? "invalid"
      : canonicalTags.length > 1
        ? "conflicting"
        : canonicalTags.length === 1
          ? "resolved"
          : "missing";
  const evidence = declarations
    .slice(0, CRAWL_SITE_LANGUAGE_EVIDENCE_LIMIT)
    .map((page) => ({
      fetchUrl: page.fetchUrl,
      declaredTag: page.declaration.declaredTag,
      canonicalTag: page.declaration.canonicalTag,
    }));

  return {
    schemaVersion: CRAWL_SITE_LANGUAGE_SUMMARY_VERSION,
    status,
    languageTag: status === "resolved" ? canonicalTags[0]! : null,
    pagesAnalyzed: ordered.length,
    declaredPageCount: declarations.length,
    missingPageCount: ordered.length - declarations.length,
    invalidDeclarationCount,
    canonicalTags,
    dominantTag: dominantLanguageTag(tagCounts),
    tagCounts,
    evidence,
    omittedEvidenceCount: declarations.length - evidence.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function invalidSummary(): never {
  throw new SourceError(
    "INVALID_RESPONSE",
    "Crawl site-language snapshot summary is invalid.",
  );
}

const SUMMARY_KEYS_V1 = [
  "schemaVersion",
  "status",
  "languageTag",
  "pagesAnalyzed",
  "declaredPageCount",
  "missingPageCount",
  "invalidDeclarationCount",
  "canonicalTags",
  "evidence",
  "omittedEvidenceCount",
] as const;
const SUMMARY_KEYS_V2 = [
  ...SUMMARY_KEYS_V1,
  "dominantTag",
  "tagCounts",
] as const;

/**
 * Strictly read the optional versioned member before it can update a Site.
 * Historical crawl.site_graph.v2 snapshots without this member remain valid and
 * return null.
 *
 * Each summary version is read under its own exact key set. A v1 payload is
 * neither upgraded nor re-derived: it reports its per-tag counts as unknown,
 * because it never had them.
 */
export function parseCrawlSiteLanguageSnapshotSummary(
  snapshotSummary: unknown,
): CrawlSiteLanguageSummary | null {
  if (!isRecord(snapshotSummary) || !Object.hasOwn(snapshotSummary, "siteLanguage")) {
    return null;
  }
  const value = snapshotSummary["siteLanguage"];
  const countsAreDeclared =
    isRecord(value) &&
    value["schemaVersion"] === CRAWL_SITE_LANGUAGE_SUMMARY_VERSION;
  const schemaVersion = countsAreDeclared
    ? CRAWL_SITE_LANGUAGE_SUMMARY_VERSION
    : CRAWL_SITE_LANGUAGE_SUMMARY_VERSION_V1;
  if (
    !isRecord(value) ||
    !exactKeys(value, countsAreDeclared ? SUMMARY_KEYS_V2 : SUMMARY_KEYS_V1) ||
    value["schemaVersion"] !== schemaVersion
  ) {
    invalidSummary();
  }

  const status = value["status"];
  const languageTag = value["languageTag"];
  const pagesAnalyzed = value["pagesAnalyzed"];
  const declaredPageCount = value["declaredPageCount"];
  const missingPageCount = value["missingPageCount"];
  const invalidDeclarationCount = value["invalidDeclarationCount"];
  const omittedEvidenceCount = value["omittedEvidenceCount"];
  if (
    (status !== "resolved" &&
      status !== "missing" &&
      status !== "invalid" &&
      status !== "conflicting") ||
    (languageTag !== null && typeof languageTag !== "string") ||
    !nonnegativeInteger(pagesAnalyzed) ||
    !nonnegativeInteger(declaredPageCount) ||
    !nonnegativeInteger(missingPageCount) ||
    !nonnegativeInteger(invalidDeclarationCount) ||
    !nonnegativeInteger(omittedEvidenceCount) ||
    declaredPageCount + missingPageCount !== pagesAnalyzed ||
    invalidDeclarationCount > declaredPageCount
  ) {
    invalidSummary();
  }

  const rawCanonicalTags = value["canonicalTags"];
  if (!Array.isArray(rawCanonicalTags)) invalidSummary();
  const canonicalTags = rawCanonicalTags as unknown[];
  if (
    canonicalTags.some(
      (tag) =>
        typeof tag !== "string" || canonicalLanguageTag(tag) !== tag,
    ) ||
    new Set(canonicalTags).size !== canonicalTags.length ||
    [...canonicalTags].sort((left, right) =>
      compareAscii(left as string, right as string),
    ).some((tag, index) => tag !== canonicalTags[index])
  ) {
    invalidSummary();
  }

  const rawEvidence = value["evidence"];
  if (
    !Array.isArray(rawEvidence) ||
    rawEvidence.length > CRAWL_SITE_LANGUAGE_EVIDENCE_LIMIT ||
    rawEvidence.length + omittedEvidenceCount !== declaredPageCount
  ) {
    invalidSummary();
  }
  const evidence: CrawlSiteLanguageEvidenceSample[] = rawEvidence.map(
    (candidate) => {
      if (
        !isRecord(candidate) ||
        !exactKeys(candidate, ["fetchUrl", "declaredTag", "canonicalTag"]) ||
        typeof candidate["fetchUrl"] !== "string" ||
        typeof candidate["declaredTag"] !== "string" ||
        candidate["declaredTag"].length === 0 ||
        candidate["declaredTag"].length > MAX_LANGUAGE_TAG_CHARS ||
        (candidate["canonicalTag"] !== null &&
          (typeof candidate["canonicalTag"] !== "string" ||
            canonicalLanguageTag(candidate["canonicalTag"]) !==
              candidate["canonicalTag"]))
      ) {
        invalidSummary();
      }
      try {
        const url = new URL(candidate["fetchUrl"]);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          invalidSummary();
        }
      } catch {
        invalidSummary();
      }
      const reparsed = parseHtmlLanguageDeclaration(candidate["declaredTag"]);
      if (
        reparsed === null ||
        reparsed.canonicalTag !== candidate["canonicalTag"]
      ) {
        invalidSummary();
      }
      return {
        fetchUrl: candidate["fetchUrl"],
        declaredTag: candidate["declaredTag"],
        canonicalTag: candidate["canonicalTag"],
      };
    },
  );

  const typedCanonicalTags = canonicalTags as string[];
  const evidenceFetchUrls = evidence.map((sample) => sample.fetchUrl);
  const sampledCanonicalTags = new Set(
    evidence.flatMap((sample) =>
      sample.canonicalTag === null ? [] : [sample.canonicalTag],
    ),
  );
  const sampledInvalidCount = evidence.filter(
    (sample) => sample.canonicalTag === null,
  ).length;
  if (
    new Set(evidenceFetchUrls).size !== evidenceFetchUrls.length ||
    sampledInvalidCount > invalidDeclarationCount ||
    [...sampledCanonicalTags].some(
      (tag) => !typedCanonicalTags.includes(tag),
    ) ||
    typedCanonicalTags.length >
      declaredPageCount - invalidDeclarationCount ||
    (status === "resolved" &&
      (invalidDeclarationCount !== 0 ||
        typedCanonicalTags.length !== 1 ||
        languageTag !== typedCanonicalTags[0])) ||
    (status === "missing" &&
      (declaredPageCount !== 0 ||
        invalidDeclarationCount !== 0 ||
        typedCanonicalTags.length !== 0 ||
        languageTag !== null)) ||
    (status === "invalid" &&
      (invalidDeclarationCount === 0 || languageTag !== null)) ||
    (status === "conflicting" &&
      (invalidDeclarationCount !== 0 ||
        typedCanonicalTags.length < 2 ||
        languageTag !== null))
  ) {
    invalidSummary();
  }

  // The counts must reconstruct the same decision the writer recorded: one
  // entry per canonical tag in the same order, every declared page attributed
  // exactly once, and a dominant tag that is recomputable from them.
  let tagCounts: CrawlSiteLanguageTagCount[] | null = null;
  let dominantTag: string | null = null;
  if (countsAreDeclared) {
    const rawTagCounts = value["tagCounts"];
    if (
      !Array.isArray(rawTagCounts) ||
      rawTagCounts.length !== typedCanonicalTags.length
    ) {
      invalidSummary();
    }
    tagCounts = (rawTagCounts as unknown[]).map((candidate, index) => {
      if (
        !isRecord(candidate) ||
        !exactKeys(candidate, ["canonicalTag", "declaredPageCount"]) ||
        candidate["canonicalTag"] !== typedCanonicalTags[index] ||
        !nonnegativeInteger(candidate["declaredPageCount"]) ||
        candidate["declaredPageCount"] < 1
      ) {
        invalidSummary();
      }
      return {
        canonicalTag: candidate["canonicalTag"] as string,
        declaredPageCount: candidate["declaredPageCount"] as number,
      };
    });
    const countedPages = tagCounts.reduce(
      (total, entry) => total + entry.declaredPageCount,
      0,
    );
    dominantTag = dominantLanguageTag(tagCounts);
    if (
      countedPages + invalidDeclarationCount !== declaredPageCount ||
      value["dominantTag"] !== dominantTag
    ) {
      invalidSummary();
    }
  }

  return {
    schemaVersion,
    status,
    languageTag,
    pagesAnalyzed,
    declaredPageCount,
    missingPageCount,
    invalidDeclarationCount,
    canonicalTags: typedCanonicalTags,
    dominantTag,
    tagCounts,
    evidence,
    omittedEvidenceCount,
  };
}
