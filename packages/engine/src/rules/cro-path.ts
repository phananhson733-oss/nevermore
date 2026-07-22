import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";
import { crawlTargetMembers, findingTarget } from "../target.ts";

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

export const croPathRule = {
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
    if (ctx.crawlPartial()) {
      return { status: "inconclusive", reason: "partial_crawl_link_graph" };
    }

    const dests = ctx.conversionDestinations();
    if (dests.size === 0) {
      // No resolvable conversion destination — nothing to require a path to.
      return { status: "skipped", reason: "not_applicable" };
    }

    const affected: string[] = [];
    const affectedFetchUrls = new Set<string>();
    let anyPriority = false;

    for (const [url, variants] of ctx.indexablePages()) {
      if (!ctx.isCommercial(url)) continue;
      if (dests.has(url)) continue; // a destination page is exempt from linking to itself
      // A missing-path finding is a subject-level negative fact. If any healthy
      // exact variant exposes a destination link, absence is not established.
      const linked = variants.some((page) =>
        page.internalOutlinks.some((link) => dests.has(link.targetSubjectUrl)),
      );
      if (linked) continue;
      affected.push(url);
      for (const page of variants) affectedFetchUrls.add(page.fetchUrl);
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
    const members = crawlTargetMembers(ctx, [...affectedFetchUrls]);
    if (members === null) {
      return { status: "inconclusive", reason: "missing_observation_lineage" };
    }
    const candidate: FindingCandidate = {
      subjectRefs: [CANDIDATE_KEY],
      severity,
      titleArgs: { affectedCount: affected.length, destinationCount: dests.size },
      metrics: { affectedCount: affected.length, destinationCount: dests.size },
      evidence: [evidence],
      target: findingTarget(
        { relation: "affected_by_page_set", targetKind: "page_set" },
        "missing_conversion_path",
        members,
        "observation_members",
      ),
    };
    return { status: "candidate", candidates: [candidate] };
  },
} satisfies DiagnosticRule;
