import type { VisibilityReportV2 } from "./visibility-v2-contract.ts";
import type { VisibilitySiteEvidenceV1 } from "./site-index-contract.ts";
import type { GeoGap } from "./gap-contract.ts";
import { siteQuestionTerms } from "./site-index-text.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { VISIBILITY_MIN_SUCCESS_RATIO } from "./visibility-contract.ts";
import { visibilityTrackedRivals } from "./visibility-v2.ts";

/** Fixed precedence B→A→D→C. These label observed evidence gaps, not why an
 * engine made a decision. A is expressly scoped to the bounded read inventory. */
export function classifyVisibilityGaps(report: VisibilityReportV2, evidence: VisibilitySiteEvidenceV1 | null): readonly GeoGap[] {
  return report.questions.map((question): GeoGap => {
    const base = { id: `gap-${question.questionId}`, questionId: question.questionId, evidenceIds: [] as readonly string[], pageUrl: null, sourceUrls: [] as readonly string[] };
    const unknown = (reason: GeoGap["reason"]): GeoGap => ({ ...base, kind: "unattributed", reason, action: "none" });
    if (question.prompted || question.layer === "branded") return unknown("prompted_question");
    const enough = report.manifest.samplesPerQuestion >= 3 && report.manifest.engines.every(({ engine }) => question.samples.filter((sample) => sample.engine === engine && sample.status === "ok").length >= Math.ceil(report.manifest.samplesPerQuestion * VISIBILITY_MIN_SUCCESS_RATIO));
    if (report.manifest.status === "insufficient" || !enough) return unknown("measurement_insufficient");
    if (evidence === null || evidence.index.targetHost !== report.context.targetHost || evidence.index.status === "unavailable") return unknown("site_evidence_unavailable");
    if (!siteQuestionTerms(question.definition, report.context).searchable) return unknown("question_mapping_unavailable");
    const relevant = evidence.index.pages.filter((page) => page.state === "read" && page.bodyComplete && page.matches.some((match) => match.questionId === question.questionId));
    const checks = evidence.citability.filter((check) => check.questionId === question.questionId && relevant.some((page) => page.id === check.pageId && page.url === check.url));
    const failed = checks.find((check) => check.checks.some((row) => row.weight === "counted" && row.state === "fail"));
    if (failed !== undefined) return { ...base, kind: "B", reason: "relevant_page_citability_failed", action: "citability", pageUrl: failed.url, evidenceIds: [failed.pageId, failed.id] };
    const mentionMiss = question.mentioned === 0;
    const citationMiss = question.mode === "retrieval" && question.citationEvaluable > 0 && question.cited === 0;
    const missed = mentionMiss || citationMiss;
    if (missed && relevant.length === 0 && evidence.index.status === "complete" && evidence.index.limits.length === 0 && evidence.index.pages.length === evidence.index.discoveredCount && evidence.index.pages.every((page) => page.state === "read" && page.bodyComplete)) return { ...base, kind: "A", reason: "no_matching_page_in_audited_inventory", action: "brief", evidenceIds: ["site-index"] };
    const confirmed = new Set(visibilityTrackedRivals(report.context).map((rival) => rival.brandName));
    const outranked = question.samples.filter((sample) => sample.status === "ok" && (sample.competitorPositions ?? []).some((rival) => confirmed.has(rival.brandName) && (sample.listPosition === null ? !sample.mentioned : rival.position < sample.listPosition)));
    if (question.layer === "comparison" && relevant.length > 0 && outranked.length >= 2) return { ...base, kind: "D", reason: "repeated_competitor_list_position", action: "brief", pageUrl: relevant[0]!.url, evidenceIds: [relevant[0]!.id, ...outranked.slice(0, 2).map((sample) => sample.slotId)] };
    const refs = evidence.references.filter((page) => page.state === "read" && page.bodyComplete && page.ownPresence === false && ["listicle", "comparison"].includes(page.pageType) && page.finalUrl !== null && normalizeGeoHost(page.finalUrl) === normalizeGeoHost(page.url) && normalizeGeoHost(page.finalUrl) !== report.context.targetHost && page.sampleSlots.filter((slot) => question.samples.some((sample) => sample.slotId === slot && sample.status === "ok")).length >= 2);
    if (missed && relevant.length > 0 && refs.length > 0) return { ...base, kind: "C", reason: "missing_from_read_reference_pages", action: "third_party", sourceUrls: [refs[0]!.url], evidenceIds: [refs[0]!.id] };
    if (evidence.index.status !== "complete" && relevant.length === 0) return unknown("inventory_incomplete");
    if (relevant.length > 0 && checks.length === 0) return unknown("citability_unavailable");
    return unknown("no_actionable_gap");
  });
}
