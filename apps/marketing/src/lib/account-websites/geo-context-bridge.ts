// @input  -- a GEO target and one exact confirmed Marketing website snapshot
// @output -- a bounded local GEO proposal plus the pinned snapshot reference
// @pos    -- explicit adapter between durable account context and GEO run state

import {
  parseWebsiteDetails,
  parseWebsiteProfileReference,
  profileSha256,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
  type WebsiteProfileReferenceV1,
} from "./contracts.ts";
import {
  isGeoCountryCode,
  proposeGeoAliasCandidates,
  type GeoAliasCandidateV1,
  type GeoContextSourceEntryV1,
} from "../agents/geo-context.ts";
import { normalizeGeoText } from "../agents/geo-canonical.ts";
import {
  normalizeGeoHost,
  normalizeGeoTargetUrl,
} from "../agents/geo-url.ts";

export interface GeoWebsiteProfileProjection {
  readonly targetUrl: string;
  readonly productName: string;
  readonly brandAliases: readonly GeoAliasCandidateV1[];
  readonly category: string;
  readonly categoryConfirmed: false;
  readonly buyer: string;
  readonly user: string;
  readonly jtbd: string;
  readonly useCases: readonly string[];
  readonly outcomes: readonly string[];
  readonly barriers: readonly string[];
  readonly directCompetitors: readonly string[];
  readonly indirectAlternatives: readonly string[];
  readonly marketCode: string;
  readonly sourceProfileVersion: string;
  readonly sourceSummary: readonly GeoContextSourceEntryV1[];
  readonly websiteProfileReference: WebsiteProfileReferenceV1;
}

export interface GeoWebsiteProfileHiddenProjection {
  readonly user: string;
  readonly useCases: readonly string[];
  readonly outcomes: readonly string[];
  readonly barriers: readonly string[];
  readonly indirectAlternatives: readonly string[];
  readonly sourceProfileVersion: string;
  readonly sourceSummary: readonly GeoContextSourceEntryV1[];
}

function boundedProjectionList(
  values: readonly string[],
  maxItems: number,
): readonly string[] {
  const projected: string[] = [];
  for (const value of values) {
    const normalized = normalizeGeoText(value);
    if (
      normalized.length === 0 ||
      normalized.length > 120 ||
      projected.includes(normalized)
    ) {
      continue;
    }
    projected.push(normalized);
    if (projected.length === maxItems) break;
  }
  return projected;
}

function boundedProjectionText(value: string, max: number): string {
  const normalized = normalizeGeoText(value);
  return normalized.length <= max ? normalized : "";
}

/**
 * The immutable subset an exact GEO reference is allowed to claim as pinned.
 *
 * Pure and shared by the browser bridge and the pre-billing server check. Text
 * that does not fit GEO is omitted rather than truncated into a different fact;
 * list order is stable, duplicates and over-bound entries are omitted, and only
 * non-empty projected fields receive pinned-source provenance.
 */
export function projectWebsiteProfileHiddenContext(
  profile: MarketingWebsiteProfileV1,
): GeoWebsiteProfileHiddenProjection {
  const user = boundedProjectionText(profile.user, 300);
  const useCases = boundedProjectionList(profile.useCases, 12);
  const outcomes = boundedProjectionList(profile.outcomes, 12);
  const barriers = boundedProjectionList(profile.barriers, 12);
  const indirectAlternatives = boundedProjectionList(
    profile.indirectAlternatives,
    10,
  );
  const entries: GeoContextSourceEntryV1[] = [];
  for (const [field, present] of [
    ["user", user !== ""],
    ["use_cases", useCases.length > 0],
    ["outcomes", outcomes.length > 0],
    ["barriers", barriers.length > 0],
    ["indirect_alternatives", indirectAlternatives.length > 0],
  ] as const) {
    if (present) {
      entries.push({
        field,
        source: "saved_website_profile",
        limitationCode: "pinned_snapshot",
      });
    }
  }
  return {
    user,
    useCases,
    outcomes,
    barriers,
    indirectAlternatives,
    sourceProfileVersion: profile.schemaVersion,
    sourceSummary: entries,
  };
}

function savedSource(
  field: string,
  valuePresent: boolean,
  candidate = false,
): GeoContextSourceEntryV1 {
  return valuePresent
    ? {
        field,
        source: candidate
          ? "saved_website_profile_candidate"
          : "saved_website_profile",
        limitationCode: candidate
          ? "requires_current_confirmation"
          : "pinned_snapshot",
      }
    : {
        field,
        source: "not_supplied",
        limitationCode: "not_supplied",
      };
}

/**
 * Build run-local GEO input from one exact confirmed website snapshot.
 *
 * This is a consistency adapter, not authorization. The run endpoint resolves
 * the exact reference again for the authenticated user before it constructs a
 * provider or claims a budget. No value here is confirmed on the visitor's
 * behalf and this module has no write path back to the account profile.
 */
export async function referenceWebsiteProfileForGeo(input: {
  readonly targetUrl: string;
  readonly website: WebsiteDetails;
}): Promise<GeoWebsiteProfileProjection> {
  const targetUrl = normalizeGeoTargetUrl(input.targetUrl);
  const targetHost =
    targetUrl === null ? null : normalizeGeoHost(targetUrl);
  if (targetUrl === null || targetHost === null) {
    throw new Error("GEO target URL is invalid");
  }

  const website = await parseWebsiteDetails(input.website);
  if (website.canonicalSiteKey !== targetHost) {
    throw new Error("website profile host does not match the GEO target host");
  }
  const snapshot = website.currentConfirmedSnapshot;
  if (snapshot === null) {
    throw new Error("website profile must have a confirmed snapshot");
  }

  const reference = parseWebsiteProfileReference({
    schemaVersion: snapshot.schemaVersion,
    websiteId: snapshot.websiteId,
    snapshotId: snapshot.snapshotId,
    snapshotRevision: snapshot.snapshotRevision,
    profileSchemaVersion: snapshot.profileSchemaVersion,
    profileHash: snapshot.profileHash,
  });
  if (
    reference.websiteId !== website.websiteId ||
    (await profileSha256(snapshot.profile)) !== reference.profileHash
  ) {
    throw new Error("website profile hash or reference identity does not match");
  }

  const profile = snapshot.profile;
  const productName = normalizeGeoText(profile.productName);
  const category = normalizeGeoText(profile.categories[0] ?? "");
  const declaredBuyer = normalizeGeoText(profile.buyer);
  const buyer =
    declaredBuyer === ""
      ? normalizeGeoText(profile.primaryIcp)
      : declaredBuyer;
  const jtbd = normalizeGeoText(profile.jtbd);
  const hidden = projectWebsiteProfileHiddenContext(profile);
  const directCompetitors = boundedProjectionList(profile.directCompetitors, 10);
  const marketCode = isGeoCountryCode(profile.country) ? profile.country : "";
  const brandAliases = proposeGeoAliasCandidates(targetUrl, productName);

  return {
    targetUrl,
    productName,
    brandAliases,
    category,
    categoryConfirmed: false,
    buyer,
    user: hidden.user,
    jtbd,
    useCases: hidden.useCases,
    outcomes: hidden.outcomes,
    barriers: hidden.barriers,
    directCompetitors,
    indirectAlternatives: hidden.indirectAlternatives,
    marketCode,
    sourceProfileVersion: hidden.sourceProfileVersion,
    sourceSummary: [
      {
        field: "target_url",
        source: "visitor_url",
        limitationCode: null,
      },
      savedSource("product_name", productName !== ""),
      savedSource("category", category !== "", true),
      savedSource("buyer", buyer !== ""),
      savedSource("brand_aliases", brandAliases.length > 0, true),
      savedSource("direct_competitors", directCompetitors.length > 0),
      savedSource("jtbd", jtbd !== ""),
      ...hidden.sourceSummary,
      savedSource("market_code", marketCode !== ""),
      {
        field: "target_query_language",
        source: "product_constraint",
        limitationCode: "english_only_in_p0",
      },
    ],
    websiteProfileReference: reference,
  };
}
