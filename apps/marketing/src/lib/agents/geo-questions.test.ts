// @input  -- product seeds, including empty and hostile ones
// @output -- proof the generated set is always confirmable and always payable
// @pos    -- focused tests for the GEO Agent's question generator

import { describe, expect, it } from "vitest";
import {
  GEO_MAX_QUESTION_LENGTH,
  GEO_QUESTIONS_PER_RUN,
} from "./geo-report-contract.ts";
import { generateGeoQuestions } from "./geo-questions.ts";

const SEED = {
  category: "AI visibility tracking",
  buyer: "SaaS marketing teams",
  rivals: ["Profound", "Peec AI"],
};

describe("generateGeoQuestions", () => {
  it("produces exactly the run's question count with unique ids", () => {
    const questions = generateGeoQuestions(SEED);

    expect(questions).toHaveLength(GEO_QUESTIONS_PER_RUN);
    expect(new Set(questions.map((q) => q.questionId)).size).toBe(
      GEO_QUESTIONS_PER_RUN,
    );
    expect(new Set(questions.map((q) => q.question)).size).toBe(
      GEO_QUESTIONS_PER_RUN,
    );
  });

  it("spans the whole buyer journey, not just discovery", () => {
    const stages = new Set(generateGeoQuestions(SEED).map((q) => q.stage));

    expect(stages).toEqual(
      new Set(["discovery", "comparison", "evaluation", "decision"]),
    );
  });

  it("names the rivals the buyer would recognise", () => {
    const questions = generateGeoQuestions(SEED);

    expect(questions.some((q) => q.question.includes("Profound"))).toBe(true);
  });

  it("still produces a usable set with no rivals", () => {
    const questions = generateGeoQuestions({ ...SEED, rivals: [] });

    expect(questions).toHaveLength(GEO_QUESTIONS_PER_RUN);
    expect(questions.some((q) => q.question.includes("undefined"))).toBe(false);
    expect(questions.some((q) => q.question.includes("established"))).toBe(true);
  });

  it("falls back to neutral wording rather than emitting a blank", () => {
    const questions = generateGeoQuestions({
      category: "   ",
      buyer: "",
      rivals: [],
    });

    for (const question of questions) {
      expect(question.question.length).toBeGreaterThan(10);
      expect(question.question).not.toContain("  ");
    }
  });

  it.each([
    ["a very long category", { ...SEED, category: "a".repeat(600) }],
    ["a very long buyer", { ...SEED, buyer: "b".repeat(600) }],
    ["a very long rival", { ...SEED, rivals: ["c".repeat(600)] }],
  ] as const)("keeps every question payable with %s", (_label, seed) => {
    for (const question of generateGeoQuestions(seed)) {
      // Over this bound the provider refuses the call after billing for it.
      expect(question.question.length).toBeLessThanOrEqual(
        GEO_MAX_QUESTION_LENGTH,
      );
      expect(question.question.trim()).toBe(question.question);
      expect(question.question.length).toBeGreaterThan(0);
    }
  });

  it("collapses newlines and padding a pasted value brings with it", () => {
    const questions = generateGeoQuestions({
      ...SEED,
      category: "  AI\n\nvisibility\ttracking  ",
    });

    expect(questions[0]!.question).toContain("AI visibility tracking");
    expect(questions[0]!.question).not.toContain("\n");
  });

  it("is deterministic", () => {
    expect(generateGeoQuestions(SEED)).toEqual(generateGeoQuestions(SEED));
  });
});
