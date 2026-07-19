/**
 * CONTENT-COVERAGE-001 (spec §8.3 / §8.4, domain `content_intent`). Detects ICP
 * offers / use cases that no indexable page appears to cover. PURE logic: no DB,
 * no network, no LLM, no clock — it reads a frozen `DiagnosticContext` only.
 *
 * Coverage is INFERRED from crawl + the `intent_match.v1` heuristic (English only).
 * A target is a defect only when it is confidently `uncovered`; an `inconclusive`
 * verdict (empty target tokens or no eligible pages) never manufactures a defect.
 */

import type { DiagnosticContext } from "../context.ts";
import type { DiagnosticRule, EvidenceDraft, FindingCandidate } from "../rule.ts";
import { matchIntent, pageFieldBag } from "../util/intent-match.ts";

type TargetKind = "offer" | "use_case";

interface CoverageTarget {
  readonly text: string;
  readonly kind: TargetKind;
}

export const contentCoverageRule = {
  id: "CONTENT-COVERAGE-001",
  version: 1,
  domain: "content_intent",
  requiredDatasets: [
    { dataset: "crawl", required: true },
    { dataset: "icp", required: true },
  ],
  evaluate(ctx) {
    // Structural gate first: without a crawl there are no pages to judge.
    if (!ctx.hasDataset("crawl")) {
      return { status: "skipped", reason: "missing_dataset" };
    }
    // `intent_match.v1` is an English-only heuristic (spec §8.4).
    if (!ctx.isEnglish()) {
      return { status: "skipped", reason: "unsupported_language" };
    }

    const bags = buildPageBags(ctx);
    const targets = collectTargets(ctx);

    const candidates: FindingCandidate[] = [];
    let coveredCount = 0;
    for (const target of targets) {
      const outcome = matchIntent(target.text, bags);
      if (outcome === "covered") {
        coveredCount += 1;
        continue;
      }
      // "inconclusive": empty target tokens or no eligible pages → not a defect.
      if (outcome === "inconclusive") continue;
      candidates.push(buildCandidate(ctx, target));
    }

    if (candidates.length > 0) {
      return { status: "candidate", candidates };
    }
    return { status: "pass", metrics: { coveredCount } };
  },
} satisfies DiagnosticRule;

/** Token field bags for every eligible indexable page (dropping null bags). */
function buildPageBags(ctx: DiagnosticContext): ReadonlySet<string>[] {
  const bags: ReadonlySet<string>[] = [];
  for (const [subjectUrl, page] of ctx.indexablePages()) {
    let urlPath: string;
    try {
      urlPath = new URL(subjectUrl).pathname;
    } catch {
      continue;
    }
    const bag = pageFieldBag({ urlPath, title: page.title, h1: page.h1 });
    if (bag) bags.push(bag);
  }
  return bags;
}

/** Every ICP offer and use case, tagged with its subjectRef kind. */
function collectTargets(ctx: DiagnosticContext): CoverageTarget[] {
  return [
    ...ctx.icp.offers.map((text): CoverageTarget => ({ text, kind: "offer" })),
    ...ctx.icp.useCases.map((text): CoverageTarget => ({ text, kind: "use_case" })),
  ];
}

function buildCandidate(ctx: DiagnosticContext, target: CoverageTarget): FindingCandidate {
  const subjectRef = `page_set:${target.kind}:${slugify(target.text)}`;
  const evidence: EvidenceDraft = {
    sourceProvider: "crawl",
    origin: "derived",
    method: "inferred",
    grade: "C",
    availability: "available",
    support: "supports",
    subjectRefs: [subjectRef],
    claim: `No indexable page covers the core intent tokens of "${target.text}".`,
    observedAt: ctx.observedAt("crawl"),
    limitation: "Intent match is an English-only heuristic over URL/title/H1 tokens.",
  };
  return {
    subjectRefs: [subjectRef],
    severity: "high",
    titleArgs: { target: target.text, kind: target.kind },
    metrics: { target: target.text, kind: target.kind },
    evidence: [evidence],
  };
}

/** lowercase → spaces to "-" → strip remaining non-alphanumerics (keeps hyphens). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
