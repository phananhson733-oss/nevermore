/**
 * TECH-HTTP-001 (spec §8.3, §8.4) — broken HTTP responses.
 *
 * Aggregates crawled pages whose FINAL status is 4xx or 5xx, one finding
 * candidate per distinct status code. A missing/zero status is treated as
 * `unavailable`, never as a defect (spec §1.3: unavailable ≠ broken). The rule
 * only decides WHETHER it triggers and on WHICH subjects; severity policy and
 * titles come from the registry. Pure and replayable — no clock, DB, or network.
 */

import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";
import { crawlTargetMembers, findingTarget } from "../target.ts";

const HTTP_LIMITATION =
  "Status reflects a single crawl fetch of each URL, not every request path, method, or geography.";

/** The broken status code for a page, or null when it is unavailable / healthy. */
function brokenCode(finalStatus: number | null): number | null {
  // status 0 / null is unavailable (spec §1.3), not a 4xx/5xx defect.
  if (finalStatus === null || finalStatus === 0) return null;
  if (finalStatus >= 400 && finalStatus < 600) return finalStatus;
  return null;
}

export const techHttpStatusRule = {
  id: "TECH-HTTP-001",
  version: 2,
  domain: "technical_seo",
  requiredDatasets: [{ dataset: "crawl", required: true }],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }

    // Findings aggregate by stable subjectUrl while Evidence retains every
    // exact fetchUrl that returned the broken status (spec §7.6).
    const byCode = new Map<
      number,
      { subjectUrls: Set<string>; fetchUrls: Set<string> }
    >();
    for (const [subjectUrl, variants] of ctx.pageVariants) {
      for (const page of variants) {
        const code = brokenCode(page.finalStatus);
        if (code === null) continue;
        const affected = byCode.get(code) ?? {
          subjectUrls: new Set<string>(),
          fetchUrls: new Set<string>(),
        };
        affected.subjectUrls.add(subjectUrl);
        affected.fetchUrls.add(page.fetchUrl);
        byCode.set(code, affected);
      }
    }

    if (byCode.size === 0) {
      return { status: "pass", metrics: { brokenCount: 0 } };
    }

    const observedAt = ctx.observedAt("crawl");
    const codes = [...byCode.keys()].sort((a, b) => a - b);
    const candidates: FindingCandidate[] = [];
    for (const code of codes) {
      const affected = byCode.get(code);
      const subjectUrls = [...(affected?.subjectUrls ?? [])].sort();
      const fetchUrls = [...(affected?.fetchUrls ?? [])].sort();
      const isServerError = code >= 500;
      const anyCommercial = subjectUrls.some((url) => ctx.isCommercial(url));
      // 5xx is always high; 4xx is high only when a priority/commercial URL is hit.
      const severity: Severity = isServerError || anyCommercial ? "high" : "medium";
      const evidence: EvidenceDraft = {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: fetchUrls,
        claim: `${subjectUrls.length} crawled page(s) returned HTTP ${code}.`,
        observedAt,
        limitation: HTTP_LIMITATION,
      };
      const members = crawlTargetMembers(ctx, fetchUrls);
      if (members === null) {
        return { status: "inconclusive", reason: "missing_observation_lineage" };
      }
      candidates.push({
        subjectRefs: [`http_status:${code}`],
        severity,
        titleArgs: { status: code, count: subjectUrls.length },
        metrics: { count: subjectUrls.length, statusCode: code },
        evidence: [evidence],
        target: findingTarget(
          {
            relation: "affected_by_http_status",
            targetKind: "http_status",
          },
          String(code),
          members,
          "observation_members",
        ),
      });
    }

    return { status: "candidate", candidates };
  },
} satisfies DiagnosticRule;
