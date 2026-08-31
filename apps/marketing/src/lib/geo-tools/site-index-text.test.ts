import { describe, expect, it } from "vitest";
import { matchSiteQuestion } from "./site-index-text.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
describe("frozen question relevance", () => {
  it("does not match API inside capital while preserving dense-script phrases", () => {
    const report = visibilityReportFixtureV2();
    const q = { ...report.questions[0]!.definition, text: "How do teams manage API authentication?", requiredEntities: ["API"] };
    expect(matchSiteQuestion(q, report.context, "Capital gains guide", "Learn about capital gains and personal investing.")).toBeNull();
    const chinese = { ...q, text: "如何管理发票提醒？", requiredEntities: ["发票提醒"] };
    expect(matchSiteQuestion(chinese, report.context, "自动化指南", "系统自动发送发票提醒，避免遗漏付款。")).toMatchObject({ entities: ["发票提醒"] });
  });
});
