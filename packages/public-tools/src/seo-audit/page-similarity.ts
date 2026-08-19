// @input  -- the collected paragraphs of every HTML page in one crawl
// @output -- each page's closest sibling, after site chrome is removed
// @pos    -- the measurement behind 4.5, kept out of the record builder

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
 */

/** Words per shingle. Five is long enough that ordinary phrase reuse does not
 * register and short enough to survive light editing between two pages. */
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
 * Below this many pages, chrome and duplication cannot be told apart.
 *
 * On a two-page site a paragraph on both pages is either the footer or the
 * duplication itself, and nothing in the text says which. Refusing is the
 * only honest answer; guessing picks a side at random.
 */
const MIN_PAGES = 4;

/** Below this many shingles left after chrome removal, a score means nothing. */
const MIN_SHINGLES = 20;

/** Signature length. 64 keeps the error near 12% while staying cheap. */
const SIGNATURE_SIZE = 64;

export interface PageSimilarityInput {
  readonly url: string;
  readonly paragraphs: readonly string[];
  /**
   * The page declares `rel="next"` or `rel="prev"`.
   *
   * Page 2 and page 3 of an archive carry the same intro, the same filter
   * chrome and the same card layout, differing only in which items they list.
   * That is what a paginated archive IS, and the site has done nothing wrong.
   * Sequence members are scored against nobody rather than reported.
   */
  readonly partOfASequence: boolean;
}

export interface PageSimilarity {
  readonly url: string;
  /** The most similar other page, or null when this page is not judgeable. */
  readonly nearest: string | null;
  /** Estimated Jaccard overlap with `nearest`, or null when not judgeable. */
  readonly similarity: number | null;
  /** Shingles left after site chrome was removed. */
  readonly distinctiveShingles: number;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a, seeded. Deterministic across runs so two crawls of one site agree. */
function hash(text: string, seed: number): number {
  let value = (2_166_136_261 ^ seed) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return value >>> 0;
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
    for (let slot = 0; slot < SIGNATURE_SIZE; slot += 1) {
      const candidate = hash(shingle, slot);
      const current = signature[slot] ?? -1;
      if (current === -1 || (candidate >>> 0) < (current >>> 0)) {
        signature[slot] = candidate | 0;
      }
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

/**
 * Paragraphs carried by enough pages to be site furniture.
 *
 * Counted per page, not per occurrence: a footer repeated three times on one
 * long page is still one page's worth of evidence that it is chrome.
 */
function chromeParagraphs(
  pages: readonly PageSimilarityInput[],
): ReadonlySet<string> {
  const pagesCarrying = new Map<string, number>();
  for (const page of pages) {
    for (const paragraph of new Set(page.paragraphs.map(normalize))) {
      if (paragraph === "") continue;
      pagesCarrying.set(paragraph, (pagesCarrying.get(paragraph) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * CHROME_PAGE_SHARE));
  return new Set(
    [...pagesCarrying.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([paragraph]) => paragraph),
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
      distinctiveShingles: 0,
    }));
  }

  const chrome = chromeParagraphs(pages);
  const prepared = pages.map((page) => {
    const words = page.paragraphs
      .map(normalize)
      .filter((paragraph) => paragraph !== "" && !chrome.has(paragraph))
      .join(" ")
      .split(" ")
      .filter((word) => word !== "");
    const shingles = shinglesOf(words);
    return {
      url: page.url,
      shingles,
      signature:
        page.partOfASequence || shingles.size < MIN_SHINGLES
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
        distinctiveShingles: page.shingles.size,
      };
    }

    let best = 0;
    let nearest: string | null = null;
    for (let other = 0; other < prepared.length; other += 1) {
      if (other === index) continue;
      const candidate = prepared[other];
      if (candidate === undefined || candidate.signature === null) continue;
      const score = agreement(page.signature, candidate.signature);
      if (score > best) {
        best = score;
        nearest = candidate.url;
      }
    }

    return {
      url: page.url,
      nearest,
      similarity: nearest === null ? null : best,
      distinctiveShingles: page.shingles.size,
    };
  });
}
