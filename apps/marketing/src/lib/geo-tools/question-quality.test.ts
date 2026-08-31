import { describe, expect, it } from "vitest";

import { emptyGeoKbPayload, type GeoKbPayload } from "./kb-contract.ts";
import { buildGeoQuestionSet, geoQuestionSetCanonicalText, geoQuestionSetDigest, type GeoQuestion } from "./kb-questions.ts";
import { assessGeoQuestionQuality, geoQuestionLanguageIssue } from "./question-quality.ts";

const payload: GeoKbPayload = {
  ...emptyGeoKbPayload("https://quality.test/"),
  officialName: "星图",
  aliases: ["Star Map"],
  categoryTerms: ["astrology", "心理占星", "自我探索", "CBT 日记", "知识库", "合盘分析"],
  roles: [{ id: "r1", label: "beginners", segment: "new learners", painPoints: ["unclear jargon"], decisionCriteria: ["price"], vocabulary: ["synastry"] }],
  competitors: [{ domain: "rival.test", brandName: "小米", aliases: ["Xiaomi"], confirmed: true }],
};
const question: GeoQuestion = {
  id: "q1", text: "What are the top astrology tools right now?", layer: "discovery", mode: "retrieval",
  roleId: null, requiredEntities: ["astrology"], templateId: "geo.retrieval.category_top", calibrated: true,
};

describe("English question wording", () => {
  it.each(["en", "en-US", "en-GB"])("detects mixed natural-language text for %s", (language) => {
    expect(geoQuestionLanguageIssue("What are the top 占星工具 tools right now?", language)).toBe(true);
    expect(geoQuestionLanguageIssue("Which astrology tool should 初学者 pick?", language)).toBe(true);
  });

  it("allows Unicode proper names but does not exempt unrelated non-English wording", () => {
    expect(geoQuestionLanguageIssue("How does 星图 compare to 小米 for astrology?", "en-US", ["星图", "小米"])).toBe(false);
    expect(geoQuestionLanguageIssue("How does 星图 compare for 占星工具?", "en", ["星图"])).toBe(true);
    expect(geoQuestionLanguageIssue("What is café management software?", "en")).toBe(false);
    expect(geoQuestionLanguageIssue("哪些占星工具适合初学者？", "zh")).toBe(false);
  });
});

describe("frozen question quality", () => {
  it("diagnoses the observed mixed-language category and unrelated entities without rewriting the snapshot", () => {
    const legacyPayload = { ...payload, categoryTerms: ["占星工具", ...payload.categoryTerms.slice(1)] };
    const legacyQuestion = { ...question, text: "What are the top 占星工具 tools right now?", requiredEntities: legacyPayload.categoryTerms };
    const frozen = { ...buildGeoQuestionSet(payload), registryVersion: "2026-08-17/13", questions: [legacyQuestion] };
    const hash = geoQuestionSetDigest(frozen);
    const canonical = geoQuestionSetCanonicalText(frozen);
    expect(assessGeoQuestionQuality(legacyPayload, legacyQuestion)).toEqual({ ok: false, issues: [
      { code: "category_language_mismatch", field: "categoryTerms", values: ["占星工具"] },
      { code: "question_language_mismatch", field: "question", values: [legacyQuestion.text] },
      { code: "unrelated_required_entities", field: "requiredEntities", values: payload.categoryTerms.slice(1) },
    ] });
    expect(geoQuestionSetCanonicalText(frozen)).toBe(canonical);
    expect(geoQuestionSetDigest(frozen)).toBe(hash);
  });

  it("does not promote omitted secondary categories, criteria, vocabulary or aliases into a valid question", () => {
    const legacyQuestion = { ...question, requiredEntities: ["astrology", "psychological astrology", "price", "synastry", "Star Map"] };
    const legacyPayload = { ...payload, categoryTerms: ["astrology", "psychological astrology"] };
    expect(assessGeoQuestionQuality(legacyPayload, legacyQuestion).issues).toContainEqual({ code: "unrelated_required_entities", field: "requiredEntities", values: ["psychological astrology", "price", "synastry", "Star Map"] });
    expect(assessGeoQuestionQuality(payload, question)).toEqual({ ok: true, issues: [] });
  });

  it("accepts explicitly named brands, rivals and role labels in otherwise-English questions", () => {
    for (const current of buildGeoQuestionSet(payload).questions) {
      expect(assessGeoQuestionQuality(payload, current)).toEqual({ ok: true, issues: [] });
    }
  });

  it("does not reject an arbitrary unknown entity using a guessed semantic relevance rule", () => {
    expect(assessGeoQuestionQuality(payload, { ...question, requiredEntities: ["astrology", "composite chart"] })).toEqual({ ok: true, issues: [] });
  });
});
