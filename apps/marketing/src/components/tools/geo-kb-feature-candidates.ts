// @input  -- an exact inherited Profile key/value and the current editable fact rows
// @output -- a prefilled candidate that still requires an explicit source before save
// @pos    -- explicit Profile→GEO review action; no writes or inferred provenance

import { GEO_KB_LIMITS, type GeoKbFact } from "../../lib/geo-tools/kb-contract.ts";

type PendingGeoProfileFact =
  | { readonly status: "ready"; readonly fact: GeoKbFact }
  | { readonly status: "exists" | "too_long" | "full" };

function normalizedFactKey(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
}

export function pendingGeoProfileFact(key: string, value: string, facts: readonly GeoKbFact[]): PendingGeoProfileFact {
  if (key.length === 0 || key.length > GEO_KB_LIMITS.text || key.trim() !== key || value.length === 0 || value.length > GEO_KB_LIMITS.text || value.trim() !== value) return { status: "too_long" };
  if (facts.some((fact) => normalizedFactKey(fact.key) === normalizedFactKey(key))) return { status: "exists" };
  if (facts.length >= GEO_KB_LIMITS.facts) return { status: "full" };
  return { status: "ready", fact: { key, value, reason: "", sourceUrl: "", observedAt: "" } };
}

export function pendingGeoFeatureFact(feature: string, facts: readonly GeoKbFact[]): PendingGeoProfileFact {
  return pendingGeoProfileFact(feature, feature, facts);
}
