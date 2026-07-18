import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";

/**
 * CRO-PATH-001 (spec §8.4, conversion_journey). A commercial page with no direct
 * internal link to any conversion destination leaves visitors without a path to
 * convert. This rule is PURE: it reads the frozen crawl link graph plus the ICP
 * conversion target and never touches the DB, network, LLM or clock.
 *
 * Requires crawl + icp. When the conversion destination cannot be resolved the
 * rule is `not_applicable` (it never fabricates a defect).
 */

const CANDIDATE_KEY = "page_set:missing_conversion_path";

const CRAWL_LIMITATION =
  "Internal-link coverage reflects only pages reached in this crawl; pages beyond crawl depth or excluded from crawling are not represented.";

export const croPathRule: DiagnosticRule = {
  id: "CRO-PATH-001",
  version: 1,
  domain: "conversion_journey",
  requiredDatasets: [
    { dataset: "crawl", required: true },
    { dataset: "icp", required: true },
  ],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }

    const dests = ctx.conversionDestinations();
    if (dests.size === 0) {
      // No resolvable conversion destination — nothing to require a path to.
      return { status: "skipped", reason: "not_applicable" };
    }

    const affected: string[] = [];
    let anyPriority = false;

    for (const [url, page] of ctx.indexablePages()) {
      if (!ctx.isCommercial(url)) continue;
      if (dests.has(url)) continue; // a destination page is exempt from linking to itself
      const linked = page.internalOutlinks.some((link) => dests.has(link.targetSubjectUrl));
      if (linked) continue;
      affected.push(url);
      if (ctx.isPriority(url)) anyPriority = true;
    }

    if (affected.length === 0) {
      return {
        status: "pass",
        metrics: { affectedCount: 0, destinationCount: dests.size },
      };
    }

    const severity: Severity = anyPriority ? "high" : "medium";
    const evidence: EvidenceDraft = {
      sourceProvider: "crawl",
      origin: "direct_public",
      method: "observed",
      grade: "B",
      availability: "available",
      support: "supports",
      subjectRefs: [...affected],
      claim: `${affected.length} commercial page(s) have no direct internal link to any of the ${dests.size} conversion destination(s).`,
      observedAt: ctx.observedAt("crawl"),
      limitation: CRAWL_LIMITATION,
    };
    const candidate: FindingCandidate = {
      subjectRefs: [CANDIDATE_KEY],
      severity,
      titleArgs: { affectedCount: affected.length, destinationCount: dests.size },
      metrics: { affectedCount: affected.length, destinationCount: dests.size },
      evidence: [evidence],
    };
    return { status: "candidate", candidates: [candidate] };
  },
};
