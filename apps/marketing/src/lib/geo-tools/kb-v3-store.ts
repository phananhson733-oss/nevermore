// @input -- owner-scoped v3 drafts, candidates and the generation records a publish may reuse
// @output -- CAS draft saves, the v3 publish RPC, and a narrow read of one generation record
// @pos -- service-role transport only; every write goes through a SECURITY DEFINER function
import { z } from "zod";

import { DEFAULT_GEO_KB_RPC_TRANSPORT, type GeoKbRpcTransport } from "./kb-generation-store.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoKbDraftSummary, GeoKbStoreResult } from "./kb-store.ts";
import { GEO_KB_SCHEMA_VERSION_V3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import type { GeoPreparedCandidateV3 } from "./kb-prepared-v3-contract.ts";

// Not `z.uuid()`: the identities in this product are UUIDv8, and a
// version-pinning validator rejects every one of them.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const unavailable = (): GeoKbStoreResult<never> => ({ kind: "unavailable", reason: "store_unavailable" });

function rpcRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || value[0] === null || typeof value[0] !== "object") throw new Error("Invalid v3 RPC response");
  return value[0] as Record<string, unknown>;
}

/**
 * Why `generation_input_locked` is its own outcome rather than an invalid save.
 *
 * The database refuses a save that moves `runRef.generationInputHash` once a run
 * exists, because a review decision recorded under a different generation input
 * is a decision about something the owner never saw. That is not a malformed
 * payload and it is not a version conflict; it is "the paid inputs moved, pay
 * for an update or reload", and the editor has to say so in those terms.
 */
export type GeoKbV3SaveOutcome = GeoKbStoreResult<GeoKbDraftSummary> | { readonly kind: "input_locked" };

export async function saveGeoKbDraftV3(
  input: { readonly userId: string; readonly kbId: string; readonly payload: GeoKbPayloadV3; readonly baseVersion: number },
  transport: GeoKbRpcTransport = DEFAULT_GEO_KB_RPC_TRANSPORT,
): Promise<GeoKbV3SaveOutcome> {
  try {
    uuid.parse(input.userId); uuid.parse(input.kbId);
    z.number().int().nonnegative().refine(Number.isSafeInteger).parse(input.baseVersion);
    const contentHash = geoV2Digest(input.payload);
    const result = await transport.callRpc("marketing_geo_save_kb_draft", {
      p_user_id: input.userId, p_kb_id: input.kbId, p_schema_version: GEO_KB_SCHEMA_VERSION_V3,
      p_payload: input.payload, p_content_hash: contentHash, p_base_version: input.baseVersion,
    });
    if (result.error) return unavailable();
    const row = rpcRow(result.data);
    if (row.outcome === "not_found") return { kind: "missing" };
    if (row.outcome === "generation_input_locked") return { kind: "input_locked" };
    if (row.outcome === "conflict") {
      return { kind: "conflict", currentDraftVersion: typeof row.draft_version === "number" && Number.isSafeInteger(row.draft_version) ? row.draft_version : null };
    }
    // Every other refusal is the database telling us the payload it canonicalised
    // is not the payload we hashed, or a legacy guard we should never have hit.
    if (row.outcome !== "saved" || row.content_hash !== contentHash) return unavailable();
    const saved = z.object({
      draft_version: z.number().int().positive().refine(Number.isSafeInteger),
      updated_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
    }).parse(row);
    return { kind: "ok", value: { draftVersion: saved.draft_version, contentHash, updatedAt: new Date(saved.updated_at).toISOString() } };
  } catch { return unavailable(); }
}

export interface GeoKbV3PublishOutcome {
  readonly snapshotId: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly frozenAt: string;
  /** Publishing identical bytes returns the version that already holds them. */
  readonly reusedExisting: boolean;
}

/** `input_stale` is the candidate naming a generation input the draft has moved past. */
export type GeoKbV3PublishResult =
  | GeoKbStoreResult<GeoKbV3PublishOutcome>
  | { readonly kind: "input_stale" }
  | { readonly kind: "candidate_mismatch" };

export async function publishGeoKbV3(
  input: { readonly userId: string; readonly kbId: string; readonly candidate: GeoPreparedCandidateV3 },
  transport: GeoKbRpcTransport = DEFAULT_GEO_KB_RPC_TRANSPORT,
): Promise<GeoKbV3PublishResult> {
  try {
    uuid.parse(input.userId); uuid.parse(input.kbId);
    const result = await transport.callRpc("marketing_geo_publish_kb_v3", {
      p_user_id: input.userId, p_kb_id: input.kbId, p_candidate: input.candidate, p_candidate_hash: input.candidate.candidateHash,
    });
    if (result.error) return unavailable();
    const row = rpcRow(result.data);
    if (row.outcome === "not_found") return { kind: "missing" };
    if (row.outcome === "no_draft") return { kind: "invalid", code: "no_draft" };
    if (row.outcome === "input_stale") return { kind: "input_stale" };
    if (row.outcome === "candidate_mismatch") return { kind: "candidate_mismatch" };
    if (row.outcome !== "published") return unavailable();
    const published = z.object({
      snapshot_id: uuid,
      revision: z.number().int().positive().refine(Number.isSafeInteger),
      content_hash: hash,
      frozen_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
      reused_existing: z.boolean(),
    }).parse(row);
    if (published.content_hash !== input.candidate.baseDraftHash) return unavailable();
    return { kind: "ok", value: {
      snapshotId: published.snapshot_id, revision: published.revision, contentHash: published.content_hash,
      frozenAt: new Date(published.frozen_at).toISOString(), reusedExisting: published.reused_existing,
    } };
  } catch { return unavailable(); }
}

/**
 * The parts of one generation record a publish has to look at, read without
 * the v2 record parser.
 *
 * That parser resolves a `questions` result through the prepared-candidate
 * contracts, and a v3 question generation returns a bare question set instead
 * -- so running it here would report every real v3 record as unavailable. This
 * reads the same row through the same owner-scoped RPC and validates only what
 * publish uses: whose it is, whether it succeeded, and the input hash the
 * result is bound to. It grants no capability and starts no work.
 */
export interface GeoKbGenerationSummaryV3 {
  readonly generationId: string;
  readonly kind: "roles" | "questions" | "knowledge_pack";
  readonly state: "claimed" | "dispatched" | "succeeded" | "failed" | "uncertain";
  readonly result: unknown;
}

const summarySchema = z.object({
  generationId: uuid,
  userId: uuid,
  kbId: uuid,
  kind: z.enum(["roles", "questions", "knowledge_pack"]),
  state: z.enum(["claimed", "dispatched", "succeeded", "failed", "uncertain"]),
  result: z.unknown(),
}).passthrough();

export type GeoKbGenerationSummaryReadV3 =
  | { readonly kind: "ok"; readonly generation: GeoKbGenerationSummaryV3 }
  | { readonly kind: "missing" }
  | { readonly kind: "unavailable" };

export async function readGeoKbGenerationSummaryV3(
  input: { readonly userId: string; readonly kbId: string; readonly generationId: string },
  transport: GeoKbRpcTransport = DEFAULT_GEO_KB_RPC_TRANSPORT,
): Promise<GeoKbGenerationSummaryReadV3> {
  try {
    uuid.parse(input.userId); uuid.parse(input.kbId); uuid.parse(input.generationId);
    const result = await transport.callRpc("marketing_geo_read_generation", {
      p_user_id: input.userId, p_kb_id: input.kbId, p_generation_id: input.generationId, p_kind: null,
    });
    if (result.error) return { kind: "unavailable" };
    const row = rpcRow(result.data);
    if (row.outcome === "not_found") return { kind: "missing" };
    if (row.outcome !== "found") return { kind: "unavailable" };
    const parsed = summarySchema.parse(row.generation);
    if (parsed.userId.toLowerCase() !== input.userId.toLowerCase()
      || parsed.kbId.toLowerCase() !== input.kbId.toLowerCase()
      || parsed.generationId.toLowerCase() !== input.generationId.toLowerCase()) return { kind: "unavailable" };
    return { kind: "ok", generation: { generationId: parsed.generationId, kind: parsed.kind, state: parsed.state, result: parsed.result } };
  } catch { return { kind: "unavailable" }; }
}
