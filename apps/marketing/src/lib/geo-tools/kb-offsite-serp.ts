// @input  -- a confirmed brand name, its market, and the paid SERP client already in use
// @output -- three brand queries' organic results, each domain sorted by what it publishes
// @pos    -- the only paid provider call the offsite evidence layer makes; it fetches no page

/**
 * Three queries, chosen because they are the three shapes of page an engine
 * reads about an entity: the entity itself (`"Brand"`), what people say about
 * it (`Brand reviews`), and what it is compared against (`Brand alternatives`).
 *
 * The provider client is the one the On-Page Checker already uses; this module
 * adds no HTTP layer of its own. It takes the client's `serpOrganic` method as
 * a dependency rather than importing `@sf/sources` here, for the reason
 * `serp-landscape.ts` spells out: that barrel drags `node:net` behind it, and a
 * single dropped `type` keyword downstream would put it in a browser chunk.
 * `kb-offsite-serp.test.ts` pins the structural compatibility so the seam
 * cannot drift away from the real client.
 *
 * What the classification below is, and is not: it says what kind of page a
 * domain publishes. It says nothing about whether a given page is independent
 * of the brand. That judgement is made in `kb-offsite-verification.ts`, from
 * the fetched body only -- a media domain publishes sponsored posts and a
 * directory hosts genuine user reviews, so a verdict read off the domain would
 * be wrong in both directions.
 */
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { isMatchableGeoName } from "../agents/geo-alias-match.ts";
import { SERP_LANGUAGES, SERP_LOCATIONS } from "../tools/serp-markets.ts";
import { GEO_KNOWLEDGE_LIMITS, type GeoUnavailableReason } from "./kb-knowledge-shape.ts";
import { geoBoundText } from "./kb-first-party-proof.ts";

export const GEO_OFFSITE_SERP_LIMITS = {
  /** Paid provider calls per update. One per query shape, and no retries. */
  queries: 3,
  /** Page one, because "who does an engine see about this brand" is page one. */
  depth: 10,
  /** Landing pages the collector may fetch out of all queries combined. */
  landingPages: 8,
  /** Distinct candidate URLs carried forward; the rest are counted, not kept. */
  candidates: 32,
  /**
   * Competitor scope, restated from the knowledge limits because it is used
   * here for the opposite purpose: a confirmed competitor's page is
   * `competitor_page` evidence and must never be re-labelled `third_party_page`.
   */
  competitorIdentities: GEO_KNOWLEDGE_LIMITS.competitorIdentities,
  competitorPagesPerIdentity: GEO_KNOWLEDGE_LIMITS.competitorPagesPerIdentity,
  titleCodePoints: 200,
} as const;

export type GeoOffsiteQueryKind = "brand_exact" | "brand_reviews" | "brand_alternatives";

export interface GeoOffsiteQuery {
  readonly kind: GeoOffsiteQueryKind;
  readonly query: string;
}

/**
 * The three queries, or none at all.
 *
 * A name the alias matcher would never look for -- one or two Latin characters
 * -- returns nothing rather than three paid calls whose results could not be
 * cross-referenced afterwards anyway.
 *
 * The English words "reviews" and "alternatives" are used in every market. They
 * are the terms the design fixes, and they are what a non-English audience
 * types too often for a localized guess to be worth a paid call; a market-aware
 * wording is a change to make with evidence, not by assumption.
 */
export function geoOffsiteBrandQueries(brandName: string): readonly GeoOffsiteQuery[] {
  const name = geoBoundText(brandName, GEO_OFFSITE_SERP_LIMITS.titleCodePoints);
  if (name === "" || !isMatchableGeoName(name)) return [];
  return [
    { kind: "brand_exact", query: `"${name}"` },
    { kind: "brand_reviews", query: `${name} reviews` },
    { kind: "brand_alternatives", query: `${name} alternatives` },
  ];
}

/**
 * What a domain publishes about an entity.
 *
 *  - `third_party_profile` -- a structured record *of the entity*: a name, a
 *    description, links. This is the only kind of page that can become a
 *    `sameAs` claim, because `sameAs` asserts identity, not coverage.
 *  - `review` -- other people's opinions about the entity. About it, not it.
 *  - `media` -- an editorial publication writing about it.
 *  - `other` -- an unrecognized domain. Explicitly not "not press" and not
 *    "not a profile": it means the table has no entry, nothing more.
 */
export type GeoOffsiteCategory = "third_party_profile" | "media" | "review" | "other";

export interface GeoOffsiteVenue {
  /** Registrable domain or exact subdomain; longest entry wins a match. */
  readonly domain: string;
  readonly category: GeoOffsiteCategory;
  /**
   * The record exists because the subject created it: an app store listing, a
   * company's own page on a network. Positive knowledge about how the venue
   * publishes, and the one venue property the independence judgement is allowed
   * to consume.
   */
  readonly ownerPublished: boolean;
  /** The subject can claim or edit a record somebody else may have created. */
  readonly ownerSubmittable: boolean;
  /** Whether a cross-referenced page here may become a `sameAs` claim (R1). */
  readonly sameAsEligible: boolean;
  /** Why this domain sits in this row. Kept as data so the table can be audited. */
  readonly basis: string;
}

/**
 * The classification table.
 *
 * Small on purpose. Every row is a domain whose publishing model can be stated
 * in one sentence; a domain nobody can describe that way belongs in `other`,
 * where it is reported as unrecognized instead of being guessed at.
 *
 * The media rows are a recognition aid and nothing more. An unlisted
 * publication is `other`, which must never be rendered as "no press coverage" --
 * the list cannot be complete and does not try to be.
 */
export const GEO_OFFSITE_VENUES: readonly GeoOffsiteVenue[] = [
  // Identity records. An engine resolving "what is this entity" reads these.
  { domain: "wikipedia.org", category: "third_party_profile", ownerPublished: false, ownerSubmittable: false, sameAsEligible: true,
    basis: "Encyclopedia article; edited by a community, not by the subject, though conflict-of-interest editing exists." },
  { domain: "wikidata.org", category: "third_party_profile", ownerPublished: false, ownerSubmittable: true, sameAsEligible: true,
    basis: "Identity graph item; the canonical sameAs target, and anyone including the subject may create one." },
  { domain: "crunchbase.com", category: "third_party_profile", ownerPublished: false, ownerSubmittable: true, sameAsEligible: true,
    basis: "Company record anyone can create and the company can claim and edit." },
  { domain: "g2.com", category: "third_party_profile", ownerPublished: false, ownerSubmittable: true, sameAsEligible: true,
    basis: "Vendor profile the vendor claims, with user reviews on the same record; filed as a profile because the page is an identity record for the entity." },
  { domain: "capterra.com", category: "third_party_profile", ownerPublished: false, ownerSubmittable: true, sameAsEligible: true,
    basis: "Vendor profile with reviews attached, on the same model as G2." },
  { domain: "producthunt.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "Launch record submitted by the maker; the listing text is the subject's own." },
  { domain: "linkedin.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "Company page administered by the company itself." },
  { domain: "github.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "Organization or repository published by the subject." },
  { domain: "apps.apple.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "App store listing written by the developer." },
  { domain: "play.google.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "App store listing written by the developer." },
  { domain: "apps.microsoft.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "App store listing written by the publisher." },
  { domain: "chromewebstore.google.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "Extension listing written by the developer." },
  { domain: "addons.mozilla.org", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "Add-on listing written by the developer." },
  { domain: "x.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "Self-operated channel on a third-party platform: a valid identity record, never independent evidence." },
  { domain: "twitter.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "Former spelling of the same self-operated channel." },
  { domain: "facebook.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "Self-operated page on a third-party platform." },
  { domain: "youtube.com", category: "third_party_profile", ownerPublished: true, ownerSubmittable: true, sameAsEligible: true,
    basis: "Self-operated channel on a third-party platform." },

  // Opinion venues. About the entity, so never an identity record.
  { domain: "trustpilot.com", category: "review", ownerPublished: false, ownerSubmittable: true, sameAsEligible: false,
    basis: "Consumer review venue; the business may claim its listing but does not write the reviews." },
  { domain: "trustradius.com", category: "review", ownerPublished: false, ownerSubmittable: true, sameAsEligible: false,
    basis: "Software review venue on the same model." },
  { domain: "getapp.com", category: "review", ownerPublished: false, ownerSubmittable: true, sameAsEligible: false,
    basis: "Software directory and review venue." },
  { domain: "softwareadvice.com", category: "review", ownerPublished: false, ownerSubmittable: true, sameAsEligible: false,
    basis: "Software directory and review venue." },
  { domain: "sitejabber.com", category: "review", ownerPublished: false, ownerSubmittable: true, sameAsEligible: false,
    basis: "Consumer review venue." },

  // Editorial publications. A recognition aid, deliberately incomplete.
  { domain: "techcrunch.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Technology news publication." },
  { domain: "theverge.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Technology news publication." },
  { domain: "wired.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Technology news publication." },
  { domain: "arstechnica.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Technology news publication." },
  { domain: "venturebeat.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Technology news publication." },
  { domain: "zdnet.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Technology news publication." },
  { domain: "cnet.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Technology news publication." },
  { domain: "engadget.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Technology news publication." },
  { domain: "thenextweb.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Technology news publication." },
  { domain: "fastcompany.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Business publication." },
  { domain: "businessinsider.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Business publication." },
  { domain: "bloomberg.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Business news wire." },
  { domain: "reuters.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "News wire." },
  { domain: "ft.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Business newspaper." },
  { domain: "wsj.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Business newspaper." },
  { domain: "nytimes.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Newspaper." },
  { domain: "theguardian.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Newspaper." },
  { domain: "forbes.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false,
    basis: "Business publication that also runs a contributor network, so a page here is not by itself editorial coverage; the page decides." },
  { domain: "inc.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false,
    basis: "Business publication with a contributor network, on the same caveat." },
  { domain: "entrepreneur.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false,
    basis: "Business publication with a contributor network, on the same caveat." },
  { domain: "36kr.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Chinese-language technology and venture publication." },
  { domain: "huxiu.com", category: "media", ownerPublished: false, ownerSubmittable: false, sameAsEligible: false, basis: "Chinese-language business and technology publication." },
];

/** Longest matching domain first, so `apps.apple.com` never resolves as `apple.com`. */
const VENUES_BY_SPECIFICITY: readonly GeoOffsiteVenue[] = [...GEO_OFFSITE_VENUES]
  .sort((left, right) => right.domain.length - left.domain.length || left.domain.localeCompare(right.domain, "en"));

/** The table row for a host, or null when the table has no entry for it. */
export function classifyGeoOffsiteVenue(host: string): GeoOffsiteVenue | null {
  const candidate = host.toLocaleLowerCase("en").replace(/\.$/u, "");
  return VENUES_BY_SPECIFICITY.find((venue) => candidate === venue.domain || candidate.endsWith(`.${venue.domain}`)) ?? null;
}

// ---------------------------------------------------------------------------
// provider seam
// ---------------------------------------------------------------------------

/**
 * The subset of the DataForSEO client this module uses.
 *
 * Declared structurally so `createDataForSeoKeywordMetricsClient(...).serpOrganic`
 * can be passed straight in. Widening this shape means widening what the real
 * client must provide, which the test asserts at type level.
 */
export interface GeoOffsiteSerpRequest {
  readonly keyword: string;
  readonly locationCode: number;
  readonly languageCode: string;
  readonly depth: number;
}

export interface GeoOffsiteSerpResultRow {
  readonly rankGroup: number;
  readonly domain: string;
  readonly title: string | null;
  readonly url: string | null;
}

export interface GeoOffsiteSerpResponse {
  readonly rows: readonly GeoOffsiteSerpResultRow[];
  readonly costUsd: number;
}

export type GeoOffsiteSerpFetch = (request: GeoOffsiteSerpRequest) => Promise<GeoOffsiteSerpResponse>;

export interface GeoOffsiteSerpDependencies {
  readonly serpOrganic: GeoOffsiteSerpFetch;
  /**
   * Where paid spend is reported. Defaults to a server log line, as elsewhere.
   *
   * `null` means the call was dispatched and its price never came back. It is
   * reported rather than skipped: a dispatch that leaves no line in the cost
   * log is a call recorded as one that did not happen.
   */
  readonly onCost?: (usd: number | null, market: string, query: string) => void;
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

export interface GeoOffsiteSerpCandidate {
  /** Normalized, exactly as the source catalogue's URL contract requires. */
  readonly url: string;
  readonly host: string;
  readonly title: string | null;
  /** Best (lowest) position across the queries that surfaced this URL. */
  readonly bestPosition: number;
  readonly queries: readonly GeoOffsiteQueryKind[];
  readonly venue: GeoOffsiteVenue | null;
  readonly category: GeoOffsiteCategory;
}

export interface GeoOffsiteSerpQueryOutcome {
  readonly kind: GeoOffsiteQueryKind;
  readonly query: string;
  readonly status: "ok" | "unavailable";
  readonly reason: GeoUnavailableReason | null;
  readonly resultsObserved: number;
}

export interface GeoOffsiteSerpReading {
  readonly availability: "available" | "partial" | "unavailable";
  readonly reason: GeoUnavailableReason | null;
  readonly market: string | null;
  readonly language: string | null;
  readonly queries: readonly GeoOffsiteSerpQueryOutcome[];
  readonly candidates: readonly GeoOffsiteSerpCandidate[];
  readonly costUsd: number;
  /**
   * Queries that were dispatched and whose response never arrived. The provider
   * bills a live task it dispatched, so any charge for these is NOT in
   * `costUsd` and `costUsd` is not a complete total while this is above zero.
   *
   * A count, not a dollar estimate: request-shape rejections are raised before
   * anything is sent, so some of these provably cost nothing, and guessing a
   * price would replace one unknown with a fabricated number. (`geo-cost-guard`
   * does charge a liability for its unpriced calls -- it has to, because a
   * spending ceiling that ignores them stops binding. This reading enforces no
   * ceiling; it only reports.)
   */
  readonly unpricedQueries: number;
  /** Results dropped because they are the site's own pages, or a competitor's. */
  readonly ownResultsSkipped: number;
  readonly competitorResultsSkipped: number;
  /** Candidates beyond the carry limit. Counted so the reader is never told there were none. */
  readonly candidatesDropped: number;
}

const CATEGORY_PRIORITY: Readonly<Record<GeoOffsiteCategory, number>> = {
  third_party_profile: 0,
  review: 1,
  media: 2,
  other: 3,
};

function logProviderCost(usd: number | null, market: string, query: string): void {
  console.info(`[geo-offsite-serp] paid_call cost_usd=${usd === null ? "unknown" : String(usd)} market=${market} query_units=${[...query].length}`);
}

function hostMatches(host: string, owners: readonly string[]): boolean {
  const candidate = host.replace(/^www\./u, "");
  return owners.some((owner) => {
    const normalized = owner.toLocaleLowerCase("en").replace(/^www\./u, "").replace(/\.$/u, "");
    return normalized !== "" && (candidate === normalized || candidate.endsWith(`.${normalized}`));
  });
}

interface CandidateAccumulator {
  readonly url: string;
  readonly host: string;
  title: string | null;
  bestPosition: number;
  readonly queries: GeoOffsiteQueryKind[];
  readonly venue: GeoOffsiteVenue | null;
}

export interface GeoOffsiteSerpInput {
  readonly brandName: string;
  readonly market: string | null;
  readonly language: string | null;
  /** The site the knowledge base is about, plus any host it also answers on. */
  readonly officialHosts: readonly string[];
  /** Confirmed competitor hosts; their pages are competitor evidence, not offsite. */
  readonly competitorHosts: readonly string[];
}

function unreadable(reason: GeoUnavailableReason, market: string | null, language: string | null): GeoOffsiteSerpReading {
  return {
    availability: "unavailable", reason, market, language, queries: [], candidates: [],
    costUsd: 0, unpricedQueries: 0, ownResultsSkipped: 0, competitorResultsSkipped: 0, candidatesDropped: 0,
  };
}

/**
 * Run the three brand queries and group what came back.
 *
 * Every failure resolves rather than throws: this runs inside a paid update
 * whose other steps have already spent money, and losing the whole update
 * because one provider call failed would throw away work the customer paid for.
 * A query that failed is reported as failed, and the groups it would have
 * filled are reported as not collected -- never as collected and empty.
 */
export async function readGeoOffsiteSerp(
  input: GeoOffsiteSerpInput,
  dependencies: GeoOffsiteSerpDependencies,
): Promise<GeoOffsiteSerpReading> {
  const market = (input.market ?? "").toLocaleUpperCase("en");
  const locationCode = SERP_LOCATIONS[market];
  const language = (input.language ?? "").trim().toLocaleLowerCase("en").split(/[-_]/u)[0] ?? "";
  if (locationCode === undefined) return unreadable("not_applicable", null, null);
  if (!SERP_LANGUAGES.has(language)) return unreadable("unsupported_language", market, null);
  const queries = geoOffsiteBrandQueries(input.brandName);
  if (queries.length === 0) return unreadable("insufficient_evidence", market, language);

  const outcomes: GeoOffsiteSerpQueryOutcome[] = [];
  const byUrl = new Map<string, CandidateAccumulator>();
  let costUsd = 0;
  let unpricedQueries = 0;
  let ownResultsSkipped = 0;
  let competitorResultsSkipped = 0;

  for (const { kind, query } of queries.slice(0, GEO_OFFSITE_SERP_LIMITS.queries)) {
    let response: GeoOffsiteSerpResponse;
    try {
      response = await dependencies.serpOrganic({ keyword: query, locationCode, languageCode: language, depth: GEO_OFFSITE_SERP_LIMITS.depth });
    } catch {
      // The provider bills a live task it dispatched, so a throw may still have
      // cost money. It is reported as a failed query rather than retried -- and
      // counted as unpriced and logged with an unknown price, because adding
      // nothing to `costUsd` and writing no cost line would record a call that
      // may have been billed as one that did not happen.
      unpricedQueries += 1;
      (dependencies.onCost ?? logProviderCost)(null, market, query);
      outcomes.push({ kind, query, status: "unavailable", reason: "fetch_failed", resultsObserved: 0 });
      continue;
    }
    (dependencies.onCost ?? logProviderCost)(response.costUsd, market, query);
    costUsd += response.costUsd;
    const rows = response.rows.slice(0, GEO_OFFSITE_SERP_LIMITS.depth);
    outcomes.push({ kind, query, status: "ok", reason: null, resultsObserved: rows.length });
    for (const row of rows) {
      if (row.url === null) continue;
      const normalized = normalizeAccountWebsiteUrl(row.url);
      if (normalized === null) continue;
      const host = new URL(normalized.submittedUrl).hostname.toLocaleLowerCase("en");
      if (hostMatches(host, input.officialHosts)) { ownResultsSkipped += 1; continue; }
      if (hostMatches(host, input.competitorHosts.slice(0, GEO_OFFSITE_SERP_LIMITS.competitorIdentities))) { competitorResultsSkipped += 1; continue; }
      const existing = byUrl.get(normalized.submittedUrl);
      if (existing === undefined) {
        byUrl.set(normalized.submittedUrl, {
          url: normalized.submittedUrl, host,
          title: row.title === null ? null : geoBoundText(row.title, GEO_OFFSITE_SERP_LIMITS.titleCodePoints) || null,
          bestPosition: row.rankGroup, queries: [kind], venue: classifyGeoOffsiteVenue(host),
        });
        continue;
      }
      if (row.rankGroup < existing.bestPosition) existing.bestPosition = row.rankGroup;
      if (!existing.queries.includes(kind)) existing.queries.push(kind);
      if (existing.title === null && row.title !== null) existing.title = geoBoundText(row.title, GEO_OFFSITE_SERP_LIMITS.titleCodePoints) || null;
    }
  }

  const ranked = [...byUrl.values()]
    .map((entry): GeoOffsiteSerpCandidate => ({
      url: entry.url, host: entry.host, title: entry.title, bestPosition: entry.bestPosition,
      queries: [...entry.queries], venue: entry.venue, category: entry.venue?.category ?? "other",
    }))
    .sort((left, right) =>
      CATEGORY_PRIORITY[left.category] - CATEGORY_PRIORITY[right.category]
      || left.bestPosition - right.bestPosition
      || left.url.localeCompare(right.url, "en"));
  const succeeded = outcomes.filter((outcome) => outcome.status === "ok").length;
  return {
    availability: succeeded === 0 ? "unavailable" : succeeded === outcomes.length ? "available" : "partial",
    reason: succeeded === 0 ? "fetch_failed" : null,
    market, language, queries: outcomes,
    candidates: ranked.slice(0, GEO_OFFSITE_SERP_LIMITS.candidates),
    costUsd,
    unpricedQueries,
    ownResultsSkipped,
    competitorResultsSkipped,
    candidatesDropped: Math.max(0, ranked.length - GEO_OFFSITE_SERP_LIMITS.candidates),
  };
}
