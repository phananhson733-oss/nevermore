// @input  -- one confirmed Marketing website profile snapshot
// @output -- a knowledge-base draft prefilled from it, with nothing confirmed on the visitor's behalf
// @pos    -- a one-time import, not a sync; the two records diverge after this and both know it

import type { MarketingWebsiteProfileV1 } from "../account-websites/contracts.ts";
import { proposeGeoKbAliases } from "./kb-aliases.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import {
  emptyGeoKbPayload,
  GEO_KB_LIMITS,
  type GeoKbCompetitor,
  type GeoKbPayload,
  type GeoKbRole,
} from "./kb-contract.ts";

/**
 * Why this is an import and not a projection.
 *
 * The account profile answers "what is this product"; a knowledge base answers
 * "what do we call it, who competes with it, and what have we verified". They
 * overlap on the first question and diverge on the rest, and both are edited by
 * hand afterwards. A live projection would mean editing the knowledge base
 * silently rewrote the profile's frozen history, or the reverse - so the import
 * happens once, records which snapshot it came from, and stops.
 */

function trimmedList(
  values: readonly string[],
  maxItems: number,
  maxLength: number,
): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.trim().normalize("NFC");
    if (cleaned.length === 0 || cleaned.length > maxLength) continue;
    if (out.includes(cleaned)) continue;
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * The account profile stores competitors as free text: some entries are
 * hostnames, some are brand names. Both are kept, neither is confirmed, and
 * which one it is decides which field it lands in.
 */
function competitorFrom(value: string): GeoKbCompetitor | null {
  const cleaned = value.trim().normalize("NFC");
  if (cleaned.length === 0 || cleaned.length > GEO_KB_LIMITS.text) return null;
  const host = /\s/.test(cleaned) ? null : normalizeGeoHost(cleaned);
  return host === null
    ? { domain: "", brandName: cleaned, confirmed: false }
    : { domain: host, brandName: "", confirmed: false };
}

/**
 * One role, built from the profile's single ICP.
 *
 * The profile describes one buyer; a knowledge base can hold several. Importing
 * one and leaving the rest to the visitor is the honest shape - inventing two
 * more from the same sentence would put words in their mouth and then let a run
 * ask questions in that voice.
 */
function roleFrom(profile: MarketingWebsiteProfileV1): readonly GeoKbRole[] {
  const label = profile.buyer.trim() || profile.primaryIcp.trim();
  if (label.length === 0 || label.length > GEO_KB_LIMITS.text) return [];
  return [
    {
      id: "imported-primary",
      label,
      segment: profile.primaryIcp.trim().slice(0, GEO_KB_LIMITS.text),
      painPoints: trimmedList(
        [profile.triggerPain, profile.icpPain].filter(
          (entry) => entry.trim().length > 0,
        ),
        8,
        GEO_KB_LIMITS.listItem,
      ),
      decisionCriteria: trimmedList(
        profile.qualificationSignals,
        8,
        GEO_KB_LIMITS.listItem,
      ),
      vocabulary: trimmedList(profile.icpInterests, 12, GEO_KB_LIMITS.listItem),
    },
  ];
}

export interface GeoKbImportSource {
  readonly websiteId: string;
  readonly snapshotId: string;
  readonly snapshotRevision: number;
  readonly origin: string;
  readonly profile: MarketingWebsiteProfileV1;
}

export function importGeoKbPayload(source: GeoKbImportSource): GeoKbPayload {
  const base = emptyGeoKbPayload(source.origin);
  const aliases = proposeGeoKbAliases(
    source.origin,
    source.profile.productName,
  );

  const competitors: GeoKbCompetitor[] = [];
  const seen = new Set<string>();
  for (const entry of source.profile.directCompetitors) {
    const competitor = competitorFrom(entry);
    if (competitor === null) continue;
    const key =
      competitor.domain.length > 0
        ? `d:${competitor.domain}`
        : `n:${competitor.brandName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    competitors.push(competitor);
  }

  const country = source.profile.country.trim().toUpperCase();
  const language = source.profile.locale.trim().toLowerCase().split("-")[0] ?? "";

  return {
    ...base,
    officialName: source.profile.productName
      .trim()
      .slice(0, GEO_KB_LIMITS.text),
    aliases: trimmedList(aliases, GEO_KB_LIMITS.aliases, GEO_KB_LIMITS.listItem),
    categoryTerms: trimmedList(
      source.profile.categories,
      GEO_KB_LIMITS.categoryTerms,
      GEO_KB_LIMITS.listItem,
    ),
    market: {
      country: /^[A-Z]{2}$/.test(country) ? country : base.market.country,
      language: /^[a-z]{2}$/.test(language) ? language : base.market.language,
    },
    roles: roleFrom(source.profile),
    // A larger source needs an explicit subset selection in the complete Profile
    // review. Choosing the first five here would silently omit the rest.
    competitors: competitors.length > GEO_KB_LIMITS.competitors ? [] : competitors,
    // Deliberately empty. A verified fact needs a source URL and a date, and
    // the profile carries neither; importing its prose as facts would create
    // exactly the unsourced numbers the fact table exists to prevent.
    facts: [],
    importedFrom: {
      websiteId: source.websiteId,
      snapshotId: source.snapshotId,
      snapshotRevision: String(source.snapshotRevision),
    },
  };
}
