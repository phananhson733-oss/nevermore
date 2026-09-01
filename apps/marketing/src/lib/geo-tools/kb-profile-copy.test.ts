import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalProfileJson, emptyMarketingWebsiteProfile, type WebsiteProfileReferenceV1 } from "../account-websites/contracts.ts";
import { createGeoProfileCopy, geoKbJsonbBytes, parseGeoProfileCopy, profileCopyReference } from "./kb-profile-copy.ts";
import { assertGeoProfileCopyIntegrity, inheritedProfileFromCopy } from "./kb-profile-copy-server.ts";

const profile = { ...emptyMarketingWebsiteProfile(), productName: " e\u0301 exact ", buyer: "line one\nline two", country: "US", locale: "en" };
const reference: WebsiteProfileReferenceV1 = { schemaVersion: "website-profile-reference.v1", websiteId: "11111111-1111-4111-8111-111111111111", snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 3, profileSchemaVersion: "marketing-website-profile.v1", profileHash: createHash("sha256").update(canonicalProfileJson(profile)).digest("hex") };

describe("complete Profile copy contract", () => {
  it("accepts only an actual source reference and preserves an independent exact profile", () => {
    const copy = createGeoProfileCopy(reference, profile);
    expect(copy.profile).toEqual(profile);
    expect(copy.profile).not.toBe(profile);
    expect(profileCopyReference(copy)).toEqual(reference);
    expect(() => assertGeoProfileCopyIntegrity(copy)).not.toThrow();
    expect(() => createGeoProfileCopy({ ...reference, schemaVersion: "other.v1" } as never, profile)).toThrow();
  });
  it.each(["0", "-1", "01", "1.5", "9007199254740992", 3])("rejects invalid revision %j", (snapshotRevision) => {
    expect(() => parseGeoProfileCopy({ ...createGeoProfileCopy(reference, profile), snapshotRevision })).toThrow();
  });
  it("rejects unknown copy/profile keys instead of silently retaining private data", () => {
    const copy = createGeoProfileCopy(reference, profile);
    expect(() => parseGeoProfileCopy({ ...copy, token: "never accepted" })).toThrow();
    expect(() => parseGeoProfileCopy({ ...copy, profile: { ...profile, token: "never accepted" } })).toThrow();
  });
  it("measures the SQL representation including structural spaces and UTF-8", () => {
    expect(geoKbJsonbBytes({ z: [null, "中文", true], a: "tab\tnewline\n" })).toBe(Buffer.byteLength('{"a": "tab\\tnewline\\n", "z": [null, "中文", true]}'));
    expect(() => geoKbJsonbBytes({ numericRevision: 3 })).toThrow();
  });
  it("does not accept a schema-valid profile larger than its own persisted 128KiB source limit", () => {
    const large = Array.from({ length: 32 }, (_, i) => `${String(i)}${"中".repeat(490)}`);
    expect(() => createGeoProfileCopy(reference, { ...profile, coreFeatures: large, trustSignals: large, useCases: large })).toThrow();
  });
  it("projects source provenance into context without granting operational evidence", () => {
    const copied = createGeoProfileCopy(reference, profile);
    const inherited = inheritedProfileFromCopy(copied);
    expect(inherited).toEqual({ reference, productName: profile.productName, oneLinePositioning: "", coreFeatures: [], market: { country: "US", language: "en" }, fieldProvenance: [] });
    expect(inherited).not.toHaveProperty("fullProfile");
  });
});
