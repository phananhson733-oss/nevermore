// @input -- an authenticated same-origin request to publish one reviewed v3 draft
// @output -- the frozen version, the draft version it left behind, and what was accepted in bulk
// @pos -- free route: no model call, no crawl budget; it assembles what already exists

/**
 * 发布 costs nothing and produces nothing new.
 *
 * Everything a published version contains already exists: the knowledge a paid
 * run wrote, the review the owner made, and -- when there is one -- the question
 * set a paid run wrote separately. Publishing binds them together, and the only
 * thing it decides is what to do about items nobody looked at.
 *
 * Those become `accepted_in_bulk`, and they are written *back into the draft*
 * before the version is assembled. That ordering is the point: without it the
 * published version would carry decisions the draft does not have, and the next
 * time the card was opened it would offer to publish the same items again as if
 * nobody had ever decided anything. Writing back first also means publishing
 * twice is genuinely idempotent -- the second attempt finds nothing pending,
 * changes no bytes, and the database returns the version that already holds
 * them.
 *
 * What it may never do is upgrade a label. A publish-time sweep is the weakest
 * form of consent there is, and it is recorded as exactly that.
 */
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { geoV3PublishRequestSchema } from "../../components/tools/geo-kb-v3-wire.ts";
import { assertGeoItemKeyIntegrity } from "./kb-item-key.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoKbStoreResult } from "./kb-store.ts";
import { isGeoKbPayloadV3Value, type VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import { buildGeoKnowledgePackV3 } from "./kb-knowledge-pack-v3.ts";
import type { GeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import {
  assertGeoQuestionGenerationResultBinding,
  parseGeoQuestionGenerationResultV1,
  type GeoQuestionGenerationResultV1,
} from "./kb-question-generation-contract.ts";
import {
  createGeoPreparedCandidateV3,
  geoReviewHashV3,
  type GeoCandidateQuestionSetV3,
  type GeoSourceReceiptRefV3,
} from "./kb-prepared-v3-contract.ts";
import { buildGeoSnapshotContextV3, type GeoContextEvidenceRefV3 } from "./snapshot-context-v3.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import {
  applyGeoV3ReviewAction,
  geoV3DecisionStates,
  geoV3PendingKeys,
  geoV3ReviewCounts,
  materializeGeoV3Review,
} from "./kb-v3-review.ts";
import { geoV3Items, geoV3ItemKeys, parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import type { GeoKbGenerationSummaryReadV3, GeoKbV3PublishResult, GeoKbV3SaveOutcome } from "./kb-v3-store.ts";

export interface GeoKbV3PublishDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly readDetails: (input: { readonly userId: string; readonly kbId: string }) => Promise<GeoKbStoreResult<Pick<VersionedGeoKbDetails, "kbId" | "draft">>>;
  readonly saveDraft: (input: { readonly userId: string; readonly kbId: string; readonly payload: GeoKbPayloadV3; readonly baseVersion: number }) => Promise<GeoKbV3SaveOutcome>;
  readonly readGeneration: (input: { readonly userId: string; readonly kbId: string; readonly generationId: string }) => Promise<GeoKbGenerationSummaryReadV3>;
  readonly publish: (input: { readonly userId: string; readonly kbId: string; readonly candidate: ReturnType<typeof createGeoPreparedCandidateV3> }) => Promise<GeoKbV3PublishResult>;
  /**
   * The durable observations this version was built on.
   *
   * Deliberately injected and deliberately empty by default: in this slice
   * nothing links a v3 draft to rows of the observation ledger, and attaching
   * the most recent receipt for the knowledge base would name evidence this
   * version may not have been built from. The evidence itself is not lost --
   * every source, with its observation time and body hash, is in the published
   * payload's own catalogue. What an empty list says is only that this version
   * points at no ledger row, which is true.
   */
  readonly readEvidenceRefs?: (input: { readonly userId: string; readonly kbId: string; readonly payload: GeoKbPayloadV3 }) => Promise<{
    readonly evidenceRefs: readonly GeoContextEvidenceRefV3[];
    readonly sourceReceiptRefs: readonly GeoSourceReceiptRefV3[];
  }>;
  readonly generationRunning?: (userId: string, kbId: string) => Promise<boolean | "unavailable">;
  readonly consumeQuota?: (userId: string, kbId: string) => Promise<"allowed" | "limited" | "unavailable">;
  readonly newCandidateId: () => string;
  readonly now: () => Date;
}

async function authenticated(authenticate: () => Promise<ServerAuthenticatedUser>): Promise<{ readonly userId: string } | Response> {
  const identity = await authenticate().catch(() => ({ status: "unavailable" as const }));
  if (identity.status === "authenticated") return { userId: identity.userId };
  return privateError(identity.status === "unauthenticated" ? "auth_required" : "auth_unavailable", identity.status === "unauthenticated" ? 401 : 503);
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What a generation record contributes to a publish, or why it contributes
 * nothing. `Response` is a refusal that has to reach the caller: an outage and a
 * relocked input are not the same as "there is no question set".
 */
type QuestionSetOutcome =
  | { readonly slot: GeoCandidateQuestionSetV3; readonly value: GeoQuestionSetV2 | null }
  | Response;

async function resolveQuestionSet(
  dependencies: GeoKbV3PublishDependencies,
  scope: { readonly userId: string; readonly kbId: string },
  runRef: GeoKbPayloadV3["runRef"],
): Promise<QuestionSetOutcome> {
  const generationId = runRef.questionsGenerationId;
  // No question generation was ever recorded. `not_attempted` is the honest
  // reason; inventing a failure would claim a paid call nobody made.
  if (generationId === null) return { slot: { status: "unavailable", reason: "not_attempted", failedGenerationId: null }, value: null };
  const read = await dependencies.readGeneration({ ...scope, generationId });
  // The draft names a generation this owner does not have. That is a store
  // inconsistency, not a version without questions.
  if (read.kind !== "ok") return privateError("store_unavailable", 503);
  const generation = read.generation;
  if (generation.kind !== "questions") return privateError("store_unavailable", 503);
  if (generation.state === "claimed" || generation.state === "dispatched") return privateError("generation_running", 409);
  if (generation.state === "failed") return { slot: { status: "unavailable", reason: "generation_unavailable", failedGenerationId: generationId }, value: null };
  if (generation.state === "uncertain") return { slot: { status: "unavailable", reason: "outcome_unknown", failedGenerationId: generationId }, value: null };
  // A stored result that does not parse, or that names another owner's record,
  // is a store inconsistency: the shape is validated before any field of it is
  // used to decide anything.
  let result: GeoQuestionGenerationResultV1;
  try {
    result = parseGeoQuestionGenerationResultV1(generation.result);
    assertGeoQuestionGenerationResultBinding(result, { kbId: scope.kbId, generationId });
  } catch { return privateError("store_unavailable", 503); }
  // The record has to be bound to the same locked input as the draft. A
  // question set generated against other inputs is not this version's -- and
  // that is an actionable refusal, not a broken store, so it stays here rather
  // than inside the contract.
  if (result.generationInputHash !== runRef.generationInputHash) return privateError("input_changed", 409);
  return { slot: { status: "available", value: result.questionSet }, value: result.questionSet };
}

/**
 * The knowledge generation, when one was reused. Only the binding is checked
 * here -- the knowledge itself is already in the draft, and re-deriving it would
 * be a second source of truth.
 */
async function assertKnowledgeGeneration(
  dependencies: GeoKbV3PublishDependencies,
  scope: { readonly userId: string; readonly kbId: string },
  runRef: GeoKbPayloadV3["runRef"],
): Promise<Response | null> {
  const generationId = runRef.knowledgeGenerationId;
  if (generationId === null) return null;
  const read = await dependencies.readGeneration({ ...scope, generationId });
  if (read.kind !== "ok" || read.generation.kind !== "knowledge_pack") return privateError("store_unavailable", 503);
  const generation = read.generation;
  if (generation.state === "claimed" || generation.state === "dispatched") return privateError("generation_running", 409);
  // A failed knowledge step leaves the deterministic modules behind and nothing
  // to bind, which is a publishable state; there is simply no record to reuse.
  if (generation.state !== "succeeded") return null;
  const result = generation.result;
  if (!record(result) || !record(result.manifest)) return privateError("store_unavailable", 503);
  if (result.manifest.generationInputHash !== runRef.generationInputHash) return privateError("input_changed", 409);
  return null;
}

export async function handleGeoKbV3Publish(request: Request, dependencies: GeoKbV3PublishDependencies): Promise<Response> {
  const identity = await authenticated(dependencies.authenticate);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, 4_096);
  if (!json.ok) return json.response;
  const parsed = geoV3PublishRequestSchema.safeParse(json.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  const { kbId, baseVersion, draftHash } = parsed.data;
  const scope = { userId: identity.userId, kbId };

  if (dependencies.consumeQuota) {
    const quota = await dependencies.consumeQuota(scope.userId, scope.kbId).catch(() => "unavailable" as const);
    if (quota !== "allowed") return privateError(quota === "limited" ? "rate_limited" : "store_unavailable", quota === "limited" ? 429 : 503);
  }

  try {
    const loaded = await dependencies.readDetails(scope);
    if (loaded.kind !== "ok") return privateError(loaded.kind === "missing" ? "not_found" : "store_unavailable", loaded.kind === "missing" ? 404 : 503);
    if (loaded.value.kbId !== scope.kbId) return privateError("store_unavailable", 503);
    const draft = loaded.value.draft;
    if (draft === null || !isGeoKbPayloadV3Value(draft.payload)) return privateError("not_found", 404);
    const stored = draft.payload;
    if (draft.draftVersion !== baseVersion) return privateJson({ error: { code: "conflict" }, draftVersion: draft.draftVersion }, 409);
    if (draft.contentHash !== draftHash) return privateJson({ error: { code: "conflict" }, draftVersion: draft.draftVersion }, 409);

    const lockedHash = stored.runRef.generationInputHash;
    if (geoV2Digest(stored.generationInput) !== lockedHash) return privateError("input_changed", 409);

    if (dependencies.generationRunning) {
      const running = await dependencies.generationRunning(scope.userId, scope.kbId).catch(() => "unavailable" as const);
      if (running === true) return privateError("generation_running", 409);
    }

    const knowledgeRefusal = await assertKnowledgeGeneration(dependencies, scope, stored.runRef);
    if (knowledgeRefusal !== null) return knowledgeRefusal;
    const questions = await resolveQuestionSet(dependencies, scope, stored.runRef);
    if (questions instanceof Response) return questions;
    // Neither half exists: there is nothing a consumer could read, so this would
    // publish a version whose only content is the claim that a version exists.
    if (stored.knowledge === null && questions.slot.status === "unavailable") return privateError("nothing_to_publish", 422);

    assertGeoItemKeyIntegrity(geoV3Items(stored.knowledge));
    const itemKeys = geoV3ItemKeys(stored.knowledge);
    const states = geoV3DecisionStates(stored.review, itemKeys);
    const pending = geoV3PendingKeys(states);
    const now = dependencies.now().toISOString();
    const swept = pending.length === 0 ? states : applyGeoV3ReviewAction(states, { kind: "accept_all", itemKeys: pending });
    const review = materializeGeoV3Review(stored.review, swept, {
      contentHash: geoV3ItemContentHashes(stored.knowledge),
      decidedAt: now,
      baseDraftVersion: String(draft.draftVersion),
    });

    let payload: GeoKbPayloadV3;
    try { payload = parseGeoKbPayloadV3({ ...stored, review }); } catch { return privateError("publish_invalid", 422); }

    // The draft has to agree with what is about to be published, so the sweep is
    // saved first and the version that comes back is the one the candidate names.
    let draftVersion = draft.draftVersion, draftContentHash = draft.contentHash;
    if (geoV2Digest(payload) !== draft.contentHash) {
      const saved = await dependencies.saveDraft({ ...scope, payload, baseVersion });
      if (saved.kind === "input_locked") return privateError("input_changed", 409);
      if (saved.kind === "missing") return privateError("not_found", 404);
      // Null, not -1. The store answers `null` when the database handed back
      // no usable version, and a sentinel in a field named `draftVersion`
      // reads as a version. `kb-v3-draft-create.ts` passes the same null on.
      if (saved.kind === "conflict") return privateJson({ error: { code: "conflict" }, draftVersion: saved.currentDraftVersion }, 409);
      if (saved.kind !== "ok") return privateError("store_unavailable", 503);
      draftVersion = saved.value.draftVersion;
      draftContentHash = saved.value.contentHash;
    }

    const evidence = dependencies.readEvidenceRefs === undefined
      ? { evidenceRefs: [], sourceReceiptRefs: [] }
      : await dependencies.readEvidenceRefs({ ...scope, payload });

    let candidate: ReturnType<typeof createGeoPreparedCandidateV3>;
    try {
      const knowledgePack = payload.knowledge === null ? null : buildGeoKnowledgePackV3({
        generatedAt: now, payload, questionSet: questions.value, bulkAcceptedAt: now,
      });
      const context = buildGeoSnapshotContextV3({
        kbId: scope.kbId, payload, questionSet: questions.value, evidenceRefs: evidence.evidenceRefs,
      });
      candidate = createGeoPreparedCandidateV3({
        schemaVersion: "marketing-geo-prepared-candidate.v3",
        candidateId: dependencies.newCandidateId(),
        kbId: scope.kbId,
        baseDraftVersion: String(draftVersion),
        baseDraftHash: draftContentHash,
        payload,
        questionSet: questions.slot,
        context,
        knowledgePack,
        generationInputHash: lockedHash,
        reviewHash: geoReviewHashV3(payload),
        sourceReceiptRefs: [...evidence.sourceReceiptRefs],
      });
    } catch { return privateError("publish_invalid", 422); }

    const published = await dependencies.publish({ ...scope, candidate });
    if (published.kind === "input_stale") return privateError("input_changed", 409);
    if (published.kind === "candidate_mismatch") return privateError("publish_invalid", 422);
    if (published.kind === "missing") return privateError("not_found", 404);
    if (published.kind === "invalid") return privateError("not_found", 404);
    if (published.kind !== "ok") return privateError("store_unavailable", 503);

    const counts = geoV3ReviewCounts(swept);
    return privateJson({ data: {
      snapshotId: published.value.snapshotId,
      revision: published.value.revision,
      contentHash: published.value.contentHash,
      frozenAt: published.value.frozenAt,
      reusedExisting: published.value.reusedExisting,
      draftVersion,
      draftHash: draftContentHash,
      bulkAccepted: pending.length,
      counts,
      questionSet: questions.slot.status === "available" ? { status: "available" } : { status: "unavailable", reason: questions.slot.reason },
    } });
  } catch { return privateError("store_unavailable", 503); }
}
