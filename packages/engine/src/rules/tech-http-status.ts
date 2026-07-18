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

const HTTP_LIMITATION =
  "Status reflects a single crawl fetch of each URL, not every request path, method, or geography.";

/** The broken status code for a page, or null when it is unavailable / healthy. */
function brokenCode(finalStatus: number | null): number | null {
  // status 0 / null is unavailable (spec §1.3), not a 4xx/5xx defect.
  if (finalStatus === null || finalStatus === 0) return null;
  if (finalStatus >= 400 && finalStatus < 600) return finalStatus;
  return null;
}

export const techHttpStatusRule: DiagnosticRule = {
  id: "TECH-HTTP-001",
  version: 1,
  domain: "technical_seo",
  requiredDatasets: [{ dataset: "crawl", required: true }],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }

    // Group the affected subjectUrls by their broken status code.
    const byCode = new Map<number, string[]>();
    for (const [subjectUrl, page] of ctx.pages) {
      const code = brokenCode(page.finalStatus);
      if (code === null) continue;
      const list = byCode.get(code) ?? [];
      list.push(subjectUrl);
      byCode.set(code, list);
    }

    if (byCode.size === 0) {
      return { status: "pass", metrics: { brokenCount: 0 } };
    }

    const observedAt = ctx.observedAt("crawl");
    const codes = [...byCode.keys()].sort((a, b) => a - b);
    const candidates: readonly FindingCandidate[] = codes.map((code) => {
      const urls = [...(byCode.get(code) ?? [])].sort();
      const isServerError = code >= 500;
      const anyCommercial = urls.some((u) => ctx.isCommercial(u));
      // 5xx is always high; 4xx is high only when a priority/commercial URL is hit.
      const severity: Severity = isServerError || anyCommercial ? "high" : "medium";
      const evidence: EvidenceDraft = {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: urls,
        claim: `${urls.length} crawled page(s) returned HTTP ${code}.`,
        observedAt,
        limitation: HTTP_LIMITATION,
      };
      return {
        subjectRefs: [`http_status:${code}`],
        severity,
        titleArgs: { status: code, count: urls.length },
        metrics: { count: urls.length, statusCode: code },
        evidence: [evidence],
      };
    });

    return { status: "candidate", candidates };
  },
};
