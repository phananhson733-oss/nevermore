import { describe, expect, it } from "vitest";
import { parseGeoRoleSynthesis, parseGeoQuestionSynthesis } from "./kb-synthesis-contract.ts";
import { ROLE_SYNTHESIS_INPUT, ROLE_SYNTHESIS_OUTPUT, QUESTION_SYNTHESIS_INPUT, QUESTION_SYNTHESIS_OUTPUT } from "./kb-synthesis-fixtures.ts";

describe("role synthesis output authority", () => {
  it("accepts grounded Chinese personas with English question labels and category terms", () => {
    expect(parseGeoRoleSynthesis(ROLE_SYNTHESIS_OUTPUT, ROLE_SYNTHESIS_INPUT)).toEqual({ ok: true, value: ROLE_SYNTHESIS_OUTPUT });
  });
  it.each(["unknown_key", "foreign_evidence", "empty_evidence", "duplicate_id", "duplicate_category", "invented_number", "query_cluster", "too_many_roles"])("rejects %s rather than repairing a generated Persona", (kind) => {
    const value = structuredClone(ROLE_SYNTHESIS_OUTPUT);
    if (kind === "unknown_key") Object.assign(value.roles[0]!, { source: "gsc", confirmed: true });
    if (kind === "foreign_evidence") value.roles[0]!.evidenceRefs = ["foreign"];
    if (kind === "empty_evidence") value.categoryTerms[0]!.evidenceRefs = [];
    if (kind === "duplicate_id") value.roles.push({ ...value.roles[0]! });
    if (kind === "duplicate_category") value.categoryTerms.push({ ...value.categoryTerms[0]! });
    if (kind === "invented_number") value.roles[0]!.segment = "有99名员工的团队";
    if (kind === "query_cluster") value.roles[0]!.questionLabel = "Queries about invoices";
    if (kind === "too_many_roles") value.roles = Array.from({ length: 6 }, (_, index) => ({ ...value.roles[0]!, id: `r${index}`, questionLabel: `finance audience ${index}` }));
    expect(parseGeoRoleSynthesis(value, ROLE_SYNTHESIS_INPUT).ok).toBe(false);
  });
  it("only permits numeric literals grounded in that role's referenced sources", () => {
    const input = { ...ROLE_SYNTHESIS_INPUT, sources: [...ROLE_SYNTHESIS_INPUT.sources, { id: "unused", kind: "manual" as const, text: "A separate source mentions 99." }] };
    const value = structuredClone(ROLE_SYNTHESIS_OUTPUT); value.roles[0]!.label = "99人团队的财务经理";
    expect(parseGeoRoleSynthesis(value, input).ok).toBe(false);
  });
  it("reports insufficient basis instead of requiring a fabricated Persona", () => {
    expect(parseGeoRoleSynthesis({ roles: [], categoryTerms: [] }, ROLE_SYNTHESIS_INPUT)).toMatchObject({ ok: false, reason: "insufficient_basis" });
  });
  it("keeps role IDs within the persisted core limit", () => {
    const value = structuredClone(ROLE_SYNTHESIS_OUTPUT); value.roles[0]!.id = "r".repeat(65);
    expect(parseGeoRoleSynthesis(value, ROLE_SYNTHESIS_INPUT).ok).toBe(false);
  });
});

describe("semantic question synthesis authority", () => {
  function roleAnchor(kind: "role_pain" | "role_criterion" | "role_alternative", phrase: string, questionText: string) {
    const value = structuredClone(QUESTION_SYNTHESIS_OUTPUT);
    const id = kind === "role_pain" ? "pain" : kind === "role_criterion" ? "criterion" : "alternative";
    const layer = kind === "role_pain" ? "problem" : kind === "role_criterion" ? "evaluation" : "comparison";
    value.entities.find(entity => entity.id === id)!.text = phrase;
    value.questions.find(question => question.layer === layer)!.text = questionText;
    return parseGeoQuestionSynthesis(value, QUESTION_SYNTHESIS_INPUT);
  }
  it("anchors the real role pain when natural English inserts articles and of", () => {
    expect(roleAnchor("role_pain", "lack an easy-to-enter astrology knowledge system", "How can learners overcome the lack of an easy-to-enter astrology knowledge system?")).toMatchObject({ ok: true });
  });
  it.each([
    ["role_criterion", "ease of use for beginners", "How can finance managers evaluate the ease of use for beginners?"],
    ["role_alternative", "a spreadsheet for invoices", "How does invoice reminder software compare to the spreadsheet for invoices?"],
  ] as const)("allows minimal English function words around a %s anchor", (kind, phrase, question) => {
    expect(roleAnchor(kind, phrase, question)).toMatchObject({ ok: true });
  });
  it.each([
    ["unrelated wording", "easy astrology knowledge system", "How can finance managers solve unrelated chart problems?"],
    ["reordered content words", "easy astrology knowledge system", "How can finance managers address knowledge astrology easy system?"],
    ["a substring collision", "astro", "How can finance managers use astrology?"],
  ] as const)("still refuses role pain anchored only by %s", (_case, phrase, question) => {
    expect(roleAnchor("role_pain", phrase, question)).toMatchObject({ ok: false, path: "questions.pain_anchor" });
  });
  it("falls back to exact normalized inclusion when a role phrase has only function words", () => {
    expect(roleAnchor("role_pain", "the of", "How can finance managers address the of?")).toMatchObject({ ok: true });
    expect(roleAnchor("role_pain", "the of", "How can finance managers address the lack of tools?")).toMatchObject({ ok: false, path: "questions.pain_anchor" });
  });
  it("translates accepted role concepts without forcing a brand into unprompted questions", () => {
    const parsed = parseGeoQuestionSynthesis(QUESTION_SYNTHESIS_OUTPUT, QUESTION_SYNTHESIS_INPUT);
    expect(parsed).toEqual({ ok: true, value: QUESTION_SYNTHESIS_OUTPUT });
    expect(QUESTION_SYNTHESIS_OUTPUT.questions[0]!.text).not.toContain("Acme");
  });
  it.each(["unknown_key", "calibration", "foreign_entity", "unreturned_entity", "foreign_role", "foreign_evidence", "duplicate_question", "duplicate_entity", "empty_entities", "changed_brand", "changed_numeric_fact", "new_number", "unused_pain", "missing_problem", "missing_evaluation", "missing_discovery", "missing_branded", "global_persona"])("rejects %s instead of laundering model text as frozen authority", (kind) => {
    const value = structuredClone(QUESTION_SYNTHESIS_OUTPUT);
    if (kind === "unknown_key") Object.assign(value, { profile: {} });
    if (kind === "calibration") Object.assign(value.questions[0]!, { mode: "retrieval", calibrated: true, templateId: "known" });
    if (kind === "foreign_entity") value.entities[0]!.id = "foreign";
    if (kind === "unreturned_entity") value.entities = value.entities.filter(entity => entity.id !== "pain");
    if (kind === "foreign_role") value.questions[0]!.roleId = "other-role";
    if (kind === "foreign_evidence") value.questions[0]!.evidenceRefs = ["other-evidence"];
    if (kind === "duplicate_question") value.questions.push({ ...value.questions[0]!, id: "another-id" });
    if (kind === "duplicate_entity") value.entities.push({ ...value.entities[0]! });
    if (kind === "empty_entities") value.questions[0]!.entityRefs = [];
    if (kind === "changed_brand") value.entities[0]!.text = "Better Acme";
    if (kind === "changed_numeric_fact") value.entities.find(entity => entity.id === "price")!.text = "$29 per month";
    if (kind === "new_number") value.questions[0]!.text = "How can finance managers reduce manual invoice reminders by 99%?";
    if (kind === "unused_pain") value.questions[0]!.text = "Which product is good for finance managers?";
    if (kind === "missing_problem") value.questions = value.questions.filter(question => question.layer !== "problem");
    if (kind === "missing_evaluation") value.questions = value.questions.filter(question => question.layer !== "evaluation");
    if (kind === "missing_discovery") value.questions = value.questions.filter(question => question.layer !== "discovery");
    if (kind === "missing_branded") value.questions = value.questions.filter(question => question.layer !== "branded");
    if (kind === "global_persona") value.questions[0]!.roleId = null;
    expect(parseGeoQuestionSynthesis(value, QUESTION_SYNTHESIS_INPUT).ok).toBe(false);
  });
  it("accepts global discovery and branded questions when there are no accepted personas", () => {
    const input = { ...QUESTION_SYNTHESIS_INPUT, roles: [], entities: QUESTION_SYNTHESIS_INPUT.entities.filter(entity => entity.roleId === null) };
    const value = { entities: QUESTION_SYNTHESIS_OUTPUT.entities.filter(entity => ["brand", "category", "price"].includes(entity.id)), questions: QUESTION_SYNTHESIS_OUTPUT.questions.filter(question => question.roleId === null) };
    expect(parseGeoQuestionSynthesis(value, input)).toEqual({ ok: true, value });
  });
  it("accepts an otherwise valid manually reviewed role with an empty segment", () => {
    const input = structuredClone(QUESTION_SYNTHESIS_INPUT); input.roles[0]!.segment = "";
    expect(parseGeoQuestionSynthesis(QUESTION_SYNTHESIS_OUTPUT, input).ok).toBe(true);
  });
  it("preserves a valid 200-character brand entity instead of truncating it", () => {
    const name = "Acme" + "X".repeat(196);
    const input = structuredClone(QUESTION_SYNTHESIS_INPUT); input.officialName = name; input.entities[0]!.text = name;
    const value = structuredClone(QUESTION_SYNTHESIS_OUTPUT); value.entities[0]!.text = name; value.questions[3]!.text = `What is ${name}?`;
    expect(parseGeoQuestionSynthesis(value, input)).toEqual({ ok: true, value });
  });
  it.each(["problem", "evaluation"] as const)("refuses a global %s without an accepted role", (layer) => {
    const value = { ...QUESTION_SYNTHESIS_OUTPUT, questions: [...QUESTION_SYNTHESIS_OUTPUT.questions, { id: "unbound", text: "How should I choose invoice reminder software?", layer, roleId: null, entityRefs: ["category"], evidenceRefs: ["P1"] }] };
    expect(parseGeoQuestionSynthesis(value, QUESTION_SYNTHESIS_INPUT).ok).toBe(false);
  });
  it.each(["problem", "evaluation"] as const)("refuses a role-bound %s when that role has no corresponding basis", (layer) => {
    const field = layer === "problem" ? "painPoints" : "decisionCriteria", kind = layer === "problem" ? "role_pain" : "role_criterion", id = layer === "problem" ? "pain" : "criterion";
    const input = structuredClone(QUESTION_SYNTHESIS_INPUT); input.roles[0]![field] = []; input.entities = input.entities.filter(entity => entity.kind !== kind);
    const value = structuredClone(QUESTION_SYNTHESIS_OUTPUT); value.entities = value.entities.filter(entity => entity.id !== id);
    const question = value.questions.find(question => question.layer === layer)!; question.text = "How should I choose invoice reminder software?"; question.entityRefs = ["category"];
    expect(parseGeoQuestionSynthesis(value, input).ok).toBe(false);
  });
  it("requires comparison coverage for accepted alternatives", () => {
    const value = { ...QUESTION_SYNTHESIS_OUTPUT, questions: QUESTION_SYNTHESIS_OUTPUT.questions.filter(question => question.layer !== "comparison") };
    expect(parseGeoQuestionSynthesis(value, QUESTION_SYNTHESIS_INPUT)).toMatchObject({ ok: false, path: "questions.role_alternative_coverage" });
  });
  it("requires and accepts a known competitor comparison without modifying its name", () => {
    const competitor = { id: "competitor", text: "Rival Billing", kind: "competitor" as const, roleId: null, evidenceRefs: ["P1"] };
    const input = { ...QUESTION_SYNTHESIS_INPUT, entities: [...QUESTION_SYNTHESIS_INPUT.entities, competitor] };
    expect(parseGeoQuestionSynthesis(QUESTION_SYNTHESIS_OUTPUT, input)).toMatchObject({ ok: false, path: "questions.competitor_coverage" });
    const value = { entities: [...QUESTION_SYNTHESIS_OUTPUT.entities, { id: competitor.id, text: competitor.text }], questions: [...QUESTION_SYNTHESIS_OUTPUT.questions, { id: "q-competitor", text: "How does Acme compare with Rival Billing?", layer: "comparison" as const, roleId: null, entityRefs: ["brand", "competitor"], evidenceRefs: ["P1"] }] };
    expect(parseGeoQuestionSynthesis(value, input)).toEqual({ ok: true, value });
    value.entities[value.entities.length - 1]!.text = "Other Billing";
    expect(parseGeoQuestionSynthesis(value, input).ok).toBe(false);
  });
  it("does not accept source-free alternative hypotheses as reviewed candidates", () => {
    const value = structuredClone(ROLE_SYNTHESIS_OUTPUT); value.roles[0]!.alternatives = ["假设：外包催收"];
    expect(parseGeoRoleSynthesis(value, ROLE_SYNTHESIS_INPUT)).toMatchObject({ ok: false, path: "roles.alternatives" });
  });
});
