import { describe, expect, it } from "vitest";
import { visibilityReportMarkdown } from "./visibility-markdown.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
describe("complete Visibility task Markdown", () => {
  it("contains every supported A/B/C/D task, exact origin and evidence rather than observations alone", () => {
    const base = visibilityReportFixtureV2();
    const report = { ...base, questions: ["a", "b", "c", "d"].map((id) => ({ ...base.questions[0]!, questionId: id, text: `Question ${id}` })), gaps: [
      { id: "gap-a", questionId: "a", kind: "A" as const, reason: "no_matching_page_in_audited_inventory" as const, action: "brief" as const, evidenceIds: ["site-index"], pageUrl: null, sourceUrls: [] },
      { id: "gap-b", questionId: "b", kind: "B" as const, reason: "relevant_page_citability_failed" as const, action: "citability" as const, evidenceIds: ["t2-1"], pageUrl: "https://acme.test/guide", sourceUrls: [] },
      { id: "gap-c", questionId: "c", kind: "C" as const, reason: "missing_from_read_reference_pages" as const, action: "third_party" as const, evidenceIds: ["page-1"], pageUrl: null, sourceUrls: ["https://publisher.test/list"] },
      { id: "gap-d", questionId: "d", kind: "D" as const, reason: "repeated_competitor_list_position" as const, action: "brief" as const, evidenceIds: ["chatgpt:d:1", "chatgpt:d:2"], pageUrl: "https://acme.test/compare", sourceUrls: [] },
    ] };
    const value = visibilityReportMarkdown(report, "en");
    for (const id of ["gap-a", "gap-b", "gap-c", "gap-d", "t2-1", base.manifest.questionSetHash]) expect(value).toContain(id);
    expect(value).toContain("https://publisher.test/list");
    expect(value).toContain("https://acme.test/guide");
    expect(value).toContain("not a content draft");
    expect(value).toContain("- [ ]");
  });
});
