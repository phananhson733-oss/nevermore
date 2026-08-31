// @input -- a parsed, server-resolved GEO brief and explicit Draft settings
// @output -- only non-null fact-table receipts eligible to support claims
// @pos -- never turns sampled AI answers or site-index titles into factual evidence
import type { DraftResult } from "./contract.ts";
import type { GeoContentBrief, GeoFactEvidence } from "./geo-contract.ts";
import type { SectionEvidence } from "./validate-section.ts";
import type { GeoMissingFact } from "./geo-fact-support.ts";
export { geoMissingFactStatements, checkGeoHeadingSupport, geoOutlineSupportViolation } from "./geo-fact-support.ts";

export function geoMissingFacts(brief: GeoContentBrief): GeoMissingFact[] { return brief.fact_table.filter(fact => fact.value === null).map(fact => ({ label: fact.label, reason: fact.reason ?? "unverified" })); }

export function geoDraftFacts(brief: GeoContentBrief, sectionId: string, settings: DraftResult["settings"]): GeoFactEvidence[] {
  if (settings.product_mention === "none") return [];
  // In GEO the direct-answer section is the explicit product-context slot.
  const leadSection = brief.outline.status === "available" ? brief.outline.items.find(item => item.answers.includes("Q1"))?.id : null;
  if (settings.product_mention === "gap_only" && sectionId !== leadSection) return [];
  const usable = new Set(brief.fact_table.filter(row => row.value !== null && row.reason === null).flatMap(row => row.evidence_refs));
  const blocked = new Set(brief.fact_table.filter(row => row.value === null).flatMap(row => row.evidence_refs));
  return brief.evidence.facts.filter(fact => usable.has(fact.id) && !blocked.has(fact.id));
}

/** Shape-only validation derives labels from K/C/P IDs, never certifies their authenticity. */
export function carriedGeoSectionEvidence(section: Extract<DraftResult["sections"][number], { status: "ok" }>): SectionEvidence | null {
  if (!section.body.paragraphs.some(paragraph => paragraph.sentences.some(item => item.sources !== undefined))) return null;
  const refs = section.body.paragraphs.flatMap(paragraph => paragraph.sentences.flatMap(item => item.evidence_refs));
  const facts: GeoFactEvidence[] = refs.map(id => ({ id, source: id.startsWith("K") ? "kb" : id.startsWith("C") ? "crawl" : "product_profile", text: section.body.paragraphs.flatMap(paragraph => paragraph.sentences).find(sentence => sentence.evidence_refs.includes(id))?.text ?? "", observed_at: "1970-01-01T00:00:00Z", url: null }));
  return { citableCrawlIds: new Set(), profileFacts: new Map(), stanceAllowed: false, geoFacts: new Map(facts.map(fact => [fact.id, fact])) };
}
