// @input  -- an exact inherited Profile key/value and the current editable fact rows
// @output -- a prefilled candidate that still requires an explicit source before save
// @pos    -- explicit Profile→GEO review action; no writes or inferred provenance

import { GEO_KB_LIMITS, type GeoKbFact } from "../../lib/geo-tools/kb-contract.ts";
import type { MarketingWebsiteProfileV1, WebsiteProfileFieldName } from "../../lib/account-websites/contracts.ts";
import { absolutePublicUrl, validTimestamp } from "../../lib/geo-tools/kb-v2-contract.ts";

export interface GeoProfileFactSource {
  readonly sourceUrl: string;
  readonly observedAt: string;
}

/**
 * The archived Profile records which page each field was read from and when.
 * Carrying that forward saves retyping a URL the account already holds.
 *
 * Three conditions, each of which the fact would otherwise overstate:
 *
 * - `source: "public_page"`, the one source meaning bytes were actually
 *   retrieved from that address. A declared, edited or locally computed field
 *   has no page behind it.
 * - `derivation: "observed"`. A `sourceUrl` on a fact asserts the page states
 *   the value. An inferred field was composed by a model from those pages, and
 *   citing one as though it said so is a claim the archive cannot back.
 * - Exactly one evidence URL. With several, any single choice is arbitrary and
 *   the fact would cite a page picked by array order.
 *
 * A carried address is still not verification: the fact stays pending with an
 * empty crawl support reference until a source refresh finds it. It now can.
 * The crawler matches a fact by finding its key text and its value together in
 * one page segment, and the key is the claim itself, so both halves are text a
 * page can carry. While the key was the Profile field path -- `coreFeatures[0]`,
 * which appears on no page -- such a fact was user-confirmed or nothing.
 */
export function geoProfileFactSource(profile: MarketingWebsiteProfileV1, key: string): GeoProfileFactSource | null {
  const field = key.replace(/\[\d+\]$/u, "") as WebsiteProfileFieldName;
  const entry = profile.fieldProvenance.find((row) => row.path === `/${field}`);
  if (!entry || entry.source !== "public_page" || entry.derivation !== "observed") return null;
  if (entry.observedAt === null || !validTimestamp(entry.observedAt)) return null;
  const [sourceUrl] = entry.evidenceUrls;
  if (entry.evidenceUrls.length !== 1 || sourceUrl === undefined) return null;
  return sourceUrl.length <= GEO_KB_LIMITS.url && absolutePublicUrl(sourceUrl) ? { sourceUrl, observedAt: entry.observedAt } : null;
}

type PendingGeoProfileFact =
  | { readonly status: "ready"; readonly fact: GeoKbFact }
  | { readonly status: "exists" | "too_long" | "full" };

function normalizedFactKey(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
}

/**
 * The stored key is the claim itself, not the Profile field it came from.
 * `inspectGeoFact` verifies a fact by finding its key and its value together in
 * one page segment, and a field path -- `coreFeatures[0]` -- appears on no
 * page: keying by it made every Profile-derived fact unverifiable by
 * construction, and put a machine string where the visitor reads a dimension.
 * Deduplication follows the same rule -- the same claim is the same fact,
 * whichever Profile field offered it.
 *
 * `field` still says which field this came from, because that is what the
 * caller looks the recorded provenance up by; it is no longer what gets saved.
 */
export function pendingGeoProfileFact(field: string, value: string, facts: readonly GeoKbFact[], source: GeoProfileFactSource | null = null): PendingGeoProfileFact {
  const key = value;
  if (field.length === 0 || key.length === 0 || key.length > GEO_KB_LIMITS.text || value.length > GEO_KB_LIMITS.text || value.trim() !== value) return { status: "too_long" };
  // Against both halves of every row. The key is what the payload requires to
  // be unique, so a claim equal to an existing dimension would collide there;
  // the value is the claim, so a claim equal to an existing value is the same
  // fact filed twice. Comparing keys alone let a claim matching an existing
  // row's value straight through, and refused one whose only match was a
  // dimension nothing had claimed.
  if (facts.some((fact) => normalizedFactKey(fact.key) === normalizedFactKey(key) || normalizedFactKey(fact.value) === normalizedFactKey(key))) return { status: "exists" };
  if (facts.length >= GEO_KB_LIMITS.facts) return { status: "full" };
  return { status: "ready", fact: { key, value, reason: "", sourceUrl: source?.sourceUrl ?? "", observedAt: source?.observedAt ?? "" } };
}

export function pendingGeoFeatureFact(feature: string, facts: readonly GeoKbFact[]): PendingGeoProfileFact {
  return pendingGeoProfileFact(feature, feature, facts);
}
