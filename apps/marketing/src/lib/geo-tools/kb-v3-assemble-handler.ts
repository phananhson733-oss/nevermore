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
 * Three properties it exists to hold.
 *
 * **It buys nothing.** Every input already exists and was already charged for.
 * A generation that failed is reported as failed; it is never re-dispatched, and
 * `outcome_unknown` in particular is never auto-retried -- a request whose
 * outcome we never saw is not evidence that nothing was billed.
 *
 * **It fabricates nothing.** A failed model step leaves no evidence bundle
 * behind (a failed generation record's result is null), so there is nothing to
 * assemble and the draft keeps `knowledge: null` rather than gaining an empty
 * body that would read as "we looked and there is nothing". When a narrative
 * *is* present, the assembler's own partial/unavailable module states carry any
 * per-module failure; this route never invents a module.
 *
 * **It is content-idempotent.** `generatedAt` is taken from the generation
 * record, never from a clock, so re-assembling the same record produces the same
 * body, the same payload digest and therefore no new draft version at all.
 */
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { z } from "zod";

import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoKbStoreResult } from "./kb-store.ts";
import { isGeoKbPayloadV3Value, type VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import {
  assembleGeoKnowledgeBodyV3,
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
 */
type KnowledgeOutcome = { readonly generationId: string; readonly result: GeoKnowledgeGenerationResultV2 } | Response;

async function resolveKnowledgeGeneration(
  dependencies: GeoKbV3AssembleDependencies,
  scope: { readonly userId: string; readonly kbId: string },
  runRef: GeoKbPayloadV3["runRef"],
): Promise<KnowledgeOutcome> {
  const read = await dependencies
    .readLatestGeneration({ ...scope, kind: "knowledge_pack" })
    .catch(() => ({ kind: "unavailable" as const }));
  if (read.kind !== "ok") return privateError("store_unavailable", 503);
  const generation = read.generation;
  // Nobody has run the knowledge step for this knowledge base. There is nothing
  // to assemble, and saying "assembled" would claim a body that does not exist.
  if (generation === null) return privateError("generation_missing", 409);
  if (generation.kind !== "knowledge_pack") return privateError("store_unavailable", 503);
  if (generation.state === "claimed" || generation.state === "dispatched") {
    return privateError("generation_running", 409);
  }
  // A failed step produced no evidence bundle and no narrative, so there is
  // nothing to assemble from. Assembling "the observed half" is not available
  // here either: the observations live inside the generation's own result.
  if (generation.state === "failed") return privateError("generation_failed", 422);
  // Never auto-retried, and never quietly treated as a failure that produced a
  // body: we do not know whether the provider was billed or what it returned.
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
  return { generationId: generation.generationId, result };
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

    const knowledge = await resolveKnowledgeGeneration(dependencies, scope, stored.runRef);
    if (knowledge instanceof Response) return knowledge;
    const { result } = knowledge;

    let merged: ReturnType<typeof mergeGeoDraftV3>;
    let assembly: { readonly knowledge: GeoKnowledgeBodyV3; readonly dropped: readonly GeoAssemblyDrop[] };
    try {
      assembly = assembleGeoKnowledgeBodyV3({
        // From the record, never from a clock: a retry must assemble the same
        // body, and the same body must not mint a new draft version.
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
        robots: null,
        snippetsBlocked: null,
      });
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
          runRef: { ...stored.runRef, knowledgeGenerationId: knowledge.generationId },
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
        knowledgeGenerationId: knowledge.generationId,
        assembledAt: result.generatedAt,
        /** False when the assembled draft is byte-identical to the stored one. */
        changed,
        items: geoV3Items(payload.knowledge).length,
        // Read off the assembled body rather than the merged one, and they are
        // the same statuses: `mergeGeoDraftV3` edits rows inside a module --
        // conflicts, carried-forward corrections -- and never changes a module
        // from available to unavailable or back. `items` below is counted on the
        // merged payload, because carrying a correction forward does add a row.
        modules: moduleStatuses(assembly.knowledge),
        outcomes: outcomeCounts(merged.outcomes.map((outcome) => outcome.kind)),
        /** Everything collected that could not be shown, and why. Never silent. */
        dropped: droppedRows(assembly.dropped),
        droppedTotal: assembly.dropped.length,
        /** Exclusions the review's own ceiling could not keep. Never silent. */
        evictedSuppressions: [...merged.evictedSuppressions],
      },
    });
  } catch {
    return privateError("store_unavailable", 503);
  }
}
