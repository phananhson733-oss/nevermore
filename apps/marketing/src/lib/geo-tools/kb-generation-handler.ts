// @input -- same-origin authenticated requests naming saved drafts, not model content
// @output -- owner-scoped durable generation status with no internal lease capability
// @pos -- HTTP admission for role synthesis and complete candidate preparation
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { z } from "zod";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { executeGeoKbGeneration, type GeoKbGenerationDependencies, type GeoKbGenerationKind, type GeoKbGenerationInvocation, type GeoKbGenerationRecord, type GeoGenerationValue } from "./kb-generation.ts";
import type { GeoSourceReceiptRef } from "./snapshot-context-v2.ts";

export interface GeoKbGenerationRequest {
  readonly kbId: string; readonly baseVersion: number; readonly draftHash: string;
  readonly idempotencyKey: string; readonly displayLocale: "en" | "zh";
  readonly sourceReceiptRefs: readonly GeoSourceReceiptRef[];
}
export interface GeoKbGenerationHandlerDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  /** Reads owned exact sources and does pure preflight only. No provider call. */
  readonly prepare: (input: GeoKbGenerationRequest & { readonly userId: string; readonly kind: GeoKbGenerationKind }) => Promise<
    | { readonly kind: "ready"; readonly input: Readonly<Record<string, GeoGenerationValue>>; readonly invoke: (generationId: string) => Promise<GeoKbGenerationInvocation> }
    | { readonly kind: "missing" | "input_stale" | "model_unavailable" | "unsupported_language" | "invalid_input" | "unavailable" }>;
  readonly store: Pick<GeoKbGenerationDependencies, "claim" | "markDispatched" | "finish"> & {
    readonly read: (input: { readonly userId: string; readonly kbId: string; readonly generationId: string }) => Promise<{ readonly kind: "ok"; readonly generation: GeoKbGenerationRecord } | { readonly kind: "missing" | "unavailable" }>;
    readonly readByKey: (input: { readonly userId: string; readonly kbId: string; readonly kind: GeoKbGenerationKind; readonly idempotencyKey: string }) => Promise<{ readonly kind: "ok"; readonly generation: GeoKbGenerationRecord } | { readonly kind: "missing" | "unavailable" }>;
  };
  readonly consumeQuota: (userId: string, kbId: string, kind: GeoKbGenerationKind) => ReturnType<GeoKbGenerationDependencies["consumeQuota"]>;
}

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const generationRequest = z.object({ kbId: z.string().uuid(), baseVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), draftHash: hash,
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u), displayLocale: z.enum(["en", "zh"]),
  sourceReceiptRefs: z.array(z.object({ receiptId: z.string().uuid(), contentHash: hash }).strict()).max(32),
}).strict();
const readRequest = z.union([
  z.object({ kbId: z.string().uuid(), generationId: z.string().uuid() }).strict(),
  z.object({ kbId: z.string().uuid(), kind: z.enum(["roles", "questions"]), idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u) }).strict(),
]);

export function publicGeoKbGeneration(record: GeoKbGenerationRecord) {
  return { generationId: record.generationId, kbId: record.kbId, kind: record.kind, inputHash: record.inputHash,
    state: record.state, result: record.result, errorReason: record.errorReason, attempt: record.attempt };
}
async function authenticated(dependencies: GeoKbGenerationHandlerDependencies): Promise<{ readonly userId: string } | Response> {
  const identity = await dependencies.authenticate().catch(() => ({ status: "unavailable" as const }));
  if (identity.status !== "authenticated") return privateError(identity.status === "unauthenticated" ? "auth_required" : "auth_unavailable", identity.status === "unauthenticated" ? 401 : 503);
  return { userId: identity.userId };
}

export async function handleGeoKbGeneration(request: Request, kind: GeoKbGenerationKind, dependencies: GeoKbGenerationHandlerDependencies): Promise<Response> {
  const identity = await authenticated(dependencies);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, 8192);
  if (!json.ok) return json.response;
  const parsed = generationRequest.safeParse(json.value);
  if (!parsed.success || new Set(parsed.data.sourceReceiptRefs.map(ref => ref.receiptId)).size !== parsed.data.sourceReceiptRefs.length) return privateError("invalid_request", 400);
  const input = parsed.data;
  const ready = await dependencies.prepare({ ...input, userId: identity.userId, kind }).catch(() => ({ kind: "unavailable" as const }));
  if (ready.kind !== "ready") {
    const status = ready.kind === "missing" ? 404 : ready.kind === "input_stale" ? 409 : ready.kind === "unsupported_language" || ready.kind === "invalid_input" ? 422 : 503;
    return privateError(ready.kind === "missing" ? "not_found" : ready.kind === "unavailable" ? "store_unavailable" : ready.kind, status);
  }
  if (ready.input.kbId !== input.kbId || ready.input.baseDraftVersion !== String(input.baseVersion) || ready.input.baseDraftHash !== input.draftHash || !hash.safeParse(ready.input.profileCopyHash).success) return privateError("store_unavailable", 503);
  const outcome = await executeGeoKbGeneration({ userId: identity.userId, kbId: input.kbId, kind, idempotencyKey: input.idempotencyKey, input: ready.input }, {
    configured: true, ...dependencies.store, consumeQuota: () => dependencies.consumeQuota(identity.userId, input.kbId, kind), invoke: ready.invoke,
  });
  if (outcome.kind !== "ok") return privateError(outcome.kind, outcome.kind === "conflict" ? 409 : outcome.kind === "invalid_input" ? 422 : 503);
  return privateJson({ data: { generation: publicGeoKbGeneration(outcome.generation), reused: outcome.reused } });
}

export async function handleGeoKbGenerationRead(request: Request, dependencies: GeoKbGenerationHandlerDependencies): Promise<Response> {
  const identity = await authenticated(dependencies);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, 1024);
  if (!json.ok) return json.response;
  const input = readRequest.safeParse(json.value);
  if (!input.success) return privateError("invalid_request", 400);
  const result = await ("generationId" in input.data ? dependencies.store.read({ userId: identity.userId, ...input.data }) : dependencies.store.readByKey({ userId: identity.userId, ...input.data }))
    .catch(() => ({ kind: "unavailable" as const }));
  if (result.kind !== "ok") return privateError(result.kind === "missing" ? "not_found" : "store_unavailable", result.kind === "missing" ? 404 : 503);
  if (result.generation.userId !== identity.userId || result.generation.kbId !== input.data.kbId || ("generationId" in input.data ? result.generation.generationId !== input.data.generationId : result.generation.kind !== input.data.kind)) return privateError("store_unavailable", 503);
  return privateJson({ data: { generation: publicGeoKbGeneration(result.generation) } });
}
