/**
 * TECH-LINKGRAPH-005 (spec §8.3, §8.4) — thin internal link equity.
 *
 * Flags commercial/priority indexable pages that receive fewer than 2 internal
 * inlinks (the derived count from `ctx.internalInlinks`). A partial crawl cannot
 * observe the full link graph, so the rule returns `inconclusive` rather than
 * manufacturing a defect. One aggregated candidate lists every affected page.
 * Pure and replayable — the inlink counts are computed upstream in the context.
 */

import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";

const MIN_INTERNAL_INLINKS = 2;

const LINKGRAPH_LIMITATION =
  "Inlink counts are derived from the crawled internal outlinks only; links from uncrawled pages are not counted.";

export const techLinkgraphRule = {
  id: "TECH-LINKGRAPH-005",
  version: 2,
  domain: "technical_seo",
  requiredDatasets: [
    { dataset: "crawl", required: true },
    { dataset: "icp", required: true },
  ],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }
    if (ctx.crawlPartial()) {
      // A partial crawl means the link graph is incomplete — cannot judge equity.
      return { status: "inconclusive", reason: "partial_crawl_incomplete_link_graph" };
    }

    const affectedSubjectUrls: string[] = [];
    const affectedFetchUrls = new Set<string>();
    let anyPriority = false;
    for (const [subjectUrl, variants] of ctx.pageVariants) {
      const indexableVariants = variants.filter(
        (page) =>
          page.robotsIndexable &&
          page.status !== null &&
          page.status >= 200 &&
          page.status < 300,
      );
      if (indexableVariants.length === 0) continue;
      if (!ctx.isCommercial(subjectUrl)) continue;
      const inlinks = ctx.internalInlinks.get(subjectUrl) ?? 0;
      if (inlinks < MIN_INTERNAL_INLINKS) {
        affectedSubjectUrls.push(subjectUrl);
        for (const page of indexableVariants) {
          affectedFetchUrls.add(page.fetchUrl);
        }
        if (ctx.isPriority(subjectUrl)) anyPriority = true;
      }
    }

    if (affectedSubjectUrls.length === 0) {
      return { status: "pass", metrics: { affectedCount: 0 } };
    }

    const sortedSubjectUrls = [...affectedSubjectUrls].sort();
    const sortedFetchUrls = [...affectedFetchUrls].sort();
    const severity: Severity = anyPriority ? "high" : "medium";
    const evidence: EvidenceDraft = {
      sourceProvider: "crawl",
      origin: "derived",
      method: "computed",
      grade: "B",
      availability: "available",
      support: "supports",
      subjectRefs: sortedFetchUrls,
      claim: `${sortedSubjectUrls.length} commercial page(s) receive fewer than ${MIN_INTERNAL_INLINKS} internal inlinks.`,
      observedAt: ctx.observedAt("crawl"),
      limitation: LINKGRAPH_LIMITATION,
    };
    const candidate: FindingCandidate = {
      subjectRefs: ["page_set:low_internal_inlinks"],
      severity,
      titleArgs: { affectedCount: sortedSubjectUrls.length },
      metrics: { affectedCount: sortedSubjectUrls.length },
      evidence: [evidence],
    };
    return { status: "candidate", candidates: [candidate] };
  },
} satisfies DiagnosticRule;
