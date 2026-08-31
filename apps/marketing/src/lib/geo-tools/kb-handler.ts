// @input  -- same-origin authenticated POSTs from the knowledge-base editor
// @output -- the knowledge base, a saved draft, a frozen version, or one bounded error code
// @pos    -- the HTTP boundary of the GEO knowledge base; every write below goes through the store's RPCs

import { normalizeSeoAuditUrl } from "@sf/public-tools";

import {
  authenticateAccountRequest,
  privateError,
  privateJson,
  readAccountMutationJson,
} from "../account-websites/route-http.ts";
import {
  geoKbBlockers,
  parseGeoKbPayload,
  type GeoKbPayload,
} from "./kb-contract.ts";
import { buildGeoQuestionSet, type GeoQuestionSet, type GeoQuestion } from "./kb-questions.ts";
import { assessGeoQuestionQuality } from "./question-quality.ts";
import type { GeoInheritedProfile } from "./asset-context.ts";
import type { GeoSnapshotContext } from "./snapshot-context.ts";
import { parseWebsiteProfileReference, type WebsiteProfileReferenceV1 } from "../account-websites/contracts.ts";

const LOAD_BODY_LIMIT_BYTES = 4_096;
const SAVE_BODY_LIMIT_BYTES = 131_072;
const FREEZE_BODY_LIMIT_BYTES = 1_024;

/**
 * What the editor is told about a frozen version.
 *
 * The question set itself is not returned here: it can be large, and the page
 * asks for it separately when the visitor opens the preview.
 */
export interface GeoKbFrozenSummary {
  readonly snapshotId: string;
  readonly revision: number;
  readonly frozenAt: string;
  readonly contentHash: string;
  readonly questionCount: number;
  readonly retrievalCount: number;
  readonly questionSetHash?: string;
  readonly registryVersion?: string;
  readonly questions?: readonly GeoQuestion[];
  readonly skippedLayers?: readonly ("problem" | "evaluation")[];
}

export interface GeoKbContextPreview {
  readonly skippedLayers: readonly ("problem" | "evaluation")[];
  readonly questionSetHash: string;
  readonly contentHash: string;
}

export interface GeoKbView {
  readonly kbId: string;
  readonly origin: string;
  readonly host: string;
  readonly draftVersion: number;
  readonly payload: GeoKbPayload;
  readonly frozen: GeoKbFrozenSummary | null;
  /** Whether a confirmed website profile exists that a prefill could read. */
  readonly importAvailable: boolean;
  /** Exact inherited product fields; never an independently editable copy. */
  readonly profile?: GeoInheritedProfile | null;
  readonly context?: GeoKbContextPreview;
}

export type GeoKbStoreOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict"; readonly draftVersion: number }
  | { readonly kind: "hash_mismatch" }
  | { readonly kind: "no_draft" }
  | { readonly kind: "context_stale" }
  | { readonly kind: "website_required" }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface GeoKbSaveResult {
  readonly draftVersion: number;
  readonly updatedAt: string;
  readonly context?: GeoKbContextPreview;
}

export interface GeoKbFreezeResult extends GeoKbFrozenSummary {
  readonly reusedExisting: boolean;
  readonly context?: GeoKbContextPreview;
}

/**
 * Everything the handler needs from the world, injected.
 *
 * The store, the account profile and the clock all arrive this way so the
 * request contract can be tested without a database and without a session.
 */
export interface GeoKbHandlerDependencies {
  readonly authenticate: typeof authenticateAccountRequest;
  readonly loadKnowledgeBase: (input: {
    readonly userId: string;
    readonly url: string;
  }) => Promise<GeoKbStoreOutcome<GeoKbView>>;
  /** Read an owned knowledge base without registering or creating a site. */
  readonly loadExistingKnowledgeBase?: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => Promise<GeoKbStoreOutcome<GeoKbView>>;
  readonly saveDraft: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly payload: GeoKbPayload;
    readonly baseVersion: number;
    readonly expectedProfileReference?: WebsiteProfileReferenceV1 | null;
  }) => Promise<GeoKbStoreOutcome<GeoKbSaveResult>>;
  readonly freeze: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly baseVersion: number;
    readonly questionSet: GeoQuestionSet;
    readonly context?: GeoSnapshotContext;
  }) => Promise<GeoKbStoreOutcome<GeoKbFreezeResult>>;
  readonly readDraftPayload: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => Promise<GeoKbStoreOutcome<{ readonly payload: GeoKbPayload; readonly draftVersion: number; readonly questionSet?: GeoQuestionSet; readonly context?: GeoSnapshotContext }>>;
  /** A prefill from the account's confirmed profile for this site, if any. */
  readonly importFromProfile: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => Promise<GeoKbStoreOutcome<GeoKbPayload>>;
}

function storeError(
  outcome: Extract<
    GeoKbStoreOutcome<unknown>,
    { kind: "not_found" | "conflict" | "hash_mismatch" | "no_draft" | "context_stale" | "website_required" | "unavailable" }
  >,
): Response {
  switch (outcome.kind) {
    case "context_stale":
      return privateError("context_stale", 409);
    case "website_required":
      return privateError("website_required", 422);
    case "not_found":
      return privateError("not_found", 404);
    case "conflict":
      return privateJson(
        { error: { code: "conflict" }, draftVersion: outcome.draftVersion },
        409,
      );
    case "hash_mismatch":
      return privateError("hash_mismatch", 409);
    case "no_draft":
      return privateError("no_draft", 409);
    case "unavailable":
      // The reason is deliberately not forwarded: it names our infrastructure.
      return privateError("store_unavailable", 503);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const present = Object.keys(value);
  return (
    present.length === keys.length && keys.every((key) => present.includes(key))
  );
}

function baseVersionOf(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

/** Load an existing ID, or register the URL's site when the account has none. */
export async function handleGeoKbLoad(
  request: Request,
  dependencies: GeoKbHandlerDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, LOAD_BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  if (exactKeys(body.value, ["kbId"])) {
    const kbId = (body.value as { kbId: unknown }).kbId;
    if (typeof kbId !== "string" || kbId.trim().length === 0) {
      return privateError("invalid_request", 400);
    }
    if (!dependencies.loadExistingKnowledgeBase) {
      return privateError("store_unavailable", 503);
    }
    const outcome = await dependencies.loadExistingKnowledgeBase({ userId: auth.userId, kbId });
    if (outcome.kind !== "ok") return storeError(outcome);
    return privateJson({ data: outcome.value });
  }
  if (!exactKeys(body.value, ["url"])) {
    return privateError("invalid_request", 400);
  }
  const normalized = normalizeSeoAuditUrl((body.value as { url: unknown }).url);
  if (!normalized.ok) return privateError("invalid_url", 400);

  const outcome = await dependencies.loadKnowledgeBase({
    userId: auth.userId,
    url: normalized.url,
  });
  if (outcome.kind !== "ok") return storeError(outcome);
  return privateJson({ data: outcome.value });
}

export async function handleGeoKbSaveDraft(
  request: Request,
  dependencies: GeoKbHandlerDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, SAVE_BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  const profileProvided = isRecord(body.value) && Object.hasOwn(body.value, "expectedProfileReference");
  if (!exactKeys(body.value, ["kbId", "payload", "baseVersion", ...(profileProvided ? ["expectedProfileReference"] : [])])) {
    return privateError("invalid_request", 400);
  }
  const record = body.value as {
    readonly kbId: unknown;
    readonly payload: unknown;
    readonly baseVersion: unknown;
    readonly expectedProfileReference?: unknown;
  };
  const kbId = typeof record.kbId === "string" ? record.kbId : null;
  const baseVersion = baseVersionOf(record.baseVersion);
  if (kbId === null || baseVersion === null) {
    return privateError("invalid_request", 400);
  }
  const parsed = parseGeoKbPayload(record.payload);
  if (!parsed.ok) {
    // The specific field is returned because the editor can point at it, and
    // "something is wrong somewhere" is not a fixable message.
    return privateJson(
      { error: { code: "invalid_payload" }, reason: parsed.reason },
      400,
    );
  }

  let expectedProfileReference: WebsiteProfileReferenceV1 | null | undefined;
  if (profileProvided) {
    try { expectedProfileReference = record.expectedProfileReference === null ? null : parseWebsiteProfileReference(record.expectedProfileReference); }
    catch { return privateError("invalid_request", 400); }
  }

  const outcome = await dependencies.saveDraft({
    userId: auth.userId,
    kbId,
    payload: parsed.value,
    baseVersion,
    ...(expectedProfileReference === undefined ? {} : { expectedProfileReference }),
  });
  if (outcome.kind !== "ok") return storeError(outcome);
  return privateJson({
    data: {
      ...outcome.value,
      blockers: geoKbBlockers(parsed.value, { roleLayersSkipped: outcome.value.context?.skippedLayers.length === 2 }),
    },
  });
}

/**
 * Freeze the working copy.
 *
 * The question set is derived here rather than accepted from the client: it is
 * a pure function of the payload, and a client-supplied set would let the
 * frozen record claim a run asked something it never did.
 */
export async function handleGeoKbFreeze(
  request: Request,
  dependencies: GeoKbHandlerDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, FREEZE_BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  const contextProvided = isRecord(body.value) && Object.hasOwn(body.value, "contextHash");
  if (!exactKeys(body.value, ["kbId", "baseVersion", ...(contextProvided ? ["contextHash"] : [])])) {
    return privateError("invalid_request", 400);
  }
  const record = body.value as {
    readonly kbId: unknown;
    readonly baseVersion: unknown;
    readonly contextHash?: unknown;
  };
  const kbId = typeof record.kbId === "string" ? record.kbId : null;
  const baseVersion = baseVersionOf(record.baseVersion);
  if (kbId === null || baseVersion === null || (contextProvided && (typeof record.contextHash !== "string" || !/^[a-f0-9]{64}$/u.test(record.contextHash)))) {
    return privateError("invalid_request", 400);
  }

  const draft = await dependencies.readDraftPayload({
    userId: auth.userId,
    kbId,
  });
  if (draft.kind !== "ok") return storeError(draft);
  if (draft.value.draftVersion !== baseVersion) {
    return privateJson(
      { error: { code: "conflict" }, draftVersion: draft.value.draftVersion },
      409,
    );
  }
  if (draft.value.context && record.contextHash !== draft.value.context.contentHash) return privateError("context_stale", 409);
  const blockers = geoKbBlockers(draft.value.payload, { roleLayersSkipped: draft.value.context?.skippedLayers.length === 2 });
  if (blockers.length > 0) {
    return privateJson({ error: { code: "not_ready" }, blockers }, 422);
  }

  const questionSet = draft.value.questionSet ?? buildGeoQuestionSet(draft.value.payload);
  if (questionSet.questions.some((question) => !assessGeoQuestionQuality(draft.value.payload, question, questionSet.language).ok)) {
    return privateJson({ error: { code: "not_ready" }, blockers: ["question_quality"] }, 422);
  }
  const outcome = await dependencies.freeze({
    userId: auth.userId,
    kbId,
    baseVersion,
    questionSet,
    ...(draft.value.context ? { context: draft.value.context } : {}),
  });
  if (outcome.kind !== "ok") return storeError(outcome);
  return privateJson({
    data: {
      ...outcome.value,
      questions: questionSet.questions,
    },
  });
}

/**
 * Return a prefill from the confirmed website profile without saving it.
 *
 * Not saved, because the visitor has to see what it filled in before it
 * becomes their draft - and because an import that silently overwrote a draft
 * would lose work with no way back.
 */
export async function handleGeoKbImport(
  request: Request,
  dependencies: GeoKbHandlerDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, FREEZE_BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, ["kbId"])) {
    return privateError("invalid_request", 400);
  }
  const kbId = (body.value as { kbId: unknown }).kbId;
  if (typeof kbId !== "string") return privateError("invalid_request", 400);

  const outcome = await dependencies.importFromProfile({
    userId: auth.userId,
    kbId,
  });
  if (outcome.kind !== "ok") return storeError(outcome);
  return privateJson({ data: { payload: outcome.value } });
}
