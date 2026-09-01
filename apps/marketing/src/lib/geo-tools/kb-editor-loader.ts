// @input -- a verified account and exact owned GEO records
// @output -- one complete editor view; an upgrade preview is never a write
// @pos -- server-side loading only, with old frozen records kept independent
import type { MarketingWebsiteProfileV1, WebsiteProfileReferenceV1 } from "../account-websites/contracts.ts";
import type { GeoKbEditorViewV2, GeoKbFrozenV2Wire } from "../../components/tools/geo-kb-v2-wire.ts";
import type { GeoKbFrozenSummary } from "../../components/tools/geo-kb-wire.ts";
import type { VersionedGeoKbDetails } from "./kb-versioned-read.ts";
import type { GeoKbRegistration, GeoKbStoreResult } from "./kb-store.ts";
import type { GeoKbStoreOutcome } from "./kb-handler.ts";
import type { GeoKbSourceReportV2 } from "./kb-source-contract.ts";
import type { GeoPreparedCandidateV1 } from "./kb-prepared-contract.ts";
import type { GeoKbGenerationRead } from "./kb-generation-store.ts";
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
  readonly readFrozen: (input: { readonly userId: string; readonly kbId: string; readonly snapshotId: string }) => Promise<{ readonly kind: "ok"; readonly value: GeoKbFrozenV2Wire | GeoKbFrozenSummary } | { readonly kind: "unavailable" }>;
  readonly readSource: (input: { readonly userId: string; readonly kbId: string }) => Promise<GeoKbStoreResult<GeoKbSourceReportV2 | null>>;
  readonly readPrepared: (input: { readonly userId: string; readonly kbId: string }) => Promise<GeoKbStoreResult<GeoPreparedCandidateV1 | null>>;
  readonly readGeneration: (input: { readonly userId: string; readonly kbId: string; readonly kind: "roles" | "questions" }) => Promise<GeoKbGenerationRead>;
}

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
      if (details.kind !== "ok" || source.kind === "unavailable") return unavailable();
      const kb = details.value;
      if (kb.kbId !== scope.kbId || kb.canonicalSiteKey !== site.canonicalSiteKey || normalizeAccountWebsiteUrl(kb.origin)?.host !== site.host) return unavailable();
      const currentCopy = source.kind === "ok" ? createGeoProfileCopy(source.value.reference, source.value.profile) : null;
      if (currentCopy) assertGeoProfileCopyIntegrity(currentCopy);
      const profile = currentCopy ? { ...inheritedProfileFromCopy(currentCopy), fullProfile: currentCopy.profile } : null;
      let original = kb.draft?.payload;
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
      const [receipt, prepared, roles, questions, frozen] = await Promise.all([
        dependencies.readSource(scope), dependencies.readPrepared(scope), dependencies.readGeneration({ ...scope, kind: "roles" }), dependencies.readGeneration({ ...scope, kind: "questions" }),
        kb.frozen === null ? Promise.resolve({ kind: "ok" as const, value: null }) : dependencies.readFrozen({ ...scope, snapshotId: kb.frozen.snapshotId }),
      ]);
      if (receipt.kind !== "ok" || prepared.kind !== "ok" || roles.kind !== "ok" || questions.kind !== "ok" || frozen.kind !== "ok") return unavailable();
      for (const generation of [roles.generation, questions.generation]) if (generation && (generation.userId !== userId || generation.kbId !== scope.kbId)) return unavailable();
      const view = parseGeoKbEditorViewV2({ schemaVersion: "marketing-geo-kb-editor.v2", kbId: kb.kbId, origin: kb.origin, host: kb.host,
        draftVersion: kb.draft?.draftVersion ?? 0, draftHash: kb.draft?.contentHash ?? null, profileCopyHash: geoV2Digest(payload.profileCopy), payload, requiresSave, profile, frozen: frozen.value,
        sourceReceipt: receipt.value, prepared: prepared.value,
        generations: { roles: roles.generation ? publicGeoKbGeneration(roles.generation) : null, questions: questions.generation ? publicGeoKbGeneration(questions.generation) : null } });
      return view === null ? unavailable() : { kind: "ok", value: view };
    } catch { return unavailable(); }
  };
}
