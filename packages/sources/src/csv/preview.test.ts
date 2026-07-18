import { describe, expect, it } from "vitest";
import { SourceError } from "../adapter.ts";
import {
  KEYWORD_GAP_TEMPLATE_ID,
  MAX_CSV_BYTES,
  PREVIEW_ROW_LIMIT,
  previewCsv,
} from "./preview.ts";

const HEADER = "Keyword,Search Volume,Current URL,Country,Language\n";

describe("previewCsv", () => {
  it("rejects a non-keyword-gap templateId", () => {
    try {
      previewCsv(HEADER, "some_other_template");
      throw new Error("expected previewCsv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceError);
      expect((error as SourceError).code).toBe("INVALID_CONFIGURATION");
    }
  });

  it("rejects an upload larger than the byte cap", () => {
    const oversize = "a".repeat(MAX_CSV_BYTES + 1);
    expect(() => previewCsv(oversize, KEYWORD_GAP_TEMPLATE_ID)).toThrow(SourceError);
  });

  it("detects columns and suggests a mapping from fuzzy headers", () => {
    const result = previewCsv(`${HEADER}seo tools,1200,https://a.com,US,en-US\n`, KEYWORD_GAP_TEMPLATE_ID);
    expect(result.suggestedMapping).toEqual({
      keyword: 0,
      searchVolume: 1,
      cluster: null,
      currentUrl: 2,
      currentRank: null,
      competitorDomain: null,
      competitorRank: null,
      marketCode: 3,
      languageCode: 4,
    });
    expect(result.detectedColumns[1]?.suggestedField).toBe("searchVolume");
  });

  it("reports the total row count and caps previewRows at the limit", () => {
    const body = Array.from({ length: 25 }, (_, index) => `kw${index},100,https://a.com,US,en`).join("\n");
    const result = previewCsv(`${HEADER}${body}\n`, KEYWORD_GAP_TEMPLATE_ID);
    expect(result.rowCount).toBe(25);
    expect(result.previewRows).toHaveLength(PREVIEW_ROW_LIMIT);
  });

  it("warns when required columns cannot be auto-detected and errors on no data", () => {
    const result = previewCsv("colA,colB\n", KEYWORD_GAP_TEMPLATE_ID);
    const warningCodes = result.validationWarnings.map((issue) => issue.code);
    const errorCodes = result.validationErrors.map((issue) => issue.code);
    expect(warningCodes).toContain("keyword_unmapped");
    expect(warningCodes).toContain("search_volume_unmapped");
    expect(errorCodes).toContain("no_data_rows");
  });
});
