// @input  -- the knowledge-base store, the account website store, and the request's identity
// @output -- the dependency set the four knowledge-base routes run with
// @pos    -- the wiring seam; it maps store outcomes to HTTP-shaped ones and nothing else

import { normalizeSeoAuditUrl } from "@sf/public-tools";

import { authenticateAccountRequest } from "../account-websites/route-http.ts";
import { findAccountWebsiteByUrl } from "../account-websites/store.ts";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import type { GeoKbPayload } from "./kb-contract.ts";
import { emptyGeoKbPayload } from "./kb-contract.ts";
import type {
  GeoKbHandlerDependencies,
  GeoKbStoreOutcome,
  GeoKbView,
} from "./kb-handler.ts";
import { importGeoKbPayload } from "./kb-import.ts";
import type { GeoQuestionSet } from "./kb-questions.ts";
import type { GeoInheritedProfile } from "./asset-context.ts";
import { readGeoSnapshotContext, readLatestGeoEnrichmentReceipt } from "./asset-context-store.ts";
import { buildGeoSnapshotContext, type GeoSnapshotContext } from "./snapshot-context.ts";
import { canonicalGeoEnrichmentText } from "./kb-enrichment.ts";
import { freezeGeoKbWithContext } from "./kb-freeze-context.ts";
import {
  ensureGeoKnowledgeBase,
  freezeGeoKb,
  readFrozenGeoKb,
  readGeoKnowledgeBase,
  saveGeoKbDraft,
  type GeoKbDetails,
  type GeoKbFrozenSnapshot,
  type GeoKbStoreResult,
} from "./kb-store.ts";

export {
  handleGeoKbFreeze,
  handleGeoKbImport,
  handleGeoKbLoad,
  handleGeoKbSaveDraft,
} from "./kb-handler.ts";

/**
 * One translation, in one place.
 *
 * The store speaks in `missing` / `invalid` / `conflict`; the HTTP layer speaks
 * in codes a page can render. Doing this per call site is how two endpoints end
 * up disagreeing about what a conflict is.
 */
function toOutcome<T, U>(
  result: GeoKbStoreResult<T>,
  map: (value: T) => U,
): GeoKbStoreOutcome<U> {
  switch (result.kind) {
    case "ok":
      return { kind: "ok", value: map(result.value) };
    case "missing":
      return { kind: "not_found" };
    case "conflict":
      // Zero is not "unknown" here: the save RPC reads it as "there is no
      // draft yet", so a client that retried with it would collide a second
      // time and never converge. A negative marker cannot be mistaken for a
      // version.
      return {
        kind: "conflict",
        draftVersion: result.currentDraftVersion ?? -1,
      };
    case "invalid":
      // `no_draft` is the one invalid code with its own meaning at the HTTP
      // layer: there is nothing to freeze yet, which is a state rather than a
      // malformed request.
      if (result.code === "no_draft") return { kind: "no_draft" };
      if (result.code === "question_set_stale") return { kind: "hash_mismatch" };
      if (result.code === "context_stale") return { kind: "context_stale" };
      if (result.code === "website_required") return { kind: "website_required" };
      return { kind: "not_found" };
    default:
      // The store separates "the database is not answering" from "the
      // database and this process disagree about a digest". The second is an
      // integrity failure worth finding in logs, so it keeps its own reason
      // even though both surface as 503.
      return {
        kind: "unavailable",
        reason:
          result.kind === "unavailable" ? result.reason : "store unavailable",
      };
  }
}

function siteKeyOf(url: string): {
  readonly origin: string;
  readonly host: string;
  readonly canonicalSiteKey: string;
} | null {
  const normalized = normalizeAccountWebsiteUrl(url);
  return normalized ? { origin: normalized.origin, host: normalized.host, canonicalSiteKey: normalized.canonicalSiteKey } : null;
}

function viewFrom(
  details: GeoKbDetails,
  importAvailable: boolean,
  retrievalCount: number,
  profile: GeoInheritedProfile | null,
  payload: GeoKbPayload,
  context: GeoSnapshotContext,
  frozen: GeoKbFrozenSnapshot | null,
  frozenContext: GeoSnapshotContext | null,
): GeoKbView {
  return {
    kbId: details.kbId,
    origin: details.origin,
    host: details.host,
    draftVersion: details.draft?.draftVersion ?? 0,
    payload,
    frozen:
      details.frozen === null
        ? null
        : {
            snapshotId: details.frozen.snapshotId,
            revision: details.frozen.revision,
            frozenAt: details.frozen.frozenAt,
            contentHash: details.frozen.contentHash,
            questionCount: details.frozen.questionCount,
            retrievalCount,
            questionSetHash: details.frozen.questionSetHash,
            ...(frozen ? { questions: frozen.questionSet.questions, registryVersion: frozen.questionSet.registryVersion } : {}),
            ...(frozenContext ? { skippedLayers: frozenContext.skippedLayers } : {}),
          },
    importAvailable,
    profile,
    context: contextPreview(context),
  };
}

async function profileFor(
  userId: string,
  url: string,
): Promise<
  | { readonly ok: true; readonly payload: GeoKbPayload; readonly profile: GeoInheritedProfile }
  | { readonly ok: false; readonly unavailable: boolean }
> {
  const resolved = await findAccountWebsiteByUrl(userId, url);
  if (resolved.kind !== "ok") return { ok: false, unavailable: resolved.kind === "unavailable" };
  return {
    ok: true,
    profile: {
      reference: resolved.value.reference,
      productName: resolved.value.profile.productName,
      oneLinePositioning: resolved.value.profile.oneLinePositioning,
      coreFeatures: resolved.value.profile.coreFeatures,
      fieldProvenance: resolved.value.profile.fieldProvenance.filter((field) => ["/productName", "/oneLinePositioning", "/coreFeatures"].includes(field.path)),
      market: {
        country: resolved.value.profile.country,
        language: resolved.value.profile.locale,
      },
    },
    payload: importGeoKbPayload({
      websiteId: resolved.value.website.websiteId,
      snapshotId: resolved.value.reference.snapshotId,
      snapshotRevision: resolved.value.reference.snapshotRevision,
      origin: resolved.value.website.origin,
      profile: resolved.value.profile,
    }),
  };
}

function contextPreview(context: GeoSnapshotContext) {
  return { skippedLayers: context.skippedLayers, questionSetHash: context.questionSetHash, contentHash: context.contentHash };
}

async function contextFor(userId: string, kbId: string, origin: string, payload: GeoKbPayload, profile: GeoInheritedProfile | null): Promise<GeoKbStoreOutcome<ReturnType<typeof buildGeoSnapshotContext>>> {
  const source = await readLatestGeoEnrichmentReceipt({ userId, kbId });
  if (source.kind !== "ok") return { kind: "unavailable", reason: "source receipt unavailable" };
  const targetHost = normalizeAccountWebsiteUrl(origin)?.host;
  if (!targetHost || normalizeAccountWebsiteUrl(payload.targetUrl)?.host !== targetHost) return { kind: "unavailable", reason: "GEO asset identity mismatch" };
  // A Profile change makes the old enrichment stale. Its labels are not
  // borrowed by a new context; the UI explicitly shows skipped source layers.
  const receipt = source.value && canonicalGeoEnrichmentText(source.value.profileReference) === canonicalGeoEnrichmentText(profile?.reference ?? null) ? source.value : null;
  try { return { kind: "ok", value: buildGeoSnapshotContext({ kbId, targetHost, payload, profile, receipt }) }; }
  catch { return { kind: "unavailable", reason: "source context invalid" }; }
}

async function loadView(
  userId: string,
  details: GeoKbDetails,
  profileUrl: string,
): Promise<GeoKbStoreOutcome<GeoKbView>> {
  let retrievalCount = 0;
  let snapshot: GeoKbFrozenSnapshot | null = null;
  let frozenContext: GeoSnapshotContext | null = null;
  if (details.frozen !== null) {
    const frozen = await readFrozenGeoKb({
      userId,
      kbId: details.kbId,
      revision: details.frozen.revision,
    });
    if (frozen.kind !== "ok") {
      return {
        kind: "unavailable",
        reason:
          frozen.kind === "unavailable"
            ? frozen.reason
            : "frozen snapshot unavailable",
      };
    }
    retrievalCount = retrievalCountOf(frozen.value.questionSet);
    snapshot = frozen.value;
    const context = await readGeoSnapshotContext({ userId, kbId: details.kbId, snapshotId: frozen.value.snapshotId });
    if (context.kind !== "ok") return { kind: "unavailable", reason: "frozen context unavailable" };
    frozenContext = context.value;
  }
  const profile = await profileFor(userId, profileUrl);
  if (!profile.ok && profile.unavailable) return { kind: "unavailable", reason: "profile unavailable" };
  const inherited = profile.ok ? profile.profile : null;
  const payload = details.draft?.payload ?? (profile.ok ? { ...profile.payload, roles: [], market: profile.profile.market } : emptyGeoKbPayload(details.origin));
  const prepared = await contextFor(userId, details.kbId, details.origin, payload, inherited);
  if (prepared.kind !== "ok") return prepared;
  return {
    kind: "ok",
    value: viewFrom(details, profile.ok, retrievalCount, inherited, payload, prepared.value.context, snapshot, frozenContext),
  };
}

export const DEFAULT_GEO_KB_HANDLER_DEPENDENCIES: GeoKbHandlerDependencies = {
  authenticate: authenticateAccountRequest,

  loadKnowledgeBase: async ({ userId, url }) => {
    const site = siteKeyOf(url);
    if (site === null) return { kind: "not_found" };
    const registration = await ensureGeoKnowledgeBase({ userId, ...site });
    if (registration.kind !== "ok") return toOutcome(registration, () => null as never);
    const details = await readGeoKnowledgeBase({
      userId,
      kbId: registration.value.kbId,
    });
    if (details.kind !== "ok") return toOutcome(details, () => null as never);
    return loadView(userId, details.value, url);
  },

  loadExistingKnowledgeBase: async ({ userId, kbId }) => {
    const details = await readGeoKnowledgeBase({ userId, kbId });
    if (details.kind !== "ok") return toOutcome(details, () => null as never);
    return loadView(userId, details.value, details.value.origin);
  },

  saveDraft: async ({ userId, kbId, payload, baseVersion, expectedProfileReference }) => {
    const owned = await readGeoKnowledgeBase({ userId, kbId });
    if (owned.kind !== "ok") return toOutcome(owned, () => null as never);
    const profile = await profileFor(userId, owned.value.origin);
    if (!profile.ok && profile.unavailable) return { kind: "unavailable", reason: "profile unavailable" };
    if (expectedProfileReference === undefined || canonicalGeoEnrichmentText(expectedProfileReference) !== canonicalGeoEnrichmentText(profile.ok ? profile.profile.reference : null)) return { kind: "context_stale" };
    const prepared = await contextFor(userId, kbId, owned.value.origin, payload, profile.ok ? profile.profile : null);
    if (prepared.kind !== "ok") return prepared;
    const result = await saveGeoKbDraft({ userId, kbId, payload, baseVersion });
    return toOutcome(result, (value) => ({
      draftVersion: value.draftVersion,
      updatedAt: value.updatedAt,
      context: contextPreview(prepared.value.context),
    }));
  },

  freeze: async ({ userId, kbId, baseVersion, questionSet, context }) => {
    const input = {
      userId,
      kbId,
      baseVersion,
      questionSet,
    };
    const result = context ? await freezeGeoKbWithContext({ ...input, context }) : await freezeGeoKb(input);
    return toOutcome(result, (value) => ({
      snapshotId: value.snapshotId,
      revision: value.revision,
      frozenAt: value.frozenAt,
      contentHash: value.contentHash,
      questionCount: value.questionCount,
      retrievalCount: retrievalCountOf(questionSet),
      reusedExisting: value.reusedExisting,
      questionSetHash: value.questionSetHash,
      registryVersion: questionSet.registryVersion,
      ...(context ? { context: contextPreview(context), skippedLayers: context.skippedLayers } : {}),
    }));
  },

  readDraftPayload: async ({ userId, kbId }) => {
    const details = await readGeoKnowledgeBase({ userId, kbId });
    if (details.kind !== "ok") return toOutcome(details, () => null as never);
    const draft = details.value.draft;
    if (draft === null) return { kind: "no_draft" };
    const profile = await profileFor(userId, details.value.origin);
    if (!profile.ok && profile.unavailable) return { kind: "unavailable", reason: "profile unavailable" };
    const prepared = await contextFor(userId, kbId, details.value.origin, draft.payload, profile.ok ? profile.profile : null);
    if (prepared.kind !== "ok") return prepared;
    return {
      kind: "ok",
      value: { payload: draft.payload, draftVersion: draft.draftVersion, ...prepared.value },
    };
  },

  importFromProfile: async ({ userId, kbId }) => {
    const details = await readGeoKnowledgeBase({ userId, kbId });
    if (details.kind !== "ok") return toOutcome(details, () => null as never);
    const normalized = normalizeSeoAuditUrl(details.value.origin);
    if (!normalized.ok) return { kind: "not_found" };
    const profile = await profileFor(userId, normalized.url);
    if (!profile.ok && profile.unavailable) return { kind: "unavailable", reason: "profile unavailable" };
    // "No confirmed profile" is a state the editor renders, not a failure: the
    // page offers the prefill only when one exists, and this is the race where
    // it stopped existing in between.
    if (!profile.ok) return { kind: "not_found" };
    return { kind: "ok", value: profile.payload };
  },
};

function retrievalCountOf(questionSet: GeoQuestionSet): number {
  return questionSet.questions.filter(
    (question) => question.mode === "retrieval",
  ).length;
}
