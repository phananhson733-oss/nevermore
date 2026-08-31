// @input -- a stored or submitted complete GEO Profile copy
// @output -- independently verified source digest and legacy context projection
// @pos -- server-only integrity check, never reads a live Website Profile
import { createHash } from "node:crypto";
import { canonicalProfileJson } from "../account-websites/contracts.ts";
import type { GeoInheritedProfile } from "./asset-context.ts";
import { parseGeoProfileCopy, profileCopyReference, type GeoProfileCopy } from "./kb-profile-copy.ts";

export function assertGeoProfileCopyIntegrity(copy: GeoProfileCopy): void {
  const parsed = parseGeoProfileCopy(copy);
  const hash = createHash("sha256").update(canonicalProfileJson(parsed.profile), "utf8").digest("hex");
  if (hash !== parsed.profileHash) throw new Error("Copied Profile hash mismatch");
}

/** Preserve the existing context contract, not its editor-only fullProfile. */
export function inheritedProfileFromCopy(copy: GeoProfileCopy): GeoInheritedProfile {
  assertGeoProfileCopyIntegrity(copy);
  return {
    reference: profileCopyReference(copy),
    productName: copy.profile.productName,
    oneLinePositioning: copy.profile.oneLinePositioning,
    coreFeatures: copy.profile.coreFeatures,
    market: { country: copy.profile.country, language: copy.profile.locale },
    fieldProvenance: copy.profile.fieldProvenance.filter((field) => ["/productName", "/oneLinePositioning", "/coreFeatures"].includes(field.path)),
  };
}
