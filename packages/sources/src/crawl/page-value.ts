// @input  -- a URL path plus the BCP-47 primary subtag this crawl is profiling for
// @output -- an integer page-value score and the signed terms that produced it
// @pos    -- the ordering key that decides which pages a context crawl spends its budget on
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Why this file exists at all.
 *
 * A breadth-first crawl from the origin spends its budget on whatever the
 * homepage happens to link first, which on a marketing site is the blog. In the
 * 2026-08-10 Tranche 1 measurement that produced product/pricing/feature pages
 * for 9% of fetched URLs — linear.app returned ten pages of which zero were
 * product pages and eight were blog posts — so an LLM asked to state the
 * product's value proposition described blog topics instead. Ordering the
 * frontier by this score raised the product-page share to 100% on 7 of 15 sites
 * in Tranche 2.
 *
 * Why a signed score and not an allow-list: an allow-list of known section
 * names cannot rank two admitted candidates against each other, and it silently
 * drops every site that names its sections something else. A score lets an
 * unrecognised shallow path (0) still be crawled after the recognised ones, and
 * lets a recognised-but-buried path lose to a shallow unknown one.
 *
 * Everything here is a path heuristic. A high score is a claim about where the
 * product is *usually* described, never a claim about what the page contains.
 */

/** Nothing else on a site is asked to describe the whole offer in one page. */
const HOMEPAGE_SCORE = 10;

/**
 * Recognised section names, per tier, keyed by the FIRST path segment after any
 * locale prefix. German equivalents are carried inline rather than in a
 * separate table so that adding a tier cannot silently forget one language.
 */
const SECTION_TIERS: readonly (readonly [number, readonly string[]])[] = [
  [
    // Pricing states the product's units of value and who it is sold to. It is
    // the single highest-yield page for positioning after the homepage.
    9,
    [
      "pricing",
      "plans",
      "preise",
      "tarife",
      "preisuebersicht",
      "preisübersicht",
    ],
  ],
  [
    // The product surface itself: what it does, for whom, and how.
    8,
    [
      "product",
      "products",
      "features",
      "platform",
      "solutions",
      "use-cases",
      "usecases",
      "services",
      "how-it-works",
      "produkt",
      "produkte",
      "funktionen",
      "plattform",
      "loesungen",
      "lösungen",
      "anwendungsfaelle",
      "anwendungsfälle",
      "leistungen",
      "so-funktioniert-es",
      "wie-es-funktioniert",
    ],
  ],
  [
    // Proof and reach: who the company is, who buys, what it plugs into. These
    // describe the product obliquely, so they rank below the product pages but
    // are still worth budget once those are exhausted.
    7,
    [
      "about",
      "about-us",
      "customers",
      "integrations",
      "templates",
      "ueber-uns",
      "über-uns",
      "unternehmen",
      "kunden",
      "referenzen",
      "integrationen",
      "vorlagen",
    ],
  ],
  [
    // Objection handling and free utilities. Often verbatim product language,
    // but just as often support trivia, hence the lowest positive tier.
    6,
    ["faq", "tools", "haeufige-fragen", "häufige-fragen", "werkzeuge"],
  ],
];

const SECTION_SCORES: ReadonlyMap<string, number> = new Map(
  SECTION_TIERS.flatMap(([score, segments]) =>
    segments.map((segment) => [segment, score] as const),
  ),
);

/**
 * Sections whose pages are about a topic rather than about the product. Matched
 * against EVERY segment, not just the first, because `/resources/blog/x` and
 * `/de/news/y` bury the giveaway one level down.
 */
const OFF_TOPIC_SEGMENTS: ReadonlySet<string> = new Set([
  "blog",
  "news",
  "careers",
  "legal",
  "privacy",
  "terms",
  "changelog",
  "glossary",
  "tags",
  "tag",
  "category",
  "categories",
  "author",
  "authors",
  "events",
  "webinars",
  "podcast",
  "nachrichten",
  "neuigkeiten",
  "presse",
  "karriere",
  "jobs",
  "stellenangebote",
  "impressum",
  "rechtliches",
  "datenschutz",
  "agb",
  "nutzungsbedingungen",
  "glossar",
  "schlagworte",
  "kategorie",
  "autor",
  "veranstaltungen",
  "webinare",
]);

/**
 * ISO 639-1 subtags accepted as a locale prefix.
 *
 * Shape alone is not enough. `/us`, `/ai` and `/go-to` all match the BCP-47
 * pattern, and treating them as locales would charge an ordinary product path
 * the foreign-locale penalty. The primary subtag must therefore be a language
 * we recognise, in both the bare (`/de`) and region-tagged (`/de-ch`) forms.
 */
const LANGUAGE_SUBTAGS: ReadonlySet<string> = new Set([
  "ar",
  "bg",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fa",
  "fi",
  "fr",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "ms",
  "nb",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sr",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
]);

const LOCALE_SHAPE = /^([a-z]{2})(?:-[a-z0-9]{2,8})?$/;

/** One hit anywhere in the path is enough; a second hit says nothing new. */
export const PAGE_VALUE_OFF_TOPIC_PENALTY = -6;

/**
 * A locale prefix for a market this profile is not about is worse than an
 * off-topic section: the page may be a perfect pricing page, but its text
 * cannot be fed to a profile written in another language.
 */
export const PAGE_VALUE_FOREIGN_LOCALE_PENALTY = -8;

/** Charged once at depth 2 and once more at depth 3+; deeper is not charged again. */
export const PAGE_VALUE_DEPTH_PENALTY_STEP = -2;

/** Scores below this are not worth a request; the caller must not fetch them. */
export const PAGE_VALUE_MIN_CRAWLABLE_SCORE = 0;

/**
 * At or above this, a page is counted as a product page in the crawl summary.
 * Seven is the "about/customers/integrations" tier: the lowest tier whose pages
 * still speak about the company's own offer rather than about a topic.
 */
export const PAGE_VALUE_PRODUCT_SCORE_THRESHOLD = 7;

export interface PageValueOptions {
  /**
   * BCP-47 primary subtag of the market this profile is for, e.g. `"de"`. Case
   * is normalised here. Locale prefixes for any other language are penalised.
   */
  readonly targetLanguage: string;
}

export interface PageValueBreakdown {
  /** The path as scored, after query/fragment removal and percent-decoding. */
  readonly path: string;
  /** Lowercased, non-empty path segments with any locale prefix removed. */
  readonly segments: readonly string[];
  /**
   * The locale prefix that was stripped, or null when the path carried none.
   * Never `""`: an empty string would read as "a locale with no name".
   */
  readonly localeSegment: string | null;
  /** Segment count after locale removal. The homepage is 0. */
  readonly depth: number;
  /** Positive tier score for the first content segment; 0 when unrecognised. */
  readonly sectionScore: number;
  /** `PAGE_VALUE_OFF_TOPIC_PENALTY` or 0. */
  readonly offTopicPenalty: number;
  /** `PAGE_VALUE_FOREIGN_LOCALE_PENALTY` or 0. */
  readonly foreignLocalePenalty: number;
  /** 0, one step, or two steps of `PAGE_VALUE_DEPTH_PENALTY_STEP`. */
  readonly depthPenalty: number;
  /** The sum of the four terms above. May be negative. */
  readonly score: number;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape is not a reason to drop the path; score it verbatim.
    return segment;
  }
}

function pathOnly(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

function splitSegments(path: string): readonly string[] {
  return pathOnly(path)
    .split("/")
    .map((segment) => decodeSegment(segment).trim().toLowerCase())
    .filter((segment) => segment.length > 0);
}

interface LocalePrefix {
  /** The segment as written, e.g. `"de-ch"`. */
  readonly segment: string;
  /** Its primary subtag, e.g. `"de"`. */
  readonly language: string;
}

/** The locale prefix a path opens with, or null when it opens with content. */
function localePrefix(segment: string | undefined): LocalePrefix | null {
  if (segment === undefined) return null;
  const language = LOCALE_SHAPE.exec(segment)?.[1];
  if (!language || !LANGUAGE_SUBTAGS.has(language)) return null;
  return { segment, language };
}

function depthPenaltyFor(depth: number): number {
  if (depth >= 3) return PAGE_VALUE_DEPTH_PENALTY_STEP * 2;
  if (depth >= 2) return PAGE_VALUE_DEPTH_PENALTY_STEP;
  return 0;
}

/**
 * Score one path and show the work.
 *
 * Pure by construction: no clock, no network, no module state. The caller sorts
 * by `score` and refuses anything under `PAGE_VALUE_MIN_CRAWLABLE_SCORE`.
 */
export function pageValueBreakdown(
  path: string,
  options: PageValueOptions,
): PageValueBreakdown {
  const raw = splitSegments(path);
  const locale = localePrefix(raw[0]);
  const segments = locale === null ? raw : raw.slice(1);
  const depth = segments.length;
  const target =
    options.targetLanguage.trim().toLowerCase().split("-")[0] ?? "";

  const sectionScore =
    depth === 0 ? HOMEPAGE_SCORE : (SECTION_SCORES.get(segments[0] ?? "") ?? 0);
  const offTopicPenalty = segments.some((segment) =>
    OFF_TOPIC_SEGMENTS.has(segment),
  )
    ? PAGE_VALUE_OFF_TOPIC_PENALTY
    : 0;
  const foreignLocalePenalty =
    locale !== null && locale.language !== target
      ? PAGE_VALUE_FOREIGN_LOCALE_PENALTY
      : 0;
  const depthPenalty = depthPenaltyFor(depth);

  return {
    path: pathOnly(path),
    segments,
    localeSegment: locale?.segment ?? null,
    depth,
    sectionScore,
    offTopicPenalty,
    foreignLocalePenalty,
    depthPenalty,
    score: sectionScore + offTopicPenalty + foreignLocalePenalty + depthPenalty,
  };
}

/** The score alone, for callers that only need to sort. */
export function pageValueScore(
  path: string,
  options: PageValueOptions,
): number {
  return pageValueBreakdown(path, options).score;
}

/** Whether a fetched page counts toward `productPagesFetched`. */
export function pageValueIsProductPage(score: number): boolean {
  return score >= PAGE_VALUE_PRODUCT_SCORE_THRESHOLD;
}

/** Whether a candidate is worth a request at all. */
export function pageValueIsCrawlable(score: number): boolean {
  return score >= PAGE_VALUE_MIN_CRAWLABLE_SCORE;
}
