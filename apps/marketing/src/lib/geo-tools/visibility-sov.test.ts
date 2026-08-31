import { describe, expect, it } from "vitest";
import { compareVisibilitySov, computeVisibilitySov, type VisibilitySovCluster } from "./visibility-sov.ts";

function clusters(n: number, own = 2, anyBrand = 4, answered = 5, planned = 5): VisibilitySovCluster[] {
  return Array.from({ length: n }, (_, index) => ({ questionId: `q-${index}`, own, anyBrand, answered, planned }));
}

describe("conditional-answer SOV", () => {
  it("counts an answer containing own and rivals only once in the denominator", () => {
    const result = computeVisibilitySov(clusters(1, 3, 3, 3, 3));
    expect(result.ownAnswers).toBe(3);
    expect(result.anyBrandAnswers).toBe(3);
    expect(result.point).toBe(1);
    expect(result.clusters).toBe(1);
    expect(result.lo).toBeNull();
    expect(result.hi).toBeNull();
    expect(result.intervalReason).toBe("fewer_than_10_question_clusters");
  });
  it("uses the specified two-mean Hoeffding ratio bound, not a Bernoulli bound around the answer point", () => {
    const result = computeVisibilitySov(clusters(100));
    expect(result.point).toBe(0.5);
    expect(result.lo).toBeCloseTo(0.2657951206039661, 12);
    expect(result.hi).toBeCloseTo(0.8405492850365571, 12);
    expect(result.clusters).toBe(100);
    expect(result.intervalReason).toBeNull();
    expect(result.method).toBe("question_cluster_hoeffding_ratio_95.v1");
    expect(result.assumption).toBe("independent_question_clusters");
    expect(result.scope).toBe("observed_answers");
  });
  it("does not invent independent units when every question is replicated 5 versus 50 times", () => {
    const small = computeVisibilitySov(clusters(100, 2, 4, 5, 5));
    const large = computeVisibilitySov(clusters(100, 20, 40, 50, 50));
    expect(large).toMatchObject({ clusters: small.clusters, point: small.point, lo: small.lo, hi: small.hi });
    expect(large.answered).toBe(small.answered * 10);
  });
  it.each([0, 5])("never collapses %i/5 endpoints to an exact confidence claim", (own) => {
    const result = computeVisibilitySov(clusters(100, own, 5));
    expect(result.point).toBe(own / 5);
    expect(result.lo).not.toBeNull();
    expect(result.hi).not.toBeNull();
    expect(result.hi! - result.lo!).toBeGreaterThan(0);
    expect(result.lo).toBeGreaterThanOrEqual(0);
    expect(result.hi).toBeLessThanOrEqual(1);
  });
  it("includes answered questions without any brand in the independent question count", () => {
    const result = computeVisibilitySov([...clusters(9, 5, 5), { questionId: "no-brand", own: 0, anyBrand: 0, answered: 5, planned: 5 }]);
    expect(result.clusters).toBe(10);
    expect(result.point).toBe(1);
    expect(result.lo).not.toBeNull();
    expect(result.intervalReason).toBeNull();
  });
  it("does not turn wholly failed questions into zero-valued observations", () => {
    const observed = clusters(10, 5, 5);
    const before = computeVisibilitySov(observed);
    const result = computeVisibilitySov([...observed, { questionId: "failed", own: 0, anyBrand: 0, answered: 0, planned: 5 }]);
    expect(result).toMatchObject({ point: 1, clusters: 10, unobservedClusters: 1, lo: before.lo, hi: before.hi, answered: 50, planned: 55 });
  });
  it("keeps partial response loss out of the point denominator while widening the bound", () => {
    const complete = computeVisibilitySov(clusters(10, 5, 5));
    const partial = computeVisibilitySov(clusters(10, 1, 1, 1, 5));
    expect(partial.point).toBe(1);
    expect(partial.answered).toBe(10);
    expect(partial.planned).toBe(50);
    expect(partial.lo!).toBeLessThan(complete.lo!);
  });
  it("reports no brand-eligible denominator as unknown, not 0 percent", () => {
    const result = computeVisibilitySov(clusters(20, 0, 0));
    expect(result).toMatchObject({ point: null, lo: null, hi: null, clusters: 20, intervalReason: "no_brand_present_answers" });
  });
  it("separates an absence of answered clusters from an absence of brands", () => {
    expect(computeVisibilitySov([])).toMatchObject({ point: null, clusters: 0, intervalReason: "no_observed_questions" });
    expect(computeVisibilitySov(clusters(3, 0, 0, 0, 5))).toMatchObject({ point: null, clusters: 0, unobservedClusters: 3, intervalReason: "no_observed_questions" });
  });
  it("uses one common planned cap without changing the answer-weighted estimand", () => {
    const rows = [...clusters(50, 5, 5), ...clusters(50, 0, 50, 50, 50).map((q) => ({ ...q, questionId: `large-${q.questionId}` }))];
    const result = computeVisibilitySov(rows);
    const epsilon = Math.sqrt(Math.log(4 / 0.05) / 200);
    expect(result.point).toBe(250 / 2750);
    expect(result.point).not.toBe(0.5); // Not a mean of 50 all-own and 50 no-own question rates.
    expect(result.lo).toBe(0);
    expect(result.hi).toBeCloseTo((0.05 + epsilon) / (0.55 - epsilon), 14);
  });
  it("keeps every valid small-count point within the conservative bounds", () => {
    for (const n of [10, 25, 100]) {
      for (let planned = 1; planned <= 5; planned += 1) {
        for (let anyBrand = 1; anyBrand <= planned; anyBrand += 1) {
          for (let own = 0; own <= anyBrand; own += 1) {
            const result = computeVisibilitySov(clusters(n, own, anyBrand, planned, planned));
            expect(result.lo!).toBeLessThanOrEqual(result.point!);
            expect(result.hi!).toBeGreaterThanOrEqual(result.point!);
            expect(result.lo!).toBeGreaterThanOrEqual(0);
            expect(result.hi!).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe("cluster input validation", () => {
  it.each([
    { own: -1 }, { own: 1.5 }, { own: Number.NaN }, { anyBrand: Number.POSITIVE_INFINITY },
    { own: 5, anyBrand: 4 }, { anyBrand: 6 }, { answered: 6 }, { planned: -1 },
    { planned: Number.MAX_SAFE_INTEGER + 1 }, { questionId: "" },
  ])("rejects impossible counts or identities: %j", (invalid) => {
    expect(() => computeVisibilitySov([{ ...clusters(1)[0]!, ...invalid }])).toThrow(RangeError);
  });
  it("rejects duplicate question identities, even when a duplicate has no answer", () => {
    expect(() => computeVisibilitySov([clusters(1)[0]!, { questionId: "q-0", own: 0, anyBrand: 0, answered: 0, planned: 5 }])).toThrow(RangeError);
  });
  it("rejects aggregate count overflow rather than silently rounding the denominator", () => {
    expect(() => computeVisibilitySov(clusters(2, 0, 0, 0, Number.MAX_SAFE_INTEGER))).toThrow(RangeError);
  });
});

describe("paired conditional-answer SOV comparison", () => {
  it("uses only observed answers on intersected question identities for both points", () => {
    const before = [...clusters(10), { questionId: "before-only", own: 5, anyBrand: 5, answered: 5, planned: 5 }];
    const after = [...clusters(10, 3), { questionId: "after-only", own: 0, anyBrand: 5, answered: 5, planned: 5 }];
    const result = compareVisibilitySov(before, after);
    expect(result).toMatchObject({ pairs: 10, beforePoint: 0.5, afterPoint: 0.75, point: 0.25, scope: "paired_observed_answers" });
    expect(result.matchedQuestionIds).toEqual(clusters(10).map((q) => q.questionId).sort());
    expect(result.matchedQuestionIds).not.toContain("before-only");
    expect(result.matchedQuestionIds).not.toContain("after-only");
  });
  it("uses four simultaneous means for the paired difference interval", () => {
    const result = compareVisibilitySov(clusters(100, 1, 5), clusters(100, 4, 5));
    expect(result.point).toBeCloseTo(0.6, 14);
    const epsilon = Math.sqrt(Math.log(8 / 0.05) / 200);
    const expectedLo = (0.8 - epsilon) - (0.2 + epsilon) / (1 - epsilon);
    const expectedHi = 1 - (0.2 - epsilon);
    expect(result.lo).toBeCloseTo(expectedLo, 14);
    expect(result.hi).toBeCloseTo(expectedHi, 14);
    expect(result.method).toBe("paired_question_cluster_hoeffding_ratio_95.v1");
    expect(result.direction).toBe("increase");
  });
  it("cannot call one observed pair significant, regardless of replica count", () => {
    const result = compareVisibilitySov(clusters(1, 0, 50, 50, 50), clusters(1, 50, 50, 50, 50));
    expect(result).toMatchObject({ pairs: 1, point: 1, lo: null, hi: null, intervalReason: "fewer_than_10_question_pairs", direction: "inconclusive" });
  });
  it("keeps identical all-one runs uncertain instead of a bootstrap [0,0]", () => {
    const result = compareVisibilitySov(clusters(100, 5, 5), clusters(100, 5, 5));
    expect(result.point).toBe(0);
    expect(result.lo).toBeLessThan(0);
    expect(result.hi).toBeGreaterThan(0);
    expect(result.direction).toBe("inconclusive");
  });
  it("has identical precision when both runs merely multiply within-question replicas", () => {
    const small = compareVisibilitySov(clusters(100, 1, 5), clusters(100, 4, 5));
    const large = compareVisibilitySov(clusters(100, 10, 50, 50, 50), clusters(100, 40, 50, 50, 50));
    expect(large).toMatchObject({ pairs: small.pairs, point: small.point, lo: small.lo, hi: small.hi, direction: small.direction });
  });
  it("permits different planned caps while keeping one independent pair per question", () => {
    const result = compareVisibilitySov(clusters(10, 1, 5), clusters(10, 10, 50, 50, 50));
    expect(result.pairs).toBe(10);
    expect(result.beforePoint).toBe(0.2);
    expect(result.afterPoint).toBe(0.2);
    expect(result.point).toBe(0);
    expect(result.direction).toBe("inconclusive");
  });
  it("does not pair a wholly failed current question as a zero", () => {
    const after = clusters(10, 3);
    after[0] = { questionId: "q-0", own: 0, anyBrand: 0, answered: 0, planned: 5 };
    const result = compareVisibilitySov(clusters(10), after);
    expect(result).toMatchObject({ pairs: 9, point: 0.25, lo: null, hi: null, intervalReason: "fewer_than_10_question_pairs" });
    expect(result.matchedQuestionIds).not.toContain("q-0");
  });
  it("cannot invent a difference when a paired run has no eligible brand answers", () => {
    expect(compareVisibilitySov(clusters(10, 0, 0), clusters(10))).toMatchObject({ pairs: 10, beforePoint: null, afterPoint: 0.5, point: null, lo: null, hi: null, intervalReason: "no_brand_present_answers", direction: "inconclusive" });
  });
  it("separates unmatched runs from a measured zero difference", () => {
    expect(compareVisibilitySov(clusters(10), clusters(10).map((q) => ({ ...q, questionId: `other-${q.questionId}` })))).toMatchObject({ pairs: 0, point: null, lo: null, hi: null, intervalReason: "no_paired_questions", direction: "inconclusive" });
  });
  it("reverses a real direction and bounds when the two runs swap", () => {
    const up = compareVisibilitySov(clusters(100, 1, 5), clusters(100, 4, 5));
    const down = compareVisibilitySov(clusters(100, 4, 5), clusters(100, 1, 5));
    expect(down.point).toBe(-up.point!);
    expect(down.lo).toBe(-up.hi!);
    expect(down.hi).toBe(-up.lo!);
    expect(down.direction).toBe("decrease");
  });
  it("is deterministic under row reordering and does not mutate frozen inputs", () => {
    const before = Object.freeze(clusters(100, 1, 5).map((cluster) => Object.freeze(cluster)));
    const after = Object.freeze(clusters(100, 4, 5).map((cluster) => Object.freeze(cluster)));
    expect(compareVisibilitySov(before, after)).toEqual(compareVisibilitySov([...before].reverse(), [...after].reverse()));
  });
  it("rejects invalid or duplicate clusters even when they would be outside the intersection", () => {
    expect(() => compareVisibilitySov(clusters(10), [...clusters(10), { questionId: "unmatched", own: 3, anyBrand: 2, answered: 5, planned: 5 }])).toThrow(RangeError);
    expect(() => compareVisibilitySov([...clusters(10), clusters(1)[0]!], clusters(10))).toThrow(RangeError);
  });
});
