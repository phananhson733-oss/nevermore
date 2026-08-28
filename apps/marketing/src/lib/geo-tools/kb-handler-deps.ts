// @input  -- the knowledge-base store, the account website store, and the request's identity
// @output -- the dependency set the four knowledge-base routes run with
// @pos    -- the wiring seam; it maps store outcomes to HTTP-shaped ones and nothing else

import { normalizeSeoAuditUrl } from "@sf/public-tools";

import { authenticateAccountRequest } from "../account-websites/route-http.ts";
import { findAccountWebsiteByUrl } from "../account-websites/store.ts";
import type { GeoKbPayload } from "./kb-contract.ts";
import { emptyGeoKbPayload } from "./kb-contract.ts";
import type {
  GeoKbHandlerDependencies,
  GeoKbStoreOutcome,
  GeoKbView,
} from "./kb-handler.ts";
import { importGeoKbPayload } from "./kb-import.ts";
import type { GeoQuestionSet } from "./kb-questions.ts";
import {
  ensureGeoKnowledgeBase,
  freezeGeoKb,
  readGeoKnowledgeBase,
  saveGeoKbDraft,
  type GeoKbDetails,
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
  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase();
    return {
      origin: parsed.origin,
      host,
      // Same key shape the account website store uses, so one account's two
      // records for the same site cannot drift apart.
      canonicalSiteKey: host.replace(/^www\./, ""),
    };
  } catch {
    return null;
  }
}

function viewFrom(
  details: GeoKbDetails,
  importAvailable: boolean,
  questionCounts: { readonly retrieval: number } | null,
): GeoKbView {
  const payload: GeoKbPayload =
    details.draft?.payload ?? emptyGeoKbPayload(details.origin);
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
            // Only known once the set itself is read; the editor shows the
            // total until then rather than inventing a split.
            retrievalCount: questionCounts?.retrieval ?? details.frozen.questionCount,
          },
    importAvailable,
  };
}

async function profileFor(
  userId: string,
  url: string,
): Promise<
  | { readonly ok: true; readonly payload: GeoKbPayload }
  | { readonly ok: false }
> {
  const resolved = await findAccountWebsiteByUrl(userId, url);
  if (resolved.kind !== "ok") return { ok: false };
  return {
    ok: true,
    payload: importGeoKbPayload({
      websiteId: resolved.value.website.websiteId,
      snapshotId: resolved.value.reference.snapshotId,
      snapshotRevision: resolved.value.reference.snapshotRevision,
      origin: resolved.value.website.origin,
      profile: resolved.value.profile,
    }),
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
    const profile = await profileFor(userId, url);
    return { kind: "ok", value: viewFrom(details.value, profile.ok, null) };
  },

  saveDraft: async ({ userId, kbId, payload, baseVersion }) => {
    const result = await saveGeoKbDraft({ userId, kbId, payload, baseVersion });
    return toOutcome(result, (value) => ({
      draftVersion: value.draftVersion,
      updatedAt: value.updatedAt,
    }));
  },

  freeze: async ({ userId, kbId, baseVersion, questionSet }) => {
    const result = await freezeGeoKb({
      userId,
      kbId,
      baseVersion,
      questionSet,
    });
    return toOutcome(result, (value) => ({
      snapshotId: value.snapshotId,
      revision: value.revision,
      frozenAt: value.frozenAt,
      contentHash: value.contentHash,
      questionCount: value.questionCount,
      retrievalCount: retrievalCountOf(questionSet),
      reusedExisting: value.reusedExisting,
    }));
  },

  readDraftPayload: async ({ userId, kbId }) => {
    const details = await readGeoKnowledgeBase({ userId, kbId });
    if (details.kind !== "ok") return toOutcome(details, () => null as never);
    const draft = details.value.draft;
    if (draft === null) return { kind: "no_draft" };
    return {
      kind: "ok",
      value: { payload: draft.payload, draftVersion: draft.draftVersion },
    };
  },

  importFromProfile: async ({ userId, kbId }) => {
    const details = await readGeoKnowledgeBase({ userId, kbId });
    if (details.kind !== "ok") return toOutcome(details, () => null as never);
    const normalized = normalizeSeoAuditUrl(details.value.origin);
    if (!normalized.ok) return { kind: "not_found" };
    const profile = await profileFor(userId, normalized.url);
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
