import { describe, expect, it } from "vitest";
import { citabilityCheck } from "./citability-contract.ts";
import { groupCitabilityCauses } from "./citability-causes.ts";

const failed = (id: string, section: "readable" | "extractable" = "readable") => citabilityCheck(id, section, "deterministic", "counted", "fail", { key: "evidence" }, { key: "fix" });
describe("deterministic root-cause groups", () => {
  it("groups crawler rules sharing the same robots source without losing evidence or fixes", () => {
    const checks = [failed("robots.oai-searchbot"), failed("robots.chatgpt-user"), failed("canonical")];
    const groups = groupCitabilityCauses(checks);
    expect(groups.map((group) => group.id)).toEqual(["crawlerAccess", "canonical"]);
    expect(groups[0]?.checkIds).toEqual(["robots.oai-searchbot", "robots.chatgpt-user"]);
    expect(checks.every((check) => check.measured.key === "evidence" && check.fix?.key === "fix")).toBe(true);
  });
  it("links dependent raw-document failures as possible rather than proven rendering causes", () => {
    const checks = [failed("ssr"), failed("leadAnswer", "extractable"), failed("extractableStructure", "extractable"), failed("citedData", "extractable")];
    const rendering = groupCitabilityCauses(checks).find((group) => group.id === "rendering");
    expect(rendering?.checkIds).toEqual(["ssr"]);
    expect(rendering?.relatedCheckIds).toEqual(["leadAnswer", "extractableStructure"]);
    expect(rendering?.basis).toBe("possibleDependency");
    expect(groupCitabilityCauses(checks).flatMap((group) => group.checkIds)).toEqual(expect.arrayContaining(checks.map((check) => check.ruleId)));
  });
  it("does not turn unavailable, advisory or not-applicable rows into failed root causes", () => {
    const checks = [citabilityCheck("ssr", "readable", "deterministic", "counted", "fetchError", { key: "unknown" }), citabilityCheck("faqSchema", "extractable", "deterministic", "counted", "notApplicable", { key: "absent" })];
    expect(groupCitabilityCauses(checks)).toEqual([]);
  });
});
