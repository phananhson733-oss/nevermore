import { describe, expect, it } from "vitest";
import { thirdPartyGapMarkdown } from "./gap-markdown.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
describe("C-gap third-party task export", () => {
  it("exports actual source selectors as third-party work, never a content draft", () => {
    const report = { ...visibilityReportFixtureV2(), gaps: [{ id: "gap-q1", questionId: "q1", kind: "C" as const, reason: "missing_from_read_reference_pages" as const, evidenceIds: ["ref-1"], pageUrl: null, sourceUrls: ["https://publisher.test/list"], action: "third_party" as const }] };
    const markdown = thirdPartyGapMarkdown(report, "gap-q1", "en");
    expect(markdown).toContain("Third-party placement tasks");
    expect(markdown).toContain("https://publisher.test/list");
    expect(markdown).toContain(report.manifest.questionSetHash);
    expect(markdown).toContain("not a content draft");
    expect(thirdPartyGapMarkdown({ ...report, gaps: [{ ...report.gaps[0]!, kind: "A", action: "brief" }] }, "gap-q1", "en")).toBeNull();
  });
});
