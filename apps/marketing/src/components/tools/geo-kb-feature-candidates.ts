// @input  -- an exact inherited feature and the current editable fact rows
// @output -- an unverified empty-value candidate, never an observed statement
// @pos    -- explicit Profile→GEO review action; no writes or inferred provenance

import { GEO_KB_LIMITS, type GeoKbFact } from "../../lib/geo-tools/kb-contract.ts";

export function pendingGeoFeatureFact(feature: string, facts: readonly GeoKbFact[]):
  | { readonly status: "ready"; readonly fact: GeoKbFact }
  | { readonly status: "exists" | "too_long" | "full" } {
  if (feature.length === 0 || feature.length > GEO_KB_LIMITS.text || feature.trim() !== feature) return { status: "too_long" };
  if (facts.some((fact) => fact.key.trim().toLocaleLowerCase("en") === feature.toLocaleLowerCase("en"))) return { status: "exists" };
  if (facts.length >= GEO_KB_LIMITS.facts) return { status: "full" };
  return { status: "ready", fact: { key: feature, value: "", reason: "lowConfidence", sourceUrl: "", observedAt: "" } };
}
