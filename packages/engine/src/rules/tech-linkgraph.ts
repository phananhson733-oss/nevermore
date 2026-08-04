/**
 * TECH-LINKGRAPH-005 (spec §8.3, §8.4) — frozen internal-link opportunities.
 *
 * Version 3 projects three deterministic, observation-backed page sets:
 * low observed inbound support, deep crawl traversal, and links whose internal
 * target was not resolved by the same frozen crawl. An unresolved target is
 * deliberately not called a broken URL. Partial crawls may still contribute
 * candidates, but their evidence stays partial and carries the coverage limit.
 */

import type { CrawlPageProjection } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";
import { crawlTargetMembers, findingTarget } from "../target.ts";

const MAX_LOW_INTERNAL_INLINKS = 1;
const MIN_DEEP_PAGE_DEPTH = 3;

const LINKGRAPH_LIMITATION =
  "Internal-link facts are limited to static HTML links observed in the frozen crawl; navigation rendered only by JavaScript and pages outside the crawl are not counted.";
const UNRESOLVED_TARGET_LIMITATION =
  "A target absent from the frozen crawl is unverified, not proven broken; it may be outside collected coverage, excluded by robots, or unavailable within the run budget.";

interface AffectedPageSet {
  readonly subjectUrls: readonly string[];
  readonly fetchUrls: readonly string[];
  readonly anyPriority: boolean;
}

interface UnresolvedPageSet extends AffectedPageSet {
  readonly targetUrls: readonly string[];
}

function isIndexable(page: CrawlPageProjection): boolean {
  return (
    page.robotsIndexable &&
    page.status !== null &&
    page.status >= 200 &&
    page.status < 300
  );
}

function isHome(subjectUrl: string): boolean {
  try {
    const url = new URL(subjectUrl);
    return url.pathname === "/" && url.search === "";
  } catch {
    return false;
  }
}

function severityFor(pageSet: AffectedPageSet): Severity {
  return pageSet.anyPriority ? "high" : "medium";
}

function evidenceAvailability(
  ctx: DiagnosticContext,
): EvidenceDraft["availability"] {
  return ctx.crawlPartial() ? "partial" : "available";
}

function candidateForPageSet(
  ctx: DiagnosticContext,
  input: {
    readonly pageSet: AffectedPageSet;
    readonly kind: "low_inbound" | "deep_page" | "unresolved_target";
    readonly targetRef:
      | "low_internal_inlinks"
      | "deep_crawl_pages"
      | "unresolved_internal_targets";
    readonly claim: string;
    readonly limitation: string;
    readonly metrics: Record<string, number | string | null>;
    readonly evidenceSubjectRefs?: readonly string[];
  },
): FindingCandidate | null {
  const members = crawlTargetMembers(ctx, input.pageSet.fetchUrls);
  if (members === null) return null;
  const evidence: EvidenceDraft = {
    sourceProvider: "crawl",
    origin: "derived",
    method: "computed",
    grade: "B",
    availability: evidenceAvailability(ctx),
    support: "supports",
    subjectRefs: input.evidenceSubjectRefs ?? input.pageSet.fetchUrls,
    claim: input.claim,
    observedAt: ctx.observedAt("crawl"),
    limitation: input.limitation,
  };
  return {
    subjectRefs: [`page_set:${input.targetRef}`],
    severity: severityFor(input.pageSet),
    titleArgs: {
      kind: input.kind,
      affectedCount: input.pageSet.subjectUrls.length,
    },
    metrics: input.metrics,
    evidence: [evidence],
    target: findingTarget(
      { relation: "affected_by_page_set", targetKind: "page_set" },
      input.targetRef,
      members,
      "observation_members",
    ),
  };
}

function pageSet(
  ctx: DiagnosticContext,
  include: (
    subjectUrl: string,
    indexableVariants: readonly CrawlPageProjection[],
  ) => boolean,
): AffectedPageSet {
  const subjectUrls: string[] = [];
  const fetchUrls = new Set<string>();
  let anyPriority = false;
  for (const [subjectUrl, variants] of ctx.pageVariants) {
    const indexableVariants = variants.filter(isIndexable);
    if (indexableVariants.length === 0 || !include(subjectUrl, indexableVariants)) {
      continue;
    }
    subjectUrls.push(subjectUrl);
    for (const page of indexableVariants) fetchUrls.add(page.fetchUrl);
    if (ctx.isPriority(subjectUrl)) anyPriority = true;
  }
  return {
    subjectUrls: Object.freeze(subjectUrls.sort()),
    fetchUrls: Object.freeze([...fetchUrls].sort()),
    anyPriority,
  };
}

function unresolvedPageSet(ctx: DiagnosticContext): UnresolvedPageSet {
  const subjectUrls = new Set<string>();
  const fetchUrls = new Set<string>();
  const targetUrls = new Set<string>();
  let anyPriority = false;
  for (const [subjectUrl, variants] of ctx.pageVariants) {
    for (const page of variants.filter(isIndexable)) {
      const unresolved = page.internalOutlinks.filter(
        (link) => !ctx.pageVariants.has(link.targetSubjectUrl),
      );
      if (unresolved.length === 0) continue;
      subjectUrls.add(subjectUrl);
      fetchUrls.add(page.fetchUrl);
      for (const link of unresolved) targetUrls.add(link.targetSubjectUrl);
      if (ctx.isPriority(subjectUrl)) anyPriority = true;
    }
  }
  return {
    subjectUrls: Object.freeze([...subjectUrls].sort()),
    fetchUrls: Object.freeze([...fetchUrls].sort()),
    targetUrls: Object.freeze([...targetUrls].sort()),
    anyPriority,
  };
}

function evaluateV3(ctx: DiagnosticContext): RuleResult {
  if (!ctx.hasDataset("crawl")) {
    return { status: "skipped", reason: "missing_dataset" };
  }

  const lowInbound = pageSet(
    ctx,
    (subjectUrl) =>
      !isHome(subjectUrl) &&
      (ctx.internalInlinks.get(subjectUrl) ?? 0) <= MAX_LOW_INTERNAL_INLINKS,
  );
  const deepPages = pageSet(
    ctx,
    (subjectUrl) =>
      (ctx.crawlDepths.get(subjectUrl) ?? -1) >= MIN_DEEP_PAGE_DEPTH,
  );
  const unresolvedTargets = unresolvedPageSet(ctx);

  const candidates: FindingCandidate[] = [];
  if (lowInbound.subjectUrls.length > 0) {
    const candidate = candidateForPageSet(ctx, {
      pageSet: lowInbound,
      kind: "low_inbound",
      targetRef: "low_internal_inlinks",
      claim: `${lowInbound.subjectUrls.length} indexable non-home page(s) have at most ${MAX_LOW_INTERNAL_INLINKS} observed internal inlink(s).`,
      limitation: LINKGRAPH_LIMITATION,
      metrics: {
        affectedCount: lowInbound.subjectUrls.length,
        maximumObservedInlinks: MAX_LOW_INTERNAL_INLINKS,
      },
    });
    if (candidate === null) {
      return { status: "inconclusive", reason: "missing_observation_lineage" };
    }
    candidates.push(candidate);
  }
  if (deepPages.subjectUrls.length > 0) {
    const maximumDepth = Math.max(
      ...deepPages.subjectUrls.map(
        (subjectUrl) => ctx.crawlDepths.get(subjectUrl) ?? MIN_DEEP_PAGE_DEPTH,
      ),
    );
    const candidate = candidateForPageSet(ctx, {
      pageSet: deepPages,
      kind: "deep_page",
      targetRef: "deep_crawl_pages",
      claim: `${deepPages.subjectUrls.length} indexable page(s) were observed at crawl depth ${MIN_DEEP_PAGE_DEPTH} or deeper.`,
      limitation:
        "Frozen crawl depth is a traversal fact, not a guaranteed homepage click count; sitemap and other allowed seeds may shorten the observed path.",
      metrics: {
        affectedCount: deepPages.subjectUrls.length,
        minimumDepth: MIN_DEEP_PAGE_DEPTH,
        maximumDepth,
      },
    });
    if (candidate === null) {
      return { status: "inconclusive", reason: "missing_observation_lineage" };
    }
    candidates.push(candidate);
  }
  if (unresolvedTargets.subjectUrls.length > 0) {
    const candidate = candidateForPageSet(ctx, {
      pageSet: unresolvedTargets,
      kind: "unresolved_target",
      targetRef: "unresolved_internal_targets",
      claim: `${unresolvedTargets.subjectUrls.length} source page(s) link to ${unresolvedTargets.targetUrls.length} internal target(s) that were not resolved by the frozen crawl.`,
      limitation: UNRESOLVED_TARGET_LIMITATION,
      metrics: {
        affectedCount: unresolvedTargets.subjectUrls.length,
        unresolvedTargetCount: unresolvedTargets.targetUrls.length,
      },
      evidenceSubjectRefs: Object.freeze(
        [...unresolvedTargets.fetchUrls, ...unresolvedTargets.targetUrls].sort(),
      ),
    });
    if (candidate === null) {
      return { status: "inconclusive", reason: "missing_observation_lineage" };
    }
    candidates.push(candidate);
  }

  if (candidates.length > 0) return { status: "candidate", candidates };
  return ctx.crawlPartial()
    ? {
        status: "inconclusive",
        reason: "partial_crawl_no_observed_link_opportunity",
      }
    : { status: "pass", metrics: { affectedCount: 0 } };
}

/** Current governed executor. */
export const techLinkgraphRule = {
  id: "TECH-LINKGRAPH-005",
  version: 3,
  domain: "technical_seo",
  requiredDatasets: [
    { dataset: "crawl", required: true },
    { dataset: "icp", required: true },
  ],
  evaluate: evaluateV3,
} satisfies DiagnosticRule;

/**
 * Exact @2 executor retained for historical 0.2.1/0.2.2 replay. Its narrower
 * commercial-only and complete-crawl behavior must never drift with @3.
 */
export function createLegacyTechLinkgraphExecutor(): DiagnosticRule {
  return {
    ...techLinkgraphRule,
    version: 2,
    evaluate(ctx: DiagnosticContext): RuleResult {
      if (!ctx.hasDataset("crawl")) {
        return { status: "skipped", reason: "missing_dataset" };
      }
      if (ctx.crawlPartial()) {
        return {
          status: "inconclusive",
          reason: "partial_crawl_incomplete_link_graph",
        };
      }
      const affected = pageSet(
        ctx,
        (subjectUrl) =>
          ctx.isCommercial(subjectUrl) &&
          (ctx.internalInlinks.get(subjectUrl) ?? 0) < 2,
      );
      if (affected.subjectUrls.length === 0) {
        return { status: "pass", metrics: { affectedCount: 0 } };
      }
      const members = crawlTargetMembers(ctx, affected.fetchUrls);
      if (members === null) {
        return { status: "inconclusive", reason: "missing_observation_lineage" };
      }
      return {
        status: "candidate",
        candidates: [
          {
            subjectRefs: ["page_set:low_internal_inlinks"],
            severity: severityFor(affected),
            titleArgs: { affectedCount: affected.subjectUrls.length },
            metrics: { affectedCount: affected.subjectUrls.length },
            evidence: [
              {
                sourceProvider: "crawl",
                origin: "derived",
                method: "computed",
                grade: "B",
                availability: "available",
                support: "supports",
                subjectRefs: affected.fetchUrls,
                claim: `${affected.subjectUrls.length} commercial page(s) receive fewer than 2 internal inlinks.`,
                observedAt: ctx.observedAt("crawl"),
                limitation:
                  "Inlink counts are derived from the crawled internal outlinks only; links from uncrawled pages are not counted.",
              },
            ],
            target: findingTarget(
              { relation: "affected_by_page_set", targetKind: "page_set" },
              "low_internal_inlinks",
              members,
              "observation_members",
            ),
          },
        ],
      };
    },
  };
}
