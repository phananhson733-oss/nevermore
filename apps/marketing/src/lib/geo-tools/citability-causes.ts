import type { CitabilityCheck, CitabilityRootCause } from "./citability-contract.ts";

/** Group shared inputs, not causal certainty. Related raw-HTML failures remain
 * independent rows and are labelled possible dependencies rather than erased. */
export function groupCitabilityCauses(checks: readonly CitabilityCheck[]): readonly CitabilityRootCause[] {
  const failures = checks.filter((check) => check.state === "fail");
  const definitions: readonly { id: CitabilityRootCause["id"]; ids: readonly string[] }[] = [
    { id: "crawlerAccess", ids: failures.filter((check) => check.ruleId.startsWith("robots.") && check.weight === "counted").map((check) => check.ruleId) },
    { id: "rendering", ids: ["ssr"] },
    { id: "canonical", ids: ["canonical"] },
    { id: "answerStructure", ids: ["leadAnswer", "extractableStructure"] },
    { id: "claimEvidence", ids: ["qualifiers", "citedData"] },
    { id: "faq", ids: ["faqSchema"] },
    { id: "advisory", ids: failures.filter((check) => check.weight === "advisory").map((check) => check.ruleId) },
  ];
  return definitions.flatMap(({ id, ids }) => {
    const checkIds = failures.filter((check) => ids.includes(check.ruleId)).map((check) => check.ruleId);
    if (checkIds.length === 0) return [];
    const relatedCheckIds = id === "rendering" ? failures.filter((check) => ["leadAnswer", "extractableStructure"].includes(check.ruleId)).map((check) => check.ruleId) : [];
    const basis = relatedCheckIds.length > 0 ? "possibleDependency" : id === "crawlerAccess" && checkIds.length > 1 ? "sharedEvidence" : "independent";
    return [{ id, basis, checkIds, relatedCheckIds }];
  });
}
