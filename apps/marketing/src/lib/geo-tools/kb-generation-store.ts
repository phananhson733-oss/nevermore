// @input -- authenticated owner, immutable input identity and internal lease capability
// @output -- validated durable generation records; no provider calls or secret output
// @pos -- service-role-only SQL transport for the semantic generation state machine
import { z } from "zod";
import { createAdminSupabaseClient } from "../supabase/admin.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import { parseAnyGeoPreparedCandidate } from "./kb-prepared-contract.ts";
import { parseGeoRoleProposal } from "./kb-role-proposal.ts";
import { parseGeoKnowledgeGenerationResultV1 } from "./kb-knowledge-generation-contract.ts";
import { GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA, parseGeoKnowledgeGenerationResultV2 } from "./kb-knowledge-synthesis-v2-contract.ts";
import { GEO_GENERATION_RESULT_BYTES, geoGenerationInputHash, type GeoKbGenerationDependencies, type GeoKbGenerationRecord, type GeoKbGenerationKind, type GeoGenerationValue } from "./kb-generation.ts";

export interface GeoKbRpcTransport {
  readonly callRpc: (name: string, params: Record<string, unknown>) => Promise<{ readonly data: unknown; readonly error: unknown }>;
}
export const DEFAULT_GEO_KB_RPC_TRANSPORT: GeoKbRpcTransport = {
  callRpc: async (name, params) => await createAdminSupabaseClient().rpc(name, params),
};
const uuid = z.string().uuid();
const generationKind = z.enum(["roles", "questions", "knowledge_pack"]);
const count = z.number().int().nonnegative().refine(Number.isSafeInteger).nullable();
const attemptSchema = z.object({ attemptedCalls: z.union([z.literal(0), z.literal(1)]), delivery: z.enum(["not_attempted", "response_received", "outcome_unknown"]), modelRequested: z.string().min(1).max(200).nullable(), inputTokens: count, outputTokens: count, requestCount: count }).strict().refine(value => (value.attemptedCalls === 0) === (value.delivery === "not_attempted"));
const recordSchema = z.object({ generationId: uuid, userId: uuid, kbId: uuid, kind: generationKind, inputHash: z.string().regex(/^[a-f0-9]{64}$/u), state: z.enum(["claimed", "dispatched", "succeeded", "failed", "uncertain"]), result: z.unknown(), errorReason: z.enum(["rate_limited", "quota_unavailable", "invalid_output", "provider_rejected", "outcome_unknown", "input_stale", "model_unavailable"]).nullable(), attempt: attemptSchema.nullable() }).strict();
function resultSchemaVersion(value: unknown): string {
  return z.object({ schemaVersion: z.string() }).passthrough().parse(value).schemaVersion;
}
/**
 * A knowledge_pack result comes in two shapes, and which one it is is decided by
 * the record itself rather than by the caller. V1 binds a run to a `profileCopy`
 * hash; V2 binds it to `generationInputHash`, which is the only binding a V3
 * draft has -- it carries no profileCopy at all. Parsing every knowledge result
 * as V1, which this store used to do, made every V3 knowledge generation
 * unstorable: `finish` threw on the way in, the paid narrative was reported as
 * `store_unavailable` and thrown away, and the draft never gained a knowledge
 * body. The database has accepted both versions since 20260907143000.
 */
function parseSucceededResult(kind: GeoKbGenerationKind, value: unknown) {
  if (kind === "roles") return parseGeoRoleProposal(value);
  if (kind === "questions") return parseAnyGeoPreparedCandidate(value);
  return resultSchemaVersion(value) === GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA
    ? parseGeoKnowledgeGenerationResultV2(value)
    : parseGeoKnowledgeGenerationResultV1(value);
}
function succeededResultKind(value: unknown): GeoKbGenerationKind {
  const schemaVersion = resultSchemaVersion(value);
  if (schemaVersion === "marketing-geo-role-proposal.v1") return "roles";
  if (schemaVersion === "marketing-geo-prepared-candidate.v1" || schemaVersion === "marketing-geo-prepared-candidate.v2") return "questions";
  if (schemaVersion === "marketing-geo-knowledge-generation-result.v1" || schemaVersion === GEO_KNOWLEDGE_GENERATION_RESULT_V2_SCHEMA) return "knowledge_pack";
  throw new Error("Unknown generation result schema");
}
function assertResultScope(result: { readonly kbId: string; readonly generationId?: string }, scope: { readonly kbId: string; readonly generationId: string }): void {
  if (result.kbId !== scope.kbId || result.generationId !== undefined && result.generationId !== scope.generationId) throw new Error("Generation result scope mismatch");
}
export function parseGeoKbGenerationRecord(value: unknown): GeoKbGenerationRecord {
  const parsed = recordSchema.parse(value);
  if (parsed.result === undefined) throw new Error("Generation result must be explicit");
  if (parsed.state === "claimed" || parsed.state === "dispatched") {
    if (parsed.result !== null || parsed.errorReason !== null || parsed.attempt !== null) throw new Error("Active generation has terminal data");
  } else if (parsed.state === "succeeded") {
    if (parsed.result === null || parsed.errorReason !== null || parsed.attempt?.delivery !== "response_received") throw new Error("Invalid successful generation");
    if (geoV2JsonbBytes(parsed.result) > GEO_GENERATION_RESULT_BYTES) throw new Error("Generation result exceeds byte limit");
    const result = parseSucceededResult(parsed.kind, parsed.result);
    if (result.kbId !== parsed.kbId || ("generationId" in result && result.generationId !== parsed.generationId)) throw new Error("Generation result scope mismatch");
    if (parsed.kind === "knowledge_pack") {
      // Read off the parsed result, not off the raw JSON, and version-agnostic:
      // both manifests are hashed the same way, and the V1 type would silently
      // narrow a V2 manifest to the wrong shape.
      const manifest = (result as { readonly manifest: unknown }).manifest;
      const durableInput = JSON.parse(canonicalGeoV2Text(manifest)) as Readonly<Record<string, GeoGenerationValue>>;
      if (geoGenerationInputHash("knowledge_pack", durableInput) !== parsed.inputHash) throw new Error("Knowledge generation input hash mismatch");
    }
  } else if (parsed.result !== null || parsed.errorReason === null || (parsed.state === "uncertain" && (parsed.errorReason !== "outcome_unknown" || parsed.attempt?.delivery !== "outcome_unknown"))) throw new Error("Invalid failed generation");
  return parsed as GeoKbGenerationRecord;
}
const one = (value: unknown): Record<string, unknown> => {
  if (!Array.isArray(value) || value.length !== 1 || value[0] === null || typeof value[0] !== "object") throw new Error("Invalid generation RPC envelope");
  return value[0] as Record<string, unknown>;
};
function owned(value: unknown, scope: { readonly userId: string; readonly kbId: string; readonly generationId?: string }): GeoKbGenerationRecord {
  const record = parseGeoKbGenerationRecord(value);
  if (record.userId !== scope.userId || record.kbId !== scope.kbId || (scope.generationId !== undefined && record.generationId !== scope.generationId)) throw new Error("Foreign generation record");
  return record;
}
export type GeoKbGenerationRead = { readonly kind: "ok"; readonly generation: GeoKbGenerationRecord | null } | { readonly kind: "unavailable" };
export type GeoKbGenerationStore = Pick<GeoKbGenerationDependencies, "claim" | "markDispatched" | "finish"> & {
  readonly read: (input: { readonly userId: string; readonly kbId: string; readonly generationId: string }) => Promise<GeoKbGenerationRead>;
  readonly readLatest: (input: { readonly userId: string; readonly kbId: string; readonly kind: GeoKbGenerationKind }) => Promise<GeoKbGenerationRead>;
  readonly readByKey: (input: { readonly userId: string; readonly kbId: string; readonly kind: GeoKbGenerationKind; readonly idempotencyKey: string }) => Promise<GeoKbGenerationRead>;
};
export function createGeoKbGenerationStore(transport: GeoKbRpcTransport = DEFAULT_GEO_KB_RPC_TRANSPORT): GeoKbGenerationStore {
  const read = async (input: { readonly userId: string; readonly kbId: string; readonly generationId?: string; readonly kind?: GeoKbGenerationKind }): Promise<GeoKbGenerationRead> => {
    try {
      uuid.parse(input.userId); uuid.parse(input.kbId); if (input.generationId !== undefined) uuid.parse(input.generationId);
      if (input.kind !== undefined) generationKind.parse(input.kind);
      const result = await transport.callRpc("marketing_geo_read_generation", { p_user_id: input.userId, p_kb_id: input.kbId, p_generation_id: input.generationId ?? null, p_kind: input.kind ?? null });
      if (result.error) return { kind: "unavailable" };
      const row = one(result.data);
      if (row.outcome === "not_found") return { kind: "ok", generation: null };
      if (row.outcome !== "found") return { kind: "unavailable" };
      const generation = owned(row.generation, input);
      if (input.kind !== undefined && generation.kind !== input.kind) return { kind: "unavailable" };
      return { kind: "ok", generation };
    } catch { return { kind: "unavailable" }; }
  };
  return {
    claim: async input => {
      try {
        uuid.parse(input.userId); uuid.parse(input.kbId);
        generationKind.parse(input.kind);
        if (geoV2JsonbBytes(input.input) > 196_608 || geoGenerationInputHash(input.kind, input.input) !== input.inputHash) return { kind: "conflict" };
        const result = await transport.callRpc("marketing_geo_claim_generation", { p_user_id: input.userId, p_kb_id: input.kbId, p_kind: input.kind, p_idempotency_key: input.idempotencyKey, p_input_hash: input.inputHash, p_input: input.input });
        if (result.error) return { kind: "unavailable" };
        const row = one(result.data);
        if (row.outcome === "conflict" || row.outcome === "input_stale" || row.outcome === "not_found") return { kind: "conflict" };
        const generation = owned(row.generation, input);
        if (generation.kind !== input.kind || generation.inputHash !== input.inputHash) return { kind: "unavailable" };
        if (row.outcome === "existing") return { kind: "existing", generation };
        if (row.outcome !== "claimed" || generation.state !== "claimed") return { kind: "unavailable" };
        return { kind: "claimed", generation, claimToken: uuid.parse(row.claim_token) };
      } catch { return { kind: "unavailable" }; }
    },
    markDispatched: async scope => {
      try {
        for (const id of [scope.userId, scope.kbId, scope.generationId, scope.claimToken]) uuid.parse(id);
        const result = await transport.callRpc("marketing_geo_dispatch_generation", { p_user_id: scope.userId, p_kb_id: scope.kbId, p_generation_id: scope.generationId, p_claim_token: scope.claimToken });
        if (result.error) return { kind: "unavailable" };
        const row = one(result.data), generation = owned(row.generation, scope);
        if (row.outcome !== "dispatched" && row.outcome !== "existing") return { kind: "unavailable" };
        if (row.outcome === "dispatched" && generation.state !== "dispatched") return { kind: "unavailable" };
        return { kind: row.outcome, generation };
      } catch { return { kind: "unavailable" }; }
    },
    finish: async (scope, outcome) => {
      try {
        for (const id of [scope.userId, scope.kbId, scope.generationId, scope.claimToken]) uuid.parse(id);
        if (outcome.attempt !== null) attemptSchema.parse(outcome.attempt);
        let expectedKind: GeoKbGenerationKind | null = null;
        if (outcome.state === "succeeded") {
          if (geoV2JsonbBytes(outcome.result) > GEO_GENERATION_RESULT_BYTES) return { kind: "unavailable" };
          expectedKind = succeededResultKind(outcome.result);
          const parsed = parseSucceededResult(expectedKind, outcome.result);
          assertResultScope(parsed, scope);
        }
        const result = await transport.callRpc("marketing_geo_finish_generation", { p_user_id: scope.userId, p_kb_id: scope.kbId, p_generation_id: scope.generationId, p_claim_token: scope.claimToken, p_state: outcome.state, p_result: outcome.result, p_error_reason: outcome.errorReason, p_attempt: outcome.attempt });
        if (result.error) return { kind: "unavailable" };
        const row = one(result.data);
        if (row.outcome !== "finished" && row.outcome !== "existing") return { kind: "unavailable" };
        const generation = owned(row.generation, scope);
        if (expectedKind !== null && generation.kind !== expectedKind) return { kind: "unavailable" };
        return { kind: "ok", generation };
      } catch { return { kind: "unavailable" }; }
    },
    read, readLatest: read,
    // Recovery never starts work. SQL may settle an expired dispatched lease
    // to uncertain; no quota/claim/provider capability is issued by this call.
    readByKey: async input => {
      try {
        uuid.parse(input.userId); uuid.parse(input.kbId);
        generationKind.parse(input.kind);
        z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u).parse(input.idempotencyKey);
        const result = await transport.callRpc("marketing_geo_read_generation_by_key", { p_user_id: input.userId, p_kb_id: input.kbId, p_kind: input.kind, p_idempotency_key: input.idempotencyKey });
        if (result.error) return { kind: "unavailable" };
        const row = one(result.data);
        if (row.outcome === "not_found") return { kind: "ok", generation: null };
        if (row.outcome !== "found") return { kind: "unavailable" };
        const generation = owned(row.generation, input);
        return generation.kind === input.kind ? { kind: "ok", generation } : { kind: "unavailable" };
      } catch { return { kind: "unavailable" }; }
    },
  };
}
export const DEFAULT_GEO_KB_GENERATION_STORE = createGeoKbGenerationStore();
