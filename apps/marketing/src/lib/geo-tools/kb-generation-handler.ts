// @input -- same-origin authenticated requests naming saved drafts, not model content
// @output -- owner-scoped durable generation status with no internal lease capability
// @pos -- HTTP admission for role, question and knowledge generation
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { z } from "zod";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
import { executeGeoKbGeneration, type GeoKbGenerationDependencies, type GeoKbGenerationKind, type GeoKbGenerationInvocation, type GeoKbGenerationRecord, type GeoGenerationValue } from "./kb-generation.ts";
import type { GeoSourceReceiptRef } from "./snapshot-context-v2.ts";

export interface GeoKbGenerationRequest {
  readonly kbId: string; readonly baseVersion: number; readonly draftHash: string;
  readonly idempotencyKey: string; readonly displayLocale: "en" | "zh";
  readonly sourceReceiptRefs: readonly GeoSourceReceiptRef[];
  readonly knowledgeGenerationId?: string;
}
export interface GeoKbGenerationHandlerDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  /** Reads owned exact sources and does pure preflight only. No provider call. */
  readonly prepare: (input: GeoKbGenerationRequest & { readonly userId: string; readonly kind: GeoKbGenerationKind }) => Promise<
    | { readonly kind: "ready"; readonly input: Readonly<Record<string, GeoGenerationValue>>; readonly invoke: (generationId: string) => Promise<GeoKbGenerationInvocation> }
    /**
     * `unsupported_draft` is not "your draft is broken". It is this deployment
     * saying it cannot run THIS step for THIS draft version -- a v3 draft has no
     * roles-proposal result shape and no v3 question-set assembler yet -- so it
     * is permanent for now and must not read as a retryable outage.
     *
     * `input_too_large` is not `invalid_input` either. The draft parsed, the
     * contract accepted it, and the adapter refused before dispatch because the
     * prompt it would have bought is over the byte ceiling -- so nothing was
     * spent, and the owner's next move is to narrow what is being asked about,
     * not to hunt for a malformed field. It is also not the existing
     * `payload_too_large`, which names an HTTP body that exceeded the read cap.
     */
    | { readonly kind: "missing" | "input_stale" | "model_unavailable" | "unsupported_language" | "unsupported_draft" | "input_too_large" | "invalid_input" | "unavailable" }>;
  readonly store: Pick<GeoKbGenerationDependencies, "claim" | "markDispatched" | "finish"> & {
    readonly read: (input: { readonly userId: string; readonly kbId: string; readonly generationId: string }) => Promise<{ readonly kind: "ok"; readonly generation: GeoKbGenerationRecord | null } | { readonly kind: "unavailable" }>;
    readonly readByKey: (input: { readonly userId: string; readonly kbId: string; readonly kind: GeoKbGenerationKind; readonly idempotencyKey: string }) => Promise<{ readonly kind: "ok"; readonly generation: GeoKbGenerationRecord | null } | { readonly kind: "unavailable" }>;
  };
  readonly consumeQuota: (userId: string, kbId: string, kind: GeoKbGenerationKind) => ReturnType<GeoKbGenerationDependencies["consumeQuota"]>;
}

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const generationRequest = z.object({ kbId: z.string().uuid(), baseVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), draftHash: hash,
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u), displayLocale: z.enum(["en", "zh"]),
  sourceReceiptRefs: z.array(z.object({ receiptId: z.string().uuid(), contentHash: hash }).strict()).max(32),
  knowledgeGenerationId: z.string().uuid().optional(),
}).strict();
const readRequest = z.union([
  z.object({ kbId: z.string().uuid(), generationId: z.string().uuid() }).strict(),
  z.object({ kbId: z.string().uuid(), kind: z.enum(["roles", "questions", "knowledge_pack"]), idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u) }).strict(),
]);

/**
 * The draft a stored knowledge-pack result says it was built on.
 *
 * Read defensively: the record came back from the store, and a result whose
 * manifest cannot be read is treated exactly like one naming another draft.
 */
function knowledgePackManifest(record: GeoKbGenerationRecord): { readonly baseDraftVersion?: unknown; readonly baseDraftHash?: unknown } | null {
  const result = record.result;
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
  const manifest = (result as { readonly manifest?: unknown }).manifest;
  if (manifest === null || manifest === undefined || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  return manifest as { readonly baseDraftVersion?: unknown; readonly baseDraftHash?: unknown };
}
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
  if (input.knowledgeGenerationId !== undefined && kind !== "questions") return privateError("invalid_request", 400);
  // `prepare` is a pure preflight for roles and questions, but for a knowledge
  // pack it runs the live evidence crawl -- up to 18 fetches under a 70s
  // deadline, spending the per-target crawl budget this tool shares with the
  // audit tools -- and only then reaches the claim that is supposed to make the
  // request idempotent. So the key is read first: a retry that carries the same
  // key finds its earlier attempt before that work is spent, not after it.
  // Roles and questions stay on the original path deliberately; their durable
  // input is a pure function of the saved draft, so the claim's own
  // content-addressed dedupe already answers a repeat correctly, and skipping
  // their prepare would skip the draft-staleness check it performs.
  if (kind === "knowledge_pack") {
    const existing = await dependencies.store.readByKey({ userId: identity.userId, kbId: input.kbId, kind, idempotencyKey: input.idempotencyKey }).catch(() => ({ kind: "unavailable" as const }));
    if (existing.kind !== "ok") return privateError("store_unavailable", 503);
    if (existing.generation !== null) {
      const record = existing.generation;
      if (record.userId !== identity.userId || record.kbId !== input.kbId || record.kind !== kind) return privateError("store_unavailable", 503);
      // One key naming two different drafts stays the conflict the claim makes
      // of it today. Only a succeeded record carries the manifest that says
      // which draft it answers; an unfinished one holds no result that could be
      // mistaken for an answer to this request.
      //
      // Any record ends the request, including an unfinished one. The claim RPC
      // can re-claim two of those states -- an expired `claimed` lease, and a
      // `rate_limited`/`quota_unavailable` failure that never reached the
      // provider -- but only by reading a lease expiry no HTTP caller can see,
      // so reproducing that decision here would be guesswork. Neither recovery
      // is reachable for a knowledge pack today anyway: its input hash moves on
      // every attempt, so the key always mismatches and the claim answers 409.
      // Whoever makes that hash deterministic must decide then whether this
      // short-circuit should defer to the RPC for those two states; until then
      // a caller retries a dead attempt with a new idempotency key.
      const manifest = knowledgePackManifest(record);
      if (record.state === "succeeded" && (manifest === null || manifest.baseDraftVersion !== String(input.baseVersion) || manifest.baseDraftHash !== input.draftHash)) return privateError("conflict", 409);
      return privateJson({ data: { generation: publicGeoKbGeneration(record), reused: true } });
    }
  }
  const ready = await dependencies.prepare({ ...input, userId: identity.userId, kind }).catch(() => ({ kind: "unavailable" as const }));
  if (ready.kind !== "ready") {
    // 422 for every permanent refusal of a well-formed request, including
    // `input_too_large`: 413 names a request body the server would not read,
    // and this body was read, understood and answered.
    const status = ready.kind === "missing" ? 404 : ready.kind === "input_stale" ? 409
      : ready.kind === "unsupported_language" || ready.kind === "unsupported_draft" || ready.kind === "input_too_large" || ready.kind === "invalid_input" ? 422 : 503;
    return privateError(ready.kind === "missing" ? "not_found" : ready.kind === "unavailable" ? "store_unavailable" : ready.kind, status);
  }
  // The durable input has to describe the request that is about to be paid for,
  // and it has to name exactly one Profile identity domain. v1/v2 bind a whole
  // `profileCopy` by hash; v3 binds the run's locked `generationInputHash` and
  // has no copy to hash. Requiring exactly one of the two -- present, a hash,
  // and the other absent -- keeps a preparer from returning an input that would
  // satisfy the wrong SQL branch at claim time.
  const identityHashes = [ready.input.profileCopyHash, ready.input.generationInputHash].filter(value => value !== undefined);
  if (ready.input.kbId !== input.kbId || ready.input.baseDraftVersion !== String(input.baseVersion) || ready.input.baseDraftHash !== input.draftHash
    || identityHashes.length !== 1 || !hash.safeParse(identityHashes[0]).success) return privateError("store_unavailable", 503);
  const outcome = await executeGeoKbGeneration({ userId: identity.userId, kbId: input.kbId, kind, idempotencyKey: input.idempotencyKey, input: ready.input }, {
    configured: true, ...dependencies.store, consumeQuota: () => dependencies.consumeQuota(identity.userId, input.kbId, kind), invoke: ready.invoke,
  });
  if (outcome.kind !== "ok") return privateError(outcome.kind, outcome.kind === "conflict" ? 409 : outcome.kind === "invalid_input" ? 422 : 503);
  // `rejection` names the check that refused the model's output. It is the
  // whole reason the token is computed, and this is its only reader: the stored
  // record deliberately cannot carry it (its key set is fixed by a database
  // CHECK), and there is no logger on this path, so without this line a
  // repeatedly failing step stays the black box it was.
  return privateJson({ data: { generation: publicGeoKbGeneration(outcome.generation), reused: outcome.reused, ...(outcome.rejection === null ? {} : { rejection: outcome.rejection }) } });
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
  if (result.kind !== "ok") return privateError("store_unavailable", 503);
  if (result.generation === null) return privateError("not_found", 404);
  if (result.generation.userId !== identity.userId || result.generation.kbId !== input.data.kbId || ("generationId" in input.data ? result.generation.generationId !== input.data.generationId : result.generation.kind !== input.data.kind)) return privateError("store_unavailable", 503);
  return privateJson({ data: { generation: publicGeoKbGeneration(result.generation) } });
}
