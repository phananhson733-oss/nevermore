// @input -- an authenticated same-origin batch of owner review gestures for one v3 draft
// @output -- the saved review, its counts and the new draft version, or a refusal that names itself
// @pos -- free route: it makes no model call, spends no crawl budget and writes only `review`

/**
 * The route behind 接受 / 修正 / 排除 / 全部接受.
 *
 * It is deliberately not a draft-save route. The request carries gestures, not
 * a payload, so the two locked halves of a v3 draft -- what the run was asked
 * about and what it produced -- have no field in which a client could change
 * them. What the owner may change is applied to the payload the server already
 * holds, under compare-and-swap on the draft version, and the resulting payload
 * is re-parsed by the same contract that guards every other v3 boundary.
 *
 * Three refusals are distinct on purpose, because the remedy differs:
 *
 *   conflict          someone else advanced this draft. Reload; never overwrite.
 *   input_changed     a run relocked the generation input. The decisions on
 *                     screen were made against knowledge that is no longer the
 *                     knowledge, so they are not recorded.
 *   generation_running a run is writing this draft right now. Wait; the editor
 *                     holds its automatic writes and retries.
 */
import { z } from "zod";

import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { geoV3ReviewRequestSchema } from "../../components/tools/geo-kb-v3-wire.ts";
import { assertGeoItemKeyIntegrity } from "./kb-item-key.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoKbStoreResult } from "./kb-store.ts";
import type { VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import { isGeoKbPayloadV3Value } from "./kb-versioned-read.ts";
import { geoV3ItemContentHashes, geoV3RestatedItemKeys } from "./kb-v3-item-content.ts";
import {
  applyGeoV3ReviewActions,
  geoV3DecisionStates,
  geoV3ReviewCounts,
  materializeGeoV3Review,
} from "./kb-v3-review.ts";
import { geoV3ItemKeys, parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { geoV3Items } from "./kb-v3-contract.ts";
import type { GeoKbV3SaveOutcome } from "./kb-v3-store.ts";

export interface GeoKbV3ReviewDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly readDetails: (input: { readonly userId: string; readonly kbId: string }) => Promise<GeoKbStoreResult<Pick<VersionedGeoKbDetails, "kbId" | "draft">>>;
  readonly saveDraft: (input: { readonly userId: string; readonly kbId: string; readonly payload: GeoKbPayloadV3; readonly baseVersion: number }) => Promise<GeoKbV3SaveOutcome>;
  /**
   * A run is bound to the draft version it was dispatched with, and only the
   * server sees every tab. "unavailable" fails open for the same reason the v2
   * draft route does: the run keeps executing at the provider whether or not
   * this read can answer, and refusing would freeze every open review for the
   * length of the outage. Nothing about correctness rests here -- the version
   * check still refuses a stale write.
   */
  readonly generationRunning?: (userId: string, kbId: string) => Promise<boolean | "unavailable">;
  /** Autosave turns one gesture into one write per typing pause per open tab. */
  readonly consumeQuota?: (userId: string, kbId: string) => Promise<"allowed" | "limited" | "unavailable">;
  readonly now: () => Date;
}

async function authenticated(authenticate: () => Promise<ServerAuthenticatedUser>): Promise<{ readonly userId: string } | Response> {
  const identity = await authenticate().catch(() => ({ status: "unavailable" as const }));
  if (identity.status === "authenticated") return { userId: identity.userId };
  return privateError(identity.status === "unauthenticated" ? "auth_required" : "auth_unavailable", identity.status === "unauthenticated" ? 401 : 503);
}

/**
 * The v3 draft this knowledge base holds, or the reason there is none to review.
 * A v2 draft is not an error the owner can act on here -- it is a knowledge base
 * that has not been updated to v3 yet -- so it reads as "no v3 draft".
 */
function v3Draft(details: Pick<VersionedGeoKbDetails, "draft">): { readonly payload: GeoKbPayloadV3; readonly draftVersion: number; readonly contentHash: string } | null {
  const draft = details.draft;
  if (draft === null || !isGeoKbPayloadV3Value(draft.payload)) return null;
  return { payload: draft.payload, draftVersion: draft.draftVersion, contentHash: draft.contentHash };
}

export async function handleGeoKbV3Review(request: Request, dependencies: GeoKbV3ReviewDependencies): Promise<Response> {
  const identity = await authenticated(dependencies.authenticate);
  if (identity instanceof Response) return identity;
  // Bounded well below the draft ceiling: the largest legitimate body is one
  // "accept all" over every item key plus a handful of corrections.
  const json = await readAccountMutationJson(request, 131_072);
  if (!json.ok) return json.response;
  const parsed = geoV3ReviewRequestSchema.safeParse(json.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  const { kbId, baseVersion, expectedGenerationInputHash, actions } = parsed.data;
  const scope = { userId: identity.userId, kbId };

  if (dependencies.consumeQuota) {
    const quota = await dependencies.consumeQuota(scope.userId, scope.kbId).catch(() => "unavailable" as const);
    if (quota !== "allowed") return privateError(quota === "limited" ? "rate_limited" : "store_unavailable", quota === "limited" ? 429 : 503);
  }

  try {
    const loaded = await dependencies.readDetails(scope);
    if (loaded.kind !== "ok") return privateError(loaded.kind === "missing" ? "not_found" : "store_unavailable", loaded.kind === "missing" ? 404 : 503);
    if (loaded.value.kbId !== scope.kbId) return privateError("store_unavailable", 503);
    const draft = v3Draft(loaded.value);
    if (draft === null) return privateError("not_found", 404);
    if (draft.draftVersion !== baseVersion) return privateJson({ error: { code: "conflict" }, draftVersion: draft.draftVersion }, 409);
    /**
     * Two independent checks, both fail-closed. The stored hash is what the run
     * locked; the recomputed one proves the stored generation input still
     * digests to it, so a payload edited in transit cannot inherit an old
     * identity. And the client's expectation has to match both, or the review on
     * screen was made against a different set of inputs.
     */
    const lockedHash = draft.payload.runRef.generationInputHash;
    if (geoV2Digest(draft.payload.generationInput) !== lockedHash) return privateError("input_changed", 409);
    if (expectedGenerationInputHash !== lockedHash) return privateError("input_changed", 409);

    if (dependencies.generationRunning) {
      const running = await dependencies.generationRunning(scope.userId, scope.kbId).catch(() => "unavailable" as const);
      if (running === true) return privateError("generation_running", 409);
    }

    const items = geoV3Items(draft.payload.knowledge);
    // The stored keys are re-derived rather than trusted: a decision is filed
    // under an item key, so a key that is not the digest of its own item would
    // silently point one owner's exclusion at different content.
    assertGeoItemKeyIntegrity(items);
    const itemKeys = geoV3ItemKeys(draft.payload.knowledge);
    const before = geoV3DecisionStates(draft.payload.review, itemKeys);
    const after = applyGeoV3ReviewActions(before, actions);
    const review = materializeGeoV3Review(draft.payload.review, after, {
      contentHash: geoV3ItemContentHashes(draft.payload.knowledge),
      decidedAt: dependencies.now().toISOString(),
      baseDraftVersion: String(draft.draftVersion),
    });

    let payload: GeoKbPayloadV3;
    try {
      // Only `review` moves. Re-parsing the whole payload is what proves it:
      // the contract checks the override targets, the byte budgets and the item
      // keys again, on the object that is about to be stored.
      payload = parseGeoKbPayloadV3({ ...draft.payload, review });
    } catch { return privateError("invalid_review", 422); }
    if (geoV2Digest(payload.generationInput) !== lockedHash) return privateError("input_changed", 409);

    const counts = geoV3ReviewCounts(after);
    // Nothing changed -- a repeated gesture, or an "accept all" over a module
    // whose items were all decided. Writing anyway would advance the version for
    // no reason and invalidate a version the owner is about to publish.
    if (geoV2Digest(payload) === draft.contentHash) {
      return privateJson({ data: {
        draftVersion: draft.draftVersion, contentHash: draft.contentHash,
        updatedAt: dependencies.now().toISOString(), review: payload.review, counts,
        restated: geoV3RestatedItemKeys(payload.knowledge, payload.review),
      } });
    }

    const saved = await dependencies.saveDraft({ ...scope, payload, baseVersion });
    if (saved.kind === "input_locked") return privateError("input_changed", 409);
    if (saved.kind === "missing") return privateError("not_found", 404);
    // Null, not -1. The store answers `null` when the database handed back no
    // usable version, and a sentinel in a field named `draftVersion` reads as
    // a version. `kb-v3-draft-create.ts` passes the same null on.
    if (saved.kind === "conflict") return privateJson({ error: { code: "conflict" }, draftVersion: saved.currentDraftVersion }, 409);
    if (saved.kind === "invalid") return privateError("invalid_review", 422);
    if (saved.kind !== "ok") return privateError("store_unavailable", 503);
    return privateJson({ data: {
      draftVersion: saved.value.draftVersion, contentHash: saved.value.contentHash,
      updatedAt: saved.value.updatedAt, review: payload.review, counts,
      restated: geoV3RestatedItemKeys(payload.knowledge, payload.review),
    } });
  } catch { return privateError("store_unavailable", 503); }
}

/** Exported for the route wiring only; the schema itself lives with the wire. */
export const geoKbV3ReviewRequestSchema: typeof geoV3ReviewRequestSchema = geoV3ReviewRequestSchema;
export type GeoKbV3ReviewRequest = z.infer<typeof geoV3ReviewRequestSchema>;
