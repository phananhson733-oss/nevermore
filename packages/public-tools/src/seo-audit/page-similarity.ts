// @input  -- the collected paragraphs of every HTML page in one crawl
// @output -- each page's closest sibling, after site chrome is removed
// @pos    -- the measurement behind 4.5, kept out of the record builder
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * How near-duplicate one page is to the most similar other page on the site.
 *
 * Two things make this measurement easy to get wrong, and both of them produce
 * the same failure: a site that did nothing wrong is told its pages duplicate
 * each other.
 *
 * The first is site chrome. A nav, a footer, a cookie line and a legal
 * paragraph appear verbatim on every page. Compare raw text and a site with a
 * heavy footer and short articles reads as near-100% self-similar throughout —
 * which is the most common shape on the web, not an edge case. Chrome is
 * removed before anything is compared.
 *
 * The second is short pages. Once the chrome is gone, a page with two
 * sentences left has so few shingles that one shared sentence swings the
 * score across the threshold. Those pages are not judged rather than judged
 * badly.
 *
 * The published rule this feeds is "Below 70%; otherwise Warning", and a
 * printed number that precise cannot be produced by an estimator — see
 * `CANDIDATE_FLOOR`. MinHash narrows the field; exact Jaccard decides.
 */

/**
 * Words per shingle. Five is long enough that ordinary phrase reuse does not
 * register and short enough to survive light editing between two pages.
 *
 * For scripts written without spaces the unit is five characters rather than
 * five words — see `tokenize`.
 */
const SHINGLE_WORDS = 5;

/**
 * A paragraph on at least this share of pages is furniture, not content.
 *
 * High on purpose. Chrome is on essentially every page, while duplicated
 * content is on a few — and at a low bar the two are indistinguishable. At
 * 0.3 a body shared by two of three pages is stripped as furniture, and the
 * duplicate this check exists to find disappears into the chrome filter.
 */
const CHROME_PAGE_SHARE = 0.8;

/**
 * A block this much of a page's own text is that page's content, never its
 * furniture — however many pages also carry it.
 *
 * Without this the guard against false positives produced the worst possible
 * false negative. On a five-page site the chrome bar is four pages, so copying
 * one article body onto four pages classified that body as site furniture and
 * deleted it before anything was compared; the leftover tails scored low and
 * all four pages passed. The more completely a site duplicated its main
 * content, the more certainly this check called it distinct.
 *
 * Furniture is what surrounds content. A nav, a cookie line and a legal
 * footer are a small share of every page that carries them, so they are still
 * stripped; a block that IS some page's content is not.
 */
const CHROME_MAX_PAGE_SHARE = 0.5;

/**
 * Below this many pages, chrome and duplication cannot be told apart.
 *
 * On a two-page site a paragraph on both pages is either the footer or the
 * duplication itself, and nothing in the text says which. Refusing is the
 * only honest answer; guessing picks a side at random.
 */
const MIN_PAGES = 4;

/** Below this many shingles left after chrome removal, a score means nothing. */
const MIN_SHINGLES = 20;

/**
 * A `rel=next/prev` declaration stops exempting anything past this share.
 *
 * The exemption is meant for a paginated archive, where pages 2 and 3 legitimately
 * carry the same intro and chrome. But the declaration is markup the site
 * controls, and `rel=next/prev` has carried no indexing meaning at Google since
 * 2019 — so one line in a layout template used to exempt every page on the
 * site from this check at zero cost. A declaration that applies to nearly
 * everything distinguishes nothing, and is ignored.
 */
const SEQUENCE_DECLARATION_CEILING = 0.8;

/** Signature length. Wide enough to rank candidates; never used as a verdict. */
const SIGNATURE_SIZE = 64;

/**
 * Signature agreement at or above which two pages are compared exactly.
 *
 * Deliberately far below the published 70%, because this number's only job is
 * recall. A 64-slot signature carries roughly 12% standard error, and measured
 * against this module's own hash family a true overlap of 72% produced
 * estimates as low as 0.45 — so a floor anywhere near the published rail would
 * drop genuine duplicates before they were ever measured. Everything that
 * clears this floor is then compared exactly, and the estimate is discarded.
 */
const CANDIDATE_FLOOR = 0.3;

/**
 * Exact comparisons one page will spend before it stops.
 *
 * On a normal site this is never reached: after chrome removal two unrelated
 * pages share almost no five-token shingles, so the candidate list is a handful
 * of genuine near-duplicates. A site engineered from one template with a shared
 * vocabulary makes every page a candidate for every other, and the exact pass —
 * which rebuilds a shingle set per comparison — becomes quadratic on a
 * two-thousand-page crawl. That is the audit's whole modelling budget spent
 * inside one check.
 *
 * Truncating changes what may be concluded, not just what is spent. `best` can
 * only rise as more candidates are compared, so a page that ran out of budget
 * without finding a duplicate has not established that it has none — it is
 * reported unscored rather than clean. Finding one is still decisive from any
 * subset, so the Warning side is unaffected.
 */
const MAX_EXACT_COMPARISONS = 12;

/**
 * The published bar: at or above this, two pages compete with each other.
 *
 * Lives here, beside the code that computes the number and the tests that
 * exercise it, because it used to live in the record builder two files away —
 * where it could be changed to 0.05 with the entire package suite still green.
 * A threshold a customer is shown belongs next to its own evidence.
 *
 * The catalogue publishes this as "Below 70%; otherwise Warning", so the bar is
 * inclusive on the failing side.
 */
export const NEAR_DUPLICATE_SIMILARITY = 0.7;

export interface PageSimilarityInput {
  readonly url: string;
  readonly paragraphs: readonly string[];
  /**
   * The page declares `rel="next"` or `rel="prev"`.
   *
   * Page 2 and page 3 of an archive carry the same intro, the same filter
   * chrome and the same card layout, differing only in which items they list.
   * That is what a paginated archive IS, and the site has done nothing wrong.
   * Sequence members are scored against nobody rather than reported — unless
   * the whole site declares it, see `SEQUENCE_DECLARATION_CEILING`.
   */
  readonly partOfASequence: boolean;
}

/** Why a page carries no score. Null means it was scored. */
export type PageSimilarityGap =
  | "too_few_pages_to_separate_chrome_from_duplication"
  | "too_little_distinctive_text_to_compare"
  | "excluded_because_the_page_declares_pagination"
  | "too_many_similar_pages_to_compare_them_all_exactly";

export interface PageSimilarity {
  readonly url: string;
  /** The most similar other page, or null when nothing scored above zero. */
  readonly nearest: string | null;
  /**
   * Exact Jaccard overlap with `nearest`, or null when this page was not
   * scored at all.
   *
   * Zero and null are different answers. Zero is a measurement: this page was
   * compared against every sibling and shares nothing with any of them. Null
   * is the absence of one, and `unscored` says which absence. Collapsing them
   * reported a clean page as a hole in the audit.
   */
  readonly similarity: number | null;
  /** Set when `similarity` is null, so the reason can be published. */
  readonly unscored: PageSimilarityGap | null;
  /** Shingles left after site chrome was removed. */
  readonly distinctiveShingles: number;
}

/**
 * Scripts written without spaces between words.
 *
 * Script properties rather than hand-written code point ranges. A range typed
 * as literal characters is unreadable in review, and one homoglyph inside it
 * silently widens the class by thousands of code points — this file had exactly
 * that shape a draft ago. Hangul is deliberately absent: Korean does put spaces
 * between words, so it already tokenizes correctly.
 */
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split normalized text into the units a shingle is built from.
 *
 * Whitespace alone is wrong for Chinese, Japanese and Thai, which do not put
 * spaces between words: splitting on spaces made one clause into one token, so
 * a 89-character Chinese paragraph produced six tokens and two shingles and
 * fell under `MIN_SHINGLES` — on a Chinese-first product, this check was inert
 * for Chinese pages while reporting them as merely uncoverable.
 *
 * Runs of such characters become one token each, so a shingle over them is
 * five characters, which is roughly two to three words and the conventional
 * unit for Chinese near-duplicate work. Done by code point rather than by
 * `Intl.Segmenter` so that two crawls of one site agree regardless of which
 * ICU version each ran against.
 */
function tokenize(normalized: string): readonly string[] {
  const out: string[] = [];
  for (const chunk of normalized.split(" ")) {
    if (chunk === "") continue;
    if (!UNSPACED_SCRIPT.test(chunk)) {
      out.push(chunk);
      continue;
    }
    // A chunk can mix scripts ("iphone15手机壳"), so latin runs stay whole and
    // only the unspaced scripts are exploded.
    let latin = "";
    for (const character of chunk) {
      if (UNSPACED_SCRIPT.test(character)) {
        if (latin !== "") {
          out.push(latin);
          latin = "";
        }
        out.push(character);
      } else {
        latin += character;
      }
    }
    if (latin !== "") out.push(latin);
  }
  return out;
}

/**
 * Two independent 32-bit hashes of one string, in a single pass.
 *
 * The signature used to call a seeded FNV-1a once per slot, which is sixty-four
 * full passes over every shingle of every page — the dominant cost of the whole
 * audit's modelling phase, measured at eight seconds for two hundred pages and
 * growing. It was also a poor hash family: XOR-ing the offset basis with a slot
 * index produces highly correlated permutations, which biased the estimate low.
 *
 * Two hashes and `h1 + slot * h2` (Kirsch-Mitzenmacher) gives the same
 * distribution guarantees from one pass. `h2` is forced odd so it is coprime
 * with 2^32 and the slot sequence cannot degenerate.
 */
function hashPair(text: string): { readonly h1: number; readonly h2: number } {
  let h1 = 2_166_136_261 >>> 0;
  let h2 = 2_246_822_519 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 16_777_619) >>> 0;
    h2 = Math.imul(h2 ^ code, 2_654_435_761) >>> 0;
  }
  return { h1: h1 >>> 0, h2: (h2 | 1) >>> 0 };
}

function shinglesOf(words: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  if (words.length < SHINGLE_WORDS) return out;
  for (let index = 0; index + SHINGLE_WORDS <= words.length; index += 1) {
    out.add(words.slice(index, index + SHINGLE_WORDS).join(" "));
  }
  return out;
}

function signatureOf(shingles: ReadonlySet<string>): Int32Array {
  const signature = new Int32Array(SIGNATURE_SIZE).fill(-1);
  for (const shingle of shingles) {
    const { h1, h2 } = hashPair(shingle);
    let value = h1;
    for (let slot = 0; slot < SIGNATURE_SIZE; slot += 1) {
      const current = signature[slot] ?? -1;
      if (current === -1 || value < current >>> 0) {
        signature[slot] = value | 0;
      }
      value = (value + h2) >>> 0;
    }
  }
  return signature;
}

function agreement(left: Int32Array, right: Int32Array): number {
  let same = 0;
  for (let slot = 0; slot < SIGNATURE_SIZE; slot += 1) {
    if (left[slot] === right[slot]) same += 1;
  }
  return same / SIGNATURE_SIZE;
}

/** The number the published rule is compared against. No estimate involved. */
function jaccard(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  const [small, large] =
    left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const shingle of small) if (large.has(shingle)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Paragraphs carried by enough pages to be site furniture.
 *
 * Counted per page, not per occurrence: a footer repeated three times on one
 * long page is still one page's worth of evidence that it is chrome. A block
 * that makes up the bulk of any page carrying it is that page's content and is
 * never furniture, however widely it is repeated — see `CHROME_MAX_PAGE_SHARE`.
 */
function chromeParagraphs(
  pages: readonly PageSimilarityInput[],
): ReadonlySet<string> {
  const pagesCarrying = new Map<string, number>();
  const largestPageShare = new Map<string, number>();
  for (const page of pages) {
    const normalized = page.paragraphs.map(normalize).filter((p) => p !== "");
    const pageChars = normalized.reduce((sum, p) => sum + p.length, 0);
    for (const paragraph of new Set(normalized)) {
      pagesCarrying.set(paragraph, (pagesCarrying.get(paragraph) ?? 0) + 1);
      const share = pageChars === 0 ? 0 : paragraph.length / pageChars;
      largestPageShare.set(
        paragraph,
        Math.max(largestPageShare.get(paragraph) ?? 0, share),
      );
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * CHROME_PAGE_SHARE));
  return new Set(
    [...pagesCarrying.entries()]
      .filter(
        ([paragraph, count]) =>
          count >= threshold &&
          (largestPageShare.get(paragraph) ?? 0) < CHROME_MAX_PAGE_SHARE,
      )
      .map(([paragraph]) => paragraph),
  );
}

function distinctiveShinglesOf(
  page: PageSimilarityInput,
  chrome: ReadonlySet<string>,
): ReadonlySet<string> {
  return shinglesOf(
    tokenize(
      page.paragraphs
        .map(normalize)
        .filter((paragraph) => paragraph !== "" && !chrome.has(paragraph))
        .join(" "),
    ),
  );
}

export function measurePageSimilarity(
  pages: readonly PageSimilarityInput[],
): readonly PageSimilarity[] {
  if (pages.length < MIN_PAGES) {
    return pages.map((page) => ({
      url: page.url,
      nearest: null,
      similarity: null,
      unscored: "too_few_pages_to_separate_chrome_from_duplication",
      distinctiveShingles: 0,
    }));
  }

  const chrome = chromeParagraphs(pages);
  const declaringSequence = pages.filter((page) => page.partOfASequence).length;
  const sequenceExemptionApplies =
    declaringSequence < pages.length * SEQUENCE_DECLARATION_CEILING;

  /**
   * Signature plus size, and NOT the shingle set.
   *
   * Holding every page's shingles at once is what made this the audit's memory
   * ceiling: at the crawl's own limits that is thousands of strings per page
   * across up to two thousand pages. The sets are rebuilt for the handful of
   * pages that turn out to have a candidate, which is linear work on a short
   * list rather than a resident cost for the whole run.
   */
  const prepared = pages.map((page) => {
    const shingles = distinctiveShinglesOf(page, chrome);
    const excludedBySequence = page.partOfASequence && sequenceExemptionApplies;
    return {
      url: page.url,
      size: shingles.size,
      unscored: excludedBySequence
        ? ("excluded_because_the_page_declares_pagination" as const)
        : shingles.size < MIN_SHINGLES
          ? ("too_little_distinctive_text_to_compare" as const)
          : null,
      signature:
        excludedBySequence || shingles.size < MIN_SHINGLES
          ? null
          : signatureOf(shingles),
    };
  });

  return prepared.map((page, index) => {
    if (page.signature === null) {
      return {
        url: page.url,
        nearest: null,
        similarity: null,
        unscored: page.unscored,
        distinctiveShingles: page.size,
      };
    }

    // Rank by signature, decide by exact overlap. The estimate orders the
    // field and never reaches the verdict.
    const candidates: { index: number; estimate: number }[] = [];
    for (let other = 0; other < prepared.length; other += 1) {
      if (other === index) continue;
      const candidate = prepared[other];
      if (candidate === undefined || candidate.signature === null) continue;
      const estimate = agreement(page.signature, candidate.signature);
      if (estimate >= CANDIDATE_FLOOR)
        candidates.push({ index: other, estimate });
    }
    // Highest estimate first, so a truncated run spends its comparisons on the
    // pages most likely to be duplicates rather than on whichever crawled first.
    candidates.sort((left, right) => right.estimate - left.estimate);
    const truncated = candidates.length > MAX_EXACT_COMPARISONS;

    let best = 0;
    let nearest: string | null = null;
    if (candidates.length > 0) {
      const own = distinctiveShinglesOf(
        pages[index] as PageSimilarityInput,
        chrome,
      );
      for (const { index: other } of candidates.slice(
        0,
        MAX_EXACT_COMPARISONS,
      )) {
        const source = pages[other];
        if (source === undefined) continue;
        const score = jaccard(own, distinctiveShinglesOf(source, chrome));
        if (score > best) {
          best = score;
          nearest = source.url;
        }
      }
    }

    // A truncated search that found a duplicate has found one; a truncated
    // search that found none has not established there is none, because the
    // comparisons it skipped could only have raised the score. Only the clean
    // verdict needs the full field.
    if (truncated && best < NEAR_DUPLICATE_SIMILARITY) {
      return {
        url: page.url,
        nearest: null,
        similarity: null,
        unscored: "too_many_similar_pages_to_compare_them_all_exactly" as const,
        distinctiveShingles: page.size,
      };
    }

    return {
      url: page.url,
      nearest,
      // Scored. Zero means "compared against every sibling, shares nothing".
      similarity: best,
      unscored: null,
      distinctiveShingles: page.size,
    };
  });
}
