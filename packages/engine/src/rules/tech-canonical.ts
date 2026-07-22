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

import { canonicalizeUrl } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";
import { crawlTargetMembers, findingTarget } from "../target.ts";

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

interface CanonicalIssueRefs {
  readonly subjectUrls: Set<string>;
  readonly fetchUrls: Set<string>;
}

function emptyIssueRefs(): CanonicalIssueRefs {
  return { subjectUrls: new Set<string>(), fetchUrls: new Set<string>() };
}

export const techCanonicalRule = {
  id: "TECH-CANONICAL-002",
  version: 2,
  domain: "technical_seo",
  requiredDatasets: [{ dataset: "crawl", required: true }],
  evaluate(ctx: DiagnosticContext): RuleResult {
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }

    // Keep the declaring exact fetchUrl for each normalized relationship. This
    // lets Findings aggregate on stable subjectUrl while Evidence remains an
    // exact replayable HTTP/HTML fact (spec §7.6).
    const canonicalDeclarations = new Map<
      string,
      Map<string, Set<string>>
    >();
    const twoxxKeys = new Set<string>();
    for (const [subjectUrl, variants] of ctx.pageVariants) {
      const declarationsByTarget = new Map<string, Set<string>>();
      for (const page of variants) {
        // Canonical/body fields come from the terminal document. When the
        // initial request redirected, they must not be attributed to that
        // non-2xx source fetch identity.
        if (!is2xx(page.status)) continue;
        twoxxKeys.add(subjectUrl);
        const targetSubjectUrl = page.canonicalTarget
          ? canonicalizeUrl(page.canonicalTarget, page.fetchUrl)?.subjectUrl ?? null
          : null;
        if (targetSubjectUrl) {
          const fetchUrls =
            declarationsByTarget.get(targetSubjectUrl) ?? new Set<string>();
          fetchUrls.add(page.fetchUrl);
          declarationsByTarget.set(targetSubjectUrl, fetchUrls);
        }
      }
      canonicalDeclarations.set(subjectUrl, declarationsByTarget);
    }

    const reciprocal = emptyIssueRefs();
    const brokenTarget = emptyIssueRefs();
    const sitemapContradiction = emptyIssueRefs();

    for (const [subjectUrl, variants] of ctx.pageVariants) {
      for (const page of variants) {
        if (!is2xx(page.status)) continue;
        const targetPair = page.canonicalTarget
          ? canonicalizeUrl(page.canonicalTarget, page.fetchUrl)
          : null;
        if (targetPair === null) continue;
        const target = targetPair.subjectUrl;

        // reciprocal: A→B and any exact B variant canonicalizes back to A.
        if (
          target !== subjectUrl &&
          canonicalDeclarations.get(target)?.has(subjectUrl)
        ) {
          reciprocal.subjectUrls.add(subjectUrl);
          reciprocal.subjectUrls.add(target);
          reciprocal.fetchUrls.add(page.fetchUrl);
          for (const reverseFetchUrl of
            canonicalDeclarations.get(target)?.get(subjectUrl) ?? []) {
            reciprocal.fetchUrls.add(reverseFetchUrl);
          }
        }

        // broken_target: same-origin canonical to a subject without any 2xx
        // exact response. External canonicals remain intentionally unverified.
        if (sameOrigin(subjectUrl, target) && !twoxxKeys.has(target)) {
          brokenTarget.subjectUrls.add(subjectUrl);
          brokenTarget.fetchUrls.add(page.fetchUrl);
        }

        // A sitemap URL and its canonical must agree at exact fetch identity,
        // so /path/ → /path remains visible even though both aggregate to the
        // same subjectUrl.
        const declaringFetchUrl =
          canonicalizeUrl(page.fetchUrl)?.fetchUrl ?? page.fetchUrl;
        if (
          page.sitemapMember &&
          targetPair.fetchUrl !== declaringFetchUrl
        ) {
          sitemapContradiction.subjectUrls.add(subjectUrl);
          sitemapContradiction.fetchUrls.add(page.fetchUrl);
        }
      }
    }

    const observedAt = ctx.observedAt("crawl");
    const candidates: FindingCandidate[] = [];
    let missingLineage = false;
    const add = (
      subtype: string,
      refs: CanonicalIssueRefs,
      claim: string,
    ): void => {
      if (refs.subjectUrls.size === 0) return;
      const candidate = buildCandidate(ctx, subtype, refs, claim, observedAt);
      if (candidate === null) {
        missingLineage = true;
        return;
      }
      candidates.push(candidate);
    };
    add(
      "reciprocal",
      reciprocal,
      `${reciprocal.subjectUrls.size} page(s) form reciprocal canonical loops.`,
    );
    add(
      "broken_target",
      brokenTarget,
      `${brokenTarget.subjectUrls.size} page(s) canonicalize to an uncrawled or non-2xx same-origin URL.`,
    );
    add(
      "sitemap_contradiction",
      sitemapContradiction,
      `${sitemapContradiction.subjectUrls.size} sitemap page(s) canonicalize to a different page.`,
    );

    if (missingLineage) {
      return { status: "inconclusive", reason: "missing_observation_lineage" };
    }

    if (candidates.length === 0) {
      return { status: "pass", metrics: { canonicalIssues: 0 } };
    }
    return { status: "candidate", candidates };
  },
} satisfies DiagnosticRule;

function buildCandidate(
  ctx: DiagnosticContext,
  subtype: string,
  refs: CanonicalIssueRefs,
  claim: string,
  observedAt: string,
): FindingCandidate | null {
  const subjectUrls = [...refs.subjectUrls].sort();
  const fetchUrls = [...refs.fetchUrls].sort();
  const severity: Severity = subjectUrls.some((url) => ctx.isCommercial(url))
    ? "high"
    : "medium";
  const evidence: EvidenceDraft = {
    sourceProvider: "crawl",
    origin: "direct_public",
    method: "observed",
    grade: "B",
    availability: "available",
    support: "supports",
    subjectRefs: fetchUrls,
    claim,
    observedAt,
    limitation: CANONICAL_LIMITATION,
  };
  const members = crawlTargetMembers(ctx, fetchUrls);
  if (members === null) return null;
  return {
    subjectRefs: [`canonical_issue:${subtype}`],
    severity,
    titleArgs: { subtype, count: subjectUrls.length },
    metrics: { count: subjectUrls.length },
    evidence: [evidence],
    target: findingTarget(
      {
        relation: "affected_by_canonical_issue",
        targetKind: "canonical_issue",
      },
      subtype,
      members,
      "observation_members",
    ),
  };
}
