// @input  -- an authenticated same-origin request to start, or to re-lock, one owned site's v3 knowledge base
// @output -- the first v3 draft, or that draft rebound to the Profile revision the owner confirmed since
// @pos    -- free of model calls and of network work; it spends no crawl allowance and writes at most one draft

/**
 * The step that had no code.
 *
 * `saveGeoKbDraftV3` was reachable only from the review and publish handlers,
 * and both require a v3 draft to already exist, so no first v3 draft could come
 * into being and the whole v3 feature was unreachable in production. This is
 * the producer: the design's free "assemble" step, minus the knowledge modules
 * that a paid run writes.
 *
 * The ordering it exists to satisfy is not obvious and is worth stating.
 * `marketing_geo_generation_input_current` (v3 branch) will only let a paid
 * generation be claimed when the run's `generationInputHash` equals the hash
 * stored in the draft's `runRef`. So the generation input must be *in the
 * stored draft* before any model step -- roles included. "generationInput is
 * locked at the roles step" does not mean the roles step mints it; the free
 * step before it persists it, and this is that step.
 *
 * What the request may say is deliberately almost nothing: a knowledge base id
 * and a zero, which is the number of draft versions it expects to find. Every
 * value in the locked half is derived on the server from the owner's confirmed
 * Website Profile, and the one value that is not derived from it is a
 * documented constant meaning "no evidence yet". A client that
 * could name its own `profileRef` could name a Profile revision the owner never
 * confirmed, and the review surface downstream is built on the premise that the
 * locked half has no field a client can reach.
 *
 * It refuses rather than overwrites. A v3 draft holds knowledge a run was paid
 * for and a review the owner made; a v1/v2 draft holds accepted facts and
 * reviewed roles that a v3 generation input has no field to carry. Replacing
 * either with a freshly assembled draft would destroy work under the name of
 * creating something, so both are named refusals, and the upgrade and the
 * re-lock are separate, deliberate steps someone has to design.
 *
 * It observes nothing, and that is a decision rather than an omission. An
 * earlier version of this route collected the site here to fill
 * `evidenceContentHash`. Three things were wrong with that, and all three are
 * checkable from the source:
 *
 *   The value could not be verified by anyone. The digest is taken over an
 *   evidence body that contains `collectedAt` (`kb-knowledge-evidence.ts`), so
 *   two collections of a byte-identical site one second apart hash
 *   differently: it names a collection *moment*, not a body of evidence. The
 *   receipt behind it was stored nowhere, so no code, now or later, could
 *   reproduce it or say what it stood for.
 *
 *   The value names the wrong thing at the wrong time. The hash exists to say
 *   what a model was shown (design 16.2b, B5), and no model has been shown
 *   anything when a knowledge base is created; the step that collects the
 *   evidence a model will read is the one that has to lock it (design 5:
 *   collect, assemble, then lock at roles). Creating a value here bought
 *   something whose only correct future was being replaced -- and note, since
 *   the collect step is not wired yet, that nothing re-locks it today. That is
 *   reported as a seam rather than papered over: until something does, this
 *   field says "no evidence", which is true of a created draft and would stop
 *   being true the moment a knowledge generation ran against it.
 *
 *   It was not free. One collection reads the home page, up to eight linked own
 *   pages, robots.txt, sitemap.xml and llms.txt behind a single crawl-gate
 *   admission -- one of the four an hour a site has (`CRAWL_TARGET_MAX`,
 *   `../tools/crawl-gate.ts`), shared with the Profile scan, seo-audit and
 *   internal-link-audit. It was also spent outside any ledger: the design
 *   requires every gate-spending operation to be a resumable,
 *   idempotency-keyed run operation, and a create-time crawl can be none of
 *   those, because there is no run yet.
 *
 * So the created draft states the absence instead, with the sentinel below,
 * and the first real collection re-locks it.
 *
 * What is given up by not collecting is one signal: "the site answered just
 * now". It is a small loss. Creating a knowledge base already requires a
 * confirmed Website Profile, and a Profile is confirmed over a scan that did
 * reach the site; and the run's collect step reports per target what could not
 * be read, with reasons, which is a better answer than one 409 that says the
 * whole thing is unavailable because the home page timed out once.
 *
 * ---
 *
 * The other half of this module is the re-lock, and it lives here rather than in
 * a file of its own because it is the same three steps: read the owner's
 * confirmed Profile, derive the locked half from it, write one draft. Nothing
 * else in the product derives a `generationInput`; a second derivation anywhere
 * else would be a second answer to "what is this knowledge base measuring".
 *
 * It exists because the lock had a release nobody performed. Once a paid
 * generation names itself in `runRef`, `marketing_geo_save_kb_draft` refuses a
 * changed `generationInputHash` -- unless the same save clears all four `runRef`
 * ids, which forfeits reuse of everything the old input bought. Meanwhile
 * `marketing_geo_generation_input_current` (v3 branch) refuses to let ANY paid
 * generation be claimed unless the draft's `profileRef` still names the
 * website's current confirmed Profile snapshot. Put together: the moment the
 * owner confirms a new Profile revision every claim is refused, and the only
 * writer that could move the reference did not exist. The knowledge base could
 * never be updated again -- the run's knowledge step answers 409 `input_stale`
 * every time, which `geoRunDispatchOutcome` files as retryable, so each Update
 * spends its crawl admissions on the collect half and then stalls.
 *
 * What the re-lock costs is stated rather than hidden. Clearing
 * `knowledgeGenerationId` unbinds the knowledge that generation was paid for,
 * and `handleGeoKbV3Publish` checks a knowledge binding only when that id is
 * non-null -- so a body kept across the release would publish with no
 * provenance check at all, presented as knowledge about a generation input it
 * was never generated against. The body therefore goes with the ids, the review
 * made over that body goes with the body, and the response says exactly what
 * went. The re-lock itself buys nothing: no model call, no crawl, no run
 * started. The next update is a charge the owner makes by pressing Update, not
 * one this route makes on their behalf.
 */
import { z } from "zod";

import { geoGenerationLanguage } from "@sf/public-tools/content-brief/geo-contract";

import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import {
  normalizeAccountWebsiteUrl,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileReferenceV1,
} from "../account-websites/contracts.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { proposeGeoKbAliases } from "./kb-aliases.ts";
import { GEO_KB_LIMITS } from "./kb-contract.ts";
import { buildGeoProfileRefV3 } from "./kb-profile-ref-v3.ts";
import { buildGeoProfileSuggestions } from "./kb-profile-suggestions.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoKbStoreResult } from "./kb-store.ts";
import { isGeoKbPayloadV3Value, type VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import {
  GEO_KB_SCHEMA_VERSION_V3,
  geoGenerationInputSchema,
  parseGeoKbPayloadV3,
  type GeoGenerationInputV3,
  type GeoKbPayloadV3,
} from "./kb-v3-contract.ts";
import type { GeoKbV3SaveOutcome } from "./kb-v3-store.ts";

/**
 * Why a created draft cannot start a run yet. These are not refusals: the draft
 * is real and the owner can act on it. They are the things whoever draws the
 * card has to be able to say before the owner pays for a step that cannot work.
 */
export const GEO_KB_V3_DRAFT_BLOCKERS = [
  /** The question step follows the English registry; nothing else can be asked. */
  "unsupported_language",
  /**
   * The knowledge synthesis input requires at least one category term
   * (`kb-knowledge-synthesis-v2-contract.ts`), and a GEO probe with no category
   * has no subject at all. The Profile supplied none this projection could use.
   */
  "category_terms_missing",
] as const;
export type GeoKbV3DraftBlocker = (typeof GEO_KB_V3_DRAFT_BLOCKERS)[number];

/**
 * The documented stand-in for "no evidence set has been observed for this
 * generation input yet", built the way `GEO_ABSENT_QUESTION_SET_HASH`
 * (`snapshot-context-v3.ts`) is built and read the same way.
 *
 * It is the digest of a marker, not of any evidence: a real value is
 * `geoKnowledgeEvidenceDigest(body)` over a `marketing-geo-knowledge-evidence.v1`
 * body, and this marker is not that shape, so no collection can produce it and
 * a reader comparing digests cannot mistake an absent evidence set for a
 * present one.
 *
 * The contract the collect/assemble step relies on, stated because that step is
 * being built beside this one: a draft created here carries this value *and*
 * all four `runRef` ids null. That is exactly the state in which
 * `marketing_geo_save_kb_draft` permits `generationInputHash` to move -- the
 * lock engages only once one of those ids is non-empty
 * (`20260907143000_geo_kb_v3.sql`) -- so the first save that carries real
 * evidence re-locks the generation input in the ordinary way and needs no
 * release. Nothing has to clear anything, and nothing paid for is forfeited,
 * because nothing has been paid for yet.
 */
export const GEO_ABSENT_EVIDENCE_CONTENT_HASH = geoV2Digest({
  absent: "marketing-geo-knowledge-evidence.v1",
});

/* ------------------------------------------------------------------ */
/* The pure half: one confirmed Profile, and the digest it is bound to  */
/* ------------------------------------------------------------------ */

export interface GeoKbV3IdentitySeed {
  /** The address that answers, `www.` included, as the knowledge base names it. */
  readonly targetUrl: string;
  readonly reference: WebsiteProfileReferenceV1;
  readonly profile: MarketingWebsiteProfileV1;
}

/**
 * Everything the locked input needs except the evidence digest, so a Profile
 * that cannot produce one is refused before anything is written and with the
 * failing fields named. The split is also what lets the collect/assemble step
 * reuse this: it needs the same identity over a real digest.
 */
export type GeoKbV3IdentityBuild =
  | {
      readonly kind: "ok";
      readonly identity: GeoGenerationInputV3["identity"];
      readonly profileRef: GeoGenerationInputV3["profileRef"];
      readonly competitors: GeoGenerationInputV3["competitors"];
      readonly blockers: readonly GeoKbV3DraftBlocker[];
    }
  | { readonly kind: "unusable"; readonly fields: readonly string[] };

/** Trim, drop empties and deduplicate case-insensitively, preserving order. */
function cleanTerms(values: readonly string[], limit: number): readonly string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = raw.normalize("NFC").trim();
    const key = value.toLocaleLowerCase("en").replace(/\s+/gu, " ");
    if (value === "" || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

/** Failing field paths, deduplicated and bounded, in the order zod reported them. */
function refusedFields(issues: readonly { readonly path: readonly PropertyKey[] }[]): readonly string[] {
  const seen = new Set<string>();
  for (const issue of issues) {
    seen.add(`/${issue.path.map(String).join("/")}`);
    if (seen.size >= 16) break;
  }
  return [...seen];
}

/**
 * The competitors the Profile can name, as identities rather than as confirmed
 * rivals. Every row lands `confirmed: false`, which is the truth: nobody has
 * looked at them yet, and only a confirmed row is ever fetched or compared
 * against. Confirming one is an owner gesture the card owns.
 *
 * The same two-numbers-must-agree problem the `categoryTerms` cap has, in a
 * shape that fails harder. The slice below reads `GEO_KB_LIMITS.competitors`
 * and `geoGenerationInputSchema` bounds the same list by
 * `GEO_KNOWLEDGE_LIMITS.competitorIdentities` (`kb-v3-contract.ts`); both are
 * 5 today and nothing couples them. Unlike the identity, competitors are not
 * parsed here, so a slice wider than the contract cannot answer `unusable`
 * with the offending field named -- it throws out of
 * `lockGeoKbV3GenerationInput` and the route reports `draft_invalid` 422 over
 * a Profile that is fine. "keeps no more competitors than the locked
 * generation input admits" is the test that fails when the two diverge. The
 * two constants becoming one is reported as a seam.
 */
function competitorsFromProfile(profile: MarketingWebsiteProfileV1): GeoGenerationInputV3["competitors"] {
  const proposal = buildGeoProfileSuggestions(profile, { competitors: [] });
  const rows = proposal.competitors.flatMap((row) =>
    row.value === null ? [] : [{ domain: row.value.domain, brandName: row.value.brandName, confirmed: false }],
  );
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = row.domain === "" ? `brand:${row.brandName.toLocaleLowerCase("en")}` : `domain:${row.domain}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, GEO_KB_LIMITS.competitors);
}

export function buildGeoKbV3Identity(seed: GeoKbV3IdentitySeed): GeoKbV3IdentityBuild {
  const site = normalizeAccountWebsiteUrl(seed.targetUrl);
  if (site === null) return { kind: "unusable", fields: ["/targetUrl"] };
  const profileRef = buildGeoProfileRefV3(seed.reference, seed.profile);
  if (profileRef.kind !== "ok") return { kind: "unusable", fields: profileRef.fields };

  const officialName = seed.profile.productName.normalize("NFC").trim();
  const country = seed.profile.country.trim().toUpperCase();
  const language = seed.profile.locale.trim().toLowerCase();
  const unusable: string[] = [];
  // A knowledge base is about a named thing in a named market. An empty name
  // makes every alias, question and comparison nameless, and a market that is
  // not a country/language pair resolves to no question registry at all.
  if (officialName === "") unusable.push("/subset/productName");
  if (!/^[A-Z]{2}$/u.test(country)) unusable.push("/subset/country");
  if (!/^[a-z]{2}(-[a-z]{2})?$/u.test(language)) unusable.push("/subset/locale");
  if (unusable.length > 0) return { kind: "unusable", fields: unusable };

  /**
   * Two numbers have to agree here and nothing in the type system makes them:
   * this cap, and `geoGenerationInputSchema`'s `categoryTerms` maximum, which
   * `kb-v3-contract.ts` writes as a literal 8. If this constant were raised
   * alone, every Profile with more categories than the contract admits would
   * become `unusable` and the owner would get a hard refusal for a Profile that
   * is fine. The test named "admits as many category terms as the shared limit
   * allows" is what fails when they diverge; the contract reading the constant
   * would be better, and is reported as a seam.
   */
  const categoryTerms = cleanTerms(seed.profile.categories, GEO_KB_LIMITS.categoryTerms);
  const identity = geoGenerationInputSchema.shape.identity.safeParse({
    targetUrl: site.submittedUrl,
    officialName,
    aliases: [...proposeGeoKbAliases(site.submittedUrl, officialName)],
    categoryTerms: [...categoryTerms],
    market: { country, language },
  });
  if (!identity.success) return { kind: "unusable", fields: refusedFields(identity.error.issues) };

  const blockers: GeoKbV3DraftBlocker[] = [];
  if (geoGenerationLanguage(language) === null) blockers.push("unsupported_language");
  if (categoryTerms.length === 0) blockers.push("category_terms_missing");
  return {
    kind: "ok",
    identity: identity.data,
    profileRef: profileRef.profileRef,
    competitors: competitorsFromProfile(seed.profile),
    blockers,
  };
}

/**
 * Bind the identity to an evidence set, named by its digest.
 *
 * The argument is a parameter rather than a constant because this is also the
 * function the collect/assemble step should use when it locks a *real* digest
 * over evidence it has just collected and filed. At create time the only
 * honest argument is `GEO_ABSENT_EVIDENCE_CONTENT_HASH`: nothing has been
 * observed.
 *
 * `roles` is empty, and not a placeholder: the roles step has not run, and a
 * seeded role would have to carry `review: "accepted"` to satisfy the locked
 * input -- which would state that an owner accepted a role nobody proposed.
 */
export function lockGeoKbV3GenerationInput(
  identity: Extract<GeoKbV3IdentityBuild, { kind: "ok" }>,
  evidenceContentHash: string,
): GeoGenerationInputV3 {
  return geoGenerationInputSchema.parse({
    identity: identity.identity,
    profileRef: identity.profileRef,
    competitors: identity.competitors,
    roles: [],
    evidenceContentHash,
  });
}

/**
 * The first draft: a locked input, no knowledge, an empty review, and a
 * `runRef` that names no run.
 *
 * `runId` stays null on purpose. There is no `marketing_geo_kb_runs` row to
 * point at -- this route takes no lease and executes no operations -- and a
 * minted id would name a run that does not exist. It would also lock the
 * generation input immediately: `marketing_geo_save_kb_draft`'s v3 guard treats
 * any non-empty `runRef` id as "a run exists", so the very next save that
 * re-locks the input (which the collect/assemble step must do) would have to
 * clear the id of the run it is currently executing to make progress. The
 * single-run route writes `runId`, in the same save that locks the input its
 * run will pay against; it is cleared only by a save that re-locks a different
 * `generationInputHash`, which the database requires to clear all four ids
 * together.
 */
export function createGeoKbDraftPayloadV3(generationInput: GeoGenerationInputV3): GeoKbPayloadV3 {
  /**
   * The hash is `geoGenerationInputHashV3`'s definition, written out because
   * that function needs a payload and this is where the payload is made. The
   * two are pinned to each other by a test rather than by a runtime check: a
   * check here could only fire if the contract's parser started transforming
   * what it parses, and a test that reads the parsed payload back catches that
   * where it can be fixed, while a throw would only report it after the fact.
   */
  return parseGeoKbPayloadV3({
    schemaVersion: GEO_KB_SCHEMA_VERSION_V3,
    generationInput,
    knowledge: null,
    review: { decisions: [], suppressions: [] },
    runRef: {
      runId: null,
      generationInputHash: geoV2Digest(generationInput),
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: null,
    },
  });
}

/* ------------------------------------------------------------------ */
/* The re-lock: the release the database has and nothing performed      */
/* ------------------------------------------------------------------ */

/**
 * Whether the stored reference still names the website's current confirmed
 * Profile snapshot.
 *
 * This is not a convenience predicate. It is the database's own question,
 * written out: `marketing_geo_generation_input_current` (v3 branch,
 * `20260907143000_geo_kb_v3.sql`) refuses every paid claim unless the draft's
 * `profileRef` agrees with the website's `current_confirmed_snapshot_id` on all
 * four of these fields. Anything this answers `true` for and the database
 * answers `false` for is a knowledge base that reports itself healthy and can
 * never buy another update, which is the exact failure this path exists to end.
 *
 * The comparison is exact, and that is the reason it is not a helper someone
 * might "tidy up". The SQL compares text -- `v_website.id::text is distinct
 * from v_ref->>'websiteId'` -- and PostgreSQL renders a uuid in lower case, so
 * a reference carrying an upper-case id IS stale to the database. Folding case
 * here would report such a draft as current forever.
 *
 * `subset` and `subsetHash` are deliberately not compared. The database does
 * not read them, so a change to `kb-profile-subset.ts` that moved the subset
 * while the confirmed revision stood still is not a reason to forfeit a paid
 * run: the draft is still claimable, and re-locking it would cost the owner
 * their knowledge to fix nothing.
 */
export function geoProfileRefNamesConfirmed(
  profileRef: GeoGenerationInputV3["profileRef"],
  reference: WebsiteProfileReferenceV1,
): boolean {
  return profileRef.websiteId === reference.websiteId
    && profileRef.snapshotId === reference.snapshotId
    && profileRef.snapshotRevision === String(reference.snapshotRevision)
    && profileRef.profileHash === reference.profileHash;
}

/** The `runRef` ids a re-lock clears, which is what the database's release requires. */
export const GEO_KB_V3_RELEASED_REFS = [
  "runId",
  "rolesGenerationId",
  "knowledgeGenerationId",
  "questionsGenerationId",
] as const;
export type GeoKbV3ReleasedRef = (typeof GEO_KB_V3_RELEASED_REFS)[number];

/**
 * What a re-lock destroys, counted off the draft it replaces.
 *
 * Reported rather than implied, and reported as counts of real things rather
 * than as one "some work was lost" flag: an owner who excluded eleven items and
 * an owner who excluded none are owed different sentences.
 */
export interface GeoKbV3RelockDiscard {
  /** True when a paid generation's knowledge body was in the draft and is now gone. */
  readonly knowledge: boolean;
  readonly decisions: number;
  readonly suppressions: number;
  /** Locked roles. Nothing in this deployment produces any; see the note below. */
  readonly roles: number;
  /** The paid records this draft may no longer reuse, by the field that named them. */
  readonly released: readonly GeoKbV3ReleasedRef[];
}

/** The identity two competitor rows are the same competitor by. */
function competitorKey(row: { readonly domain: string; readonly brandName: string }): string {
  return row.domain === "" ? `brand:${row.brandName.toLocaleLowerCase("en")}` : `domain:${row.domain}`;
}

/**
 * The owner state carried across a re-lock: which competitors the owner
 * confirmed, the name they confirmed them under, and the aliases they gave
 * them.
 *
 * Which rivals exist is the Profile's answer -- the rows are recomputed from
 * its `directCompetitors` and a rival deleted there is gone here. `confirmed`
 * is not the Profile's answer. It is a judgement somebody made about a rival,
 * and editing a Profile is not that person changing their mind. Only a
 * confirmed competitor is ever fetched or compared against, so resetting the
 * flag would quietly shrink what the next update measures -- the kind of loss
 * nobody notices until a report is missing a column.
 *
 * The confirmed name travels with the flag, and it has to. A Profile entry is
 * one of exactly two shapes (`buildGeoProfileSuggestions`): a bare host, which
 * yields `{ domain, brandName: "" }`, or anything with a space in it, which
 * yields `{ domain: "", brandName }`. So a rival listed as a domain -- the
 * ordinary case -- produces a row with no name at all, while
 * `competitorSchema` requires a confirmed row to carry the name that was
 * confirmed. Carrying the flag without the name would build a payload the
 * contract refuses; dropping the flag instead would mean a confirmation
 * survives a Profile edit only for the minority of rivals the Profile happens
 * to spell out in words. The carried name therefore fills the gap and never
 * overrides an answer: where the Profile does supply a name -- the brand-keyed
 * shape, matched case-insensitively -- the Profile's spelling is what is kept.
 *
 * Nothing in this deployment writes `confirmed: true` into a v3 generation
 * input -- `competitorsFromProfile` writes `false` and it is the only producer
 * -- so today this carries nothing. It is here because the confirm gesture is
 * the card's to add, and the day it lands is not the day to discover that
 * editing a Profile un-confirms every rival.
 */
function carryCompetitorState(
  next: GeoGenerationInputV3["competitors"],
  previous: GeoGenerationInputV3["competitors"],
): GeoGenerationInputV3["competitors"] {
  const before = new Map(previous.map((row) => [competitorKey(row), row]));
  return next.map((row) => {
    const prior = before.get(competitorKey(row));
    if (prior === undefined) return row;
    const aliases = prior.aliases === undefined ? {} : { aliases: [...prior.aliases] };
    if (!prior.confirmed) return { ...row, ...aliases };
    return {
      ...row,
      ...aliases,
      brandName: row.brandName === "" ? prior.brandName : row.brandName,
      confirmed: true,
    };
  });
}

export interface GeoKbV3Relock {
  readonly payload: GeoKbPayloadV3;
  readonly discarded: GeoKbV3RelockDiscard;
}

/**
 * The draft the creator would produce today over the Profile revision the owner
 * has confirmed since -- carrying across only the two things a Profile edit
 * says nothing about.
 *
 * It is deliberately `createGeoKbDraftPayloadV3` over
 * `lockGeoKbV3GenerationInput`, the same two functions the create path uses, so
 * "a re-locked draft" and "a created draft" cannot drift into being different
 * shapes. That reuse is also where the release comes from:
 * `createGeoKbDraftPayloadV3` writes all four `runRef` ids null, and all four
 * null is exactly the clause `marketing_geo_save_kb_draft` permits a changed
 * `generationInputHash` under. There is no separate "clear the ids" step to
 * forget.
 *
 * Two things are carried:
 *
 *   `evidenceContentHash`, because it names the evidence body the input is
 *   bound to and a Profile edit did not change the site's pages. Resetting it
 *   to `GEO_ABSENT_EVIDENCE_CONTENT_HASH` would erase a true statement and
 *   oblige the next run to re-collect, spending one of the four hourly crawl
 *   admissions to learn what was already known. In this deployment the stored
 *   value is always the sentinel -- nothing re-locks it yet -- so the choice has
 *   no effect today and is a decision about the collect step being built beside
 *   this one.
 *
 *   Competitor confirmations and aliases, per `carryCompetitorState`.
 *
 * Everything else goes, each for its own reason rather than by policy. The
 * knowledge body and the review over it, because they were made against a
 * generation input that no longer exists and the record naming what produced
 * them is being cleared in this same write. `roles`, because a locked role
 * carries `review: "accepted"` and the generation that proposed it --
 * `rolesGenerationId` -- is being released too; keeping them would state that
 * an owner accepted roles proposed against a Profile revision they have since
 * replaced.
 */
export function relockGeoKbV3Payload(
  stored: GeoKbPayloadV3,
  built: Extract<GeoKbV3IdentityBuild, { kind: "ok" }>,
): GeoKbV3Relock {
  const competitors = carryCompetitorState(built.competitors, stored.generationInput.competitors);
  const payload = createGeoKbDraftPayloadV3(
    lockGeoKbV3GenerationInput({ ...built, competitors }, stored.generationInput.evidenceContentHash),
  );
  const released = GEO_KB_V3_RELEASED_REFS.filter((field) => stored.runRef[field] !== null);
  return {
    payload,
    discarded: {
      knowledge: stored.knowledge !== null,
      decisions: stored.review.decisions.length,
      suppressions: stored.review.suppressions.length,
      roles: stored.generationInput.roles.length,
      released,
    },
  };
}

/* ------------------------------------------------------------------ */
/* The HTTP boundary                                                    */
/* ------------------------------------------------------------------ */

/** The Website Profile this knowledge base is about, or why there is none. */
export type GeoKbV3ProfileRead =
  | {
      readonly kind: "ok";
      readonly canonicalSiteKey: string;
      readonly reference: WebsiteProfileReferenceV1;
      readonly profile: MarketingWebsiteProfileV1;
    }
  /** No website is registered for this site. */
  | { readonly kind: "missing" }
  /** A website, but no confirmed Profile revision to reference. */
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "unavailable" };

export interface GeoKbV3DraftCreateDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  /**
   * `frozen` is read, not merely carried: a v3 draft standing over a v1/v2
   * published version is a state `kb-editor-loader.ts` answers with a permanent
   * 503 (`v3_predecessor_unsupported`) that no client gesture can clear. The
   * guard below needs the head row's own answer to "is there a published
   * version", and the summary is the only place this route can get it.
   */
  readonly readDetails: (input: { readonly userId: string; readonly kbId: string }) => Promise<
    GeoKbStoreResult<Pick<VersionedGeoKbDetails, "kbId" | "origin" | "canonicalSiteKey" | "draft" | "frozen">>
  >;
  readonly readProfile: (input: { readonly userId: string; readonly url: string }) => Promise<GeoKbV3ProfileRead>;
  readonly saveDraft: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly payload: GeoKbPayloadV3;
    readonly baseVersion: number;
  }) => Promise<GeoKbV3SaveOutcome>;
  /**
   * A run is bound to the draft version it was dispatched with. "unavailable"
   * fails open for the same reason the v2 draft route and the v3 review route
   * do: the run keeps executing at the provider whether or not this read can
   * answer, and the version check still refuses a stale write.
   */
  readonly generationRunning?: (userId: string, kbId: string) => Promise<boolean | "unavailable">;
  /**
   * This route reads a Profile and writes a draft. It spends no crawl
   * allowance, so the bucket is not the crawl gate's; it is sized for a person
   * starting a knowledge base and against a client that will not stop asking.
   */
  readonly consumeQuota?: (userId: string, kbId: string) => Promise<"allowed" | "limited" | "unavailable">;
}

const createRequestSchema = z
  .object({
    kbId: z.string().uuid(),
    /**
     * Zero, and it has to be said rather than assumed. A create that defaulted
     * the base version would be a create that silently overwrote whatever it
     * found, and the CAS below is the only thing standing between two open tabs.
     */
    baseVersion: z.literal(0),
  })
  .strict();

/**
 * The re-lock, named rather than inferred.
 *
 * A create and a re-lock cannot be told apart by `baseVersion` alone -- a
 * client that sent the version it happened to hold would turn one into the
 * other -- so the destructive one has to say its own name. `draftHash` is not
 * decoration either: it is the acknowledgement. A caller cannot produce the
 * digest of the exact draft it is about to discard without having been shown
 * that draft, which a hardcoded "yes, I understand" flag would not prove.
 */
const relockRequestSchema = z
  .object({
    kbId: z.string().uuid(),
    intent: z.literal("relock"),
    baseVersion: z.number().int().positive().refine(Number.isSafeInteger),
    draftHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const requestSchema = z.union([createRequestSchema, relockRequestSchema]);

const responseSchema = z
  .object({
    kbId: z.string().uuid(),
    draftVersion: z.number().int().positive().refine(Number.isSafeInteger),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    updatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
    generationInputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    blockers: z.array(z.enum(GEO_KB_V3_DRAFT_BLOCKERS)).max(GEO_KB_V3_DRAFT_BLOCKERS.length),
  })
  .strict();
export type GeoKbDraftCreateV3 = z.infer<typeof responseSchema>;

/**
 * The server validating its own response before sending it, as the v2 draft
 * route does. Deliberately not exported: a client that imported it would pull
 * this module's digest and store chain into the browser bundle. The card's
 * parser belongs beside the other v3 response parsers in `geo-kb-v3-wire.ts`,
 * which is client-safe; the type above is erased at compile time and is free to
 * cross that line.
 */
function validateResponse(value: unknown): GeoKbDraftCreateV3 | null {
  const parsed = responseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const uuidText = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const relockBase = {
  kbId: z.string().uuid(),
  draftVersion: z.number().int().positive().refine(Number.isSafeInteger),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  updatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  generationInputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  /** The Profile revision the draft names *after* this call, either way. */
  profileRef: z
    .object({ snapshotId: uuidText, snapshotRevision: z.string().regex(/^[1-9][0-9]{0,15}$/u) })
    .strict(),
};

/**
 * The re-lock's answer, as two shapes rather than one shape with holes.
 *
 * `relocked: false` means the draft still names the Profile revision the
 * database requires, so nothing was rebuilt and nothing was written. It carries
 * no `discarded`, because a zeroed `discarded` there would be indistinguishable
 * from a re-lock that happened to destroy nothing -- and those are different
 * facts about what just happened to the owner's paid work. It carries no
 * `blockers` for the same reason: nothing was built, so this route has not
 * looked at whether a rebuilt input could start a run, and reporting an empty
 * list would state that it had and found none.
 */
const relockResponseSchema = z.discriminatedUnion("relocked", [
  z.object({ ...relockBase, relocked: z.literal(false) }).strict(),
  z
    .object({
      ...relockBase,
      relocked: z.literal(true),
      blockers: z.array(z.enum(GEO_KB_V3_DRAFT_BLOCKERS)).max(GEO_KB_V3_DRAFT_BLOCKERS.length),
      discarded: z
        .object({
          knowledge: z.boolean(),
          decisions: z.number().int().nonnegative().refine(Number.isSafeInteger),
          suppressions: z.number().int().nonnegative().refine(Number.isSafeInteger),
          roles: z.number().int().nonnegative().refine(Number.isSafeInteger),
          released: z.array(z.enum(GEO_KB_V3_RELEASED_REFS)).max(GEO_KB_V3_RELEASED_REFS.length),
        })
        .strict(),
    })
    .strict(),
]);
export type GeoKbDraftRelockV3 = z.infer<typeof relockResponseSchema>;

/** Not exported, for the reason `validateResponse` is not: see above. */
function validateRelockResponse(value: unknown): GeoKbDraftRelockV3 | null {
  const parsed = relockResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function authenticated(
  authenticate: () => Promise<ServerAuthenticatedUser>,
): Promise<{ readonly userId: string } | Response> {
  const identity = await authenticate().catch(() => ({ status: "unavailable" as const }));
  if (identity.status === "authenticated") return { userId: identity.userId };
  return privateError(
    identity.status === "unauthenticated" ? "auth_required" : "auth_unavailable",
    identity.status === "unauthenticated" ? 401 : 503,
  );
}

/** The v3 draft a re-lock replaces, once it has been proved to be one. */
interface GeoKbV3RelockTarget {
  readonly payload: GeoKbPayloadV3;
  readonly draftVersion: number;
  readonly contentHash: string;
  readonly updatedAt: string;
}

export async function handleGeoKbV3DraftCreate(
  request: Request,
  dependencies: GeoKbV3DraftCreateDependencies,
): Promise<Response> {
  const identity = await authenticated(dependencies.authenticate);
  if (identity instanceof Response) return identity;
  // A create names a knowledge base and nothing else. A re-lock also names the
  // exact draft it is about to discard. Neither can author a byte of the locked
  // half: every value in it is derived on the server from the confirmed Profile.
  const json = await readAccountMutationJson(request, 1_024);
  if (!json.ok) return json.response;
  const parsed = requestSchema.safeParse(json.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  const asked = parsed.data;
  const scope = { userId: identity.userId, kbId: asked.kbId };

  if (dependencies.consumeQuota) {
    const quota = await dependencies.consumeQuota(scope.userId, scope.kbId).catch(() => "unavailable" as const);
    if (quota !== "allowed") {
      return privateError(quota === "limited" ? "rate_limited" : "store_unavailable", quota === "limited" ? 429 : 503);
    }
  }

  try {
    const loaded = await dependencies.readDetails(scope);
    if (loaded.kind !== "ok") {
      return privateError(loaded.kind === "missing" ? "not_found" : "store_unavailable", loaded.kind === "missing" ? 404 : 503);
    }
    const owned = loaded.value;
    if (owned.kbId !== scope.kbId) return privateError("store_unavailable", 503);

    /**
     * The fork, and it is exactly the opposite question in the two branches: a
     * create needs there to be no draft, a re-lock needs there to be a v3 one.
     * Neither ever overwrites what it did not expect to find.
     */
    const existing = owned.draft;
    let target: GeoKbV3RelockTarget | null = null;
    if ("intent" in asked) {
      /**
       * A re-lock replaces a draft; it never creates one. Three refusals, three
       * different next steps: there is nothing here to re-lock, what is here is
       * a v1/v2 draft no upgrade path exists for, or somebody wrote while this
       * caller was looking at an older version.
       */
      if (existing === null) return privateError("not_found", 404);
      const stored = existing.payload;
      if (!isGeoKbPayloadV3Value(stored)) {
        return privateJson({ error: { code: "legacy_draft" }, draftVersion: existing.draftVersion }, 409);
      }
      if (existing.draftVersion !== asked.baseVersion || existing.contentHash !== asked.draftHash) {
        return privateJson({ error: { code: "conflict" }, draftVersion: existing.draftVersion }, 409);
      }
      target = {
        payload: stored,
        draftVersion: existing.draftVersion,
        contentHash: existing.contentHash,
        updatedAt: existing.updatedAt,
      };
    } else if (existing !== null) {
      // Three distinct refusals again, because three different things have to
      // happen next. A v3 draft holds paid knowledge and the owner's decisions;
      // a v1/v2 draft holds accepted facts and reviewed roles that a v3
      // generation input has no field for. Overwriting either would destroy
      // work while reporting success, so neither is done here.
      //
      // Deliberately not reported as a version conflict. `baseVersion` is
      // literally 0 here, so every existing draft would "conflict", and the
      // client would be told to reload and retry a create that can never
      // succeed. The version is still returned, because whoever asked has a
      // stale idea of this knowledge base and has to reload either way. A
      // second create racing this one is caught by the store's own
      // compare-and-swap, which does answer `conflict`.
      return privateJson(
        {
          error: { code: isGeoKbPayloadV3Value(existing.payload) ? "draft_exists" : "legacy_draft" },
          draftVersion: existing.draftVersion,
        },
        409,
      );
    } else if (owned.frozen !== null) {
      /**
       * A published version, and no draft standing over it.
       *
       * This is the refusal that was only ever made in the browser.
       * `geo-knowledge-base-v2.tsx` offers the start gesture on
       * `draftHash === null && frozen === null`; this route checked only the
       * first half, so a create arriving with a published version and no draft
       * was granted. What it grants is not recoverable: if that version is
       * v1/v2, `kb-editor-loader.ts` refuses the pair with
       * `v3_predecessor_unsupported` -- a 503 for that knowledge base from then
       * on, with no gesture that undoes it, because the create path itself is
       * the only writer and it will answer `draft_exists` forever after.
       *
       * Refused for a published version of ANY schema, not just a legacy one,
       * and that is deliberate rather than lazy. The summary carries no schema
       * version (`VersionedGeoKbFrozenSummary` is a pointer, a revision, two
       * hashes and a count), so telling the two apart here would mean reading
       * the frozen payload -- a dependency this route does not have and that
       * nothing would supply. The asymmetry decides it: refusing a create over
       * a v3 published version costs an owner one confusing 409, and granting
       * one over a legacy version costs them the knowledge base. Nothing
       * produces the v3 half of that choice today anyway -- `publishGeoKbV3`
       * leaves the draft in place and no path deletes a draft row, so a
       * knowledge base with a published version and no draft is not a state
       * this deployment writes.
       *
       * Its own code, because the next step differs from both draft refusals:
       * there is nothing here to load and nothing to convert, and the answer
       * will not change by reloading or by asking again.
       *
       * No `draftVersion` on the body. The other two refusals carry the version
       * of the draft they found; there is no draft here, and a number in that
       * field would read as one.
       */
      return privateError("published_version_exists", 409);
    }

    // A dispatched generation is bound to the hash this call is about to move.
    // Releasing the ids under it would leave a request in flight that no draft
    // can ever admit, and the owner paying for it either way.
    if (dependencies.generationRunning) {
      const running = await dependencies.generationRunning(scope.userId, scope.kbId).catch(() => "unavailable" as const);
      if (running === true) return privateError("generation_running", 409);
    }

    const site = normalizeAccountWebsiteUrl(owned.origin);
    if (site === null || site.canonicalSiteKey !== owned.canonicalSiteKey) return privateError("store_unavailable", 503);
    const profile = await dependencies.readProfile({ userId: scope.userId, url: owned.origin });
    if (profile.kind !== "ok") {
      if (profile.kind === "missing") return privateError("website_not_found", 404);
      if (profile.kind === "unconfirmed") return privateError("profile_not_confirmed", 409);
      return privateError("store_unavailable", 503);
    }
    // The Profile has to be the one for this site. Anything else means the
    // website lookup and the knowledge base disagree about what they are about.
    if (profile.canonicalSiteKey !== owned.canonicalSiteKey) return privateError("store_unavailable", 503);

    /**
     * Nothing moved, so nothing is destroyed.
     *
     * This is checked before anything is built and, crucially, before anything
     * is written: a re-lock of a draft whose reference is still the confirmed
     * one is a no-op, not a new hash. Without this branch a caller that asked
     * routinely -- on load, on focus, on retry -- would discard a paid
     * knowledge body every single time, and each call would mint a version.
     *
     * It is `geoProfileRefNamesConfirmed` rather than a payload comparison for
     * a reason that matters: the rebuilt payload differs from the stored one
     * whenever the draft carries knowledge, so "is the rebuild identical" would
     * answer "no" for every assembled draft and re-lock it.
     */
    if (target !== null && geoProfileRefNamesConfirmed(target.payload.generationInput.profileRef, profile.reference)) {
      const unchanged = validateRelockResponse({
        kbId: scope.kbId,
        relocked: false,
        draftVersion: target.draftVersion,
        contentHash: target.contentHash,
        updatedAt: target.updatedAt,
        generationInputHash: target.payload.runRef.generationInputHash,
        profileRef: {
          snapshotId: target.payload.generationInput.profileRef.snapshotId,
          snapshotRevision: target.payload.generationInput.profileRef.snapshotRevision,
        },
      });
      return unchanged === null ? privateError("store_unavailable", 503) : privateJson({ data: unchanged });
    }

    // An unusable Profile is refused with its fields named, and nothing is
    // written: there is no half-made knowledge base to clean up afterwards.
    const built = buildGeoKbV3Identity({
      targetUrl: site.submittedUrl,
      reference: profile.reference,
      profile: profile.profile,
    });
    if (built.kind !== "ok") return privateJson({ error: { code: "profile_unusable" }, fields: built.fields }, 422);

    let payload: GeoKbPayloadV3;
    let discarded: GeoKbV3RelockDiscard | null = null;
    try {
      if (target === null) {
        // No evidence has been observed for this generation input, and the draft
        // says exactly that rather than naming a collection nobody can retrieve.
        payload = createGeoKbDraftPayloadV3(lockGeoKbV3GenerationInput(built, GEO_ABSENT_EVIDENCE_CONTENT_HASH));
      } else {
        const relocked = relockGeoKbV3Payload(target.payload, built);
        payload = relocked.payload;
        discarded = relocked.discarded;
      }
    } catch {
      return privateError("draft_invalid", 422);
    }

    // Equal to `asked.baseVersion` on both paths -- the create's literal zero,
    // and the version the compare-and-swap above already proved -- and written
    // from the draft on the re-lock path so that the value the store swaps on
    // is the one this call actually read.
    const baseVersion = target === null ? asked.baseVersion : target.draftVersion;
    const saved = await dependencies.saveDraft({ ...scope, payload, baseVersion });
    // Unreachable on the re-lock path, and left in place rather than asserted
    // away: the guard fires only when the incoming payload keeps a `runRef` id,
    // and `relockGeoKbV3Payload` returns all four null. If it ever fires here
    // the release stopped satisfying the database, and the one thing that must
    // not happen then is reporting a re-lock that did not occur.
    if (saved.kind === "input_locked") return privateError("input_changed", 409);
    if (saved.kind === "missing") return privateError("not_found", 404);
    if (saved.kind === "conflict") {
      // Null, not a number. The store already answers `null` when the database
      // did not hand back a usable version, and turning that into -1 would put
      // a value in the version field that reads as a version and is not one.
      return privateJson({ error: { code: "conflict" }, draftVersion: saved.currentDraftVersion }, 409);
    }
    if (saved.kind === "invalid") return privateError("draft_invalid", 422);
    // The database canonicalises the payload itself and returns what it hashed.
    // A digest that is not ours is not our draft.
    if (saved.kind !== "ok" || saved.value.contentHash !== geoV2Digest(payload)) {
      return privateError("store_unavailable", 503);
    }

    if (discarded !== null) {
      const relocked = validateRelockResponse({
        kbId: scope.kbId,
        relocked: true,
        draftVersion: saved.value.draftVersion,
        contentHash: saved.value.contentHash,
        updatedAt: saved.value.updatedAt,
        generationInputHash: payload.runRef.generationInputHash,
        profileRef: {
          snapshotId: payload.generationInput.profileRef.snapshotId,
          snapshotRevision: payload.generationInput.profileRef.snapshotRevision,
        },
        blockers: [...built.blockers],
        discarded: {
          knowledge: discarded.knowledge,
          decisions: discarded.decisions,
          suppressions: discarded.suppressions,
          roles: discarded.roles,
          released: [...discarded.released],
        },
      });
      return relocked === null ? privateError("store_unavailable", 503) : privateJson({ data: relocked });
    }

    const body = validateResponse({
      kbId: scope.kbId,
      draftVersion: saved.value.draftVersion,
      contentHash: saved.value.contentHash,
      updatedAt: saved.value.updatedAt,
      generationInputHash: payload.runRef.generationInputHash,
      blockers: [...built.blockers],
    });
    return body === null ? privateError("store_unavailable", 503) : privateJson({ data: body });
  } catch {
    return privateError("store_unavailable", 503);
  }
}
