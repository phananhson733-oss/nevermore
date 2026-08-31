// @input  -- current editor payload, source-read baseline and one reviewed candidate
// @output -- a surgical immutable edit, or conflict with every user value preserved
// @pos    -- no save and no provenance labels; trusted receipts are matched server-side

import { GEO_KB_LIMITS, type GeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import type { GeoKbEnrichmentReport } from "../../lib/geo-tools/kb-enrichment-contract.ts";

export function applyGeoEnrichmentSuggestion(
  current: GeoKbPayload,
  baseline: GeoKbPayload,
  report: GeoKbEnrichmentReport,
  evidenceId: string,
): { readonly ok: true; readonly payload: GeoKbPayload } | { readonly ok: false } {
  const competitor = report.competitors.find((entry) => entry.evidenceId === evidenceId);
  if (competitor?.status === "available") {
    const index = current.competitors.findIndex((entry) => entry.domain === competitor.domain);
    const original = baseline.competitors.find((entry) => entry.domain === competitor.domain);
    if (index < 0 || original === undefined || JSON.stringify(current.competitors[index]) !== JSON.stringify(original)) return { ok: false };
    return { ok: true, payload: { ...current, competitors: current.competitors.map((entry, position) => position === index
      ? { domain: competitor.domain, brandName: competitor.brandName, aliases: competitor.aliases, confirmed: false } : entry) } };
  }
  const fact = report.facts.find((entry) => entry.evidenceId === evidenceId);
  if (fact?.status === "available") {
    const index = current.facts.findIndex((entry) => entry.key === fact.key);
    const original = baseline.facts.find((entry) => entry.key === fact.key);
    if (index < 0 || original === undefined || JSON.stringify(current.facts[index]) !== JSON.stringify(original)) return { ok: false };
    return { ok: true, payload: { ...current, facts: current.facts.map((entry, position) => position === index
      ? { key: fact.key, value: fact.value, reason: "", sourceUrl: fact.sourceUrl, observedAt: fact.observedAt } : entry) } };
  }
  const role = report.gsc.roles.find((entry) => entry.evidenceId === evidenceId);
  if (role === undefined || current.roles.length >= GEO_KB_LIMITS.roles || current.roles.some((entry) => entry.id === role.role.id)) return { ok: false };
  return { ok: true, payload: { ...current, roles: [...current.roles, role.role] } };
}
