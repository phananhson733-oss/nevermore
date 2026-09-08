// @input  -- one fetched offsite page, the brand's confirmed names and its own pages
// @output -- a three-state entity cross-reference and a four-state independence call
// @pos    -- pure judgement over fetched bodies; it fetches nothing and trusts no summary

/**
 * Two questions about a page somebody else published.
 *
 * 1. Is this page about *this* entity? (cross-reference, three states)
 * 2. Is this page independent of the entity? (independence, four states)
 *
 * The rule that shapes every line below: **finding no counter-evidence is not
 * evidence of independence.** A page with no byline, no publisher and no
 * markers is `undetermined`, never `independent`. The failure this prevents is
 * the product telling a customer they have independent third-party coverage
 * because a crawler could not find the word "sponsored" -- a claim that is
 * wrong in exactly the cases where being wrong matters.
 *
 * The second rule: neither question may be answered from a SERP result's title
 * or snippet. A snippet is provider-supplied, truncated, and carries no links,
 * so it can support "the brand name appears near this result" and nothing more.
 * Both functions therefore take a page whose body was actually fetched, and
 * degrade to `suspected` / `undetermined` when they are handed only a summary.
 */
import { load } from "cheerio";

import { containsGeoAlias, findGeoAliasMatch } from "../agents/geo-alias-match.ts";
import { GEO_KNOWLEDGE_LIMITS } from "./kb-knowledge-shape.ts";
import {
  geoBoundText,
  geoCleanText,
  readGeoBylineSignalsFrom,
  type GeoBylineSignals,
} from "./kb-first-party-proof.ts";

export const GEO_OFFSITE_VERIFICATION_LIMITS = {
  /** Tokens per shingle. Five is long enough that ordinary phrases collide rarely. */
  shingleSize: 5,
  /**
   * Shingles a text needs before an overlap ratio means anything.
   *
   * Below this a single shared sentence swings the ratio past any threshold, so
   * the measurement is refused rather than reported. Refusing is what keeps the
   * "< 60% overlap" condition from being satisfied by a text too short to
   * measure -- which would hand out `independent` for free.
   */
  minShingles: 20,
  /** At or above this share of the page's shingles, the page is a syndicated copy. */
  syndicationThreshold: 0.6,
  /** Body text read per page. Long enough for an article, bounded for cost. */
  bodyCodePoints: 60_000,
  linkHosts: 256,
} as const;

// ---------------------------------------------------------------------------
// page signals
// ---------------------------------------------------------------------------

export interface GeoOffsitePageSignals {
  /** The URL the body was actually read from, after redirects. */
  readonly url: string;
  /** Visible body text, whitespace collapsed and bounded. */
  readonly bodyText: string;
  /** Semantic excerpts, in document order, for the source catalogue. */
  readonly excerpts: readonly string[];
  /** Hosts every anchor on the page points at, lower-cased and de-duplicated. */
  readonly linkHosts: readonly string[];
  readonly byline: GeoBylineSignals;
  /** Owner-submission markers found in the body, in the page's own wording. */
  readonly markers: readonly string[];
}

/**
 * Phrases that say the page was placed by, or on behalf of, the subject.
 *
 * Every entry is a phrase, never a bare word. Bare "advertisement" and bare
 * "sponsored" were tried and removed: they sit in the ad-slot furniture of
 * essentially every publisher, so they marked genuine editorial coverage as
 * owner-submitted. A marker has to be about the item, not about the page
 * template.
 *
 * "Claim this profile" is deliberately absent: it is what an *unclaimed*
 * listing says, and matching it would invert the signal.
 */
export const GEO_OFFSITE_OWNER_SUBMITTED_MARKERS: readonly string[] = [
  "sponsored content",
  "sponsored post",
  "sponsored by",
  "paid partnership",
  "paid post",
  "paid placement",
  "advertorial",
  "this is an advertisement",
  "submitted by the vendor",
  "submitted by the company",
  "provided by the vendor",
  "provided by the brand",
  "claimed by the owner",
  "claimed by the vendor",
  "profile claimed by",
  "official account of",
  "guest post by",
  "赞助内容",
  "品牌方提供",
  "由品牌方提交",
  "官方账号",
  "广告推广",
  "商业推广",
  "付费推广",
];

function hostOf(value: string, base: string): string | null {
  try {
    return new URL(value, base).hostname.toLocaleLowerCase("en").replace(/\.$/u, "");
  } catch {
    return null;
  }
}

/**
 * Read one fetched page into the signals both judgements need.
 *
 * The body is taken from a clone so the authorship reader still sees the
 * page's `script` blocks: JSON-LD lives in one, and stripping scripts before
 * reading them is how a page with a perfectly good author credit ends up
 * recorded as having none.
 */
export function readGeoOffsitePageSignals(html: string, pageUrl: string): GeoOffsitePageSignals {
  const $ = load(html);
  const byline = readGeoBylineSignalsFrom($);
  const body = $("body").clone();
  body.find("script, style, noscript, template, svg, iframe").remove();
  body.find("[hidden], [aria-hidden='true']").remove();
  const bodyText = geoBoundText(body.text(), GEO_OFFSITE_VERIFICATION_LIMITS.bodyCodePoints);
  const excerpts: string[] = [];
  body.find("h1, h2, h3, h4, h5, h6, p, li").each((_index, element) => {
    if (excerpts.length >= GEO_KNOWLEDGE_LIMITS.excerptsPerSource) return false;
    const excerpt = geoBoundText($(element).text(), GEO_KNOWLEDGE_LIMITS.excerptCodePoints);
    if (excerpt !== "" && !excerpts.includes(excerpt)) excerpts.push(excerpt);
    return undefined;
  });
  if (excerpts.length === 0 && bodyText !== "") {
    excerpts.push(geoBoundText(bodyText, GEO_KNOWLEDGE_LIMITS.excerptCodePoints));
  }
  const hosts: string[] = [];
  $("a[href]").each((_index, element) => {
    if (hosts.length >= GEO_OFFSITE_VERIFICATION_LIMITS.linkHosts) return false;
    const host = hostOf($(element).attr("href") ?? "", pageUrl);
    if (host !== null && host !== "" && !hosts.includes(host)) hosts.push(host);
    return undefined;
  });
  const haystack = bodyText.toLocaleLowerCase("en");
  return {
    url: pageUrl,
    bodyText,
    excerpts,
    linkHosts: hosts,
    byline,
    markers: GEO_OFFSITE_OWNER_SUBMITTED_MARKERS.filter((marker) => haystack.includes(marker)),
  };
}

// ---------------------------------------------------------------------------
// sentence overlap
// ---------------------------------------------------------------------------

/**
 * Scripts written without spaces between words.
 *
 * A copy of the list in `geo-alias-match.ts` rather than an import, because the
 * two ask different questions of it: there it decides where a word boundary is
 * for matching, here it decides what one token is for counting. Merging them
 * would tie a change in matching semantics to a change in every overlap ratio.
 */
const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

/**
 * One token stream for both kinds of script.
 *
 * A character in a dense script is its own token, because it carries a whole
 * morpheme; a run of Latin letters is one token. The alternative -- splitting
 * on spaces -- produces a single enormous token for a Chinese paragraph, and
 * every Chinese page would then measure 0% overlap with every other.
 */
export function geoOverlapTokens(value: string): readonly string[] {
  const tokens: string[] = [];
  let current = "";
  for (const character of value.normalize("NFKC").toLocaleLowerCase("en")) {
    if (DENSE_SCRIPT.test(character)) {
      if (current !== "") { tokens.push(current); current = ""; }
      tokens.push(character);
      continue;
    }
    if (WORD_CHARACTER.test(character)) { current += character; continue; }
    if (current !== "") { tokens.push(current); current = ""; }
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

function shingleSet(value: string): ReadonlySet<string> {
  const tokens = geoOverlapTokens(value);
  const size = GEO_OFFSITE_VERIFICATION_LIMITS.shingleSize;
  const shingles = new Set<string>();
  for (let index = 0; index + size <= tokens.length; index += 1) {
    shingles.add(tokens.slice(index, index + size).join(" "));
  }
  return shingles;
}

export interface GeoOwnText {
  readonly url: string;
  readonly text: string;
}

export interface GeoShingleOverlap {
  /**
   * Share of the offsite page's shingles that also occur on one own-site page.
   *
   * Containment, not Jaccard, decides. The question is "how much of this page is
   * our text", and Jaccard answers a different one: a 300-word syndicated copy
   * of a 3,000-word own page scores about 0.1 by Jaccard and 1.0 by containment,
   * and only the second is the syndication we are looking for. The Jaccard value
   * is reported beside it so the number stays explainable.
   */
  readonly ratio: number | null;
  readonly jaccard: number | null;
  readonly pageShingles: number;
  /** The own page the ratio was measured against; null when nothing overlapped. */
  readonly matchedUrl: string | null;
  /** Why no ratio could be produced. Null when `ratio` is a number. */
  readonly unmeasurable: "page_too_short" | "own_corpus_too_short" | null;
}

/**
 * How much of `text` is reproduced from the own site.
 *
 * Measured against each own page separately and the highest containment wins,
 * because a syndicated article is copied from one page, and pooling every own
 * page would let two unrelated half-matches add up to a syndication verdict.
 * Ties keep the earliest page in input order, so the answer is deterministic.
 *
 * Known failure modes, all of them one-directional and stated because they
 * decide who gets called independent:
 *  - Translation. A translated republication shares no tokens and measures 0.
 *  - Rewriting. A paraphrase past five-token windows measures near 0.
 *  - Shared boilerplate. A partner site that embeds our navigation or our
 *    boilerplate description can pass the threshold on furniture alone, which
 *    costs a genuinely independent source its label.
 *  - Short texts. Refused rather than reported; see `minShingles`.
 */
export function geoShingleOverlap(text: string, ownTexts: readonly GeoOwnText[]): GeoShingleOverlap {
  const page = shingleSet(text);
  const minimum = GEO_OFFSITE_VERIFICATION_LIMITS.minShingles;
  if (page.size < minimum) {
    return { ratio: null, jaccard: null, pageShingles: page.size, matchedUrl: null, unmeasurable: "page_too_short" };
  }
  const own = ownTexts.map((entry) => ({ url: entry.url, shingles: shingleSet(entry.text) }));
  if (own.reduce((total, entry) => total + entry.shingles.size, 0) < minimum) {
    return { ratio: null, jaccard: null, pageShingles: page.size, matchedUrl: null, unmeasurable: "own_corpus_too_short" };
  }
  let ratio = 0;
  let jaccard = 0;
  let matchedUrl: string | null = null;
  for (const entry of own) {
    if (entry.shingles.size === 0) continue;
    let shared = 0;
    for (const shingle of page) if (entry.shingles.has(shingle)) shared += 1;
    const candidate = shared / page.size;
    if (candidate > ratio) {
      ratio = candidate;
      jaccard = shared / (page.size + entry.shingles.size - shared);
      matchedUrl = entry.url;
    }
  }
  return { ratio, jaccard, pageShingles: page.size, matchedUrl, unmeasurable: null };
}

// ---------------------------------------------------------------------------
// entity cross-reference (R1)
// ---------------------------------------------------------------------------

export type GeoCrossReferenceVerdict = "passed" | "suspected" | "failed";

/**
 * What the verdict was computed from.
 *
 * Carried beside the verdict because the two say different things: `failed` on
 * a `page_body` basis means "we read the page and it does not cross-reference",
 * while `failed` on a `serp_summary` basis means "we never read the page". Only
 * the verdict gates `sameAs`; only the basis can explain it to a reader, and a
 * UI that prints one without the other is the reason this field exists.
 */
export type GeoCrossReferenceBasis = "page_body" | "serp_summary";

export interface GeoEntityCrossReference {
  readonly verdict: GeoCrossReferenceVerdict;
  readonly basis: GeoCrossReferenceBasis;
  readonly namesBrand: boolean;
  readonly linksToOfficialDomain: boolean;
  readonly matchedAlias: string | null;
  readonly matchedOfficialHost: string | null;
}

/** Whether a host is the official site or one of its subdomains. */
export function geoIsOfficialHost(host: string, officialHosts: readonly string[]): boolean {
  const candidate = host.toLocaleLowerCase("en").replace(/^www\./u, "").replace(/\.$/u, "");
  return officialHosts.some((official) => {
    const owner = official.toLocaleLowerCase("en").replace(/^www\./u, "").replace(/\.$/u, "");
    return owner !== "" && (candidate === owner || candidate.endsWith(`.${owner}`));
  });
}

export interface GeoCrossReferenceInput {
  readonly brandNames: readonly string[];
  readonly officialHosts: readonly string[];
  /** The fetched page. `null` means the body was never read. */
  readonly page: GeoOffsitePageSignals | null;
  /** Provider title and snippet. Weak evidence; can never produce `passed`. */
  readonly serpSummary?: string;
}

/**
 * `passed` only when a page we read names the brand *and* links back to it.
 *
 * Both halves are required because either alone is ordinary: half the web
 * mentions a brand name it has no relationship with, and a link with no naming
 * is a directory row. Only `passed` may become a `sameAs` claim (R1); the other
 * two states stay candidates a person can look at.
 */
export function verifyGeoEntityCrossReference(input: GeoCrossReferenceInput): GeoEntityCrossReference {
  if (input.page === null) {
    // A snippet cannot carry a link we observed, so the link half is false by
    // construction rather than by measurement -- which is why this branch can
    // never reach `passed`, whatever the snippet says.
    const match = findGeoAliasMatch(input.serpSummary ?? "", input.brandNames);
    return {
      verdict: match === null ? "failed" : "suspected",
      basis: "serp_summary",
      namesBrand: match !== null,
      linksToOfficialDomain: false,
      matchedAlias: match?.alias ?? null,
      matchedOfficialHost: null,
    };
  }
  const match = findGeoAliasMatch(input.page.bodyText, input.brandNames);
  const officialHost = input.page.linkHosts.find((host) => geoIsOfficialHost(host, input.officialHosts)) ?? null;
  const namesBrand = match !== null;
  const linksBack = officialHost !== null;
  return {
    verdict: namesBrand && linksBack ? "passed" : namesBrand || linksBack ? "suspected" : "failed",
    basis: "page_body",
    namesBrand,
    linksToOfficialDomain: linksBack,
    matchedAlias: match?.alias ?? null,
    matchedOfficialHost: officialHost,
  };
}

// ---------------------------------------------------------------------------
// independence (R6)
// ---------------------------------------------------------------------------

export type GeoOffsiteIndependence = "independent" | "self_submitted" | "syndicated" | "undetermined";

export type GeoOffsiteIndependenceBasis =
  | "body_not_observed"
  | "owner_published_venue"
  | "owner_submitted_marker"
  | "overlap_at_or_above_threshold"
  | "no_identity_distinct_from_brand"
  | "overlap_not_measurable"
  | "distinct_identity_and_low_overlap";

export interface GeoOffsiteIndependenceJudgement {
  readonly independence: GeoOffsiteIndependence;
  readonly basis: GeoOffsiteIndependenceBasis;
  /** Author, reviewer, publisher or byline names that are not the brand itself. */
  readonly distinctIdentities: readonly string[];
  readonly markers: readonly string[];
  readonly overlap: GeoShingleOverlap | null;
}

export interface GeoIndependenceInput {
  readonly brandNames: readonly string[];
  readonly page: GeoOffsitePageSignals | null;
  readonly ownTexts: readonly GeoOwnText[];
  /**
   * True when the venue's own publishing model is that the subject creates the
   * record: an app store listing, a company's LinkedIn page, a GitHub org, a
   * Product Hunt launch. This is positive knowledge about the venue, supplied
   * by the caller's maintained table -- not an inference from an unfamiliar
   * domain, which would be the forbidden "no counter-evidence" move in reverse.
   */
  readonly venueIsOwnerPublished?: boolean;
}

function distinctIdentities(byline: GeoBylineSignals, brandNames: readonly string[]): readonly string[] {
  const names = [...byline.authors, ...byline.reviewers, ...byline.publishers, ...byline.visibleBylines];
  const distinct: string[] = [];
  for (const name of names) {
    const cleaned = geoCleanText(name);
    // A byline that is the brand is the brand talking about itself, so it is
    // not evidence that anybody else stands behind the page.
    if (cleaned === "" || containsGeoAlias(cleaned, brandNames) || distinct.includes(cleaned)) continue;
    distinct.push(cleaned);
  }
  return distinct;
}

/**
 * Independence needs positive evidence, in this order.
 *
 *  1. No body read            -> `undetermined`. Nothing was measured.
 *  2. Venue publishes on the subject's behalf -> `self_submitted`.
 *  3. An owner-submission marker in the text  -> `self_submitted`. Checked
 *     before overlap because an explicit statement in the page beats a
 *     statistic about it.
 *  4. Overlap at or above the threshold       -> `syndicated`.
 *  5. No author, reviewer, publisher or byline distinct from the brand
 *                                             -> `undetermined`.
 *  6. Overlap not measurable                  -> `undetermined`. The rule is
 *     "distinct identity AND overlap below the threshold"; an unmeasurable
 *     overlap cannot satisfy the second half, so it fails closed.
 *  7. Otherwise                               -> `independent`.
 *
 * Step 5 is the whole point of the module: a page that was fetched successfully
 * and carries no byline at all comes back `undetermined`, not `independent`.
 */
export function judgeGeoOffsiteIndependence(input: GeoIndependenceInput): GeoOffsiteIndependenceJudgement {
  const empty = { distinctIdentities: [] as readonly string[], markers: [] as readonly string[], overlap: null };
  if (input.page === null) return { independence: "undetermined", basis: "body_not_observed", ...empty };
  const markers = input.page.markers;
  const identities = distinctIdentities(input.page.byline, input.brandNames);
  if (input.venueIsOwnerPublished === true) {
    return { independence: "self_submitted", basis: "owner_published_venue", distinctIdentities: identities, markers, overlap: null };
  }
  if (markers.length > 0) {
    return { independence: "self_submitted", basis: "owner_submitted_marker", distinctIdentities: identities, markers, overlap: null };
  }
  const overlap = geoShingleOverlap(input.page.bodyText, input.ownTexts);
  const result = (independence: GeoOffsiteIndependence, basis: GeoOffsiteIndependenceBasis): GeoOffsiteIndependenceJudgement =>
    ({ independence, basis, distinctIdentities: identities, markers, overlap });
  if (overlap.ratio !== null && overlap.ratio >= GEO_OFFSITE_VERIFICATION_LIMITS.syndicationThreshold) {
    return result("syndicated", "overlap_at_or_above_threshold");
  }
  if (identities.length === 0) return result("undetermined", "no_identity_distinct_from_brand");
  if (overlap.ratio === null) return result("undetermined", "overlap_not_measurable");
  return result("independent", "distinct_identity_and_low_overlap");
}
