// Synthetic offline synthesis fixtures. Never a runtime or provider fallback.
export const SYNTHESIS_SOURCES = [
  { id: "P1", kind: "profile" as const, text: "Acme helps finance managers replace manual invoice reminders and spreadsheets with invoice reminder software. Buyers evaluate audit trails and work with overdue invoices. The documented price is $19 per month." },
  { id: "G1", kind: "gsc" as const, text: "Observed queries: how to reduce manual invoice reminders; invoice reminder software with audit trails; spreadsheet invoice reminders." },
];
export const ROLE_SYNTHESIS_INPUT = { officialName: "Acme", displayLocale: "zh" as const, questionLanguage: "en-US", sources: SYNTHESIS_SOURCES };
export const ROLE_SYNTHESIS_OUTPUT = {
  roles: [{ id: "finance", label: "财务经理", questionLabel: "finance managers", segment: "需要减少应收账款跟进工作的财务团队", painPoints: ["手工催收发票耗时"], alternatives: ["电子表格"], decisionCriteria: ["审计记录"], vocabulary: ["逾期发票"], evidenceRefs: ["P1", "G1"] }],
  categoryTerms: [{ text: "invoice reminder software", evidenceRefs: ["P1", "G1"] }],
};
export const QUESTION_SYNTHESIS_INPUT = {
  officialName: "Acme", aliases: ["Acme Billing"], language: "en-US", roles: ROLE_SYNTHESIS_OUTPUT.roles,
  entities: [
    { id: "brand", text: "Acme", kind: "brand" as const, roleId: null, evidenceRefs: ["P1"] },
    { id: "category", text: "invoice reminder software", kind: "category" as const, roleId: null, evidenceRefs: ["P1"] },
    { id: "pain", text: "手工催收发票耗时", kind: "role_pain" as const, roleId: "finance", evidenceRefs: ["P1", "G1"] },
    { id: "criterion", text: "审计记录", kind: "role_criterion" as const, roleId: "finance", evidenceRefs: ["P1", "G1"] },
    { id: "vocabulary", text: "逾期发票", kind: "role_vocabulary" as const, roleId: "finance", evidenceRefs: ["P1"] },
    { id: "alternative", text: "电子表格", kind: "role_alternative" as const, roleId: "finance", evidenceRefs: ["P1", "G1"] },
    { id: "price", text: "$19 per month", kind: "fact" as const, roleId: null, evidenceRefs: ["P1"] },
  ],
  evidenceSources: SYNTHESIS_SOURCES,
};
export const QUESTION_SYNTHESIS_OUTPUT = {
  entities: [
    { id: "brand", text: "Acme" }, { id: "category", text: "invoice reminder software" },
    { id: "pain", text: "manual invoice reminders" }, { id: "criterion", text: "audit trails" },
    { id: "vocabulary", text: "overdue invoices" }, { id: "price", text: "$19 per month" },
    { id: "alternative", text: "spreadsheets" },
  ],
  questions: [
    { id: "q-problem", text: "How can finance managers reduce manual invoice reminders?", layer: "problem" as const, roleId: "finance", entityRefs: ["pain"], evidenceRefs: ["P1", "G1"] },
    { id: "q-evaluation", text: "How can finance managers evaluate audit trails?", layer: "evaluation" as const, roleId: "finance", entityRefs: ["criterion"], evidenceRefs: ["P1", "G1"] },
    { id: "q-discovery", text: "Which invoice reminder software helps finance teams?", layer: "discovery" as const, roleId: null, entityRefs: ["category"], evidenceRefs: ["P1"] },
    { id: "q-branded", text: "What is Acme?", layer: "branded" as const, roleId: null, entityRefs: ["brand"], evidenceRefs: ["P1"] },
    { id: "q-comparison", text: "How does invoice reminder software compare with spreadsheets?", layer: "comparison" as const, roleId: "finance", entityRefs: ["alternative", "category"], evidenceRefs: ["P1", "G1"] },
  ],
};
