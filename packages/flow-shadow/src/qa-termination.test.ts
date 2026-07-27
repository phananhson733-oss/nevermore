import { describe, expect, it } from "vitest";
import type { ResearchSource } from "./types.ts";
import { evaluateDraftQa, QA_THRESHOLDS } from "./qa/index.ts";
import { CLEAN_DRAFT } from "./qa/__fixtures__/drafts.ts";
import { fixturePack } from "./qa/__fixtures__/pack.ts";

/**
 * The one QA assertion that CANNOT live under `qa/`.
 *
 * Everything in the gate's import closure — its tests and fixtures included —
 * is forbidden from reading the clock, because the verdict has to be a pure
 * function of the frozen run inputs and `verify-implementation.mjs` enforces
 * that by walking the closure. This test measures elapsed wall-clock time,
 * which is a statement about the HOST rather than about the verdict, so it sits
 * one directory outside the closure instead of relaxing the guard. Nothing
 * under `qa/` imports this file, so the closure is unchanged.
 *
 * What it pins: `ENTITY_ASSERTION`'s name run used to be an unbounded greedy
 * star, so a long run of capitalized words backtracked from every start
 * position. One 396,000-character line — comfortably inside the
 * `maxDraftChars` contract the gate advertises, and whose rejection message
 * used to promise that everything under the bound "is guaranteed to terminate"
 * — took 36 seconds. The identical text split across 36,000 lines took 184ms,
 * because the cost was quadratic in the length of ONE line and not in the size
 * of the draft. The run is now capped at eight tokens, which is where
 * `cleanNameCandidate` already truncated, so nothing real was given up.
 *
 * The budget is deliberately loose: this asserts the cost is no longer
 * quadratic, not that any particular machine is fast.
 */
describe("termination inside the advertised input bound", () => {
  const draft = `# Onboarding analytics\n\n## Why it matters\n\n${"Alpha Beta ".repeat(36_000)}\n`;

  it("judges a single very long line without quadratic backtracking", () => {
    expect(draft.length).toBeLessThanOrEqual(QA_THRESHOLDS.maxDraftChars);

    const started = Date.now();
    const evaluation = evaluateDraftQa({
      draftMarkdown: draft,
      briefMarkdown: "## Brief\n\nDefine the activation milestone.\n",
      pack: fixturePack(),
      briefOutlineStats: {
        briefSectionCount: 2,
        projectedSectionCount: 2,
        clusterKeywordCount: 1,
        projectedKeywordCount: 1,
        unconfirmedMappingCount: 0,
      },
    });
    const elapsed = Date.now() - started;

    // The draft really was judged rather than rejected for length: if it had
    // been, every rule would carry the oversized reason and the timing would
    // measure nothing.
    expect(
      evaluation.rules.some((rule) => rule.reasonCode === "draft_oversized"),
    ).toBe(false);
    expect(elapsed).toBeLessThan(10_000);
  });

  /**
   * The same content, split. Before the bound this was 194x faster than the
   * line above; the point of keeping both is that the ratio is what went wrong,
   * so the ratio is what is watched.
   */
  it("costs about the same whether the text is one line or many", () => {
    const split = `# Onboarding analytics\n\n## Why it matters\n\n${"Alpha Beta\n".repeat(36_000)}\n`;

    const oneLineStart = Date.now();
    evaluateDraftQa({
      draftMarkdown: draft,
      briefMarkdown: "## Brief\n\nDefine the activation milestone.\n",
      pack: fixturePack(),
      briefOutlineStats: {
        briefSectionCount: 2,
        projectedSectionCount: 2,
        clusterKeywordCount: 1,
        projectedKeywordCount: 1,
        unconfirmedMappingCount: 0,
      },
    });
    const oneLine = Date.now() - oneLineStart;

    const splitStart = Date.now();
    evaluateDraftQa({
      draftMarkdown: split,
      briefMarkdown: "## Brief\n\nDefine the activation milestone.\n",
      pack: fixturePack(),
      briefOutlineStats: {
        briefSectionCount: 2,
        projectedSectionCount: 2,
        clusterKeywordCount: 1,
        projectedKeywordCount: 1,
        unconfirmedMappingCount: 0,
      },
    });
    const splitLines = Date.now() - splitStart;

    expect(oneLine).toBeLessThan(Math.max(splitLines, 50) * 20);
  });

  it("bounds a maximal frozen page corpus and fails to human review", () => {
    const corpusText =
      "A frozen methodology appendix discusses sampling frames, interview protocols, cohort definitions, and correction records. ".repeat(
        260,
      );
    const externalPages: ResearchSource[] = Array.from(
      { length: 33 },
      (_, index) => ({
        kind: "external_page",
        ref: `bounded-external-page-${index}`,
        authorityTier: "B",
        label: `Bounded external page ${index}`,
        url: `https://research.example/corpus/${index}`,
        availability: "available",
        capturedAt: "2026-07-27T08:00:00.000Z",
        urlHash: "a".repeat(64),
        contentHash: "b".repeat(64),
        contentHashMethod: "sha256_canonical_extract",
        contentText: corpusText,
        contentTruncated: false,
        excerpt: corpusText.slice(0, 240),
        excerptTruncated: true,
        metrics: null,
        evidenceRefs: [],
        limitation: null,
      }),
    );
    const base = fixturePack();
    const started = Date.now();
    const evaluation = evaluateDraftQa({
      draftMarkdown: CLEAN_DRAFT,
      briefMarkdown: "## Brief\n\nDefine the activation milestone.\n",
      pack: { ...base, sources: [...base.sources, ...externalPages] },
      briefOutlineStats: {
        briefSectionCount: 2,
        projectedSectionCount: 2,
        clusterKeywordCount: 1,
        projectedKeywordCount: 1,
        unconfirmedMappingCount: 0,
      },
    });
    const elapsed = Date.now() - started;
    const overlap = evaluation.rules.find(
      (rule) => rule.ruleId === "scdup_source_overlap",
    );

    expect(overlap).toMatchObject({
      pass: true,
      evaluable: false,
      reasonCode: "scdup_source_comparison_bounded",
    });
    expect(evaluation.verdict).toBe("needs_review");
    expect(elapsed).toBeLessThan(10_000);
  });
});
