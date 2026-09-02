// @input  -- the confirmed Profile copy a V2 draft already carries, and that draft
// @output -- named differences and an explicit, bounded way to adopt them
// @pos    -- measurement inputs only; roles and facts keep their own review lineage
import type { MarketingWebsiteProfileV1 } from "../account-websites/contracts.ts";
import { GEO_KB_LIMITS } from "./kb-contract.ts";
import type { GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { buildGeoProfileSuggestions, type GeoProfileSuggestions } from "./kb-profile-suggestions.ts";

/**
 * Roles are deliberately absent. A V2 role carries a review state and, when it
 * came from a generation, the evidence it was built from. Overwriting the role
 * group from the Profile would throw both away while looking like a field
 * update, so roles stay with their own generate-and-review path.
 */
export const GEO_V2_MEASUREMENT_FIELDS = ["officialName", "categoryTerms", "market"] as const;
export type GeoV2MeasurementField = (typeof GEO_V2_MEASUREMENT_FIELDS)[number];

export interface GeoV2MeasurementGap {
  readonly fields: readonly GeoV2MeasurementField[];
  readonly sourceCompetitorCount: number;
  readonly draftCompetitorCount: number;
  readonly missingCompetitorCount: number;
  readonly competitorsDiffer: boolean;
  readonly overCompetitorLimit: boolean;
}

const competitorIdentity = (competitor: { readonly domain: string; readonly brandName: string }): string =>
  competitor.domain ? `domain:${competitor.domain}` : `brand:${competitor.brandName.trim().toLowerCase()}`;

export function geoV2MeasurementProposal(profile: MarketingWebsiteProfileV1, payload: GeoKbPayloadV2): GeoProfileSuggestions {
  return buildGeoProfileSuggestions(profile, { competitors: payload.competitors });
}

export function geoV2MeasurementGap(profile: MarketingWebsiteProfileV1, payload: GeoKbPayloadV2): GeoV2MeasurementGap {
  const proposal = geoV2MeasurementProposal(profile, payload);
  const fields = GEO_V2_MEASUREMENT_FIELDS.filter((field) => {
    const proposed = proposal.fields[field];
    // A proposal the source cannot supply is not a difference the visitor can act on.
    return proposed !== null && JSON.stringify(proposed) !== JSON.stringify(payload[field]);
  });
  const held = new Set(payload.competitors.map(competitorIdentity));
  // Only a Profile competitor that can be mapped and is absent from the
  // measurement set counts. Order is not a difference, an entry the Profile
  // stores in a form GEO cannot use is not adoptable, and a measurement set
  // already at the limit has no room - reporting any of those would leave a
  // banner the visitor has no way to clear.
  const missing = proposal.competitors.filter((row) => row.value !== null && !held.has(competitorIdentity(row.value)));
  const room = payload.competitors.length < GEO_KB_LIMITS.competitors;
  return {
    fields,
    sourceCompetitorCount: proposal.competitors.length,
    draftCompetitorCount: payload.competitors.length,
    missingCompetitorCount: missing.length,
    competitorsDiffer: room && missing.length > 0,
    overCompetitorLimit: proposal.competitors.length > GEO_KB_LIMITS.competitors,
  };
}

export function hasGeoV2MeasurementGap(gap: GeoV2MeasurementGap): boolean {
  return gap.fields.length > 0 || gap.competitorsDiffer;
}

export function applyGeoV2Measurement(
  payload: GeoKbPayloadV2,
  proposal: GeoProfileSuggestions,
  selection: { readonly fields: readonly GeoV2MeasurementField[]; readonly competitorIndices: readonly number[] | null },
): GeoKbPayloadV2 {
  if (new Set(selection.fields).size !== selection.fields.length) throw new Error("Duplicate measurement field");
  let next: GeoKbPayloadV2 = { ...payload };
  for (const field of selection.fields) {
    const value = proposal.fields[field];
    if (value === null || value === undefined) throw new Error("Unavailable measurement proposal");
    if (field === "market") next = { ...next, market: value as GeoKbPayloadV2["market"] };
    else if (field === "categoryTerms") next = { ...next, categoryTerms: value as readonly string[] };
    else if (field === "officialName") next = { ...next, officialName: value as string };
    // No fallthrough: an unrecognised field must not be written onto whichever
    // branch happens to be last.
    else throw new Error("Unsupported measurement field");
  }
  if (selection.competitorIndices !== null) {
    const indices = selection.competitorIndices;
    if (indices.length > GEO_KB_LIMITS.competitors || new Set(indices).size !== indices.length) throw new Error("Choose at most five distinct competitors");
    const competitors = indices.map((index) => {
      const value = Number.isInteger(index) && index >= 0 ? proposal.competitors[index]?.value : null;
      if (!value) throw new Error("Unavailable competitor proposal");
      return value;
    });
    const identities = competitors.map((row) => (row.domain ? `domain:${row.domain}` : `brand:${row.brandName.toLowerCase()}`));
    if (new Set(identities).size !== identities.length) throw new Error("Duplicate competitor identities");
    next = { ...next, competitors };
  }
  return next;
}
