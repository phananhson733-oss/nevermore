// @input  -- an exact inherited Profile key/value and the current editable fact rows
// @output -- a prefilled candidate that still requires an explicit source before save
// @pos    -- explicit Profile→GEO review action; no writes or inferred provenance

import { GEO_KB_LIMITS, type GeoKbFact } from "../../lib/geo-tools/kb-contract.ts";
import { normalizeAccountWebsiteUrl, type MarketingWebsiteProfileV1, type WebsiteProfileFieldName } from "../../lib/account-websites/contracts.ts";

export interface GeoProfileFactSource {
  readonly sourceUrl: string;
  readonly observedAt: string;
}

const publicUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && normalizeAccountWebsiteUrl(value) !== null;
  } catch { return false; }
};
const exactTimestamp = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/**
 * The archived Profile already records which page each field was read from and
 * when. Carrying that forward saves retyping a URL the account has, and saves a
 * second fetch of a page already fetched.
 *
 * Only `public_page` qualifies: it is the one source that means bytes were
 * actually retrieved from that address. A declared, edited or locally inferred
 * field has no page behind it, and inventing one would turn a claim into a
 * citation. Carrying the address is still not verification - the fact stays
 * pending, and its crawl support reference stays empty until a GEO source
 * receipt matches it.
 */
export function geoProfileFactSource(profile: MarketingWebsiteProfileV1, key: string): GeoProfileFactSource | null {
  const field = key.replace(/\[\d+\]$/u, "") as WebsiteProfileFieldName;
  const entry = profile.fieldProvenance.find((row) => row.path === `/${field}`);
  if (!entry || entry.source !== "public_page" || entry.observedAt === null || !exactTimestamp(entry.observedAt)) return null;
  const sourceUrl = entry.evidenceUrls.find((url) => url.length <= 2048 && publicUrl(url));
  return sourceUrl === undefined ? null : { sourceUrl, observedAt: entry.observedAt };
}

type PendingGeoProfileFact =
  | { readonly status: "ready"; readonly fact: GeoKbFact }
  | { readonly status: "exists" | "too_long" | "full" };

function normalizedFactKey(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
}

export function pendingGeoProfileFact(key: string, value: string, facts: readonly GeoKbFact[], source: GeoProfileFactSource | null = null): PendingGeoProfileFact {
  if (key.length === 0 || key.length > GEO_KB_LIMITS.text || key.trim() !== key || value.length === 0 || value.length > GEO_KB_LIMITS.text || value.trim() !== value) return { status: "too_long" };
  if (facts.some((fact) => normalizedFactKey(fact.key) === normalizedFactKey(key))) return { status: "exists" };
  if (facts.length >= GEO_KB_LIMITS.facts) return { status: "full" };
  return { status: "ready", fact: { key, value, reason: "", sourceUrl: source?.sourceUrl ?? "", observedAt: source?.observedAt ?? "" } };
}

export function pendingGeoFeatureFact(feature: string, facts: readonly GeoKbFact[]): PendingGeoProfileFact {
  return pendingGeoProfileFact(feature, feature, facts);
}
