// @input -- a verified account and exact owned GEO records
// @output -- one complete editor view per stored format, v2 or v3; an upgrade preview is never a write
// @pos -- server-side loading only, with old frozen records kept independent and no format coerced into the other
import type { MarketingWebsiteProfileV1, WebsiteProfileReferenceV1 } from "../account-websites/contracts.ts";
import type { GeoKbEditorViewV2, GeoKbFrozenKnowledgeWire, GeoKbFrozenV2Wire } from "../../components/tools/geo-kb-v2-wire.ts";
import type { GeoKbFrozenSummary } from "../../components/tools/geo-kb-wire.ts";
import { isGeoKbPayloadV3Value, type AnyVersionedGeoKbPayload, type VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import type { GeoKbEditorViewV3 } from "../../components/tools/geo-kb-v3-wire.ts";
import { geoV3ItemKeys } from "./kb-v3-contract.ts";
import { geoV3DecisionStates } from "./kb-v3-review.ts";
import type { GeoKbRegistration, GeoKbStoreResult } from "./kb-store.ts";
import type { GeoKbStoreOutcome } from "./kb-handler.ts";
import type { GeoKbSourceReportV2 } from "./kb-source-contract.ts";
import type { AnyGeoPreparedCandidate } from "./kb-prepared-contract.ts";
import type { GeoKbGenerationRead } from "./kb-generation-store.ts";
import type { GeoKbGenerationKind } from "./kb-generation.ts";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { createGeoProfileCopy } from "./kb-profile-copy.ts";
import { assertGeoProfileCopyIntegrity, inheritedProfileFromCopy } from "./kb-profile-copy-server.ts";
import { upgradeGeoKbDraftToV2 } from "./kb-upgrade.ts";
import { importGeoKbPayload } from "./kb-import.ts";
import { parseGeoKbEditorViewV2 } from "../../components/tools/geo-kb-v2-wire.ts";
import { publicGeoKbGeneration } from "./kb-generation-handler.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";

export interface GeoKbEditorLoaderDependencies {
  readonly ensure: (input: { readonly userId: string; readonly origin: string; readonly host: string; readonly canonicalSiteKey: string }) => Promise<GeoKbStoreResult<GeoKbRegistration>>;
  readonly readDetails: (input: { readonly userId: string; readonly kbId: string }) => Promise<GeoKbStoreResult<VersionedGeoKbDetails>>;
  readonly readProfile: (userId: string, url: string) => Promise<{ readonly kind: "ok"; readonly value: { readonly reference: WebsiteProfileReferenceV1; readonly profile: MarketingWebsiteProfileV1 } } | { readonly kind: "missing" | "invalid" | "unavailable" }>;
  readonly readFrozen: (input: { readonly userId: string; readonly kbId: string; readonly snapshotId: string }) => Promise<{ readonly kind: "ok"; readonly value: GeoKbFrozenKnowledgeWire | GeoKbFrozenV2Wire | GeoKbFrozenSummary } | { readonly kind: "unavailable" }>;
  readonly readSource: (input: { readonly userId: string; readonly kbId: string }) => Promise<GeoKbStoreResult<GeoKbSourceReportV2 | null>>;
  readonly readPrepared: (input: { readonly userId: string; readonly kbId: string }) => Promise<GeoKbStoreResult<AnyGeoPreparedCandidate | null>>;
  readonly readGeneration: (input: { readonly userId: string; readonly kbId: string; readonly kind: GeoKbGenerationKind }) => Promise<GeoKbGenerationRead>;
}

/**
 * Why the v2 editor load stopped, when it stopped because this knowledge base
 * holds a v3 draft.
 *
 * It is a named reason rather than the generic one because the two are acted on
 * differently: an outage is retried, and a v3 draft is loaded by
 * `createGeoKbV3EditorLoader` instead. It never leaves the server -- the routes
 * that carry this outcome answer 503 without a reason -- so widening it is a
 * dispatch decision, not a disclosure.
 */
export const GEO_KB_V3_DRAFT_REASON = "geo_kb_v3_draft";

export function createGeoKbEditorLoader(dependencies: GeoKbEditorLoaderDependencies): (input: { readonly userId: string; readonly url: string }) => Promise<GeoKbStoreOutcome<GeoKbEditorViewV2>> {
  return async ({ userId, url }) => {
    const unavailable = (): GeoKbStoreOutcome<never> => ({ kind: "unavailable", reason: "complete_editor_unavailable" });
    try {
      const site = normalizeAccountWebsiteUrl(url);
      if (!site) return { kind: "not_found" };
      const registered = await dependencies.ensure({ userId, origin: site.origin, host: site.host, canonicalSiteKey: site.canonicalSiteKey });
      if (registered.kind !== "ok") return registered.kind === "missing" ? { kind: "not_found" } : unavailable();
      const scope = { userId, kbId: registered.value.kbId };
      const [details, source] = await Promise.all([dependencies.readDetails(scope), dependencies.readProfile(userId, site.origin)]);
      if (details.kind !== "ok") return unavailable();
      const kb = details.value;
      if (kb.kbId !== scope.kbId || kb.canonicalSiteKey !== site.canonicalSiteKey || normalizeAccountWebsiteUrl(kb.origin)?.host !== site.host) return unavailable();
      let original = kb.draft?.payload;
      // This view is a v2 editor contract end to end: a profileCopy hash, fact
      // rows and role review. A v3 draft has none of those shapes and is edited
      // by the v3 card instead, so it is refused rather than bent backwards
      // into a payload it never was.
      //
      // Asked before the Profile read is judged, and that order is load-bearing.
      // The v3 card reads no Profile at all -- its facts come from the locked
      // generation input -- so an unreadable Profile store has nothing to say
      // about whether a v3 knowledge base can be shown. Judging it first turned
      // every v3 owner into a 503 for the duration of a Profile outage, which
      // reads to them as the whole knowledge base being gone.
      if (original !== undefined && isGeoKbPayloadV3Value(original)) return { kind: "unavailable", reason: GEO_KB_V3_DRAFT_REASON };
      if (source.kind === "unavailable") return unavailable();
      const currentCopy = source.kind === "ok" ? createGeoProfileCopy(source.value.reference, source.value.profile) : null;
      if (currentCopy) assertGeoProfileCopyIntegrity(currentCopy);
      const profile = currentCopy ? { ...inheritedProfileFromCopy(currentCopy), fullProfile: currentCopy.profile } : null;
      if (original === undefined) {
        if (!currentCopy) return { kind: "profile_copy_required" };
        original = { ...importGeoKbPayload({ websiteId: currentCopy.websiteId, snapshotId: currentCopy.snapshotId, snapshotRevision: Number(currentCopy.snapshotRevision), origin: kb.origin, profile: currentCopy.profile }),
          profileCopy: currentCopy, roles: [], facts: [], market: { country: currentCopy.profile.country, language: currentCopy.profile.locale.toLowerCase() } };
      }
      if (original.profileCopy === undefined) {
        if (!currentCopy) return { kind: "profile_copy_required" };
        original = { ...original, profileCopy: currentCopy };
      }
      const requiresSave = kb.draft === null || original.schemaVersion !== "marketing-geo-kb.v2";
      const payload = original.schemaVersion === "marketing-geo-kb.v2" ? original : upgradeGeoKbDraftToV2(original);
      const [receipt, prepared, roles, knowledge, questions, frozen] = await Promise.all([
        dependencies.readSource(scope), dependencies.readPrepared(scope), dependencies.readGeneration({ ...scope, kind: "roles" }), dependencies.readGeneration({ ...scope, kind: "knowledge_pack" }), dependencies.readGeneration({ ...scope, kind: "questions" }),
        kb.frozen === null ? Promise.resolve({ kind: "ok" as const, value: null }) : dependencies.readFrozen({ ...scope, snapshotId: kb.frozen.snapshotId }),
      ]);
      if (receipt.kind !== "ok" || prepared.kind !== "ok" || roles.kind !== "ok" || knowledge.kind !== "ok" || questions.kind !== "ok" || frozen.kind !== "ok") return unavailable();
      for (const generation of [roles.generation, knowledge.generation, questions.generation]) if (generation && (generation.userId !== userId || generation.kbId !== scope.kbId)) return unavailable();
      const view = parseGeoKbEditorViewV2({ schemaVersion: "marketing-geo-kb-editor.v2", kbId: kb.kbId, origin: kb.origin, host: kb.host,
        draftVersion: kb.draft?.draftVersion ?? 0, draftHash: kb.draft?.contentHash ?? null, profileCopyHash: geoV2Digest(payload.profileCopy), payload, requiresSave, profile, frozen: frozen.value,
        sourceReceipt: receipt.value, prepared: prepared.value,
        generations: { roles: roles.generation ? publicGeoKbGeneration(roles.generation) : null,
          knowledge_pack: knowledge.generation ? publicGeoKbGeneration(knowledge.generation) : null,
          questions: questions.generation ? publicGeoKbGeneration(questions.generation) : null } });
      return view === null ? unavailable() : { kind: "ok", value: view };
    } catch { return unavailable(); }
  };
}

/* ------------------------------------------------------------------ */
/* The v3 draft, which the view above has no shape for                  */
/* ------------------------------------------------------------------ */

/**
 * A loaded v3 draft, as the website GEO response carries it.
 *
 * `GeoKbEditorViewV3` is what the review card consumes; the two extra fields
 * here belong to the transport. `schemaVersion` is what tells the browser which
 * of the three editor shapes arrived -- it discriminates against
 * `marketing-geo-kb-editor.v2` and against the v1 view, which carries none --
 * and `origin` is what the website route re-derives the canonical site key from
 * before it agrees the knowledge base and the website are about the same site.
 *
 * There is no `runInProgress`: this loader does not read the run table, and
 * `false` would be a claim that no run holds the draft. The card asks the run
 * route itself when it mounts, so the honest value here is the absent one.
 */
export interface GeoKbEditorViewV3Wire extends GeoKbEditorViewV3 {
  readonly schemaVersion: "marketing-geo-kb-editor.v3";
  readonly origin: string;
}

/**
 * `not_v3` is not a failure: it means this knowledge base's draft is a v1/v2 one
 * (or there is no draft at all), which is the v2 loader's job. It is separate
 * from every `GeoKbStoreOutcome` kind on purpose -- `no_draft` would state that
 * the knowledge base has no draft, which is false whenever a v2 draft is what
 * sent us here.
 */
export type GeoKbV3EditorLoad =
  | GeoKbStoreOutcome<GeoKbEditorViewV3Wire>
  | { readonly kind: "not_v3" };

export interface GeoKbV3EditorLoaderDependencies {
  readonly ensure: GeoKbEditorLoaderDependencies["ensure"];
  readonly readDetails: GeoKbEditorLoaderDependencies["readDetails"];
  /**
   * The published version's stored payload, needed for one thing only: the
   * decisions the publish box compares this draft against. A summary cannot
   * answer that, because a decision lives inside the payload's review.
   */
  readonly readFrozenPayload: (input: { readonly userId: string; readonly kbId: string; readonly snapshotId: string })
    => Promise<GeoKbStoreResult<AnyVersionedGeoKbPayload>>;
}

export function createGeoKbV3EditorLoader(dependencies: GeoKbV3EditorLoaderDependencies): (input: { readonly userId: string; readonly url: string }) => Promise<GeoKbV3EditorLoad> {
  return async ({ userId, url }) => {
    const unavailable = (reason: string): GeoKbV3EditorLoad => ({ kind: "unavailable", reason });
    try {
      const site = normalizeAccountWebsiteUrl(url);
      if (!site) return { kind: "not_found" };
      const registered = await dependencies.ensure({ userId, origin: site.origin, host: site.host, canonicalSiteKey: site.canonicalSiteKey });
      if (registered.kind !== "ok") return registered.kind === "missing" ? { kind: "not_found" } : unavailable("v3_editor_unavailable");
      const scope = { userId, kbId: registered.value.kbId };
      const details = await dependencies.readDetails(scope);
      if (details.kind !== "ok") return unavailable("v3_editor_unavailable");
      const kb = details.value;
      if (kb.kbId !== scope.kbId || kb.canonicalSiteKey !== site.canonicalSiteKey || normalizeAccountWebsiteUrl(kb.origin)?.host !== site.host) return unavailable("v3_editor_unavailable");
      const draft = kb.draft;
      if (draft === null || !isGeoKbPayloadV3Value(draft.payload)) return { kind: "not_v3" };
      const payload = draft.payload;
      // The locked identity has to name the site this knowledge base is
      // registered for. The card draws `host` from the registration and the
      // facts from the locked identity, so a disagreement here is a card that
      // labels one site's knowledge with another site's name.
      if (normalizeAccountWebsiteUrl(payload.generationInput.identity.targetUrl)?.host !== site.host) return unavailable("v3_editor_unavailable");

      let published: GeoKbEditorViewV3["published"] = null;
      if (kb.frozen !== null) {
        const frozen = await dependencies.readFrozenPayload({ ...scope, snapshotId: kb.frozen.snapshotId });
        if (frozen.kind !== "ok") return unavailable("v3_published_version_unavailable");
        // A v3 draft standing over a v1/v2 published version has no honest
        // `published` block: those versions record no per-item decisions, and
        // an empty decision map would report every item as changed while the
        // publish box named a revision produced by a different contract. No
        // path reaches this today -- the create route refuses to replace a
        // legacy draft -- so it is refused rather than approximated.
        if (!isGeoKbPayloadV3Value(frozen.value)) return unavailable("v3_predecessor_unsupported");
        const decided = geoV3DecisionStates(frozen.value.review, geoV3ItemKeys(frozen.value.knowledge));
        published = { revision: kb.frozen.revision, frozenAt: kb.frozen.frozenAt, contentHash: kb.frozen.contentHash,
          decisions: Object.fromEntries([...decided].map(([itemKey, state]) => [itemKey, state.decision])) };
      }
      return { kind: "ok", value: { schemaVersion: "marketing-geo-kb-editor.v3", kbId: kb.kbId, origin: kb.origin, host: kb.host,
        draftVersion: draft.draftVersion, draftHash: draft.contentHash, payload, published } };
    } catch { return unavailable("v3_editor_unavailable"); }
  };
}

/**
 * One entry point that answers with whichever editor this knowledge base
 * actually holds.
 *
 * The v2 loader runs first because it is the common case and because it is the
 * one that can tell a v3 draft apart without a second read -- it already parses
 * the stored draft. Only its named v3 refusal falls through, so a v2 knowledge
 * base costs exactly what it cost before.
 */
export function createGeoKbEditorLoaderAny(
  loadV2: (input: { readonly userId: string; readonly url: string }) => Promise<GeoKbStoreOutcome<GeoKbEditorViewV2>>,
  loadV3: (input: { readonly userId: string; readonly url: string }) => Promise<GeoKbV3EditorLoad>,
): (input: { readonly userId: string; readonly url: string }) => Promise<GeoKbStoreOutcome<GeoKbEditorViewV2 | GeoKbEditorViewV3Wire>> {
  return async input => {
    const v2 = await loadV2(input);
    if (v2.kind !== "unavailable" || v2.reason !== GEO_KB_V3_DRAFT_REASON) return v2;
    const v3 = await loadV3(input);
    // The draft was v3 one read ago. `not_v3` now means it changed underneath
    // this request, and the answer that is still true is the first one.
    return v3.kind === "not_v3" ? v2 : v3;
  };
}
