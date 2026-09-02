// @input -- complete confirmed Profile and existing GEO operational overrides
// @output -- explicit, bounded measurement proposals; no automatic save or confirmation
// @pos -- source-to-measurement mapping review, separate from copying complete source data
import type { MarketingWebsiteProfileV1 } from "../account-websites/contracts.ts";
import { validateGeoPlaceholderValue } from "../agents/geo-template-registry.ts";
import { validGeoCategoryPlaceholders } from "./kb-question-placeholders.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { GEO_KB_LIMITS, type GeoKbCompetitor, type GeoKbPayload } from "./kb-contract.ts";
export const GEO_MEASUREMENT_FIELDS = ["officialName", "categoryTerms", "market", "roles"] as const;
export type GeoMeasurementField = (typeof GEO_MEASUREMENT_FIELDS)[number];
export interface GeoProfileSuggestions {
  readonly fields: { readonly [K in GeoMeasurementField]: GeoKbPayload[K] | null };
  readonly competitors: readonly { readonly sourceValue: string; readonly value: GeoKbCompetitor | null }[];
}
// GEO operational text rejects control characters; the complete source copy still preserves them.
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u001f\u007f]/u;
const textFits = (value: string, max: number) => value.trim().length > 0 && value.trim().length <= max && !controls.test(value);
const listFits = (value: readonly string[], count: number, max: number) => value.length <= count && value.every(row => textFits(row, max));

export function buildGeoProfileSuggestions(profile: MarketingWebsiteProfileV1, payload: { readonly competitors: readonly GeoKbCompetitor[] }): GeoProfileSuggestions {
  const label = profile.buyer.trim() || profile.primaryIcp.trim();
  const painPoints = [profile.triggerPain, profile.icpPain].filter(value => value.trim());
  const roles = textFits(label, GEO_KB_LIMITS.text) && validateGeoPlaceholderValue("buyer", label) === null && profile.primaryIcp.length <= GEO_KB_LIMITS.text && !controls.test(profile.primaryIcp) && listFits(painPoints, 8, GEO_KB_LIMITS.listItem) && listFits(profile.qualificationSignals, 8, GEO_KB_LIMITS.listItem) && listFits(profile.icpInterests, 12, GEO_KB_LIMITS.listItem)
    ? [{ id: "profile-primary", label, segment: profile.primaryIcp, painPoints, decisionCriteria: [...profile.qualificationSignals], vocabulary: [...profile.icpInterests] }] : null;
  const country = profile.country.trim().toUpperCase(), language = profile.locale.trim().toLowerCase();
  return {
    fields: {
      officialName: textFits(profile.productName, GEO_KB_LIMITS.text) ? profile.productName.trim() : null,
      categoryTerms: profile.categories.length > 0 && validGeoCategoryPlaceholders(profile.categories[0]!) && listFits(profile.categories, GEO_KB_LIMITS.categoryTerms, GEO_KB_LIMITS.listItem) ? [...profile.categories] : null,
      market: /^[A-Z]{2}$/u.test(country) && /^[a-z]{2}(-[a-z]{2})?$/u.test(language) ? { country, language } : null,
      roles,
    },
    competitors: profile.directCompetitors.map(sourceValue => {
      if (!textFits(sourceValue, GEO_KB_LIMITS.text)) return { sourceValue, value: null };
      const clean = sourceValue.trim();
      const domain = /\s/u.test(clean) ? null : normalizeGeoHost(clean);
      const existing = payload.competitors.find(row => domain ? row.domain === domain : row.brandName.toLowerCase() === clean.toLowerCase());
      return { sourceValue, value: existing ?? (domain ? { domain, brandName: "", confirmed: false } : { domain: "", brandName: clean, confirmed: false }) };
    }),
  };
}

/** The one way two competitor rows are judged to be the same competitor. */
export const competitorIdentity = (competitor: { readonly domain: string; readonly brandName: string }): string =>
  competitor.domain ? `domain:${competitor.domain}` : `brand:${competitor.brandName.trim().toLowerCase()}`;

/** The bounded subset a visitor may adopt from a proposal, shared by V1 and V2. */
export function selectProposedCompetitors(proposal: GeoProfileSuggestions, indices: readonly number[]): readonly GeoKbCompetitor[] {
  if (indices.length > GEO_KB_LIMITS.competitors || new Set(indices).size !== indices.length) throw new Error(`Choose at most ${GEO_KB_LIMITS.competitors} distinct competitors`);
  const competitors = indices.map(index => {
    const value = Number.isInteger(index) && index >= 0 ? proposal.competitors[index]?.value : null;
    if (!value) throw new Error("Unavailable competitor proposal");
    return value;
  });
  const identities = competitors.map(competitorIdentity);
  if (new Set(identities).size !== identities.length) throw new Error("Duplicate competitor identities");
  return competitors;
}

export function applyGeoProfileSuggestions(payload: GeoKbPayload, proposal: GeoProfileSuggestions, selection: { readonly fields: readonly GeoMeasurementField[]; readonly competitorIndices: readonly number[] | null }): GeoKbPayload {
  const next = { ...payload };
  if (new Set(selection.fields).size !== selection.fields.length) throw new Error("Duplicate measurement field");
  for (const field of selection.fields) {
    const value = proposal.fields[field];
    if (value === null || value === undefined) throw new Error("Unavailable measurement proposal");
    Object.assign(next, { [field]: value });
  }
  if (selection.competitorIndices !== null) next.competitors = [...selectProposedCompetitors(proposal, selection.competitorIndices)];
  return next;
}

export function geoProfileMeasurementDifferences(profile: MarketingWebsiteProfileV1, payload: GeoKbPayload): readonly (GeoMeasurementField | "competitors")[] {
  const proposal = buildGeoProfileSuggestions(profile, payload);
  const fields: (GeoMeasurementField | "competitors")[] = GEO_MEASUREMENT_FIELDS.filter(field => JSON.stringify(proposal.fields[field]) !== JSON.stringify(payload[field]));
  const competitors = proposal.competitors.map(row => row.value);
  if (JSON.stringify(competitors) !== JSON.stringify(payload.competitors)) fields.push("competitors");
  return fields;
}
