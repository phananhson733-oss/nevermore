// @input  -- verified Marketing auth and the owner-scoped run ledger
// @output -- real single-run route dependencies; no config reads or network work during import
// @pos    -- runtime wiring only

/**
 * What this file wires, and what it still refuses to invent.
 *
 * S4 owns the ledger, the orchestration and the route; it owns none of the
 * work. The producer of the operation list and the executor that performs one
 * are a seam, and BOTH halves of it are registered here now:
 *
 *  - collection (`kb-run-collect-executor.ts`): a run observes the site's own
 *    page and each confirmed competitor's, through the website evidence
 *    observation library;
 *  - the knowledge model step (below): the run writes the deterministic half of
 *    the body from what the collection observed, then buys one `knowledge_pack`
 *    generation for the draft and assembles it into the draft's body.
 *
 * The order in that second half is section 4.2's, not an implementation detail.
 * The deterministic modules go in BEFORE anything is dispatched, so they neither
 * wait for the model nor die with it; the assemble route builds them from the
 * observation ledger without a fetch, so this costs nothing and buys nothing.
 *
 * The second half is what closed the chain. Until it existed a v3 run seeded
 * on-site fetches and nothing else, no `knowledge_pack` record was ever created
 * for a v3 draft, `payload.knowledge` stayed null on every stored draft, and
 * `kb-v3-publish-handler.ts` answered `nothing_to_publish` (422) forever --
 * while `/v2/knowledge`, the one route whose preparer DOES accept a v3 draft,
 * was reachable only from the v2 editor, which a v3 draft never renders.
 *
 * `roles` and `questions` are still NOT registered, and that is a fact about
 * this deployment rather than a preference: nothing builds a v3 roles-proposal
 * input and there is no TypeScript contract for a v3 question-generation
 * result. `serp` and `gsc` are excluded deliberately. An operation kind nobody
 * registered is recorded as permanently unsupported rather than retried or
 * reported as done, so a run that somehow contains one finishes and says what
 * is missing instead of looping -- and nothing seeds such an operation today.
 *
 * The producer may also answer that there is nothing to run. That answer has to
 * survive to the caller: a run that opens, finds no operations and reports
 * `complete` is telling the owner their knowledge base was updated.
 */

import { getServerAuthenticatedUser, type ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import type { GeoRunContext, GeoRunExecutor, GeoRunProbeOutcome, GeoRunStartOutcome } from "./kb-run-advance.ts";
import type { GeoRunLedgerStore, GeoRunOperationReason } from "./kb-run-ledger.ts";
import { abandonGeoKbRun, DEFAULT_GEO_RUN_LEDGER_STORE } from "./kb-run-store.ts";
import type { GeoKbRunHandlerDependencies } from "./kb-run-handler.ts";
import {
  createGeoRunCollectRuntime,
  DEFAULT_GEO_RUN_COLLECT_SOURCES,
  type GeoRunSeedOutcome,
} from "./kb-run-collect-executor.ts";
import { GEO_RUN_KNOWLEDGE_MODEL_SEED } from "./kb-run-collect.ts";
import type { GeoKbGenerationError, GeoKbGenerationState } from "./kb-generation.ts";
import { handleGeoKbGeneration, handleGeoKbGenerationRead, type GeoKbGenerationHandlerDependencies } from "./kb-generation-handler.ts";
import { handleGeoKbV3Assemble, type GeoKbV3AssembleDependencies } from "./kb-v3-assemble-handler.ts";
import { DEFAULT_GEO_KB_GENERATION_STORE } from "./kb-generation-store.ts";
import { DEFAULT_GEO_KB_V2_RUNTIME } from "./kb-v2-runtime.ts";
import { isGeoKbPayloadV3Value, readVersionedGeoKnowledgeBase } from "./kb-versioned-read.ts";
import { saveGeoKbDraftV3 } from "./kb-v3-store.ts";

/**
 * The executor of last resort.
 *
 * `start` never sends anything, so it cannot be billed; it records that this
 * deployment has no producer for that kind. `probe` answers `unresolved`,
 * which is the only honest answer about work we did not do -- and, because the
 * orchestrator gives up after a bounded number of probes, it terminates.
 */
export const GEO_RUN_UNSUPPORTED_EXECUTOR: GeoRunExecutor = {
  start: async () => ({ kind: "failed_permanent", reason: "unsupported" }),
  probe: async () => ({ kind: "unresolved" }),
};

/**
 * The key one run's knowledge generation is bought under.
 *
 * Derived from the run id and nothing else, which is what makes a resumed run
 * find its own earlier attempt: `handleGeoKbGeneration` reads a knowledge pack
 * by key BEFORE its preparer spends anything, so a second invocation under the
 * same key cannot buy a second narrative. It is deliberately not derived from
 * the draft -- assembling writes a new draft version, so a draft-derived key
 * would change the moment the first attempt succeeded and authorise a second
 * charge for work already paid for.
 *
 * The other side of that: a NEW run is a new key and therefore a new charge.
 * That is the correct reading of "the owner asked for another update", and it
 * is why this key is never reused across runs.
 */
export function geoRunKnowledgeIdempotencyKey(runId: string): string {
  return `run-${runId.replace(/[^a-zA-Z0-9]/gu, "")}-knowledge`;
}

/** The locked half of the draft a knowledge step is bought against. */
export type GeoRunKnowledgeDraft =
  | {
      readonly kind: "ok";
      readonly draftVersion: number;
      readonly draftHash: string;
      readonly generationInputHash: string;
    }
  | { readonly kind: "missing" | "unsupported" | "unavailable" };

/** A stored generation record, narrowed to what the run has to decide about. */
export type GeoRunKnowledgeRead =
  | {
      readonly kind: "record";
      readonly generationId: string;
      readonly state: GeoKbGenerationState;
      readonly errorReason: GeoKbGenerationError | null;
    }
  | { readonly kind: "none" }
  | { readonly kind: "unavailable" };

/**
 * What dispatching the knowledge step answered.
 *
 * `refused` means the request never reached a provider -- the preparer said no,
 * or the claim conflicted -- so nothing was billed. `outcome_unknown` means we
 * sent something and cannot say what came back, and it is never a retry.
 */
export type GeoRunKnowledgeDispatch =
  | {
      readonly kind: "record";
      readonly generationId: string;
      readonly state: GeoKbGenerationState;
      readonly errorReason: GeoKbGenerationError | null;
    }
  | { readonly kind: "refused"; readonly permanent: boolean; readonly reason: GeoRunOperationReason }
  | { readonly kind: "outcome_unknown" };

/** What assembling a paid generation into the draft answered. It buys nothing. */
export type GeoRunAssembleOutcome =
  /**
   * `knowledgeGenerationId` is the record the DRAFT now carries, reported back
   * by the assemble route -- not the one this executor settled. That route
   * resolves "the newest knowledge_pack this knowledge base owns" rather than
   * taking an id, so the two coincide only because a run holds the single
   * active-run lease while it buys. Carrying the route's own answer keeps the
   * ledger's `resultRef` pointing at what was actually filed on the day that
   * stops being true; making the route take an id is the seam that closes it.
   */
  | { readonly kind: "assembled"; readonly knowledgeGenerationId: string }
  /**
   * The deterministic half was written: what the collection observed is on the
   * draft, and no narrative existed to file beside it. It names no generation
   * record because none was reused, which is why it is a member of its own
   * rather than an `assembled` with an empty id.
   */
  | { readonly kind: "observed" }
  /** Come back: the draft moved, the store blinked, or a quota said later. */
  | { readonly kind: "retry"; readonly reason: GeoRunOperationReason }
  /** It will answer the same way every time; do not keep asking. */
  | { readonly kind: "refused"; readonly reason: GeoRunOperationReason };

export interface GeoRunKnowledgeSources {
  readonly readDraft: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => Promise<GeoRunKnowledgeDraft>;
  readonly readGeneration: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly idempotencyKey: string;
  }) => Promise<GeoRunKnowledgeRead>;
  /** The only call here that can cost money. */
  readonly dispatchGeneration: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly idempotencyKey: string;
    readonly baseVersion: number;
    readonly draftHash: string;
  }) => Promise<GeoRunKnowledgeDispatch>;
  readonly assemble: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly baseVersion: number;
    readonly draftHash: string;
  }) => Promise<GeoRunAssembleOutcome>;
}

/**
 * A stored failure's own reason, carried through rather than flattened.
 *
 * `rate_limited` and `quota_unavailable` are the cases where nothing reached a
 * provider, and keeping the word is the difference between "your quota refused
 * this" and an unexplained failure. `input_stale` has no member of its own in
 * the ledger's reason vocabulary -- that list is a database CHECK and widening
 * it is a migration, not this file's change -- so it lands on `not_found`,
 * which is the nearest true statement: the draft the generation named is not
 * the draft that exists.
 */
function knowledgeFailureReason(reason: GeoKbGenerationError | null): GeoRunOperationReason {
  switch (reason) {
    case "rate_limited":
    case "quota_unavailable":
    case "provider_rejected":
    case "invalid_output":
    case "model_unavailable":
    case "outcome_unknown":
      return reason;
    case "input_stale":
      return "not_found";
    default:
      return "invalid_output";
  }
}

/**
 * The knowledge half of the run seam.
 *
 * Four rules it exists to hold.
 *
 *  - **Read before spending.** The first thing `start` does after reading the
 *    draft is look for a generation already bought under this run's key. A
 *    record found there ends the attempt without a dispatch, which is what
 *    makes the operation safe to hand back to `planGeoRun` as retryable: a
 *    retry re-reads, it does not re-buy. This is the same shape the fetch half
 *    uses when it consults the observation library before opening a crawl gate.
 *  - **A stored failure is this run's answer, not a suggestion to try again.**
 *    The key belongs to the run, so a failed record under it can never be
 *    superseded by another attempt in the same run: reporting it as retryable
 *    would spin the caller's poll loop forever over a decision that is already
 *    made. It is permanent for this run, and the reason travels with it.
 *  - **`outcome_unknown` is never auto-retried.** A generation we dispatched
 *    and cannot resolve stays unresolved; a record that says `uncertain` is
 *    reported as a permanent failure whose reason is `outcome_unknown`, which
 *    is the only honest thing to say about a charge we cannot see.
 *  - **Succeeded means the draft carries it.** The operation is not reported
 *    `succeeded` until the assemble has landed, because a paid narrative that
 *    never reached `payload.knowledge` leaves publish refusing exactly as it
 *    did before -- and nothing else in the run would ever go back for it.
 */
export function createGeoRunKnowledgeExecutor(sources: GeoRunKnowledgeSources): GeoRunExecutor {
  const assembleInto = async (
    context: { readonly userId: string; readonly kbId: string },
    draft: Extract<GeoRunKnowledgeDraft, { readonly kind: "ok" }>,
  ): Promise<GeoRunAssembleOutcome> =>
    await sources
      .assemble({
        userId: context.userId,
        kbId: context.kbId,
        baseVersion: draft.draftVersion,
        draftHash: draft.draftHash,
      })
      .catch(() => ({ kind: "retry" as const, reason: "store_unavailable" as const }));

  /**
   * What filing a paid narrative into the draft means for this operation.
   *
   * `observed` cannot honestly be a success here. This is only reached with a
   * succeeded record, so the route was expected to resolve that record's
   * narrative; an observed body means it filed something this operation did not
   * buy, and `resultRef` -- which is not optional for a succeeded operation --
   * would have nothing true to point at. It is reported as an outage so the
   * next invocation re-reads rather than recorded as the narrative landing.
   */
  const filed = (
    outcome: GeoRunAssembleOutcome,
  ):
    | { readonly kind: "succeeded"; readonly resultRef: string }
    | { readonly kind: "retry"; readonly reason: GeoRunOperationReason }
    | { readonly kind: "refused"; readonly reason: GeoRunOperationReason } => {
    if (outcome.kind === "assembled") return { kind: "succeeded", resultRef: outcome.knowledgeGenerationId };
    if (outcome.kind === "observed") return { kind: "retry", reason: "store_unavailable" };
    return outcome;
  };

  /** What a record means, once we have one. Never dispatches. */
  const settle = async (
    record: Extract<GeoRunKnowledgeRead, { readonly kind: "record" }>,
    context: { readonly userId: string; readonly kbId: string },
    draft: Extract<GeoRunKnowledgeDraft, { readonly kind: "ok" }>,
  ): Promise<GeoRunStartOutcome> => {
    switch (record.state) {
      case "succeeded": {
        const assembled = filed(await assembleInto(context, draft));
        if (assembled.kind === "succeeded") return assembled;
        return assembled.kind === "retry"
          ? { kind: "failed_retryable", reason: assembled.reason }
          : { kind: "failed_permanent", reason: assembled.reason };
      }
      case "failed":
        return { kind: "failed_permanent", reason: knowledgeFailureReason(record.errorReason) };
      case "uncertain":
        return { kind: "failed_permanent", reason: "outcome_unknown" };
      default:
        // `claimed` or `dispatched`: something was sent under this key and its
        // answer is not written down yet. Saying anything else would either
        // invent a result or license a second charge.
        return { kind: "outcome_unknown" };
    }
  };

  const start = async (
    operation: { readonly key: string; readonly kind: string },
    context: GeoRunContext,
  ): Promise<GeoRunStartOutcome> => {
    if (operation.kind !== "model" || operation.key !== GEO_RUN_KNOWLEDGE_MODEL_SEED.key) {
      return { kind: "failed_permanent", reason: "unsupported" };
    }
    const scope = { userId: context.userId, kbId: context.kbId };
    const draft = await sources.readDraft(scope).catch(() => ({ kind: "unavailable" as const }));
    if (draft.kind === "missing") return { kind: "failed_permanent", reason: "not_found" };
    if (draft.kind === "unsupported") return { kind: "failed_permanent", reason: "unsupported" };
    if (draft.kind !== "ok") return { kind: "failed_retryable", reason: "store_unavailable" };

    // Say what this run's paid generations are pinned to before buying one. A
    // conflict is the run already carrying a different locked input, which no
    // amount of waiting fixes.
    const bound = await context
      .bindGenerationInput(draft.generationInputHash)
      .catch(() => "unavailable" as const);
    if (bound === "conflict") return { kind: "failed_permanent", reason: "not_found" };
    if (bound !== "bound") return { kind: "failed_retryable", reason: "store_unavailable" };

    const idempotencyKey = geoRunKnowledgeIdempotencyKey(context.runId);
    const existing = await sources
      .readGeneration({ ...scope, idempotencyKey })
      .catch(() => ({ kind: "unavailable" as const }));
    if (existing.kind === "unavailable") return { kind: "failed_retryable", reason: "store_unavailable" };
    // Already bought under this run's key. Nothing leaves this process.
    if (existing.kind === "record") return await settle(existing, scope, draft);

    /**
     * Section 4.2's deterministic half, written before anything is dispatched.
     *
     * Reaching this line means the collection is finished -- the seed order in
     * `kb-run-collect.ts` puts every fetch ahead of `model:knowledge`, and
     * `planGeoRun` hands out the first actionable operation -- and that nothing
     * has been bought for this run yet. That is exactly the moment the design
     * says the modules which need no model become visible: what was observed,
     * and the coverage table over it. They used to wait for the narrative and
     * die with it, so an owner whose model step failed was left with a card of
     * zero sections after the run had already read their site.
     *
     * It buys nothing. The assemble route rebuilds its evidence bundle from the
     * observation ledger through a reader that opens no socket, so no crawl-gate
     * admission and no request can come out of this call, and it declines
     * outright on a draft that already carries a body.
     *
     * Its answer is deliberately discarded rather than made this operation's.
     * The operation is the model step; the refusals this call can produce -- a
     * draft that already has a body, no observation fresh enough to rebuild
     * from, no observation library wired -- are all states in which there is
     * still a narrative worth buying, and failing here would take that away for
     * the sake of a step that costs nothing. Nothing is hidden by discarding it:
     * the draft either gained the body or did not, and the assembly that follows
     * a succeeded generation writes the full one either way.
     */
    await assembleInto(scope, draft);
    /**
     * That write may have minted a new draft version, and a dispatch binds the
     * paid record to the version it names. So the draft is re-read rather than
     * the copy from before the write reused; not knowing the current one is a
     * reason to come back, not a reason to buy against a stale version.
     */
    const reread = await sources.readDraft(scope).catch(() => ({ kind: "unavailable" as const }));
    if (reread.kind !== "ok") return { kind: "failed_retryable", reason: "store_unavailable" };
    // The observed write never touches `generationInput`, so a hash that moved
    // is somebody else editing the draft. The bind above spoke for the old one.
    if (reread.generationInputHash !== draft.generationInputHash) {
      return { kind: "failed_retryable", reason: "store_unavailable" };
    }
    const current = reread;

    let dispatched: GeoRunKnowledgeDispatch;
    try {
      dispatched = await sources.dispatchGeneration({
        ...scope,
        idempotencyKey,
        baseVersion: current.draftVersion,
        draftHash: current.draftHash,
      });
    } catch {
      // The request went out. We do not know what came back, and that is
      // exactly the case that must not become a retry.
      return { kind: "outcome_unknown" };
    }
    if (dispatched.kind === "outcome_unknown") return { kind: "outcome_unknown" };
    if (dispatched.kind === "refused") {
      return dispatched.permanent
        ? { kind: "failed_permanent", reason: dispatched.reason }
        : { kind: "failed_retryable", reason: dispatched.reason };
    }
    return await settle(dispatched, scope, current);
  };

  const probe = async (
    operation: { readonly key: string; readonly kind: string; readonly state: string },
    context: GeoRunContext,
  ): Promise<GeoRunProbeOutcome> => {
    if (operation.kind !== "model" || operation.key !== GEO_RUN_KNOWLEDGE_MODEL_SEED.key) {
      return { kind: "unresolved" };
    }
    // The dispatch mark is written before the request leaves, so a row still
    // reading `claimed` provably sent nothing. That is the only state in which
    // "nothing was dispatched" is a fact rather than a hope.
    if (operation.state === "claimed") return { kind: "not_dispatched" };
    const scope = { userId: context.userId, kbId: context.kbId };
    // The record first, and the draft only if there turns out to be something
    // to file. A settled failure is knowable without the draft, and reading the
    // draft first would report "we could not find out" about an outcome the
    // store had already written down.
    const read = await sources
      .readGeneration({ ...scope, idempotencyKey: geoRunKnowledgeIdempotencyKey(context.runId) })
      .catch(() => ({ kind: "unavailable" as const }));
    if (read.kind !== "record") return { kind: "unresolved" };
    switch (read.state) {
      case "succeeded": {
        const draft = await sources.readDraft(scope).catch(() => ({ kind: "unavailable" as const }));
        if (draft.kind !== "ok") return { kind: "unresolved" };
        const assembled = filed(await assembleInto(scope, draft));
        if (assembled.kind === "succeeded") return assembled;
        // A refusal that will not change is reported; anything transient stays
        // unresolved, and the orchestrator's own probe bound ends the loop.
        return assembled.kind === "refused"
          ? { kind: "failed_permanent", reason: assembled.reason }
          : { kind: "unresolved" };
      }
      case "failed":
        return { kind: "failed_permanent", reason: knowledgeFailureReason(read.errorReason) };
      case "uncertain":
        return { kind: "failed_permanent", reason: "outcome_unknown" };
      default:
        return { kind: "unresolved" };
    }
  };

  return {
    start: async (operation, runContext) => await start(operation, runContext),
    probe: async (operation, runContext) => await probe(operation, runContext),
  };
}

/**
 * One executor per kind, and an honest refusal for every kind nobody wired.
 *
 * Routing by kind rather than by key keeps `serp` and `gsc` excluded by
 * construction: they reach `GEO_RUN_UNSUPPORTED_EXECUTOR`, which sends nothing
 * and records that this deployment has no producer for them.
 */
export function createGeoRunUpdateExecutor(halves: {
  readonly fetch: GeoRunExecutor;
  readonly model: GeoRunExecutor;
}): GeoRunExecutor {
  const For = (kind: string): GeoRunExecutor =>
    kind === "fetch" ? halves.fetch : kind === "model" ? halves.model : GEO_RUN_UNSUPPORTED_EXECUTOR;
  return {
    start: async (operation, context) => await For(operation.kind).start(operation, context),
    probe: async (operation, context) => await For(operation.kind).probe(operation, context),
  };
}

/**
 * The owner this executor acts as.
 *
 * Taken from the run's own scope rather than re-read from the request cookie.
 * `handleGeoKbRun` already authenticated this user before a run was claimed and
 * every ledger row is keyed on that id, so re-authenticating could only
 * introduce a second answer -- and the weaker of two disagreeing answers about
 * whose money is being spent is the wrong one to act on.
 */
function actingAs(userId: string): () => Promise<ServerAuthenticatedUser> {
  return async () => ({ status: "authenticated", userId, email: null, avatarUrl: null });
}

/** Same-origin by construction: an in-process request carries no `origin`. */
function internalRequest(path: string, body: unknown): Request {
  return new Request(`https://marketing.internal/api/tools/geo-knowledge-base/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function responseBody(response: Response): Promise<Record<string, unknown> | null> {
  const parsed: unknown = await response.json().catch(() => null);
  return record(parsed) ? parsed : null;
}

function errorCode(body: Record<string, unknown> | null): string {
  const error = body?.error;
  return record(error) && typeof error.code === "string" ? error.code : "";
}

const GENERATION_STATES: readonly string[] = ["claimed", "dispatched", "succeeded", "failed", "uncertain"];

/** A generation as the handler returns it, checked before any of it is believed. */
function generationRead(body: Record<string, unknown> | null): GeoRunKnowledgeRead {
  const data = body?.data;
  const generation = record(data) ? data.generation : undefined;
  if (!record(generation)) return { kind: "unavailable" };
  const { generationId, state, errorReason } = generation;
  if (typeof generationId !== "string" || generationId === "") return { kind: "unavailable" };
  if (typeof state !== "string" || !GENERATION_STATES.includes(state)) return { kind: "unavailable" };
  if (errorReason !== null && typeof errorReason !== "string") return { kind: "unavailable" };
  return {
    kind: "record",
    generationId,
    state: state as GeoKbGenerationState,
    errorReason: errorReason as GeoKbGenerationError | null,
  };
}

/**
 * What the generation route's answer means for the ledger.
 *
 * Exported and pure because this table is where a run livelocks or lies. A
 * permanent refusal filed as retryable spins the caller's poll loop forever; a
 * refusal that never reached a provider filed as `outcome_unknown` claims a
 * charge nobody made; and the reverse claims nothing was spent when it may have
 * been. It is written out rather than derived from a status class so each entry
 * is a decision somebody made.
 */
export function geoRunDispatchOutcome(
  status: number,
  body: Record<string, unknown> | null,
): GeoRunKnowledgeDispatch {
  if (status === 200) {
    const read = generationRead(body);
    return read.kind === "record" ? read : { kind: "outcome_unknown" };
  }
  // 409 is `conflict` or `input_stale`: something moved under us and nothing
  // was dispatched, so the next invocation re-reads and settles it.
  if (status === 409) return { kind: "refused", permanent: false, reason: "store_unavailable" };
  if (status === 404) return { kind: "refused", permanent: true, reason: "not_found" };
  // 422 is the preparer refusing a well-formed request permanently, and TWO
  // different things arrive under it. Only one of them is the statement the
  // card's `unsupported` copy makes -- "not attempted, and nothing was spent".
  //
  // `unsupported_draft` is that one. `kb-generation-preparer.ts` answers it at
  // the kind check, before it opens a socket, and only for a request whose kind
  // this draft version has no adapter for. Nothing was fetched and nothing was
  // bought, so `unsupported` is true of it. It is currently unreachable from
  // THIS caller -- the run dispatches `knowledge_pack` and only
  // `knowledge_pack`, which is the one kind that check admits -- and it is kept
  // because the branch is what makes the sentence true on the day a v3 roles or
  // questions step is registered. Nothing in production reaches it today.
  //
  // Every other 422 can arrive after the preparer has gone and collected the
  // evidence. For a knowledge pack -- the only kind this run dispatches --
  // `prepareGeoKbV3Generation` reads the site's own page, its machine files and
  // each confirmed competitor's page, opening a crawl-gate admission on the
  // owner's own host for every target the observation library cannot already
  // answer, and only THEN reaches `input_too_large` (which that path has
  // nowhere else), `invalid_input` or a second `unsupported_language`.
  //
  // The card's sentence makes two claims about an `unsupported` operation, and
  // this refusal breaks the first of them outright: it WAS attempted, all the
  // way through a collection, before anything said no. Whether it also spent a
  // crawl admission depends on what the run's own fetch half had already
  // observed inside the TTL, and neither the status nor the body says. The two
  // ambiguous codes are also reachable before the collection -- a payload that
  // will not parse, a market language the question step cannot serve -- and
  // nothing here separates those from the ones that follow it.
  //
  // Both unknowns resolve the same way: "nothing was spent" is a claim, and a
  // claim needs proof. Filing an ambiguous refusal as `unsupported` would tell
  // an owner their site was never read, minutes after it was.
  //
  // `invalid_output` is the nearest true member of the ledger's reason
  // vocabulary -- that list is a database CHECK and widening it is a migration,
  // not this file's change, the same wall `input_stale` hits in
  // `knowledgeFailureReason`. It asserts no charge the way `provider_rejected`
  // would, and the card counts it among the operations that "could not be
  // completed", which claims nothing about money in either direction. A reason
  // of its own is a seam for whoever writes the migration.
  if (status === 422) {
    return {
      kind: "refused",
      permanent: true,
      reason: errorCode(body) === "unsupported_draft" ? "unsupported" : "invalid_output",
    };
  }
  // Our own request was malformed. That is a bug in this file, not an outage,
  // and repeating it would only spend the invocation.
  if (status === 400) return { kind: "refused", permanent: true, reason: "invalid_output" };
  if (status === 401 || status === 503) {
    return {
      kind: "refused",
      permanent: false,
      reason: errorCode(body) === "model_unavailable" ? "model_unavailable" : "store_unavailable",
    };
  }
  // An unrecognised status is not proof that nothing was sent.
  return { kind: "outcome_unknown" };
}

/** What the assemble route's answer means. Nothing here was ever billable. */
export function geoRunAssembleOutcome(
  status: number,
  body: Record<string, unknown> | null,
): GeoRunAssembleOutcome {
  if (status === 200) {
    const data = body?.data;
    const named = record(data) ? data.knowledgeGenerationId : undefined;
    if (typeof named === "string" && named !== "") return { kind: "assembled", knowledgeGenerationId: named };
    // A body assembled from the collection alone names no generation record,
    // and says which half it came from. Read together, those two are the one
    // shape in which a missing id is an answer rather than a malformed one.
    if (record(data) && data.basis === "observed" && named === null) return { kind: "observed" };
    // Any other 200 that does not name the record it filed is not an assembly
    // the ledger can point at, and `resultRef` is not optional for a succeeded
    // operation. Report an outage rather than invent a pointer.
    return { kind: "retry", reason: "store_unavailable" };
  }
  if (status === 503) return { kind: "retry", reason: "store_unavailable" };
  if (status === 429) return { kind: "retry", reason: "rate_limited" };
  if (status === 409) {
    // `conflict` is the draft having moved -- re-reading it settles that, and
    // so does waiting out a generation that is still running. `input_changed`
    // and `generation_missing` never settle by waiting.
    const code = errorCode(body);
    return code === "conflict" || code === "generation_running"
      ? { kind: "retry", reason: "store_unavailable" }
      : { kind: "refused", reason: "not_found" };
  }
  if (status === 404) return { kind: "refused", reason: "not_found" };
  return { kind: "refused", reason: "invalid_output" };
}

function generationDependencies(userId: string): GeoKbGenerationHandlerDependencies {
  return { ...DEFAULT_GEO_KB_V2_RUNTIME.generation, authenticate: actingAs(userId) };
}

/**
 * The assemble route's dependencies, built per call.
 *
 * Neither `generationRunning` nor `consumeQuota` is passed, and both omissions
 * are decisions.
 *
 * `generationRunning` refuses while ANY generation kind is dispatched. Inside a
 * run the knowledge record has just been settled, and the handler already
 * refuses a knowledge pack that is still claimed or dispatched; the extra
 * predicate could only turn a finished, paid run into a 409 because of an
 * unrelated record.
 *
 * `consumeQuota` is the browser-facing bucket sized for a person clicking
 * `assemble`. The expensive half of this operation is already fused by the
 * generation route's own per-owner and per-knowledge-base hourly limits, and a
 * run that has paid for a narrative must not be unable to file it because a
 * free step ran out of an allowance meant for a different caller.
 */
function assembleDependencies(userId: string): GeoKbV3AssembleDependencies {
  return {
    authenticate: actingAs(userId),
    readDetails: async (input) => await readVersionedGeoKnowledgeBase(input),
    saveDraft: async (input) => await saveGeoKbDraftV3(input),
    readLatestGeneration: async (input) => await DEFAULT_GEO_KB_GENERATION_STORE.readLatest(input),
    /**
     * The same two readers the collection half already uses, so the rows this
     * route credits are exactly the rows this run's fetch operations wrote.
     * Taking them from `DEFAULT_GEO_RUN_COLLECT_SOURCES` rather than importing
     * the stores again keeps that one wiring rather than two that can drift.
     */
    observations: {
      resolveWebsiteId: DEFAULT_GEO_RUN_COLLECT_SOURCES.resolveWebsiteId,
      readLatestObservation: DEFAULT_GEO_RUN_COLLECT_SOURCES.readLatestObservation,
      now: DEFAULT_GEO_RUN_COLLECT_SOURCES.now,
    },
  };
}

/** What the knowledge sources need from the rest of the app, and nothing more. */
export interface GeoRunKnowledgeWiring {
  readonly readDetails: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => ReturnType<typeof readVersionedGeoKnowledgeBase>;
  /** Built per call so each acts as the run's own owner rather than a cookie's. */
  readonly generation: (userId: string) => GeoKbGenerationHandlerDependencies;
  readonly assemble: (userId: string) => GeoKbV3AssembleDependencies;
}

/**
 * The sources for the knowledge step, over whatever stores they are given.
 *
 * Every one of them goes through the handler that already owns the decision:
 * `handleGeoKbGeneration` holds the claim/dispatch/finish state machine and the
 * money rules, and `handleGeoKbV3Assemble` holds the generation-input binding
 * and the content-idempotent merge. Re-deriving either here would be a second
 * source of truth about what was paid for.
 *
 * Parameterised rather than hard-wired so the integration suite drives THIS
 * mapping -- HTTP status to ledger outcome is where a permanent refusal turns
 * into an infinite retry, and a test that reimplemented it would prove nothing
 * about what the route runs.
 */
export function createGeoRunKnowledgeSources(wiring: GeoRunKnowledgeWiring): GeoRunKnowledgeSources {
  return {
    readDraft: async ({ userId, kbId }) => {
      const read = await wiring.readDetails({ userId, kbId }).catch(() => ({ kind: "unavailable" as const }));
      if (read.kind === "missing") return { kind: "missing" };
      if (read.kind !== "ok") return { kind: "unavailable" };
      if (read.value.kbId !== kbId) return { kind: "unavailable" };
      const draft = read.value.draft;
      if (draft === null) return { kind: "missing" };
      // The knowledge step is v3-only: the locked `generationInputHash` a paid
      // record is bound to exists nowhere else, and the assemble route refuses
      // every other payload version anyway.
      if (!isGeoKbPayloadV3Value(draft.payload)) return { kind: "unsupported" };
      return {
        kind: "ok",
        draftVersion: draft.draftVersion,
        draftHash: draft.contentHash,
        generationInputHash: draft.payload.runRef.generationInputHash,
      };
    },
    readGeneration: async ({ userId, kbId, idempotencyKey }) => {
      const response = await handleGeoKbGenerationRead(
        internalRequest("v2/generation", { kbId, kind: "knowledge_pack", idempotencyKey }),
        wiring.generation(userId),
      );
      if (response.status === 404) return { kind: "none" };
      if (response.status !== 200) return { kind: "unavailable" };
      return generationRead(await responseBody(response));
    },
    dispatchGeneration: async ({ userId, kbId, idempotencyKey, baseVersion, draftHash }) => {
      const response = await handleGeoKbGeneration(
        internalRequest("v2/knowledge", {
          kbId,
          baseVersion,
          draftHash,
          idempotencyKey,
          // Not read anywhere on the v3 preparer path; the generation request
          // schema requires it and the knowledge narrative takes its language
          // from the draft's own market instead.
          displayLocale: "en",
          sourceReceiptRefs: [],
        }),
        "knowledge_pack",
        wiring.generation(userId),
      );
      return geoRunDispatchOutcome(response.status, await responseBody(response));
    },
    assemble: async ({ userId, kbId, baseVersion, draftHash }) => {
      const response = await handleGeoKbV3Assemble(
        internalRequest("v3/assemble", { kbId, baseVersion, draftHash }),
        wiring.assemble(userId),
      );
      return geoRunAssembleOutcome(response.status, await responseBody(response));
    },
  };
}

/** The production wiring: the owner-scoped stores the routes already use. */
export const DEFAULT_GEO_RUN_KNOWLEDGE_SOURCES: GeoRunKnowledgeSources = createGeoRunKnowledgeSources({
  readDetails: async (input) => await readVersionedGeoKnowledgeBase(input),
  generation: generationDependencies,
  assemble: assembleDependencies,
});

export interface GeoKbRunRuntimeDependencies {
  readonly authenticate: typeof getServerAuthenticatedUser;
  readonly store: GeoRunLedgerStore;
  readonly abandon: typeof abandonGeoKbRun;
  /**
   * What this run should hold, derived from the owner's own saved draft.
   *
   * It answers with an outcome rather than a list because "there is nothing to
   * update" and "here is an update with no operations" are different things,
   * and only one of them may be reported to a caller as a finished run.
   */
  readonly seedOperations: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => Promise<GeoRunSeedOutcome>;
  readonly executor: GeoRunExecutor;
  readonly now: () => Date;
}

const COLLECT = createGeoRunCollectRuntime(DEFAULT_GEO_RUN_COLLECT_SOURCES);
const KNOWLEDGE = createGeoRunKnowledgeExecutor(DEFAULT_GEO_RUN_KNOWLEDGE_SOURCES);

const DEFAULT: GeoKbRunRuntimeDependencies = {
  authenticate: getServerAuthenticatedUser,
  store: DEFAULT_GEO_RUN_LEDGER_STORE,
  abandon: abandonGeoKbRun,
  seedOperations: COLLECT.seedOperations,
  executor: createGeoRunUpdateExecutor({ fetch: COLLECT.executor, model: KNOWLEDGE }),
  now: () => new Date(),
};

export function createGeoKbRunRuntime(
  overrides: Partial<GeoKbRunRuntimeDependencies> = {},
): GeoKbRunHandlerDependencies {
  const dependencies = { ...DEFAULT, ...overrides };
  return {
    authenticate: dependencies.authenticate,
    store: dependencies.store,
    now: dependencies.now,
    abandon: async (input) => await dependencies.abandon(input),
    plan: async (input) => {
      // A producer that throws is an outage, not an empty plan. Letting the
      // rejection through would reach the route's own catch and become the same
      // 503, but saying so here keeps "nothing to do" a decision rather than an
      // accident of where an error was caught.
      const outcome = await dependencies
        .seedOperations(input)
        .catch(() => ({ kind: "unavailable" as const }));
      if (outcome.kind !== "ready") return { kind: outcome.kind };
      return { kind: "ready", seed: outcome.seed, executor: dependencies.executor };
    },
  };
}

export const DEFAULT_GEO_KB_RUN_DEPENDENCIES: GeoKbRunHandlerDependencies = createGeoKbRunRuntime();
