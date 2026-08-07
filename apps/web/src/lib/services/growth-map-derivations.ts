import { isCommercialUrl } from "@sf/engine";

/**
 * Deterministic read-time derivations for the Growth Map URL portfolio.
 *
 * These live beside the frozen-run projection rather than inside it because
 * they read only already validated projection values, and because both the
 * per-URL projection and the generation-wide summary must call exactly the
 * same implementation.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `page_type.v1`: a stable slug for the product's eleven page classes, derived
 * at read time from the frozen Crawl page extract plus the canonical path.
 *
 * It is deliberately not persisted. `site_pages.template_key` is the anchor a
 * `affected_by_template` FindingTarget resolves against and is validated by the
 * 0042 rule-set constraint, so a page class must never be written there.
 *
 * Deriving on read also means an already frozen generation gains the
 * classification without a migration or a re-run, and a null answer means
 * "no rule matched" — never "the page was not collected".
 */
export const PAGE_TYPE_VERSION = "page_type.v1";

export type GrowthMapPageType =
  | "home"
  | "product"
  | "blog"
  | "integration"
  | "comparison"
  | "commercial"
  | "resource"
  | "trust"
  | "solution"
  | "template"
  | "documentation";

export interface GrowthMapPageTypeInput {
  readonly normalizedUrl: string;
  /** Verified frozen crawl projection; null when the URL has no PageSnapshot. */
  readonly projection: Record<string, unknown> | null;
  /** Frozen Site language codes; empty or absent means undeclared. */
  readonly declaredLanguageCodes?: readonly string[];
}

/**
 * Locale path segments stripped before matching. The frozen
 * `contextProjection.siteLanguage` is authoritative when the Site declared
 * anything, but a bilingual site whose `language_codes` is empty (the common
 * case for older generations) would otherwise lose every `/zh/...` path, so a
 * fixed ISO 639-1 list is always unioned in. Only an exact whitelist match is
 * stripped: a bare two-letter regex would eat real sections such as `/vs/`.
 */
const FALLBACK_LOCALE_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "ar", "bg", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he",
  "hi", "hu", "id", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ro",
  "ru", "sv", "th", "tr", "uk", "vi", "zh",
  "de-de", "en-au", "en-ca", "en-gb", "en-us", "es-es", "es-mx", "fr-ca",
  "fr-fr", "ja-jp", "ko-kr", "pt-br", "pt-pt", "zh-cn", "zh-hans",
  "zh-hant", "zh-hk", "zh-tw",
]);

/**
 * Ordered path-segment rules, first match wins, scanned left to right so the
 * outermost section of a URL decides. `/wiki/...` is classified as
 * documentation by product decision, which also keeps a wiki-shaped content
 * site out of the "unclassified" bucket entirely.
 */
const PAGE_TYPE_SEGMENT_RULES: readonly (readonly [GrowthMapPageType, RegExp])[] =
  [
    [
      "documentation",
      /^(docs?|documentation|wiki|manual|guide|guides|reference|api|help|kb|knowledge-?base|support|faq)$/u,
    ],
    [
      "blog",
      /^(blog|blogs|news|article|articles|post|posts|insights|stories)$/u,
    ],
    [
      "integration",
      /^(integration|integrations|app|apps|plugin|plugins|connector|connectors|extension|extensions|marketplace)$/u,
    ],
    [
      "comparison",
      /^(vs|versus|compare|comparisons?|alternatives?)$/u,
    ],
    [
      "template",
      /^(templates?|examples?|boilerplates?|starters?)$/u,
    ],
    [
      "resource",
      /^(resources?|ebooks?|whitepapers?|webinars?|downloads?|tools?|glossary|library|academy|courses?)$/u,
    ],
    [
      "trust",
      /^(customers?|case-stud(y|ies)|testimonials?|reviews?|security|trust|privacy|terms|legal|compliance|about|about-us|company|team|careers?)$/u,
    ],
    [
      "solution",
      /^(solutions?|use-cases?|usecases?|industry|industries|for)$/u,
    ],
    ["product", /^(products?|features?|platform)$/u],
  ] as const;

/** Language-neutral comparison marker in a slug, e.g. `notion-vs-obsidian`. */
const COMPARISON_SLUG = /(^|-)vs(-|$)/u;

const NO_PRIORITY_URLS: ReadonlySet<string> = new Set();

function localePathSegments(
  declared: readonly string[] | undefined,
): ReadonlySet<string> {
  const segments = new Set(FALLBACK_LOCALE_PATH_SEGMENTS);
  for (const code of declared ?? []) {
    const normalized = code.trim().toLowerCase();
    if (normalized.length === 0) continue;
    segments.add(normalized);
    const primary = normalized.split("-")[0];
    if (primary !== undefined && primary.length > 0) segments.add(primary);
  }
  return segments;
}

function canonicalPathSegments(
  normalizedUrl: string,
  declared: readonly string[] | undefined,
): readonly string[] | null {
  let pathname: string;
  try {
    pathname = new URL(normalizedUrl).pathname;
  } catch {
    return null;
  }
  const segments = pathname
    .toLowerCase()
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .filter((segment) => segment.length > 0);
  const first = segments[0];
  if (first !== undefined && localePathSegments(declared).has(first)) {
    return segments.slice(1);
  }
  return segments;
}

function jsonLdPageType(
  projection: Record<string, unknown>,
): GrowthMapPageType | null {
  const jsonLd = projection["jsonLd"];
  if (!isRecord(jsonLd)) return null;
  const rawTypes = jsonLd["types"];
  if (!Array.isArray(rawTypes)) return null;
  const types = new Set(
    rawTypes
      .filter((value): value is string => typeof value === "string")
      // schema.org types are frequently emitted as absolute URLs.
      .map((value) => (value.split("/").at(-1) ?? "").trim().toLowerCase()),
  );
  const ordered: readonly (readonly [GrowthMapPageType, readonly string[]])[] = [
    ["product", ["product", "individualproduct", "offer", "softwareapplication"]],
    ["blog", ["blogposting", "newsarticle", "liveblogposting", "article"]],
    ["documentation", ["faqpage", "howto", "techarticle", "apireference"]],
  ];
  for (const [pageType, candidates] of ordered) {
    if (candidates.some((candidate) => types.has(candidate))) return pageType;
  }
  return null;
}

/**
 * Classify one URL. Path first (it is the operator-visible, language-neutral
 * signal and the decreed authority for `/wiki/`), then the frozen commercial
 * path pattern the diagnostic rules already share, then structured data.
 *
 * `title` and `h1` are deliberately not consulted: they are free text in an
 * arbitrary site language, so a substring rule over them would be a guess
 * dressed as a deterministic classification.
 */
export function classifyGrowthMapPageType(
  input: GrowthMapPageTypeInput,
): GrowthMapPageType | null {
  const segments = canonicalPathSegments(
    input.normalizedUrl,
    input.declaredLanguageCodes,
  );
  if (segments === null) return null;
  if (segments.length === 0) return "home";

  for (const segment of segments) {
    for (const [pageType, pattern] of PAGE_TYPE_SEGMENT_RULES) {
      if (pattern.test(segment)) return pageType;
    }
  }
  const last = segments.at(-1);
  if (last !== undefined && COMPARISON_SLUG.test(last)) return "comparison";

  if (isCommercialUrl(input.normalizedUrl, NO_PRIORITY_URLS)) {
    return "commercial";
  }

  if (input.projection !== null) {
    const contentType = input.projection["contentType"];
    if (
      typeof contentType === "string" &&
      contentType.trim().toLowerCase().startsWith("application/pdf")
    ) {
      return "resource";
    }
    const structured = jsonLdPageType(input.projection);
    if (structured !== null) return structured;
  }
  return null;
}

/**
 * `url_opportunity_rank.v1`: which URL an operator should open first.
 *
 * `max_finding_severity.v1` restated the strongest Finding severity, so a
 * content site whose engine only ever emits high/medium collapsed into a single
 * band. This derivation keeps severity as the primary axis and then separates
 * URLs by two further facts that are already counted deterministically in the
 * same frozen run:
 *
 * - `coverageCount` — the widest cross-page blast radius among the URL's
 *   reviewable Findings. A defect that already recurs on many canonical pages
 *   is structural: one fix moves the whole section.
 * - `findingCount` — how many independent reviewable Findings stack on the URL.
 *
 * Only these three inputs are used, and that is a hard constraint rather than
 * an oversight: the generation-wide band counts in `meta.summary` are computed
 * by grouping the frozen inventory on exactly this triple, so any additional
 * signal (GSC impressions, priority-page membership) would have to be countable
 * in the same aggregate or the stat cards would stop matching the rows.
 */
export const URL_OPPORTUNITY_RANK_VERSION = "url_opportunity_rank.v1";

/**
 * A Finding recurring on at least this many distinct canonical pages is a
 * template or site-wide defect, so every page it touches is promoted one band.
 */
const SITE_WIDE_COVERAGE = 50;
/**
 * Below site-wide but still a repeated pattern rather than a one-off, so the
 * URL holds the band its severity already implies.
 */
const REPEATED_COVERAGE = 5;
/** Three or more independent reviewable Findings compound on one page. */
const STACKED_FINDINGS = 3;

export type GrowthMapPriorityBand = "critical" | "high" | "medium" | "low";

export interface GrowthMapUrlOpportunityRankInput {
  readonly severity: GrowthMapPriorityBand;
  /** Widest blast radius among the URL's reviewable Findings, at least 1. */
  readonly coverageCount: number;
  /** Reviewable Findings on this URL, at least 1. */
  readonly findingCount: number;
}

function invalidOpportunityRank(): never {
  throw new Error("Growth Map URL opportunity rank inputs are inconsistent.");
}

/**
 * Ordered rules, first match wins:
 *
 * | # | severity | additional condition                       | band     |
 * |---|----------|-------------------------------------------|----------|
 * | 1 | critical | —                                         | critical |
 * | 2 | high     | site-wide coverage or stacked Findings    | critical |
 * | 3 | high     | —                                         | high     |
 * | 4 | medium   | site-wide coverage                        | high     |
 * | 5 | medium   | repeated coverage or stacked Findings     | medium   |
 * | 6 | medium   | —                                         | low      |
 * | 7 | low      | site-wide coverage                        | medium   |
 * | 8 | low      | —                                         | low      |
 */
export function deriveGrowthMapUrlOpportunityRank(
  input: GrowthMapUrlOpportunityRankInput,
): GrowthMapPriorityBand {
  if (
    !Number.isSafeInteger(input.coverageCount) ||
    input.coverageCount < 1 ||
    !Number.isSafeInteger(input.findingCount) ||
    input.findingCount < 1
  ) {
    invalidOpportunityRank();
  }
  const siteWide = input.coverageCount >= SITE_WIDE_COVERAGE;
  const repeated = input.coverageCount >= REPEATED_COVERAGE;
  const stacked = input.findingCount >= STACKED_FINDINGS;

  if (input.severity === "critical") return "critical";
  if (input.severity === "high") return siteWide || stacked ? "critical" : "high";
  if (input.severity === "medium") {
    if (siteWide) return "high";
    return repeated || stacked ? "medium" : "low";
  }
  if (input.severity === "low") return siteWide ? "medium" : "low";
  return invalidOpportunityRank();
}
