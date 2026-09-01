// @input -- authenticated owner, immutable input identity and internal lease capability
// @output -- validated durable generation records; no provider calls or secret output
// @pos -- service-role-only SQL transport for the semantic generation state machine
import { z } from "zod";
import { createAdminSupabaseClient } from "../supabase/admin.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";
import { parseGeoPreparedCandidate } from "./kb-prepared-contract.ts";
import { parseGeoRoleProposal } from "./kb-role-proposal.ts";
import { geoGenerationInputHash, type GeoKbGenerationDependencies, type GeoKbGenerationRecord, type GeoKbGenerationKind } from "./kb-generation.ts";

export interface GeoKbRpcTransport {
  readonly callRpc: (name: string, params: Record<string, unknown>) => Promise<{ readonly data: unknown; readonly error: unknown }>;
}
export const DEFAULT_GEO_KB_RPC_TRANSPORT: GeoKbRpcTransport = {
  callRpc: async (name, params) => await createAdminSupabaseClient().rpc(name, params),
};
const uuid = z.string().uuid();
const count = z.number().int().nonnegative().refine(Number.isSafeInteger).nullable();
const attemptSchema = z.object({ attemptedCalls: z.union([z.literal(0), z.literal(1)]), delivery: z.enum(["not_attempted", "response_received", "outcome_unknown"]), modelRequested: z.string().min(1).max(200).nullable(), inputTokens: count, outputTokens: count, requestCount: count }).strict().refine(value => (value.attemptedCalls === 0) === (value.delivery === "not_attempted"));
const recordSchema = z.object({ generationId: uuid, userId: uuid, kbId: uuid, kind: z.enum(["roles", "questions"]), inputHash: z.string().regex(/^[a-f0-9]{64}$/u), state: z.enum(["claimed", "dispatched", "succeeded", "failed", "uncertain"]), result: z.unknown(), errorReason: z.enum(["rate_limited", "quota_unavailable", "invalid_output", "provider_rejected", "outcome_unknown", "input_stale", "model_unavailable"]).nullable(), attempt: attemptSchema.nullable() }).strict();
export function parseGeoKbGenerationRecord(value: unknown): GeoKbGenerationRecord {
  const parsed = recordSchema.parse(value);
  if (parsed.result === undefined) throw new Error("Generation result must be explicit");
  if (parsed.state === "claimed" || parsed.state === "dispatched") {
    if (parsed.result !== null || parsed.errorReason !== null || parsed.attempt !== null) throw new Error("Active generation has terminal data");
  } else if (parsed.state === "succeeded") {
    if (parsed.result === null || parsed.errorReason !== null || parsed.attempt?.delivery !== "response_received") throw new Error("Invalid successful generation");
    if (geoV2JsonbBytes(parsed.result) > 2_097_152) throw new Error("Generation result exceeds byte limit");
    const result = parsed.kind === "questions" ? parseGeoPreparedCandidate(parsed.result) : parseGeoRoleProposal(parsed.result);
    if (result.kbId !== parsed.kbId || ("generationId" in result && result.generationId !== parsed.generationId)) throw new Error("Generation result scope mismatch");
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
        if (outcome.state === "succeeded") {
          if (geoV2JsonbBytes(outcome.result) > 2_097_152) return { kind: "unavailable" };
          const raw = z.object({ schemaVersion: z.string() }).parse(outcome.result);
          const parsed = raw.schemaVersion === "marketing-geo-prepared-candidate.v1" ? parseGeoPreparedCandidate(outcome.result) : parseGeoRoleProposal(outcome.result);
          if (parsed.kbId !== scope.kbId || ("generationId" in parsed && parsed.generationId !== scope.generationId)) return { kind: "unavailable" };
        }
        const result = await transport.callRpc("marketing_geo_finish_generation", { p_user_id: scope.userId, p_kb_id: scope.kbId, p_generation_id: scope.generationId, p_claim_token: scope.claimToken, p_state: outcome.state, p_result: outcome.result, p_error_reason: outcome.errorReason, p_attempt: outcome.attempt });
        if (result.error) return { kind: "unavailable" };
        const row = one(result.data);
        if (row.outcome !== "finished" && row.outcome !== "existing") return { kind: "unavailable" };
        return { kind: "ok", generation: owned(row.generation, scope) };
      } catch { return { kind: "unavailable" }; }
    },
    read, readLatest: read,
    // Recovery never starts work. SQL may settle an expired dispatched lease
    // to uncertain; no quota/claim/provider capability is issued by this call.
    readByKey: async input => {
      try {
        uuid.parse(input.userId); uuid.parse(input.kbId);
        z.enum(["roles", "questions"]).parse(input.kind);
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
