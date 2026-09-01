// @input -- authenticated exact candidate IDs/hashes, never client-supplied content
// @output -- persisted candidate recovery and immutable freeze identity
// @pos -- no generator or latest-source resolver is reachable from this handler
import type { ServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import type { GeoPreparedCandidateV1 } from "./kb-prepared-contract.ts";
import type { GeoKbFreezeOutcome } from "./kb-store.ts";
import { z } from "zod";
import { privateError, privateJson, readAccountMutationJson } from "../account-websites/route-http.ts";
export interface GeoKbPreparedHandlerDependencies {
  readonly authenticate: () => Promise<ServerAuthenticatedUser>;
  readonly read: (input: { readonly userId: string; readonly kbId: string; readonly candidateId?: string }) => Promise<{ readonly kind: "ok"; readonly candidate: GeoPreparedCandidateV1 } | { readonly kind: "missing" | "unavailable" }>;
  readonly freeze: (input: { readonly userId: string; readonly kbId: string; readonly candidateId: string; readonly candidateHash: string }) => Promise<{ readonly kind: "ok"; readonly value: GeoKbFreezeOutcome } | { readonly kind: "missing" | "stale" | "unavailable" }>;
}
const readSchema = z.object({ kbId: z.string().uuid(), candidateId: z.string().uuid().optional() }).strict();
const freezeSchema = z.object({ kbId: z.string().uuid(), candidateId: z.string().uuid(), candidateHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
async function authenticated(dependencies: GeoKbPreparedHandlerDependencies): Promise<{ readonly userId: string } | Response> {
  const identity = await dependencies.authenticate().catch(() => ({ status: "unavailable" as const }));
  return identity.status === "authenticated" ? { userId: identity.userId } : privateError(identity.status === "unauthenticated" ? "auth_required" : "auth_unavailable", identity.status === "unauthenticated" ? 401 : 503);
}
export async function handleGeoKbPreparedRead(request: Request, dependencies: GeoKbPreparedHandlerDependencies): Promise<Response> {
  const identity = await authenticated(dependencies);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, 1024);
  if (!json.ok) return json.response;
  const input = readSchema.safeParse(json.value);
  if (!input.success) return privateError("invalid_request", 400);
  const loaded = await dependencies.read({ userId: identity.userId, ...input.data }).catch(() => ({ kind: "unavailable" as const }));
  if (loaded.kind === "missing" && input.data.candidateId === undefined) return privateJson({ data: { candidate: null } });
  if (loaded.kind !== "ok") return privateError(loaded.kind === "missing" ? "not_found" : "store_unavailable", loaded.kind === "missing" ? 404 : 503);
  if (loaded.candidate.kbId !== input.data.kbId || (input.data.candidateId !== undefined && loaded.candidate.candidateId !== input.data.candidateId)) return privateError("store_unavailable", 503);
  return privateJson({ data: { candidate: loaded.candidate } });
}
export async function handleGeoKbPreparedFreeze(request: Request, dependencies: GeoKbPreparedHandlerDependencies): Promise<Response> {
  const identity = await authenticated(dependencies);
  if (identity instanceof Response) return identity;
  const json = await readAccountMutationJson(request, 1024);
  if (!json.ok) return json.response;
  const input = freezeSchema.safeParse(json.value);
  if (!input.success) return privateError("invalid_request", 400);
  const frozen = await dependencies.freeze({ userId: identity.userId, ...input.data }).catch(() => ({ kind: "unavailable" as const }));
  if (frozen.kind !== "ok") return privateError(frozen.kind === "missing" ? "not_found" : frozen.kind === "stale" ? "input_stale" : "store_unavailable", frozen.kind === "missing" ? 404 : frozen.kind === "stale" ? 409 : 503);
  return privateJson({ data: frozen.value });
}
