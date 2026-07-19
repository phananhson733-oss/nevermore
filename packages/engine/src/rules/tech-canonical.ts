/**
 * TECH-CANONICAL-002 (spec §8.3, §8.4) — canonical conflicts.
 *
 * Three subtypes are aggregated SEPARATELY (one candidate per subtype that has
 * at least one hit):
 *
 * - `reciprocal`          — page A canonical→B and page B canonical→A (A≠B).
 * - `broken_target`       — a same-origin canonicalTarget that is not among the
 *                           crawled 2xx pages (uncrawled or non-2xx).
 * - `sitemap_contradiction` — a sitemap page whose canonicalTarget points to a
 *                           DIFFERENT page.
 *
 * canonicalTarget is canonicalized via `subjectUrlOf` before comparison so slash
 * / tracking variants do not create phantom conflicts. Pure and replayable.
 */

import { subjectUrlOf } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";

const CANONICAL_LIMITATION =
  "Canonical relationships reflect the crawl snapshot's HTML; rel=canonical is a hint a search engine may override.";

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function is2xx(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

export const techCanonicalRule = {
  id: "TECH-CANONICAL-002",
  version: 1,
  domain: "technical_seo",
  requiredDatasets: [{ dataset: "crawl", required: true }],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }

    // Canonical subjectUrl target per page + the set of crawled 2xx page keys.
    const canonicalOf = new Map<string, string | null>();
    const twoxxKeys = new Set<string>();
    for (const [subjectUrl, page] of ctx.pages) {
      if (is2xx(page.status)) twoxxKeys.add(subjectUrl);
      const target = page.canonicalTarget
        ? subjectUrlOf(page.canonicalTarget, page.fetchUrl)
        : null;
      canonicalOf.set(subjectUrl, target);
    }

    const reciprocal = new Set<string>();
    const brokenTarget = new Set<string>();
    const sitemapContradiction = new Set<string>();

    for (const [subjectUrl, page] of ctx.pages) {
      const target = canonicalOf.get(subjectUrl) ?? null;
      if (target === null) continue;

      // reciprocal: A→B and B→A, A≠B.
      if (target !== subjectUrl && canonicalOf.get(target) === subjectUrl) {
        reciprocal.add(subjectUrl);
        reciprocal.add(target);
      }

      // broken_target: same-origin canonical to an uncrawled / non-2xx page.
      // External canonicals are intentional and unverifiable — never flagged.
      if (sameOrigin(subjectUrl, target) && !twoxxKeys.has(target)) {
        brokenTarget.add(subjectUrl);
      }

      // sitemap_contradiction: a sitemap page canonicalizing elsewhere.
      if (page.sitemapMember && target !== subjectUrl) {
        sitemapContradiction.add(subjectUrl);
      }
    }

    const observedAt = ctx.observedAt("crawl");
    const candidates: FindingCandidate[] = [];
    const add = (subtype: string, urls: ReadonlySet<string>, claim: string): void => {
      if (urls.size === 0) return;
      candidates.push(buildCandidate(ctx, subtype, [...urls], claim, observedAt));
    };
    add("reciprocal", reciprocal, `${reciprocal.size} page(s) form reciprocal canonical loops.`);
    add(
      "broken_target",
      brokenTarget,
      `${brokenTarget.size} page(s) canonicalize to an uncrawled or non-2xx same-origin URL.`,
    );
    add(
      "sitemap_contradiction",
      sitemapContradiction,
      `${sitemapContradiction.size} sitemap page(s) canonicalize to a different page.`,
    );

    if (candidates.length === 0) {
      return { status: "pass", metrics: { canonicalIssues: 0 } };
    }
    return { status: "candidate", candidates };
  },
} satisfies DiagnosticRule;

function buildCandidate(
  ctx: DiagnosticContext,
  subtype: string,
  urls: readonly string[],
  claim: string,
  observedAt: string,
): FindingCandidate {
  const sorted = [...urls].sort();
  const severity: Severity = sorted.some((u) => ctx.isCommercial(u)) ? "high" : "medium";
  const evidence: EvidenceDraft = {
    sourceProvider: "crawl",
    origin: "direct_public",
    method: "observed",
    grade: "B",
    availability: "available",
    support: "supports",
    subjectRefs: sorted,
    claim,
    observedAt,
    limitation: CANONICAL_LIMITATION,
  };
  return {
    subjectRefs: [`canonical_issue:${subtype}`],
    severity,
    titleArgs: { subtype, count: sorted.length },
    metrics: { count: sorted.length },
    evidence: [evidence],
  };
}
