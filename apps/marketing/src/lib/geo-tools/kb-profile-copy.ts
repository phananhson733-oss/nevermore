// @input -- an exact confirmed Website Profile and its immutable reference
// @output -- client-safe complete GEO copy; shared fields are never edited here
// @pos -- additive self-contained source data, separate from GEO operational fields
import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  parseMarketingWebsiteProfile,
  parseWebsiteProfileReference,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileReferenceV1,
} from "../account-websites/contracts.ts";

export const GEO_PROFILE_COPY_SCHEMA = "marketing-geo-profile-copy.v1" as const;
export const GEO_PROFILE_COPY_MAX_BYTES = 131_072;
export interface GeoProfileCopy {
  readonly schemaVersion: typeof GEO_PROFILE_COPY_SCHEMA;
  readonly websiteId: string;
  readonly snapshotId: string;
  readonly snapshotRevision: string;
  readonly profileHash: string;
  readonly profile: MarketingWebsiteProfileV1;
}

/** jsonb::text includes presentation spaces that canonical JSON omits. */
export function geoKbJsonbBytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === "string") return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (Array.isArray(value)) return 2 + value.reduce<number>((sum, child) => sum + geoKbJsonbBytes(child), 0) + Math.max(0, value.length - 1) * 2;
  if (typeof value !== "object") throw new TypeError("GEO payload contains a non-JSON scalar");
  const entries = Object.entries(value);
  return 2 + entries.reduce((sum, [key, child]) => sum + geoKbJsonbBytes(key) + 2 + geoKbJsonbBytes(child), 0) + Math.max(0, entries.length - 1) * 2;
}

export function profileCopyReference(copy: GeoProfileCopy): WebsiteProfileReferenceV1 {
  if (!/^[1-9][0-9]{0,15}$/u.test(copy.snapshotRevision) || !Number.isSafeInteger(Number(copy.snapshotRevision))) throw new Error("Invalid Profile copy revision");
  return parseWebsiteProfileReference({
    schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
    websiteId: copy.websiteId,
    snapshotId: copy.snapshotId,
    snapshotRevision: Number(copy.snapshotRevision),
    profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
    profileHash: copy.profileHash,
  });
}

export function parseGeoProfileCopy(value: unknown): GeoProfileCopy {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Profile copy");
  const record = value as Record<string, unknown>;
  const keys = ["schemaVersion", "websiteId", "snapshotId", "snapshotRevision", "profileHash", "profile"];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)) || record.schemaVersion !== GEO_PROFILE_COPY_SCHEMA || typeof record.snapshotRevision !== "string") throw new Error("Invalid Profile copy shape");
  const profile = parseMarketingWebsiteProfile(record.profile);
  if (geoKbJsonbBytes(profile) > GEO_PROFILE_COPY_MAX_BYTES) throw new Error("Profile copy exceeds source storage limit");
  const copy = { ...record, profile } as unknown as GeoProfileCopy;
  profileCopyReference(copy);
  return copy;
}

/** Preparation only: hash/ownership are independently checked on the server. */
export function createGeoProfileCopy(reference: WebsiteProfileReferenceV1, profile: MarketingWebsiteProfileV1): GeoProfileCopy {
  reference = parseWebsiteProfileReference(reference);
  return parseGeoProfileCopy({ schemaVersion: GEO_PROFILE_COPY_SCHEMA, websiteId: reference.websiteId, snapshotId: reference.snapshotId, snapshotRevision: String(reference.snapshotRevision), profileHash: reference.profileHash, profile });
}
