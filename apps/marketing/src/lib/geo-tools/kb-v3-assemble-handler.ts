// @input -- an authenticated same-origin request to assemble one v3 draft's knowledge
// @output -- the draft version that now carries a knowledge body, and what the merge did
// @pos -- free route: no model call, no crawl budget; it reads work that was already paid for

/**
 * The bridge that was missing.
 *
 * `assembleGeoKnowledgeBodyV3` and `mergeGeoDraftV3` had no runtime call site at
 * all -- only their own definitions and their tests -- so nothing in the product
 * ever wrote `payload.knowledge`. Every stored v3 draft carried `knowledge:
 * null`, and `kb-v3-publish-handler.ts` therefore refused every publish with
 * `nothing_to_publish` (422), unconditionally, because the only other half a
 * version could contain is a question set and `runRef.questionsGenerationId` is
 * null on every draft this deployment can produce.
 *
 * This route closes that gap and nothing else:
 *
 *   1. read the newest `knowledge_pack` generation this knowledge base owns,
 *   2. check it is bound to the same locked generation input as the draft,
 *   3. assemble its evidence + narrative into a v3 knowledge body,
 *   4. merge that body over the draft it replaces, so decisions survive,
 *   5. save it back with `runRef.knowledgeGenerationId` naming the record.
 *
 * It has a second, narrative-less mode, which is section 4.2's other half:
 * "the deterministic modules are visible the moment collection finishes, they
 * do not wait for the model". When no knowledge generation exists yet, or when
 * the one that exists failed, and the draft carries no body of its own, the
 * evidence bundle is rebuilt from the website evidence observation ledger --
 * the rows the run's own fetch operations wrote -- and assembled with
 * `narrative: null`. The model-dependent modules then say `unavailable` with
 * `generation_unavailable`, and what was collected is on the card instead of an
 * empty page. Before this, a run whose model step failed left `payload.knowledge`
 * null and the owner saw a card with no sections at all, after the run had
 * already spent crawl allowance on their site.
 *
 * Four properties it exists to hold.
 *
 * **It buys nothing.** Every input already exists and was already charged for.
 * A generation that failed is reported as failed; it is never re-dispatched, and
 * `outcome_unknown` in particular is never auto-retried -- a request whose
 * outcome we never saw is not evidence that nothing was billed. The observed
 * mode adds no exception: it is handed a reader that opens no socket, so no
 * crawl-gate admission and no request can come out of it.
 *
 * **It fabricates nothing.** A failed model step leaves no evidence bundle
 * behind (a failed generation record's result is null), so nothing model-derived
 * is assembled from it; the observed mode builds only from rows that record a
 * real fetch, and withholds every module those rows cannot support. The
 * machine-readable module is the sharpest case: the run's own-page operation
 * files a row per machine resource and stores what the page carries, and this
 * mode reports that module only when EVERY signal in it rests on one of those
 * rows -- otherwise it is withheld whole, because the evidence contract can only
 * say present/absent/unreachable and none of the three means "we did not look"
 * (see `GeoObservedMachine`). When a narrative *is* present, the assembler's
 * own partial/unavailable module states carry any per-module failure; this route
 * never invents a module.
 *
 * **It never costs the owner a decision.** The observed body is smaller than an
 * assembled one, and `mergeGeoDraftV3` drops a decision whose item is gone, so
 * the observed mode is refused outright on a draft that already has a body.
 *
 * **It is content-idempotent.** `generatedAt` is taken from the generation
 * record -- or, in the observed mode, from the newest observation the bundle
 * rests on -- never from a clock, so re-assembling the same inputs produces the
 * same body, the same payload digest and therefore no new draft version at all.
 */
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { z } from "zod";

import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoKbStoreResult } from "./kb-store.ts";
import { isGeoKbPayloadV3Value, type VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import {
  assembleGeoKnowledgeBodyV3,
  type AssembleGeoKnowledgeV3Input,
  type GeoAssemblyDrop,
} from "./kb-knowledge-assemble.ts";
import { mergeGeoDraftV3, type GeoMergeOutcomeKind } from "./kb-knowledge-merge.ts";
import {
  GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA,
  parseGeoKnowledgeGenerationResultV2,
  type GeoKnowledgeGenerationResultV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import { geoV3Items, type GeoKbPayloadV3, type GeoKnowledgeBodyV3 } from "./kb-v3-contract.ts";
import type { GeoKbGenerationRead } from "./kb-generation-store.ts";
import type { GeoKbV3SaveOutcome } from "./kb-v3-store.ts";
import { geoCoverageModule, geoEvidenceModule } from "./kb-knowledge-assemble-observed.ts";
import { buildGeoSourceCatalogue } from "./kb-knowledge-assemble-sources.ts";
import {
  buildGeoKnowledgeEvidenceV1,
  collectGeoKnowledgeEvidenceV1,
  geoSitemapListsPage,
  type GeoKnowledgeEvidenceReadResource,
  type GeoKnowledgeEvidenceSource,
  type GeoKnowledgeEvidenceV1,
} from "./kb-knowledge-evidence.ts";
import {
  creditGeoKnowledgeObservation,
  creditGeoKnowledgeObservedPage,
  creditGeoKnowledgeObservedRobots,
  creditGeoKnowledgeObservedStructure,
  type GeoKnowledgeRebuiltPage,
  type GeoKnowledgeObservedStructure,
  type GeoKnowledgeUnavailableReason,
} from "./kb-generation-preparer.ts";
import { planGeoRunCollection } from "./kb-run-collect.ts";
import type {
  GeoEvidenceObservation,
  GeoEvidenceObservationSelector,
  GeoEvidenceStoreResult,
} from "./kb-evidence-observations.ts";

/** The request names a draft and the exact bytes the caller believes it holds. */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const geoV3AssembleRequestSchema = z
  .object({
    kbId: uuid,
    /** Compare-and-swap: the draft version this assembly was asked for. */
    baseVersion: z.number().int().positive().refine(Number.isSafeInteger),
    /** The exact draft, so a run that wrote underneath the caller fails here. */
    draftHash: hash,
  })
  .strict();
export type GeoV3AssembleRequest = z.infer<typeof geoV3AssembleRequestSchema>;

export const GEO_KB_V3_ASSEMBLE_REQUEST_BYTES = 4_096;
/** Enough to say what an update lost without letting one field carry a report. */
export const GEO_KB_V3_ASSEMBLE_MAX_DROPPED = 64;

export interface GeoKbV3AssembleDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly readDetails: (input: { readonly userId: string; readonly kbId: string }) => Promise<
    GeoKbStoreResult<Pick<VersionedGeoKbDetails, "kbId" | "draft">>
  >;
  readonly saveDraft: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly payload: GeoKbPayloadV3;
    readonly baseVersion: number;
  }) => Promise<GeoKbV3SaveOutcome>;
  /**
   * The newest knowledge generation this knowledge base owns.
   *
   * Newest, not "the newest that succeeded": a run that was started after this
   * draft's knowledge was assembled and then failed is a fact about the current
   * state, and quietly assembling an older success instead would report the
   * failed run as if it had produced this body.
   */
  readonly readLatestGeneration: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly kind: "knowledge_pack";
  }) => Promise<GeoKbGenerationRead>;
  readonly generationRunning?: (userId: string, kbId: string) => Promise<boolean | "unavailable">;
  readonly consumeQuota?: (userId: string, kbId: string) => Promise<"allowed" | "limited" | "unavailable">;
  /**
   * The website evidence observation library, which is what lets this route
   * assemble the deterministic half without a narrative.
   *
   * Optional, and its absence is a real state rather than a default: a caller
   * that does not pass it gets exactly the behaviour this route had before --
   * no generation, no body. It is not a fallback that invents one.
   */
  readonly observations?: {
    readonly resolveWebsiteId: (input: {
      readonly userId: string;
      readonly targetUrl: string;
    }) => Promise<{ readonly kind: "ok"; readonly websiteId: string } | { readonly kind: "missing" | "unavailable" }>;
    readonly readLatestObservation: (
      input: GeoEvidenceObservationSelector,
    ) => Promise<GeoEvidenceStoreResult<GeoEvidenceObservation | null>>;
    /**
     * Reads the clock for ONE decision: whether a stored observation is still
     * inside its TTL and may therefore stand in for a fetch. That is the same
     * criterion the collection itself used, and it is the only thing here that
     * is time-dependent -- no instant it returns reaches the assembled body,
     * whose `collectedAt` and `generatedAt` both come from the newest
     * observation's own recorded time.
     */
    readonly now: () => Date;
  };
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

/**
 * The knowledge generation this draft may assemble, or the refusal that says
 * why there is none. Every branch is a distinct remedy: run the step, wait for
 * it, run it again, or re-lock the inputs.
 *
 * `observed` is not a refusal: it says there is no narrative and there is no
 * prospect of one for this draft as it stands, which is precisely the state
 * section 4.2 wants the deterministic half to be visible in. It carries the
 * refusal this route falls back to when that half cannot be built either, so
 * one branch decides both answers rather than two that can disagree.
 */
type KnowledgeOutcome =
  | { readonly kind: "narrative"; readonly generationId: string; readonly result: GeoKnowledgeGenerationResultV2 }
  | {
      readonly kind: "observed";
      readonly refusal: { readonly code: "generation_missing" | "generation_failed"; readonly status: 409 | 422 };
    }
  | Response;

/**
 * Whether this draft may be given a body assembled from observations alone.
 *
 * Only a draft that has none. `mergeGeoDraftV3` files a decision whose item is
 * no longer in the body as `dropped` and does not carry the record forward, so
 * replacing an assembled body with the strictly smaller observed-only one would
 * delete every acceptance the owner had made -- and the narrative assembly that
 * follows could not bring them back, because by then the draft it merges over
 * is the one whose review was already emptied. A knowledge base that already
 * has a body keeps it, and keeps this route's original refusals.
 */
function mayAssembleObserved(stored: GeoKbPayloadV3): boolean {
  return stored.knowledge === null;
}

async function resolveKnowledgeGeneration(
  dependencies: GeoKbV3AssembleDependencies,
  scope: { readonly userId: string; readonly kbId: string },
  stored: GeoKbPayloadV3,
): Promise<KnowledgeOutcome> {
  const runRef = stored.runRef;
  const read = await dependencies
    .readLatestGeneration({ ...scope, kind: "knowledge_pack" })
    .catch(() => ({ kind: "unavailable" as const }));
  if (read.kind !== "ok") return privateError("store_unavailable", 503);
  const generation = read.generation;
  // Nobody has run the knowledge step for this knowledge base. There is no
  // narrative -- but the collection this run already paid for is on the
  // observation ledger, and the modules that need no model can be shown from it.
  if (generation === null) {
    return mayAssembleObserved(stored)
      ? { kind: "observed", refusal: { code: "generation_missing", status: 409 } }
      : privateError("generation_missing", 409);
  }
  if (generation.kind !== "knowledge_pack") return privateError("store_unavailable", 503);
  if (generation.state === "claimed" || generation.state === "dispatched") {
    return privateError("generation_running", 409);
  }
  // A failed step produced no evidence bundle and no narrative (a failed
  // record's result is null), so the model-dependent modules stay unavailable.
  // The observed half does not depend on that record at all: the run's fetches
  // are on the observation ledger, so it survives the failure rather than
  // dying with it.
  if (generation.state === "failed") {
    return mayAssembleObserved(stored)
      ? { kind: "observed", refusal: { code: "generation_failed", status: 422 } }
      : privateError("generation_failed", 422);
  }
  // Never auto-retried, and never quietly treated as a failure that produced a
  // body: we do not know whether the provider was billed or what it returned.
  // In particular it is NOT assembled as "the observed half", because that
  // would file a body for a request whose answer may be sitting unread.
  if (generation.state === "uncertain") return privateError("outcome_unknown", 422);

  let result: GeoKnowledgeGenerationResultV2;
  try {
    const value = generation.result as { readonly schemaVersion?: unknown };
    // A v1 knowledge result is bound to a `profileCopy`, which a v3 draft does
    // not have; there is no field in it that names this draft's locked input.
    if (value?.schemaVersion !== GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA) {
      return privateError("generation_unusable", 422);
    }
    result = parseGeoKnowledgeGenerationResultV2(generation.result);
  } catch {
    return privateError("store_unavailable", 503);
  }
  if (result.kbId !== scope.kbId || result.generationId !== generation.generationId) {
    return privateError("store_unavailable", 503);
  }
  // The binding that decides whether this draft may reuse this paid run. It is
  // the same comparison the publish path makes, and the same one the database
  // makes when the generation is claimed.
  if (result.manifest.generationInputHash !== runRef.generationInputHash) {
    return privateError("input_changed", 409);
  }
  return { kind: "narrative", generationId: generation.generationId, result };
}

/**
 * The reader the observed-only assembly is handed.
 *
 * This is the whole "no crawl" guarantee, and it is structural rather than a
 * promise: `collectGeoKnowledgeEvidenceV1` reaches the network only through
 * `readResource`, so a reader that opens no socket cannot spend a crawl-gate
 * admission, cannot send a byte to the owner's site and cannot be slowed by
 * one. Everything the bundle ends up containing therefore comes from
 * `reusedSources` -- rows a fetch operation of this run already paid for.
 *
 * `not_collected` is the reason because it is what happened: this pass did not
 * look. It is not "the site refused" and not "there is nothing there".
 *
 * The observed assembly wraps it: an address whose failure this update's own
 * ledger recorded is answered from that row instead, so a machine file the run
 * read and did not get keeps its real reason. The wrapper reaches the network
 * no more than this does -- it is a map lookup -- and every other address still
 * falls through to here.
 */
const GEO_ASSEMBLE_NEVER_FETCH: GeoKnowledgeEvidenceReadResource = (input) =>
  Promise.resolve({ kind: "unavailable" as const, url: input.url, reason: "not_collected" as const });

/**
 * The three machine-readable resources the run's own-page fetch operation reads
 * beside the page itself, addressed exactly as that operation addresses them:
 * origin-rooted against the plan's own target, so `www.` and the scheme are
 * spelled the way the draft spells them.
 *
 * The spelling is load-bearing rather than cosmetic: the ledger is keyed by
 * `(kind, url)`, so an address derived a second way finds no row, and the only
 * symptom would be that every owner is told their machine-readable signals were
 * never collected. Both sides therefore start from `planGeoRunCollection`
 * rather than from `identity.targetUrl`.
 *
 * `kb-knowledge-evidence.ts` writes its own machine reads target-RELATIVE
 * (`new URL("robots.txt", target)`). The two agree for every target that
 * collector can produce a valid bundle for: relative resolution drops the
 * base's last segment, so only a target whose path ends in a slash below the
 * root diverges -- and for that target the collector mints `/x/robots.txt`,
 * which `assertEvidenceIntegrity` refuses outright, so no bundle comes out of
 * it either way.
 */
const GEO_MACHINE_RESOURCES = [
  { path: "/robots.txt", kind: "robots" },
  { path: "/sitemap.xml", kind: "sitemap" },
  { path: "/llms.txt", kind: "llms" },
] as const;

/**
 * Whether the machine module may be shown, and why not when it may not.
 *
 * The evidence contract can only say `present | absent | unreachable` about a
 * machine signal (`MACHINE_STATUSES` in `kb-knowledge-evidence.ts`); there is no
 * "not checked" and this route may not add one to a published contract. So the
 * module is published only when EVERY signal in it rests on a row this run
 * actually observed, and withheld whole otherwise -- half a module reported as
 * whole is the failure this guards against.
 *
 * Two withholding reasons, because two different things are true of the owner's
 * site and one sentence for both would be false for one of them:
 *
 *  - `not_collected` -- "This information has not been collected yet." No row.
 *    The run's 6 s machine budget did not reach it, the ledger write failed, the
 *    operation reused a still-fresh own-page observation and so re-read nothing,
 *    or the knowledge base was collected before the run started reading these
 *    resources at all. Every knowledge base in that last state stays there until
 *    its own-page row expires.
 *  - `insufficient_evidence` -- "The available evidence is not sufficient to
 *    form this section yet." The rows are there and what they carry cannot be
 *    put into the evidence contract without misstating it: a sitemap whose
 *    stored sample is a fraction of its stored total (the contract ties the
 *    reported URL count to the list of locations it carries, and the ledger
 *    keeps at most eight of them), or hreflang locales stored without the URLs
 *    the contract requires beside them.
 */
type GeoObservedMachine =
  | { readonly kind: "publish" }
  | { readonly kind: "withheld"; readonly reason: "not_collected" | "insufficient_evidence" };

const GEO_MACHINE_WITHHELD = (reason: "not_collected" | "insufficient_evidence") =>
  ({ status: "unavailable", reason }) as const;

/**
 * The assembled body with the modules its inputs could not support removed, and
 * the coverage table rebuilt so it agrees.
 *
 * Coverage is rebuilt through `geoCoverageModule` -- the same function the
 * assembler calls -- rather than by editing the one row, and its per-module
 * source references are read back off the assembled table rather than derived
 * again here: `moduleRefs` is private to the assembler, and a second walker
 * would be a second answer to "what does this module cite".
 *
 * The evidence module is rebuilt too, and for the same class of reason. Its
 * `collected` list names `changelog` as soon as the bundle carries any page,
 * because in a collected bundle a page means a parsed body and a parsed body
 * means its links were read. The page THIS mode carries is reconstructed from a
 * ledger row, and the ledger stores no links, so the group was never looked for
 * here -- and "Collected, nothing found" about a group nothing could have found
 * is the same lie as an absent machine signal. It is rebuilt by the assembler's
 * own `geoEvidenceModule`, handed the bundle as it stands with respect to
 * parsed pages -- none -- rather than by editing the list it produced: the
 * limitation sentence beside it has to name the groups it left out, and a
 * second writer of that sentence would disagree with the first.
 */
function geoObservedOnlyBody(
  assembled: GeoKnowledgeBodyV3,
  evidence: GeoKnowledgeEvidenceV1,
  decision: GeoObservedMachine,
): GeoKnowledgeBodyV3 {
  const rows = assembled.coverage.status === "unavailable" ? [] : assembled.coverage.value;
  const cited = new Map(rows.map((row) => [row.id, row.sourceRefs] as const));
  const refs = (key: string): readonly string[] => [...(cited.get(`coverage:${key}`) ?? [])];
  const machine = decision.kind === "publish" ? assembled.machine : GEO_MACHINE_WITHHELD(decision.reason);
  const unparsed = { ...evidence, pages: [] };
  const evidenceModule = geoEvidenceModule({
    evidence: unparsed,
    offsite: null,
    index: buildGeoSourceCatalogue(unparsed, null),
  }).module;
  const modules = {
    entity: assembled.entity,
    facts: assembled.facts,
    qa: assembled.qa,
    comparisons: assembled.comparisons,
    scope: assembled.scope,
    evidence: evidenceModule,
    machine,
  };
  return {
    ...assembled,
    evidence: evidenceModule,
    machine,
    coverage: geoCoverageModule(modules, {
      entity: refs("entity"),
      facts: refs("facts"),
      qa: refs("qa"),
      comparisons: refs("comparisons"),
      scope: refs("scope"),
      // The evidence module's items are the same either way -- they are built
      // from source rows, and only the `collected` list reads `pages` -- so the
      // references the assembled table carries are this module's own.
      evidence: refs("evidence"),
      // A withheld module cites nothing: the references the assembled module
      // carried would point at rows this body does not report.
      machine: decision.kind === "publish" ? refs("machine") : [],
    }),
  };
}

/**
 * What one observed-only assembly produced, beside the assembler input itself.
 */
interface GeoObservedAssembly {
  readonly input: AssembleGeoKnowledgeV3Input;
  /**
   * The same bundle `input.evidence` carries, typed. The assembler's input
   * takes it as `unknown` and parses it itself, and re-parsing it here to get
   * the type back would be a second parse of one value.
   */
  readonly evidence: GeoKnowledgeEvidenceV1;
  readonly observedAt: string;
  readonly machine: GeoObservedMachine;
}

/**
 * The assembler input for a draft that has a collection but no narrative.
 *
 * Null when there is nothing to build from, and every `null` here is a real
 * "we cannot say", never a quieter version of an empty body: no observation
 * library wired, a draft whose target no run may read, a website the library
 * does not know, or no observation of the site's own page that is still inside
 * its TTL. In each of those the caller falls back to the refusal it had before.
 *
 * The bundle is rebuilt with `collectGeoKnowledgeEvidenceV1` rather than by
 * hand so the reused rows pass exactly the admission the paid collection
 * applies to them, and so the contract's own integrity checks run over the
 * result. It costs nothing: see `GEO_ASSEMBLE_NEVER_FETCH`.
 *
 * It is then rebuilt once more, through the contract's own builder, to put the
 * page back: `collectGeoKnowledgeEvidenceV1` takes reused SOURCES and parses no
 * body, so a bundle assembled from ledger rows alone carries no page at all --
 * and `machine.jsonLd`, `machine.hreflang` and the site's own FAQ questions are
 * all derived from pages. The builder re-derives every summary from the pages
 * and sources it is handed and throws when they disagree, so it is the arbiter
 * of that second pass rather than this code.
 */
/**
 * The robots.txt this run proved it read in full, for either assembly branch.
 *
 * The narrative branch has an evidence bundle the paid step built and no reason
 * to touch the ledger -- except this one: the bundle carries the robots SOURCE
 * (a receipt, and an eight-line sample), never the file. Without the row's own
 * `robotsRules` the assembler must treat that sample as truncated, and every
 * owner is told their AI crawler permissions were not determined.
 *
 * Addressed exactly as the collection plan addresses it, for the reason spelled
 * out in `GEO_MACHINE_RESOURCES`: the ledger is keyed by `(kind, url)` and an
 * address derived a second way finds no row.
 */
async function readObservedRobots(
  dependencies: GeoKbV3AssembleDependencies,
  scope: { readonly userId: string },
  generationInput: GeoKbPayloadV3["generationInput"],
): Promise<{ readonly text: string } | null> {
  const library = dependencies.observations;
  if (library === undefined) return null;
  const own = planGeoRunCollection({
    targetUrl: generationInput.identity.targetUrl,
    competitors: generationInput.competitors
      .filter((competitor) => competitor.confirmed)
      .map((competitor) => ({ domain: competitor.domain, confirmed: true })),
  }).find((target) => target.kind === "own_page");
  if (own === undefined) return null;
  const website = await library
    .resolveWebsiteId({ userId: scope.userId, targetUrl: own.url })
    .catch(() => ({ kind: "unavailable" as const }));
  if (website.kind !== "ok") return null;
  const read = await library
    .readLatestObservation({ userId: scope.userId, websiteId: website.websiteId, kind: "robots", url: new URL("/robots.txt", own.url).toString() })
    .catch(() => ({ kind: "unavailable" as const }));
  return read.kind === "ok" ? creditGeoKnowledgeObservedRobots(read.value) : null;
}

async function geoObservedAssemblyInput(
  dependencies: GeoKbV3AssembleDependencies,
  scope: { readonly userId: string; readonly kbId: string },
  generationInput: GeoKbPayloadV3["generationInput"],
): Promise<GeoObservedAssembly | null> {
  const library = dependencies.observations;
  if (library === undefined) return null;
  const identity = generationInput.identity;
  /**
   * The run's own collection plan, re-derived from the same two inputs it is
   * seeded from. Every address below comes OUT of it rather than being built
   * beside it and checked against it: a target the plan leaves out is one no
   * ledger row covers, and crediting it here would claim an observation this
   * update never had the right to make.
   *
   * Taking the site's own address from the plan also removes a way for this
   * whole path to switch itself off in silence. The plan addresses the site as
   * `normalizeAccountWebsiteUrl(...).submittedUrl`; a second spelling derived
   * here (`new URL(identity.targetUrl).toString()`) agrees with it today and
   * would stop agreeing the moment either normalisation changed, and the only
   * symptom would be that no owner ever sees a deterministic half again.
   */
  const plan = planGeoRunCollection({
    targetUrl: identity.targetUrl,
    competitors: generationInput.competitors
      .filter((competitor) => competitor.confirmed)
      .map((competitor) => ({ domain: competitor.domain, confirmed: true })),
  });
  const own = plan.find((target) => target.kind === "own_page");
  if (own === undefined) return null;
  const targetUrl = own.url;
  const plannedCompetitors = new Set(
    plan.flatMap((target) => target.kind === "competitor_page" ? [target.url] : []),
  );
  /**
   * The competitors this update was allowed to fetch, which is not the same as
   * the competitors the draft declares. `planGeoRunCollection` caps them at
   * `GEO_RUN_COLLECT_COMPETITOR_LIMIT` and drops any whose host is not publicly
   * readable, and a competitor past that cap has no ledger row this run paid
   * for. The filter is also what keeps the list inside the evidence contract's
   * own maximum of five: handing `collectGeoKnowledgeEvidenceV1` six declared
   * competitors makes it throw, and the catch below turns that into "no
   * deterministic half at all" -- the feature lost, with nothing said.
   */
  const confirmed = generationInput.competitors
    .filter((competitor) => competitor.confirmed)
    .map((competitor) => ({ key: competitor.domain, name: competitor.brandName, confirmed: true as const }))
    .filter((competitor) => plannedCompetitors.has(`https://${competitor.key}/`));
  const website = await library
    .resolveWebsiteId({ userId: scope.userId, targetUrl })
    .catch(() => ({ kind: "unavailable" as const }));
  if (website.kind !== "ok") return null;
  const now = library.now();
  // The addresses the collector will ask for, written the way IT writes them.
  const requests = [
    { kind: "own_page" as const, url: targetUrl, competitor: null },
    ...confirmed.map((competitor) => ({
      kind: "competitor_page" as const,
      url: `https://${competitor.key}/`,
      competitor,
    })),
  ];
  const reusedSources: GeoKnowledgeEvidenceSource[] = [];
  let observedAt: string | null = null;
  /** What the own-page row recorded ABOUT the page, as this contract can carry it. */
  let structure: GeoKnowledgeObservedStructure | null = null;
  const noteObserved = (at: string | null) => {
    if (at !== null && (observedAt === null || observedAt < at)) observedAt = at;
  };
  for (const request of requests) {
    const read = await library
      .readLatestObservation({ userId: scope.userId, websiteId: website.websiteId, kind: request.kind, url: request.url })
      .catch(() => ({ kind: "unavailable" as const }));
    if (read.kind !== "ok") continue;
    const credit = creditGeoKnowledgeObservation({ ...request, observation: read.value, now });
    if (credit.kind !== "reuse") continue;
    if (request.kind === "own_page") structure = creditGeoKnowledgeObservedStructure(read.value);
    reusedSources.push(credit.source);
    noteObserved(credit.source.observedAt);
  }
  /**
   * The machine-readable resources, read out of the ledger the same way.
   *
   * A row that says the file could not be READ is not a source -- the collector
   * drops an unavailable reused source on purpose, so that a failed fetch is
   * retried rather than remembered -- so it is handed to the reader below
   * instead, which answers with the reason the run recorded. That is what keeps
   * `not_found` and `not_published` (and only those two) able to reach the
   * owner as "absent": every other reason renders as unreachable, and a
   * resource with no row at all renders as not collected.
   */
  const machineUnavailable = new Map<string, GeoKnowledgeUnavailableReason>();
  /** The sitemap's own count of itself, as the run recorded it: a string, and a total. */
  let sitemapUrlCount: string | null = null;
  /** The robots.txt the run proved it read in full, or null for a sampled one. */
  let robots: { readonly text: string } | null = null;
  let machineObserved = true;
  for (const resource of GEO_MACHINE_RESOURCES) {
    const url = new URL(resource.path, targetUrl).toString();
    const read = await library
      .readLatestObservation({ userId: scope.userId, websiteId: website.websiteId, kind: resource.kind, url })
      .catch(() => ({ kind: "unavailable" as const }));
    const credit = read.kind === "ok"
      ? creditGeoKnowledgeObservation({ kind: resource.kind, url, competitor: null, observation: read.value, now })
      : ({ kind: "fetch" } as const);
    if (credit.kind === "observed_unavailable") {
      machineUnavailable.set(url, credit.reason);
      continue;
    }
    if (credit.kind !== "reuse") {
      // No row, a row too old to stand in for a fetch, or a row this contract
      // cannot read back. In all three this update did not look.
      machineObserved = false;
      continue;
    }
    if (resource.kind === "sitemap" && read.kind === "ok" && read.value?.status.kind === "ok") {
      const total = read.value.status.structured.sitemapUrlCount;
      sitemapUrlCount = typeof total === "string" ? total : null;
    }
    // The whole robots.txt, when the run proved it read one. Without it the
    // assembler answers every AI-crawler question from an eight-line sample it
    // must treat as truncated, which is to say it answers none of them.
    if (resource.kind === "robots" && read.kind === "ok") robots = creditGeoKnowledgeObservedRobots(read.value);
    reusedSources.push(credit.source);
    noteObserved(credit.source.observedAt);
  }
  // No live observation of the site's own page is no evidence about the subject
  // of the update, which the collector refuses outright anyway.
  if (observedAt === null || structure === null || !reusedSources.some((source) => source.kind === "own_page")) return null;
  /**
   * The newest observation this bundle rests on -- including the machine rows,
   * which are observations too. It is not only what the body reports as its
   * collection time: the evidence contract refuses a source observed after the
   * collection it belongs to, so a machine row newer than the page would make
   * the whole bundle throw if it were left out of this maximum.
   */
  const collectedAt: string = observedAt;
  const ownStructure: GeoKnowledgeObservedStructure = structure;
  /** The stored count as a number, or null when the row recorded none. */
  const sitemapTotal = sitemapUrlCount === null || !/^\d{1,7}$/u.test(sitemapUrlCount)
    ? null : Number.parseInt(sitemapUrlCount, 10);
  /**
   * Still no socket, and still no crawl-gate admission: the map holds reasons
   * this update read out of its own ledger, and every address not in it falls
   * through to the reader that refuses everything.
   */
  const readResource: GeoKnowledgeEvidenceReadResource = (request) => {
    const reason = machineUnavailable.get(request.url);
    return reason === undefined
      ? GEO_ASSEMBLE_NEVER_FETCH(request)
      : Promise.resolve({ kind: "unavailable" as const, url: request.url, reason });
  };
  let evidence: Awaited<ReturnType<typeof collectGeoKnowledgeEvidenceV1>>;
  /** Declared out here because the machine gate below reads it. */
  let rebuilt: GeoKnowledgeRebuiltPage = { kind: "withheld", reason: "not_stored" };
  try {
    evidence = await collectGeoKnowledgeEvidenceV1(
      { targetUrl, competitors: confirmed },
      {
        readResource,
        reusedSources,
        /**
         * The newest observation this bundle rests on, and not a clock. It
         * becomes `collectedAt`, and `generatedAt` beside it, so assembling the
         * same rows twice produces the same bytes and therefore no second draft
         * version. `nowMs` is pinned for the same reason: it drives the
         * collector's own deadline, and a deadline read from the wall clock
         * would let two assemblies of one collection disagree about whether a
         * resource was "not collected" or "timed out".
         */
        now: () => new Date(collectedAt),
        nowMs: () => 0,
        /**
         * The sitemap's own count, from the row that read it.
         *
         * Without it the bundle reports the eight sampled locations as the
         * document's size, the `countable` gate below compares "8" with "558"
         * and withholds the whole machine module -- so a site with a large
         * sitemap lost every machine signal, not just the count.
         */
        ...(sitemapTotal === null ? {} : { reusedSitemapUrlCount: sitemapTotal }),
      },
    );
    /**
     * The page itself, rebuilt from what the run stored about it, by the same
     * function the generation path uses -- see `creditGeoKnowledgeObservedPage`
     * for what it refuses to guess.
     *
     * The page is carried whenever it can be rebuilt at all, not only when it
     * is full: `machine.sitemap.knowledgePagesListed` is `pages.some(...)`, so
     * a bundle with no page reports the site's own page as missing from a
     * sitemap that may well list it. When it cannot be rebuilt -- a row from
     * before the alternates were stored as pairs, or a list this contract
     * cannot carry -- the fallback below keeps the empty page it always used
     * and the machine gate withholds the module rather than publishing
     * `absent` about lists nobody read back.
     */
    rebuilt = creditGeoKnowledgeObservedPage({ url: targetUrl, structure: ownStructure });
    const types = rebuilt.kind === "page" ? rebuilt.page.jsonLdTypes : [];
    const alternates = rebuilt.kind === "page" ? rebuilt.page.hreflang : [];
    const page = rebuilt.kind === "page" ? rebuilt.page : {
      url: targetUrl, canonicalUrl: null, title: null, description: null, lang: null,
      jsonLdTypes: [], hreflangLocales: [], hreflang: [],
      faq: ownStructure.faq.map((pair) => ({ question: pair.question, answer: pair.answer })),
      links: [],
    };
    const { contentHash: _contentHash, machine, ...body } = evidence;
    const locations = machine.sitemap.locations ?? [];
    /**
     * Rebuilt through the contract's own builder, which re-derives every summary
     * below from the pages and sources beside it and throws if this disagrees.
     * The three summaries are restated here only because the builder demands
     * them; it is the arbiter, not this code.
     */
    evidence = buildGeoKnowledgeEvidenceV1({
      ...body,
      pages: [page],
      machine: {
        ...machine,
        jsonLd: {
          status: types.length > 0 ? "present" : "absent",
          types: [...new Set(types)].sort(),
          sourceRefs: machine.jsonLd.sourceRefs,
        },
        hreflang: {
          status: alternates.length > 0 ? "present" : "absent",
          locales: [...new Set(alternates.map((entry) => entry.locale))].sort(),
          sourceRefs: machine.hreflang.sourceRefs,
        },
        sitemap: machine.sitemap.status === "present"
          // The collector's own rule, imported rather than restated: it treats
          // the site's two spellings of its own host as one address, and
          // `assertEvidenceIntegrity` recomputes this with the same function.
          // Exact string equality here made a www sitemap under an apex target
          // disagree with the validator, which threw and cost the whole
          // observed assembly.
          ? { ...machine.sitemap, knowledgePagesListed: geoSitemapListsPage(locations, page.url) }
          : machine.sitemap,
      },
    });
  } catch {
    return null;
  }
  if (evidence.availability === "unavailable") return null;
  /**
   * The gate on the machine module: every signal it reports rests on a row this
   * run observed, or the module is not shown at all.
   *
   * The sitemap clause is the subtle one. The ledger keeps a bounded sample of
   * `<loc>` values plus the document's own total, while the evidence contract
   * ties the count it publishes to the list of locations it carries -- so the
   * count can only be published when the sample IS the document. When it is not
   * (and when a `<sitemapindex>` stored no total at all, which is right: it
   * lists sitemaps, not pages), the sample would be published as the total, and
   * "your sitemap lists 8 URLs" about a sitemap listing 800 is exactly the class
   * of sentence this route exists to refuse.
   */
  const countable = evidence.machine.sitemap.status !== "present"
    || (sitemapUrlCount !== null && String(evidence.machine.sitemap.urlCount) === sitemapUrlCount);
  const stored = ownStructure.jsonLdTypes.kind !== "not_stored" && ownStructure.hreflangLocales.kind !== "not_stored";
  /*
   * `rebuilt.kind === "page"` is the JSON-LD and hreflang half: the page was
   * reconstructed whole, so both summaries above rest on lists this row
   * actually holds. It used to additionally require that the page declared NO
   * alternates, because the contract's page shape pairs each locale with its
   * URL and the ledger stored the locales alone -- so any site with hreflang
   * lost its whole machine module. The pairs are stored now; a row written
   * before that answers `not_stored` and still withholds, which is the honest
   * answer for it and self-heals the next time the page is read.
   */
  const carriable = rebuilt.kind === "page" && countable;
  const observedMachine: GeoObservedMachine = machineObserved && stored && carriable
    ? { kind: "publish" }
    : { kind: "withheld", reason: machineObserved && stored ? "insufficient_evidence" : "not_collected" };
  return {
    observedAt: collectedAt,
    machine: observedMachine,
    evidence,
    input: {
      generatedAt: collectedAt,
      identity,
      evidence,
      offsite: null,
      synthesisInput: null,
      narrative: null,
      /**
       * The reason the model-dependent modules carry. Section 4.2 names it:
       * `generation_unavailable` is the existing vocabulary for "there is no
       * synthesis for this section", and it is the only member of
       * `GEO_NARRATIVE_FAILURE_REASONS` that says so without inventing a cause.
       */
      narrativeFailureReason: "generation_unavailable",
      robots,
      snippetsBlocked: null,
    },
  };
}

/**
 * The seven modules that carry an observation, and deliberately not the eighth.
 *
 * `knowledge.coverage` is not a module: it is a table derived from the statuses
 * beside it here, by the same function the publish step runs again over the
 * *reviewed* modules. Two copies of one judgement taken at two times will
 * disagree the moment a review excludes a section -- the publish-side table has
 * `owner_excluded_all` rows this one has no branch for -- and the ruling on that
 * slot is to delete the draft-side copy before this branch merges. Echoing its
 * status here would be the dependency that makes the deletion cost a version
 * bump; it also restates the seven above and observes nothing of its own.
 */
function moduleStatuses(knowledge: GeoKnowledgeBodyV3): Readonly<Record<string, string>> {
  return {
    entity: knowledge.entity.status,
    facts: knowledge.facts.status,
    qa: knowledge.qa.status,
    comparisons: knowledge.comparisons.status,
    scope: knowledge.scope.status,
    evidence: knowledge.evidence.status,
    machine: knowledge.machine.status,
  };
}

function outcomeCounts(kinds: readonly GeoMergeOutcomeKind[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const kind of kinds) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

function droppedRows(dropped: readonly GeoAssemblyDrop[]): readonly GeoAssemblyDrop[] {
  return dropped.slice(0, GEO_KB_V3_ASSEMBLE_MAX_DROPPED).map((entry) => ({ ...entry }));
}

export async function handleGeoKbV3Assemble(
  request: Request,
  dependencies: GeoKbV3AssembleDependencies,
): Promise<Response> {
  const identity = await authenticated(dependencies.authenticate);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, GEO_KB_V3_ASSEMBLE_REQUEST_BYTES);
  if (!json.ok) return json.response;
  const parsed = geoV3AssembleRequestSchema.safeParse(json.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  const { kbId, baseVersion, draftHash } = parsed.data;
  const scope = { userId: identity.userId, kbId };

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
    if (loaded.value.kbId !== scope.kbId) return privateError("store_unavailable", 503);
    const draft = loaded.value.draft;
    if (draft === null || !isGeoKbPayloadV3Value(draft.payload)) return privateError("not_found", 404);
    const stored = draft.payload;
    if (draft.draftVersion !== baseVersion) return privateJson({ error: { code: "conflict" }, draftVersion: draft.draftVersion }, 409);
    if (draft.contentHash !== draftHash) return privateJson({ error: { code: "conflict" }, draftVersion: draft.draftVersion }, 409);

    // The recorded hash has to be the hash of the input beside it, or the draft
    // was edited in transit and every binding below would compare the wrong
    // thing. Same check, same reason, as the publish path.
    const lockedHash = stored.runRef.generationInputHash;
    if (geoV2Digest(stored.generationInput) !== lockedHash) return privateError("input_changed", 409);

    if (dependencies.generationRunning) {
      const running = await dependencies.generationRunning(scope.userId, scope.kbId).catch(() => "unavailable" as const);
      if (running === true) return privateError("generation_running", 409);
    }

    const resolved = await resolveKnowledgeGeneration(dependencies, scope, stored);
    if (resolved instanceof Response) return resolved;

    /**
     * What is about to be assembled, and what the draft will say it rests on.
     *
     * Built before the assembly because the observed branch can fail for a
     * reason that is not a malformed assembly -- no fresh observation to
     * rebuild an evidence bundle from -- and that must reach the caller as the
     * refusal it had before rather than as `assembly_invalid`.
     */
    let basis: "generation" | "observed";
    let knowledgeGenerationId: string | null;
    let assembledAt: string;
    let input: AssembleGeoKnowledgeV3Input;
    /**
     * Null on the narrative branch, and the whole reason the two branches can be
     * told apart below: a body assembled from a paid model step reports the
     * machine module the assembler built, because that step read the three
     * machine resources itself. One nullable variable rather than a pair, so
     * that "observed" cannot be half-set.
     */
    let observed: GeoObservedAssembly | null = null;
    if (resolved.kind === "narrative") {
      const result = resolved.result;
      basis = "generation";
      knowledgeGenerationId = resolved.generationId;
      // From the record, never from a clock: a retry must assemble the same
      // body, and the same body must not mint a new draft version.
      assembledAt = result.generatedAt;
      input = {
        generatedAt: result.generatedAt,
        identity: stored.generationInput.identity,
        evidence: result.evidence,
        /**
         * Nothing in this deployment collects off-site evidence for a v3 run --
         * the run route seeds on-site fetches only and the knowledge generation
         * collects no third-party pages -- so there is none to pass. `null` is
         * "not collected", which is what the evidence module renders; an empty
         * collection would say the search ran and found nothing.
         */
        offsite: null,
        synthesisInput: result.synthesisInput,
        narrative: result.narrative,
        narrativeFailureReason: null,
        robots: await readObservedRobots(dependencies, scope, stored.generationInput),
        snippetsBlocked: null,
      };
    } else {
      const assembled = await geoObservedAssemblyInput(dependencies, scope, stored.generationInput);
      if (assembled === null) return privateError(resolved.refusal.code, resolved.refusal.status);
      observed = assembled;
      basis = "observed";
      // No record was reused, so the draft names none. Writing an id here is
      // also what arms the save RPC's generation-input lock, and a body nobody
      // paid a model for must not arm it.
      knowledgeGenerationId = null;
      assembledAt = assembled.observedAt;
      input = assembled.input;
    }

    let merged: ReturnType<typeof mergeGeoDraftV3>;
    let assembly: { readonly knowledge: GeoKnowledgeBodyV3; readonly dropped: readonly GeoAssemblyDrop[] };
    try {
      const built = assembleGeoKnowledgeBodyV3(input);
      assembly = observed === null
        ? built
        : { knowledge: geoObservedOnlyBody(built.knowledge, observed.evidence, observed.machine), dropped: built.dropped };
      merged = mergeGeoDraftV3({
        next: {
          ...stored,
          knowledge: assembly.knowledge,
          /**
           * Empty, and emphatically not `stored.review`.
           *
           * `mergeGeoDraftV3` parses `next` as a whole payload, and
           * `parseGeoKbPayloadV3` refuses a decision that names an item its
           * body does not contain. Carrying the stored review onto a freshly
           * assembled body therefore throws the moment a run stops producing
           * an item the owner had already decided on -- and this route turns
           * that into `assembly_invalid` (422), permanently: the same
           * generation is the newest one every time, so the knowledge base
           * could never be assembled again, and the only exit would be
           * releasing the generation-input lock, which forfeits every paid run.
           *
           * Nothing is lost by dropping them here. `previous` is this same
           * stored draft, and the merge reads the replaced draft's review at
           * *higher* priority than the copy sitting on `next` -- the latter is
           * documented as "a review already sitting on the freshly assembled
           * draft", which for a body assembled a line ago is nothing at all.
           * The vanished decision is then handled where it is meant to be, as
           * a `dropped` outcome whose exclusion survives as a suppression.
           */
          review: { decisions: [], suppressions: [] },
          /**
           * The reused record is named in the draft, which is what lets the
           * publish path check its binding without re-deriving the knowledge.
           *
           * It is also the first non-null `runRef` id anything in this product
           * writes, so this is the write that arms `marketing_geo_save_kb_draft`
           * v3 `generation_input_locked`: from here the locked input may only
           * change in a save that clears all four ids together. Nothing today
           * performs that releasing save -- see the seam note in the report --
           * so a second update of an assembled knowledge base has no producer
           * yet. That is a missing step, not a lock that needs loosening: the
           * lock is what stops a decision being attributed to inputs it was
           * never made against.
           */
          runRef: knowledgeGenerationId === null
            ? { ...stored.runRef }
            : { ...stored.runRef, knowledgeGenerationId },
        },
        previous: stored,
        previousDraftVersion: String(draft.draftVersion),
      });
    } catch {
      // The generation and the draft disagree about what they are about, or the
      // assembled body does not fit the budgets. Neither is retryable and
      // neither is an outage.
      return privateError("assembly_invalid", 422);
    }

    const payload = merged.payload;
    const contentHash = geoV2Digest(payload);
    let draftVersion = draft.draftVersion;
    let updatedAt = draft.updatedAt;
    // Byte-identical to what is already stored: assembling twice writes no
    // second version, which is the whole content-idempotence guarantee.
    const changed = contentHash !== draft.contentHash;
    if (changed) {
      const saved = await dependencies.saveDraft({ ...scope, payload, baseVersion });
      if (saved.kind === "input_locked") return privateError("input_changed", 409);
      if (saved.kind === "missing") return privateError("not_found", 404);
      if (saved.kind === "conflict") {
        // Null, not -1. `kb-v3-store.ts` answers `null` when the database did
        // not hand back a usable version, and -1 puts a value in the version
        // field that reads as a version and is not one -- the reader cannot
        // tell it from a real answer, and every version here is positive. The
        // create route (`kb-v3-draft-create.ts`) passes the null through for
        // the same reason.
        return privateJson({ error: { code: "conflict" }, draftVersion: saved.currentDraftVersion }, 409);
      }
      if (saved.kind !== "ok") return privateError("store_unavailable", 503);
      if (saved.value.contentHash !== contentHash) return privateError("store_unavailable", 503);
      draftVersion = saved.value.draftVersion;
      updatedAt = saved.value.updatedAt;
    }

    return privateJson({
      data: {
        kbId: scope.kbId,
        draftVersion,
        contentHash,
        updatedAt,
        generationInputHash: lockedHash,
        knowledgeGenerationId,
        assembledAt,
        /**
         * Which half of section 5 this body came from: `generation` is the
         * narrative a model step was paid for, `observed` is the deterministic
         * half assembled from the collection alone. The caller has to be able
         * to tell them apart -- an `observed` body names no generation record,
         * so a reader that only checked `knowledgeGenerationId` would read a
         * real assembly as a malformed answer.
         */
        basis,
        /** False when the assembled draft is byte-identical to the stored one. */
        changed,
        items: geoV3Items(payload.knowledge).length,
        // Read off the MERGED body, not the assembled one. It used to be the
        // assembled one on the grounds that the merge "never changes a module
        // from available to unavailable or back" -- which stopped being true
        // when carrying an owner's correction was allowed to re-open a module
        // this update found nothing for (section 4.4: a correction never rested
        // on the observation). Reporting the pre-merge statuses would tell the
        // owner a section is empty while the card draws their own answer in it.
        // `?? assembly.knowledge` only satisfies the nullable type: the merge is
        // handed a body and never removes it, and the assembled statuses are
        // what this line reported before re-opening was possible.
        modules: moduleStatuses(payload.knowledge ?? assembly.knowledge),
        outcomes: outcomeCounts(merged.outcomes.map((outcome) => outcome.kind)),
        /** Everything collected that could not be shown, and why. Never silent. */
        dropped: droppedRows(assembly.dropped),
        droppedTotal: assembly.dropped.length,
        /** Exclusions the review's own ceiling could not keep. Never silent. */
        evictedSuppressions: [...merged.evictedSuppressions],
        /**
         * Owner corrections the merge could not carry, by item key. Section 4.4
         * says a correction outlives its observation, so this should stay empty;
         * it exists because deleting the owner's own words and answering 200 is
         * the one outcome that must not be possible to reach quietly.
         */
        droppedCorrections: merged.droppedCorrections.map((entry) => entry.itemKey),
      },
    });
  } catch {
    return privateError("store_unavailable", 503);
  }
}
