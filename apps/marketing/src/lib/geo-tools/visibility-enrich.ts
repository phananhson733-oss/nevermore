// @input -- a completed paid-sampling report and bounded public read dependencies
// @output -- independent site evidence and deterministic gaps within the wire reserve
// @pos -- post-sampling enrichment; no paid retries and no invented absent pages
import type { VisibilityReportV2 } from "./visibility-v2-contract.ts";
import { collectVisibilitySiteEvidence, type GeoSiteEvidenceDependencies } from "./site-index.ts";
import { budgetVisibilityReportV2, postgresJsonbTextBytes, VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES } from "./visibility-wire.ts";
import { classifyVisibilityGaps } from "./gap-classify.ts";
import { parseVisibilityReportV2 } from "./visibility-export.ts";
import type { GeoSitePriorityHints, VisibilitySiteEvidenceV1 } from "./site-index-contract.ts";
const bytes = postgresJsonbTextBytes;
function omitOptionalSiteEvidence(evidence: VisibilitySiteEvidenceV1): VisibilitySiteEvidenceV1 {
  const pages = evidence.index.pages.slice(0, 4).map((page) => ({ ...page, headings: [], matches: [], ownPresenceExcerpt: null }));
  return { ...evidence,
    index: { ...evidence.index, ...(evidence.index.priority === undefined ? {} : { priority: { ...evidence.index.priority, prioritizedUrls: evidence.index.priority.prioritizedUrls.filter((url) => pages.some((page) => page.url === url)) } }), pages, status: pages.length === 0 ? "unavailable" : "partial", limits: [...new Set([...evidence.index.limits, "evidence_byte_limit", "incomplete_inventory"])] },
    references: [], referenceOmittedCount: evidence.referenceOmittedCount + evidence.references.length,
    citability: [], citabilityOmittedCount: evidence.citabilityOmittedCount + evidence.citability.length,
  };
}
export async function enrichVisibilityReportV2(report: VisibilityReportV2, dependencies?: GeoSiteEvidenceDependencies, priorityHints: GeoSitePriorityHints | null = null): Promise<VisibilityReportV2> {
  // Budget FIRST: site sample pointers must refer to URLs the retained report
  // actually carries. Re-budgeting after collection could invalidate pointers.
  const bounded = budgetVisibilityReportV2(report);
  try {
    let siteEvidence = await collectVisibilitySiteEvidence(bounded, dependencies, priorityHints);
    let gaps = classifyVisibilityGaps(bounded, siteEvidence);
    let omitted = false;
    if (bytes({ siteEvidence, gaps }) > VISIBILITY_SITE_EVIDENCE_RESERVE_BYTES) {
      siteEvidence = omitOptionalSiteEvidence(siteEvidence);
      gaps = classifyVisibilityGaps(bounded, siteEvidence);
      omitted = true;
    }
    const finishedAt = (dependencies?.now() ?? new Date()).toISOString();
    const final: VisibilityReportV2 = { ...bounded, manifest: { ...bounded.manifest, finishedAt }, siteEvidence, gaps, limits: [...bounded.limits, ...(omitted ? ["siteEvidenceBudget"] : [])] };
    if (parseVisibilityReportV2(final) !== null) return final;
    return { ...bounded, manifest: { ...bounded.manifest, finishedAt }, siteEvidence: null, gaps: [], limits: [...bounded.limits, omitted ? "siteEvidenceBudget" : "siteEvidenceUnavailable"] };
  } catch {
    return { ...bounded, siteEvidence: null, gaps: [], limits: [...bounded.limits, "siteEvidenceUnavailable"] };
  }
}
