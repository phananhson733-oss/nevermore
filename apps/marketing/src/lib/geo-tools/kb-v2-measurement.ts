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
  readonly competitorsDiffer: boolean;
  readonly overCompetitorLimit: boolean;
}

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
  const source = proposal.competitors.map((row) => row.value);
  return {
    fields,
    sourceCompetitorCount: proposal.competitors.length,
    draftCompetitorCount: payload.competitors.length,
    competitorsDiffer: JSON.stringify(source) !== JSON.stringify(payload.competitors),
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
    next = field === "market" ? { ...next, market: value as GeoKbPayloadV2["market"] }
      : field === "categoryTerms" ? { ...next, categoryTerms: value as readonly string[] }
        : { ...next, officialName: value as string };
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
