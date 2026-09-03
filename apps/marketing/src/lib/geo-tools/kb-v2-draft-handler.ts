// @input -- authenticated same-origin load/save requests, never caller identity
// @output -- complete editor data or a CAS-safe saved v2 draft response
// @pos -- bounded HTTP boundary; validation does not issue provider calls
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { normalizeAccountWebsiteUrl, parseWebsiteProfileReference, type WebsiteProfileReferenceV1 } from "../account-websites/contracts.ts";
import { parseGeoKbEditorViewV2, parseGeoKbDraftSaveV2, type GeoKbEditorViewV2 } from "../../components/tools/geo-kb-v2-wire.ts";
import type { GeoKbStoreOutcome } from "./kb-handler.ts";
import type { GeoKbStoreResult, GeoKbDraftSummary } from "./kb-store.ts";
import type { VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import type { GeoProfileCopy } from "./kb-profile-copy.ts";
import { parseGeoKbPayloadV2, type GeoKbPayloadV2, type AnyGeoKbPayload } from "./kb-v2-contract.ts";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { privateGeoEditorJson } from "./kb-editor-response.ts";
import { z } from "zod";
import { geoV2Digest } from "./kb-v2-digest.ts";

export interface GeoKbV2LoadDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly loadEditor: (input: { readonly userId: string; readonly url: string }) => Promise<GeoKbStoreOutcome<GeoKbEditorViewV2>>;
}
export interface GeoKbV2DraftDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly readDetails: (input: { readonly userId: string; readonly kbId: string }) => Promise<GeoKbStoreResult<Pick<VersionedGeoKbDetails, "kbId" | "origin" | "canonicalSiteKey" | "draft">>>;
  readonly validateCurrentCopy: (input: { readonly userId: string; readonly origin?: string; readonly copy: GeoProfileCopy; readonly expectedProfileReference?: WebsiteProfileReferenceV1 | null }) => Promise<"current" | "stale" | "unavailable">;
  readonly validateLineage: (input: { readonly userId: string; readonly kbId: string; readonly payload: GeoKbPayloadV2; readonly previousPayload: AnyGeoKbPayload | null }) => Promise<"valid" | "invalid" | "unavailable">;
  readonly saveDraft: (input: { readonly userId: string; readonly kbId: string; readonly payload: GeoKbPayloadV2; readonly baseVersion: number }) => Promise<GeoKbStoreResult<GeoKbDraftSummary>>;
  readonly blockers: (payload: GeoKbPayloadV2) => readonly string[];
  /**
   * Autosave turns this route from a click-bounded write into one per typing
   * pause per open tab. The bucket is sized for a person, not a loop.
   */
  readonly consumeQuota?: (userId: string, kbId: string) => Promise<"allowed" | "limited" | "unavailable">;
  /**
   * A running generation is bound to the draft version it was dispatched with.
   * Only the server sees every tab, so this is where a write under it is
   * refused. "unavailable" fails open, and deliberately: a run dispatched
   * before the outage keeps executing at the provider regardless of whether
   * this read can answer, so failing open can still waste one paid result. It
   * is the better trade because refusing would freeze every editor for the
   * duration of the outage, and because nothing about correctness rests here
   * -- the version check refuses a stale write, and a result that lands
   * against a moved version is already treated as stale downstream.
   */
  readonly generationRunning?: (userId: string, kbId: string) => Promise<boolean | "unavailable">;
}
async function authenticated(authenticate: () => Promise<ServerAuthenticatedUser>): Promise<{ readonly userId: string } | Response> {
  const identity = await authenticate().catch(() => ({ status: "unavailable" as const }));
  return identity.status === "authenticated" ? { userId: identity.userId } : privateError(identity.status === "unauthenticated" ? "auth_required" : "auth_unavailable", identity.status === "unauthenticated" ? 401 : 503);
}
const loadSchema = z.object({ url: z.string().max(2048) }).strict();
const saveSchema = z.object({ kbId: z.string().uuid(), baseVersion: z.number().int().nonnegative().refine(Number.isSafeInteger), payload: z.unknown(), expectedProfileReference: z.unknown().optional() }).strict();

export async function handleGeoKbV2Load(request: Request, dependencies: GeoKbV2LoadDependencies): Promise<Response> {
  const identity = await authenticated(dependencies.authenticate);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, 4096);
  if (!json.ok) return json.response;
  const parsed = loadSchema.safeParse(json.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  const site = normalizeAccountWebsiteUrl(parsed.data.url);
  if (site === null) return privateError("invalid_url", 400);
  try {
    const loaded = await dependencies.loadEditor({ userId: identity.userId, url: site.submittedUrl });
    if (loaded.kind !== "ok") return privateError(loaded.kind === "not_found" ? "not_found" : loaded.kind === "profile_copy_required" ? "profile_copy_required" : "store_unavailable", loaded.kind === "not_found" ? 404 : loaded.kind === "profile_copy_required" ? 409 : 503);
    const view = parseGeoKbEditorViewV2(loaded.value);
    if (view === null || view.host !== site.host) return privateError("store_unavailable", 503);
    return privateGeoEditorJson({ data: view });
  } catch { return privateError("store_unavailable", 503); }
}

export async function handleGeoKbV2Draft(request: Request, dependencies: GeoKbV2DraftDependencies): Promise<Response> {
  const identity = await authenticated(dependencies.authenticate);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, 397_312);
  if (!json.ok) return json.response;
  const parsed = saveSchema.safeParse(json.value);
  if (!parsed.success) return privateError("invalid_request", 400);
  let payload: GeoKbPayloadV2, expectedProfileReference: WebsiteProfileReferenceV1 | null | undefined;
  try {
    payload = parseGeoKbPayloadV2(parsed.data.payload);
    if (Object.hasOwn(parsed.data, "expectedProfileReference")) expectedProfileReference = parsed.data.expectedProfileReference === null ? null : parseWebsiteProfileReference(parsed.data.expectedProfileReference);
  } catch { return privateError("invalid_payload", 400); }
  const scope = { userId: identity.userId, kbId: parsed.data.kbId };
  if (dependencies.consumeQuota) {
    const quota = await dependencies.consumeQuota(scope.userId, scope.kbId).catch(() => "unavailable" as const);
    if (quota !== "allowed") return privateError(quota === "limited" ? "rate_limited" : "store_unavailable", quota === "limited" ? 429 : 503);
  }
  try {
    const loaded = await dependencies.readDetails(scope);
    if (loaded.kind !== "ok") return privateError(loaded.kind === "missing" ? "not_found" : "store_unavailable", loaded.kind === "missing" ? 404 : 503);
    const owned = loaded.value;
    if (owned.kbId !== scope.kbId) return privateError("store_unavailable", 503);
    if (normalizeAccountWebsiteUrl(payload.targetUrl)?.canonicalSiteKey !== owned.canonicalSiteKey) return privateError("invalid_payload", 400);
    const currentVersion = owned.draft?.draftVersion ?? 0;
    if (currentVersion !== parsed.data.baseVersion) return privateJson({ error: { code: "conflict" }, draftVersion: currentVersion }, 409);
    if (dependencies.generationRunning && await dependencies.generationRunning(scope.userId, scope.kbId).catch(() => "unavailable" as const) === true) return privateError("generation_running", 409);
    const current = await dependencies.validateCurrentCopy({ userId: scope.userId, origin: owned.origin, copy: payload.profileCopy, ...(expectedProfileReference === undefined ? {} : { expectedProfileReference }) });
    if (current !== "current") return privateError(current === "stale" ? "context_stale" : "store_unavailable", current === "stale" ? 409 : 503);
    const lineage = await dependencies.validateLineage({ ...scope, payload, previousPayload: owned.draft?.payload ?? null });
    if (lineage !== "valid") return privateError(lineage === "invalid" ? "invalid_input" : "store_unavailable", lineage === "invalid" ? 422 : 503);
    const saved = await dependencies.saveDraft({ ...scope, payload, baseVersion: parsed.data.baseVersion });
    if (saved.kind === "missing") return privateError("not_found", 404);
    if (saved.kind === "conflict") return privateJson({ error: { code: "conflict" }, draftVersion: saved.currentDraftVersion ?? -1 }, 409);
    if (saved.kind === "invalid") return privateError(saved.code === "context_stale" ? "context_stale" : "invalid_payload", saved.code === "context_stale" ? 409 : 400);
    if (saved.kind !== "ok" || saved.value.contentHash !== geoV2Digest(payload)) return privateError("store_unavailable", 503);
    const value = parseGeoKbDraftSaveV2({ ...saved.value, blockers: dependencies.blockers(payload) });
    return value === null ? privateError("store_unavailable", 503) : privateJson({ data: value });
  } catch { return privateError("store_unavailable", 503); }
}
