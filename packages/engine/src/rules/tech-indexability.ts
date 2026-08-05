/**
 * TECH-INDEXABILITY-006@1 — exact sitemap/indexability contradictions.
 *
 * This rule intentionally evaluates the response at the exact Crawl fetch
 * identity. Terminal HTML facts attached to a redirect source are not
 * attributed to that source URL, and non-2xx responses remain the concern of
 * TECH-HTTP-001.
 */

import type { CrawlPageProjection } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
} from "../rule.ts";
import { crawlTargetMembers, findingTarget } from "../target.ts";

const AVAILABLE_LIMITATION =
  "The finding proves the observed URL-level contradiction in the frozen crawl; it does not establish how a search engine will select or index the URL.";
const PARTIAL_LIMITATION =
  "The partial crawl proves only this observed URL-level contradiction; it does not establish complete sitemap coverage or site-wide prevalence.";

function isExact2xx(status: number | null): status is number {
  return status !== null && status >= 200 && status < 300;
}

function isConflict(page: CrawlPageProjection): boolean {
  return (
    isExact2xx(page.status) &&
    page.sitemapMember === true &&
    page.robotsIndexable === false
  );
}

export const techIndexabilityRule = {
  id: "TECH-INDEXABILITY-006",
  version: 1,
  domain: "technical_seo",
  requiredDatasets: [{ dataset: "crawl", required: true }],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }

    const conflicts = new Map<string, CrawlPageProjection>();
    for (const variants of ctx.pageVariants.values()) {
      for (const page of variants) {
        if (isConflict(page)) conflicts.set(page.fetchUrl, page);
      }
    }

    if (conflicts.size === 0) {
      return { status: "pass", metrics: { conflictCount: 0 } };
    }

    const availability = ctx.datasetAvailability("crawl");
    const observedAt = ctx.observedAt("crawl");
    const candidates: FindingCandidate[] = [];
    for (const fetchUrl of [...conflicts.keys()].sort(compareAscii)) {
      const page = conflicts.get(fetchUrl);
      if (!page || !isExact2xx(page.status)) continue;

      const members = crawlTargetMembers(ctx, [fetchUrl]);
      if (members === null) {
        return { status: "inconclusive", reason: "missing_observation_lineage" };
      }

      const evidence: EvidenceDraft = {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability,
        support: "supports",
        subjectRefs: [fetchUrl],
        claim: `${fetchUrl} was observed as a sitemap member with a page-level non-indexable signal on an exact HTTP ${page.status} response.`,
        observedAt,
        limitation:
          availability === "partial"
            ? PARTIAL_LIMITATION
            : AVAILABLE_LIMITATION,
      };
      candidates.push({
        subjectRefs: [fetchUrl],
        severity: "high",
        titleArgs: { url: fetchUrl },
        metrics: { statusCode: page.status },
        evidence: [evidence],
        target: findingTarget(
          { relation: "direct_url", targetKind: "url" },
          fetchUrl,
          members,
          "observation_members",
        ),
      });
    }

    return { status: "candidate", candidates };
  },
} satisfies DiagnosticRule;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
