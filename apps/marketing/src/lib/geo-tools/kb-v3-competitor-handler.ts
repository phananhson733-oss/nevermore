// @input -- an authenticated same-origin request naming one rival in one v3 draft: look it up, confirm it, or withdraw that
// @output -- the rival's observed identity, or the re-locked draft the gesture left behind; every refusal names itself
// @pos -- free route: no model call; `identify` may spend one crawl admission on a host the owner's own draft names

/**
 * The route behind the competitor rows on the review card.
 *
 * Two shapes of request, one boundary. `identify` reads and writes nothing;
 * it answers what a rival's homepage calls it so the owner has a name to
 * confirm. `confirm` and `unconfirm` are the only gestures in the product that
 * change the locked half of a draft outside a re-lock, and they change exactly
 * one row of it -- `applyGeoKbV3CompetitorGesture` decides the payload, this
 * file decides who may ask and against which version.
 *
 * Refusals, each with a different remedy:
 *
 *   conflict            someone else advanced this draft. Reload.
 *   input_changed       the row on screen was drawn under a locked input the
 *                       draft no longer carries. Reload.
 *   generation_running  a paid generation bound to the current hash is in
 *                       flight; moving the hash under it would strand it. Wait.
 *   unknown_competitor  the domain is not a row of this draft. This is also
 *                       what keeps `identify` from being a crawl of anything.
 *   invalid_competitor  a confirmation the contract cannot hold: no name.
 */
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { geoV3CompetitorRequestSchema } from "../../components/tools/geo-kb-v3-wire.ts";
import type { GeoKbStoreResult } from "./kb-store.ts";
import type { VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import { isGeoKbPayloadV3Value } from "./kb-versioned-read.ts";
import type { GeoKbV3CompetitorIdentity } from "./kb-v3-competitor-identity.ts";
import { applyGeoKbV3CompetitorGesture } from "./kb-v3-competitors.ts";
import type { GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import type { GeoKbV3SaveOutcome } from "./kb-v3-store.ts";

export interface GeoKbV3CompetitorDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly readDetails: (input: { readonly userId: string; readonly kbId: string }) => Promise<GeoKbStoreResult<Pick<VersionedGeoKbDetails, "kbId" | "draft">>>;
  readonly saveDraft: (input: { readonly userId: string; readonly kbId: string; readonly payload: GeoKbPayloadV3; readonly baseVersion: number }) => Promise<GeoKbV3SaveOutcome>;
  /** The lookup, built for the owner that asked so the crawl admission is theirs. */
  readonly identify: (input: { readonly userId: string; readonly domain: string }) => Promise<GeoKbV3CompetitorIdentity>;
  /** Fails open on "unavailable" for the reason the review route does: the version check still refuses a stale write. */
  readonly generationRunning?: (userId: string, kbId: string) => Promise<boolean | "unavailable">;
  readonly consumeQuota?: (userId: string, kbId: string) => Promise<"allowed" | "limited" | "unavailable">;
  readonly now: () => Date;
}

/** Bounded well above the largest body: a name, two dozen aliases and three ids. */
const REQUEST_BYTES = 8_192;

async function authenticated(authenticate: () => Promise<ServerAuthenticatedUser>): Promise<{ readonly userId: string } | Response> {
  const identity = await authenticate().catch(() => ({ status: "unavailable" as const }));
  if (identity.status === "authenticated") return { userId: identity.userId };
  return privateError(identity.status === "unauthenticated" ? "auth_required" : "auth_unavailable", identity.status === "unauthenticated" ? 401 : 503);
}

function v3Draft(details: Pick<VersionedGeoKbDetails, "draft">): { readonly payload: GeoKbPayloadV3; readonly draftVersion: number; readonly contentHash: string } | null {
  const draft = details.draft;
  if (draft === null || !isGeoKbPayloadV3Value(draft.payload)) return null;
  return { payload: draft.payload, draftVersion: draft.draftVersion, contentHash: draft.contentHash };
}

/** Exact spelling, and only a row that has a page to read. */
function namesDomain(payload: GeoKbPayloadV3, domain: string): boolean {
  return payload.generationInput.competitors.some((row) => row.domain !== "" && row.domain === domain);
}

export async function handleGeoKbV3Competitors(request: Request, dependencies: GeoKbV3CompetitorDependencies): Promise<Response> {
  const identity = await authenticated(dependencies.authenticate);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, REQUEST_BYTES);
  if (!json.ok) return json.response;
  const parsed = geoV3CompetitorRequestSchema.safeParse(json.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  const asked = parsed.data;
  const scope = { userId: identity.userId, kbId: asked.kbId };

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
    if (!namesDomain(draft.payload, asked.domain)) return privateError("unknown_competitor", 422);

    if (asked.intent === "identify") {
      const found = await dependencies.identify({ userId: scope.userId, domain: asked.domain });
      return privateJson({ data: { kbId: scope.kbId, identity: found } });
    }

    if (draft.draftVersion !== asked.baseVersion) return privateJson({ error: { code: "conflict" }, draftVersion: draft.draftVersion }, 409);
    if (asked.expectedGenerationInputHash !== draft.payload.runRef.generationInputHash) return privateError("input_changed", 409);

    if (dependencies.generationRunning) {
      const running = await dependencies.generationRunning(scope.userId, scope.kbId).catch(() => "unavailable" as const);
      if (running === true) return privateError("generation_running", 409);
    }

    const outcome = applyGeoKbV3CompetitorGesture(
      draft.payload,
      asked.intent === "confirm"
        ? { kind: "confirm", domain: asked.domain, brandName: asked.brandName, aliases: asked.aliases ?? [] }
        : { kind: "unconfirm", domain: asked.domain },
    );
    if (outcome.kind === "unknown_competitor") return privateError("unknown_competitor", 422);
    if (outcome.kind === "invalid") return privateError("invalid_competitor", 422);

    const answer = (draftVersion: number, contentHash: string, updatedAt: string) => privateJson({ data: {
      kbId: scope.kbId,
      draftVersion,
      contentHash,
      updatedAt,
      generationInputHash: outcome.payload.runRef.generationInputHash,
      competitors: outcome.payload.generationInput.competitors,
      released: outcome.released,
      changed: outcome.changed,
    } });
    // A repeated gesture writes nothing: the version does not move and no
    // record is released for a row that already said this.
    if (!outcome.changed) return answer(draft.draftVersion, draft.contentHash, dependencies.now().toISOString());

    const saved = await dependencies.saveDraft({ ...scope, payload: outcome.payload, baseVersion: asked.baseVersion });
    if (saved.kind === "input_locked") return privateError("input_changed", 409);
    if (saved.kind === "missing") return privateError("not_found", 404);
    if (saved.kind === "conflict") return privateJson({ error: { code: "conflict" }, draftVersion: saved.currentDraftVersion }, 409);
    if (saved.kind === "invalid") return privateError("invalid_competitor", 422);
    if (saved.kind !== "ok") return privateError("store_unavailable", 503);
    return answer(saved.value.draftVersion, saved.value.contentHash, saved.value.updatedAt);
  } catch { return privateError("store_unavailable", 503); }
}
