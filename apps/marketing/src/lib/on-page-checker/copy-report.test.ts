import { describe, expect, it } from "vitest";

import {
  buildKeywordEvidence,
  normalizeTargetQueries,
  type SeoAuditTargetPageExtract,
} from "@sf/public-tools";

import {
  buildCopyReport,
  COPY_REPORT_MAX_CHARS,
  inlineCode,
} from "./copy-report.ts";

const extract: SeoAuditTargetPageExtract = {
  url: "https://example.com/pricing",
  title: "Pricing and plans",
  metaDescription: "Compare pricing and plans.",
  h1: ["Pricing"],
  subHeadings: ["What each plan includes"],
  openingText: "Every plan includes the full pricing calculator.",
  staticBodyWords: 800,
  truncatedLists: false,
};

const limitationText = {
  sub_headings_h2_h6_merged_no_levels: "Sub-headings are H2-H6 merged.",
  opening_text_first_500_chars_static_extraction:
    "Opening text is the first 500 characters.",
  density_basis_captured_text_only: "Density uses the collected text only.",
};

function evidenceFor(raw: readonly string[], role: "product" | null = "product") {
  const normalized = normalizeTargetQueries(raw);
  if (!normalized.ok) throw new Error(normalized.reason);
  return buildKeywordEvidence(extract, normalized.queries, role);
}

function report(raw: readonly string[] = ["pricing"]) {
  return buildCopyReport({
    targetUrl: extract.url,
    scannedAt: "2026-08-17T12:00:00.000Z",
    cacheStatus: "miss",
    evidence: evidenceFor(raw),
    limitationText,
  });
}

describe("inlineCode", () => {
  it("wraps a plain value", () => {
    expect(inlineCode("pricing")).toBe("`pricing`");
  });

  it("outgrows a backtick inside the value", () => {
    // A single-backtick span would end early and let the rest become markup.
    expect(inlineCode("a`b")).toBe("``a`b``");
    expect(inlineCode("a``b")).toBe("```a``b```");
  });

  it("pads a value that starts or ends with a backtick", () => {
    expect(inlineCode("`x`")).toBe("`` `x` ``");
  });

  it("flattens newlines so a span cannot be broken", () => {
    expect(inlineCode("a\nb")).toBe("`a b`");
  });

  it("keeps table syntax from a value out of the table", () => {
    expect(inlineCode("a | b")).toBe("`a | b`");
  });

  it("has a form for an empty value", () => {
    expect(inlineCode("   ")).toBe("``");
  });
});

describe("buildCopyReport", () => {
  it("puts the sections in the order the reader needs them", () => {
    const text = report();
    const order = [
      "# On-page keyword check",
      "## What was measured",
      "## Coverage",
      "## Focus",
      "## Density",
      "## Limitations",
    ].map((heading) => text.indexOf(heading));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("states the basis before any number", () => {
    const text = report();
    expect(text.indexOf("It is not a whole-page")).toBeLessThan(
      text.indexOf("## Density"),
    );
  });

  it("prints every limitation in full", () => {
    const text = report();
    for (const sentence of Object.values(limitationText)) {
      expect(text).toContain(sentence);
    }
  });

  it("marks an absent field n/a instead of a zero", () => {
    const text = buildCopyReport({
      targetUrl: extract.url,
      scannedAt: "2026-08-17T12:00:00.000Z",
      cacheStatus: "miss",
      evidence: (() => {
        const normalized = normalizeTargetQueries(["pricing"]);
        if (!normalized.ok) throw new Error(normalized.reason);
        return buildKeywordEvidence(
          { ...extract, metaDescription: null },
          normalized.queries,
          null,
        );
      })(),
      limitationText,
    });

    expect(text).toContain("n/a");
    expect(text).toContain("That is not a zero.");
  });

  it("says plainly that an unavailable region is not a zero", () => {
    const normalized = normalizeTargetQueries(["pricing"]);
    if (!normalized.ok) throw new Error(normalized.reason);
    const text = buildCopyReport({
      targetUrl: extract.url,
      scannedAt: "2026-08-17T12:00:00.000Z",
      cacheStatus: "unknown",
      evidence: buildKeywordEvidence(null, normalized.queries, null),
      limitationText,
    });

    expect(text).toContain("target_page_not_captured");
    expect(text).toContain("This is not a score of zero.");
    expect(text).not.toContain("## Coverage");
  });

  it("quotes page-sourced text so it cannot reformat the report", () => {
    const text = buildCopyReport({
      targetUrl: "https://example.com/a|b",
      scannedAt: "2026-08-17T12:00:00.000Z",
      cacheStatus: "miss",
      evidence: evidenceFor(["plan | tier"]),
      limitationText,
    });

    expect(text).toContain("`https://example.com/a|b`");
    expect(text).toContain("`plan | tier`");
  });

  it("stays inside the size budget and says what it dropped", () => {
    const long = "x".repeat(78);
    const text = buildCopyReport({
      targetUrl: extract.url,
      scannedAt: "2026-08-17T12:00:00.000Z",
      cacheStatus: "miss",
      evidence: evidenceFor([
        `${long}a`,
        `${long}b`,
        `${long}c`,
        `${long}d`,
        `${long}e`,
      ]),
      limitationText,
    });

    expect(text.length).toBeLessThanOrEqual(COPY_REPORT_MAX_CHARS);
    // Whatever else goes, the basis and the limitations stay.
    expect(text).toContain("## What was measured");
    expect(text).toContain("## Limitations");
  });

  it("reports the declared page role when there is one", () => {
    expect(report()).toContain("`product`");
  });
});
