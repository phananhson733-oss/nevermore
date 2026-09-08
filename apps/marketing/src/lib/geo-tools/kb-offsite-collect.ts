// @input  -- a brand identity, its own pages, and the SSRF-safe reader the crawlers share
// @output -- third-party source rows, the evidence groups they fill, and what did not finish
// @pos    -- orchestration only: every fetch goes through the injected gated reader

/**
 * The offsite half of collection (design L2), assembled from three parts that
 * each refuse to guess: the SERP reading says which pages exist, the page
 * verifier says what a fetched body supports, and the first-party reader says
 * what the site's own pages carry.
 *
 * The one behaviour this file exists to guarantee: **a group that was not
 * collected is never reported as collected and empty.** The v1 evidence module
 * hard-coded `press` and `thirdPartyProfiles` to `[]` and the renderer then hid
 * empty groups, so "we never looked" and "we looked and found nothing" were the
 * same pixels. `evidence.collected` here lists only the groups this run
 * actually obtained evidence for (the rule is stated at `collected` below), and
 * `incomplete` names every budget that ran out and every page that was fetched
 * and could not be read.
 *
 * Fetching goes through `readResource`, which callers build with
 * `createGeoKnowledgeResourceReader` in `kb-enrichment-deps.ts`: DNS-pinned
 * SSRF-safe transport, same-host redirects only, and one crawl-gate admission
 * per host. Passing the *same reader instance* the own-site collection used is
 * deliberate -- admissions are memoized per host on the instance, so the own
 * site is admitted once for the whole update while each offsite host spends its
 * own per-target budget rather than the site's.
 */
import { createHash } from "node:crypto";

import type { GeoKnowledgeEvidenceReadResource } from "./kb-knowledge-evidence.ts";
import { GEO_KNOWLEDGE_LIMITS, type GeoKnowledgeSource, type GeoUnavailableReason } from "./kb-knowledge-shape.ts";
import { geoBoundText, observeGeoFirstPartyProof, type GeoFirstPartyPageInput } from "./kb-first-party-proof.ts";
import {
  readGeoOffsiteSerp,
  type GeoOffsiteCategory,
  type GeoOffsiteSerpCandidate,
  type GeoOffsiteSerpDependencies,
  type GeoOffsiteSerpReading,
} from "./kb-offsite-serp.ts";
import {
  judgeGeoOffsiteIndependence,
  readGeoOffsitePageSignals,
  verifyGeoEntityCrossReference,
  type GeoCrossReferenceBasis,
  type GeoCrossReferenceVerdict,
  type GeoOffsiteIndependence,
  type GeoOwnText,
} from "./kb-offsite-verification.ts";

export const GEO_OFFSITE_BUDGET = {
  /** Paid SERP calls. Enforced in `kb-offsite-serp.ts`; restated for the caller. */
  serpQueries: 3,
  /** Landing pages fetched across all three queries. */
  landingPages: 8,
  /** Per page. The gated reader clamps to the same ceiling. */
  pageTimeoutMs: 8_000,
  /**
   * The smallest window a landing-page fetch is dispatched in.
   *
   * Guarding the loop on "any time at all" admits the last candidate before the
   * wall clock with a deadline of a millisecond or two. That request cannot
   * succeed, and what it leaves behind is worse than the wasted dispatch: an
   * `unavailable` source row and a `landing_page_reads` entry, the exact record
   * a page that was reached and genuinely refused to answer produces. The
   * evidence record would then say a page is unreachable when nobody ever gave
   * it a chance to answer.
   *
   * A candidate below this floor is left unattempted instead, and lands in
   * `landing_pages` -- the stage that already means "no fetch was started".
   * One second is the smallest window in which a DNS-pinned, gate-admitted TLS
   * fetch of an HTML page is worth attempting at all.
   *
   * This is the one budget field an override cannot lower: the dispatch guard
   * takes the larger of this value and the caller's. A caller with a slow
   * target may demand a wider window; nothing may buy a hopeless dispatch.
   */
  minPageMs: 1_000,
  /** Wall clock for the whole offsite step, fetches included. */
  totalMs: 30_000,
  /**
   * Competitor scope. Used here only to keep a confirmed competitor's page out
   * of the third-party set: it is `competitor_page` evidence and relabelling it
   * would let a rival's site count as independent proof of this brand.
   */
  competitorIdentities: GEO_KNOWLEDGE_LIMITS.competitorIdentities,
  competitorPagesPerIdentity: GEO_KNOWLEDGE_LIMITS.competitorPagesPerIdentity,
} as const;

/**
 * The same keys, widened to `number`. Callers override a limit in tests and in
 * a resumed run; `typeof` would pin each field to the shipped literal and make
 * every override a type error.
 */
export type GeoOffsiteBudget = { readonly [Key in keyof typeof GEO_OFFSITE_BUDGET]: number };

/** Groups this module fills. `proof` and `changelog` come from own-site collection. */
export type GeoOffsiteEvidenceGroup = "press" | "thirdPartyProfiles" | "firstPartyProof";

/**
 * Which SERP categories fill which offsite group.
 *
 * One table, read twice: it selects a group's items *and* it decides whether
 * that group was collected, so the two can never drift apart. `other` appears
 * in neither row on purpose -- an unrecognized domain is fetched, catalogued
 * and cross-referenced, but filing it under `press` would assert it is a
 * publication (design 16.3, C9).
 */
const GEO_OFFSITE_GROUP_CATEGORIES: Readonly<Record<"press" | "thirdPartyProfiles", readonly GeoOffsiteCategory[]>> = {
  press: ["media"],
  // Review venues sit with the profiles: both are records held about the entity
  // on somebody else's platform, and neither is editorial coverage.
  thirdPartyProfiles: ["third_party_profile", "review"],
};

/**
 * How many distinct read-failure reasons reach `incomplete`.
 *
 * The assembler turns every `incomplete` entry into a sentence and stops
 * joining once the limitation text is full, so an unbounded list would push
 * earlier sentences out of the reader's view. Four reasons is more than any
 * real run produces; the per-page truth is in `sources`, where each failure is
 * listed with its own URL and reason, and the total is `spent.pagesUnreadable`.
 */
const GEO_OFFSITE_READ_FAILURE_REASONS_REPORTED = 4;

export interface GeoOffsiteEvidenceItem {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly url: string | null;
  readonly sourceRefs: readonly string[];
  readonly independence: "first_party" | GeoOffsiteIndependence;
}

export interface GeoOffsiteIdentityCandidate {
  readonly url: string;
  readonly sourceRef: string;
  readonly host: string;
  readonly verdict: GeoCrossReferenceVerdict;
  readonly basis: GeoCrossReferenceBasis;
  readonly namesBrand: boolean;
  readonly linksToOfficialDomain: boolean;
  /** True only for a `passed` cross-reference on a domain that records identity. */
  readonly sameAsEligible: boolean;
}

/**
 * Where a run fell short.
 *
 *  - `serp` -- a query the provider did not answer.
 *  - `landing_pages` -- a candidate no fetch was started for: the clock ran out
 *    or the fetch budget did.
 *  - `landing_page_reads` -- a candidate that *was* fetched and could not be
 *    read. Reached, unlike `landing_pages`, so the two get different sentences.
 *  - `first_party` -- own-page observations past the item cap.
 */
export type GeoOffsiteStage = "serp" | "landing_pages" | "landing_page_reads" | "first_party";

export interface GeoOffsiteIncomplete {
  readonly stage: GeoOffsiteStage;
  readonly reason: GeoUnavailableReason;
  /** How many items were left undone. Never zero: an entry means work remains. */
  readonly pending: number;
}

export interface GeoOffsiteCollection {
  readonly collectedAt: string;
  readonly serp: GeoOffsiteSerpReading;
  /** `third_party_page` rows to append to the knowledge body's source catalogue. */
  readonly sources: readonly GeoKnowledgeSource[];
  readonly evidence: {
    readonly press: readonly GeoOffsiteEvidenceItem[];
    readonly thirdPartyProfiles: readonly GeoOffsiteEvidenceItem[];
    readonly firstPartyProof: readonly GeoOffsiteEvidenceItem[];
    readonly collected: readonly GeoOffsiteEvidenceGroup[];
  };
  /** Cross-referenced identity records, ready for `entity.sameAs`. */
  readonly sameAsCandidates: readonly GeoOffsiteIdentityCandidate[];
  /** Everything else that referred to the brand, listed but never asserted. */
  readonly identityCandidates: readonly GeoOffsiteIdentityCandidate[];
  readonly incomplete: readonly GeoOffsiteIncomplete[];
  readonly spent: {
    readonly serpQueries: number;
    /**
     * The provider's own reported cost, summed. A floor, not a total: a query
     * the provider answered without pricing contributes nothing here and is
     * counted in `unpricedSerpQueries` instead. Read the two together.
     */
    readonly costUsd: number;
    /** SERP queries that ran and were billed, but reported no price. */
    readonly unpricedSerpQueries: number;
    readonly pagesFetched: number;
    readonly pagesUnreadable: number;
    readonly elapsedMs: number;
  };
}

export interface GeoOffsiteCollectionInput {
  /** Official name first, then confirmed aliases. Used for every name match. */
  readonly brandNames: readonly string[];
  readonly officialHosts: readonly string[];
  readonly competitorHosts: readonly string[];
  readonly market: string | null;
  readonly language: string | null;
  /** Own-site body text, for the syndication measurement. */
  readonly ownTexts: readonly GeoOwnText[];
  /** Own-site HTML, for the R11 first-party observations. */
  readonly ownPages: readonly GeoFirstPartyPageInput[];
}

export interface GeoOffsiteCollectionDependencies {
  readonly serp: GeoOffsiteSerpDependencies;
  /** Build with `createGeoKnowledgeResourceReader`; do not hand-roll a fetch. */
  readonly readResource: GeoKnowledgeEvidenceReadResource;
  readonly now: () => Date;
  readonly nowMs?: () => number;
  readonly budget?: Partial<GeoOffsiteBudget>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sourceId(url: string): string {
  return `third_party_page-${sha256(`third_party_page:${url}`).slice(0, 20)}`;
}

function isHtml(contentType: string): boolean {
  const type = contentType.toLocaleLowerCase("en").split(";", 1)[0]?.trim() ?? "";
  return type === "text/html" || type === "application/xhtml+xml";
}

function unavailableSource(url: string, host: string, reason: GeoUnavailableReason): GeoKnowledgeSource {
  return {
    id: sourceId(url), kind: "third_party_page", label: geoBoundText(host, 120), url,
    competitor: null, availability: "unavailable", reason, observedAt: null, bodyHash: null,
    excerpts: [],
    // A page nobody could read supports no independence claim at all. It is
    // still listed, because "we tried and could not read it" is information the
    // reader would otherwise never see.
    independence: "undetermined",
  };
}

interface FetchedCandidate {
  readonly candidate: GeoOffsiteSerpCandidate;
  readonly source: GeoKnowledgeSource;
  readonly identity: GeoOffsiteIdentityCandidate | null;
  readonly summary: string | null;
}

async function fetchCandidate(
  candidate: GeoOffsiteSerpCandidate,
  input: GeoOffsiteCollectionInput,
  dependencies: GeoOffsiteCollectionDependencies,
  timeoutMs: number,
): Promise<FetchedCandidate> {
  const failed = (reason: GeoUnavailableReason): FetchedCandidate =>
    ({ candidate, source: unavailableSource(candidate.url, candidate.host, reason), identity: null, summary: null });
  const result = await dependencies.readResource({ url: candidate.url, expected: "html", timeoutMs });
  if (result.kind !== "ok") return failed(result.reason);
  if (!isHtml(result.contentType)) return failed("invalid_response");
  const signals = readGeoOffsitePageSignals(result.body, candidate.url);
  // No excerpt means no exact evidence to show, and the source contract refuses
  // an available source that carries none.
  if (signals.excerpts.length === 0) return failed("insufficient_evidence");
  const cross = verifyGeoEntityCrossReference({
    brandNames: input.brandNames, officialHosts: input.officialHosts, page: signals,
  });
  const independence = judgeGeoOffsiteIndependence({
    brandNames: input.brandNames, page: signals, ownTexts: input.ownTexts,
    venueIsOwnerPublished: candidate.venue?.ownerPublished === true,
  });
  const id = sourceId(candidate.url);
  return {
    candidate,
    source: {
      id, kind: "third_party_page", label: geoBoundText(candidate.host, 120), url: candidate.url,
      competitor: null, availability: "available", reason: null, observedAt: result.observedAt,
      bodyHash: sha256(result.body), excerpts: [...signals.excerpts],
      independence: independence.independence,
    },
    identity: {
      url: candidate.url, sourceRef: id, host: candidate.host, verdict: cross.verdict, basis: cross.basis,
      namesBrand: cross.namesBrand, linksToOfficialDomain: cross.linksToOfficialDomain,
      sameAsEligible: cross.verdict === "passed" && candidate.venue?.sameAsEligible === true,
    },
    summary: signals.excerpts[0] ?? null,
  };
}

function evidenceItem(fetched: FetchedCandidate): GeoOffsiteEvidenceItem {
  return {
    id: `evidence:${fetched.source.id}`,
    label: fetched.source.label,
    summary: geoBoundText(fetched.summary ?? "", 800),
    url: fetched.source.url,
    sourceRefs: [fetched.source.id],
    independence: fetched.source.independence ?? "undetermined",
  };
}

function firstPartyItems(pages: readonly GeoFirstPartyPageInput[]): readonly GeoOffsiteEvidenceItem[] {
  return pages.flatMap((page) => observeGeoFirstPartyProof(page).map((row) => ({
    id: row.id, label: row.label, summary: row.summary, url: row.url,
    sourceRefs: [row.sourceRef], independence: "first_party" as const,
  })));
}

/**
 * Collect the offsite half of the evidence, within budget, and say what it did
 * not reach.
 *
 * Ordering is the budget policy: candidates arrive from the SERP reading sorted
 * identity records first, then review venues, then media, then unrecognized
 * domains. Spending the eight fetches top-down means a run that runs out of
 * time has spent it on the pages that answer "who is this entity" rather than
 * on whatever happened to rank tenth.
 */
export async function collectGeoOffsiteEvidence(
  input: GeoOffsiteCollectionInput,
  dependencies: GeoOffsiteCollectionDependencies,
): Promise<GeoOffsiteCollection> {
  const budget: GeoOffsiteBudget = { ...GEO_OFFSITE_BUDGET, ...dependencies.budget };
  const clock = dependencies.nowMs ?? Date.now;
  const startedAt = clock();
  const deadline = startedAt + budget.totalMs;
  const incomplete: GeoOffsiteIncomplete[] = [];

  const serp = await readGeoOffsiteSerp({
    brandName: input.brandNames[0] ?? "", market: input.market, language: input.language,
    officialHosts: input.officialHosts, competitorHosts: input.competitorHosts,
  }, dependencies.serp);
  const failedQueries = serp.queries.filter((query) => query.status === "unavailable").length;
  const attemptedSerp = serp.queries.some((query) => query.status === "ok");
  if (!attemptedSerp) {
    incomplete.push({ stage: "serp", reason: serp.reason ?? "fetch_failed", pending: budget.serpQueries - serp.queries.length + failedQueries });
  } else if (failedQueries > 0) {
    incomplete.push({ stage: "serp", reason: "fetch_failed", pending: failedQueries });
  }

  const planned = serp.candidates.slice(0, budget.landingPages);
  const fetched: FetchedCandidate[] = [];
  for (const candidate of planned) {
    const remaining = deadline - clock();
    // The caller may raise this floor, never lower it. `minPageMs` states how
    // long a DNS-pinned, gate-admitted TLS fetch of an HTML page needs before
    // it is worth attempting -- a fact about the network, not a policy knob --
    // so a value below it buys nothing but the false record described there.
    // The `Math.max(1, ...)` this replaces closed exactly one of those values:
    // with `minPageMs` overridden to 0 and 500 ms on the clock, `500 < 1` is
    // false and the candidate was dispatched with a 500 ms deadline it cannot
    // answer inside, landing in `landing_page_reads` as a page that was
    // reached and refused -- the sentence this guard exists to never produce.
    if (remaining < Math.max(GEO_OFFSITE_BUDGET.minPageMs, budget.minPageMs)) {
      // Stop and say so. Reporting the pages we did read as the whole picture
      // would be the collector claiming a completeness it did not buy -- and
      // these candidates are reported as never attempted (`landing_pages`),
      // never as fetched and unreadable (`landing_page_reads`), because no
      // request was sent for any of them.
      incomplete.push({ stage: "landing_pages", reason: "timeout", pending: planned.length - fetched.length });
      break;
    }
    fetched.push(await fetchCandidate(candidate, input, dependencies, Math.min(budget.pageTimeoutMs, remaining)));
  }
  if (serp.candidates.length > planned.length) {
    incomplete.push({ stage: "landing_pages", reason: "not_collected", pending: serp.candidates.length - planned.length });
  }

  const readable = fetched.filter((entry) => entry.source.availability === "available");
  // A page that was fetched and could not be read is work this run did not
  // finish, not work it declined -- and it is the usual reason a group ends up
  // with no evidence at all. Only the whole-step timeout and the candidate
  // overflow used to reach `incomplete`, so a run whose every read failed
  // reported nothing missing and the evidence module stayed `available`.
  const readFailures = new Map<GeoUnavailableReason, number>();
  for (const entry of fetched) {
    if (entry.source.availability === "available" || entry.source.reason === null) continue;
    readFailures.set(entry.source.reason, (readFailures.get(entry.source.reason) ?? 0) + 1);
  }
  for (const [reason, pending] of [...readFailures]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))
    .slice(0, GEO_OFFSITE_READ_FAILURE_REASONS_REPORTED)) {
    incomplete.push({ stage: "landing_page_reads", reason, pending });
  }

  const cap = GEO_KNOWLEDGE_LIMITS.evidenceItems;
  const readableIn = (group: "press" | "thirdPartyProfiles"): readonly FetchedCandidate[] =>
    readable.filter((entry) => GEO_OFFSITE_GROUP_CATEGORIES[group].includes(entry.candidate.category));
  const press = readableIn("press").map(evidenceItem).slice(0, cap);
  const profiles = readableIn("thirdPartyProfiles").map(evidenceItem).slice(0, cap);
  const identities = fetched.flatMap((entry) => entry.identity === null || entry.identity.verdict === "failed" ? [] : [entry.identity]);
  const allFirstParty = firstPartyItems(input.ownPages);
  if (allFirstParty.length > cap) {
    incomplete.push({ stage: "first_party", reason: "not_collected", pending: allFirstParty.length - cap });
  }

  /**
   * A group is `collected` when this run actually obtained that group's
   * evidence -- not when it merely looked at an index, and not when it looked
   * at somebody else's category. For the two offsite groups:
   *
   *  - No query answered: neither group. There is no index to have looked at.
   *  - The queries answered and surfaced no third-party page at all: both.
   *    "Nothing about this brand ranked" is a real finding, and it is a finding
   *    about press and profiles alike.
   *  - Otherwise, per group: at least one candidate of *that group's own*
   *    categories was read successfully. A run that read eight vendor profiles
   *    and no media page has learned nothing about press coverage; a run whose
   *    every read failed has learned nothing about either. Rendering those as
   *    "collected, nothing found" is the v1 lie in a new place -- what was
   *    attempted and did not come back is in `incomplete` and in `sources`.
   *
   * The first-party group is collected when own pages were supplied at all.
   */
  const collected: GeoOffsiteEvidenceGroup[] = [];
  for (const group of ["press", "thirdPartyProfiles"] as const) {
    if (attemptedSerp && (serp.candidates.length === 0 || readableIn(group).length > 0)) collected.push(group);
  }
  if (input.ownPages.length > 0) collected.push("firstPartyProof");

  return {
    collectedAt: dependencies.now().toISOString(),
    serp,
    sources: fetched.map((entry) => entry.source),
    evidence: { press, thirdPartyProfiles: profiles, firstPartyProof: allFirstParty.slice(0, cap), collected },
    sameAsCandidates: identities.filter((identity) => identity.sameAsEligible),
    identityCandidates: identities.filter((identity) => !identity.sameAsEligible),
    incomplete,
    spent: {
      serpQueries: serp.queries.filter((query) => query.status === "ok").length,
      costUsd: serp.costUsd,
      unpricedSerpQueries: serp.unpricedQueries,
      pagesFetched: readable.length,
      pagesUnreadable: fetched.length - readable.length,
      elapsedMs: clock() - startedAt,
    },
  };
}
