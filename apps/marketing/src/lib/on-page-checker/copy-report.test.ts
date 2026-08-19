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
  staticBodyUnits: { units: 800, basis: "words" },
  termFrequencies: null,
  truncatedLists: false,
  headingLevels: null,
  wordsUnderEachH3: null,
  response: {
    status: 200,
    finalStatus: 200,
    redirectHops: 0,
    responseMs: 42,
    contentType: "text/html; charset=utf-8",
    canonicalTarget: null,
    robotsIndexable: true,
    robotsDirectives: [],
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
    internalOutlinks: 0,
    internalOutlinksWithoutAnchorText: 0,
  },
  declared: null,
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
    // Read the cell, not the page. `toContain("n/a")` is already satisfied by
    // the boilerplate sentence that explains what n/a means, so it stays green
    // while the value cell prints `0` — which is the one thing this test exists
    // to catch.
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

    const lines = text.split("\n");
    const header = lines.find((line) => line.startsWith("| Query |"));
    const row = lines.find((line) => line.startsWith("| `pricing`"));
    expect(header).toBeDefined();
    expect(row).toBeDefined();

    // Cells split on unescaped pipes only, and the column is located by its
    // heading rather than by a hardcoded position, so a reordered table cannot
    // make this read a different slot than the one it names.
    const cells = (line: string) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim());
    const columns = cells(header ?? "");
    const values = cells(row ?? "");
    expect(values).toHaveLength(columns.length);

    const cellFor = (heading: string) => {
      const index = columns.indexOf(heading);
      expect(index, `no ${heading} column`).toBeGreaterThanOrEqual(0);
      return values[index];
    };

    // The page has no meta description at all: the cell says so, and says it
    // without printing a number. Neither `0`, nor `no (0)`, nor an empty cell.
    expect(cellFor("Description")).toBe("n/a");
    // The contrast that gives that cell its meaning: a field the page does have
    // where the keyword genuinely does not appear prints a counted zero. The two
    // must not render the same, in either direction.
    expect(cellFor("Sub-headings")).toBe("no (0)");
    expect(cellFor("Description")).not.toBe(cellFor("Sub-headings"));
    // And the slots that were counted still carry their counts, so this is not
    // a row of n/a that happens to contain the cell being asserted.
    expect(cellFor("Title")).toBe("yes (1)");
    expect(cellFor("H1")).toBe("yes (1)");
    expect(cellFor("Opening text")).toBe("yes (1)");

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
    expect(text).toContain("was not collected as a readable HTML response");
    expect(text).not.toContain("## Coverage");
  });

  /**
   * The two unavailable reasons are two different facts, and the report used to
   * state the first for both. "Not collected" about a page that was collected
   * points the reader at the wrong thing to fix.
   */
  it("distinguishes a page that was collected from one that was not", () => {
    const normalized = normalizeTargetQueries(["pricing"]);
    if (!normalized.ok) throw new Error(normalized.reason);
    const text = buildCopyReport({
      targetUrl: extract.url,
      scannedAt: "2026-08-17T12:00:00.000Z",
      cacheStatus: "miss",
      evidence: buildKeywordEvidence(null, normalized.queries, null, true),
      limitationText,
    });

    expect(text).toContain("extract_missing");
    expect(text).toContain("was collected, but its text was not carried");
    expect(text).not.toContain("was not collected as a readable HTML response");
  });

  /**
   * The step below shortening: even the shortest sentences do not fit.
   *
   * Unreachable for the six frozen limitation codes — it takes an input the
   * exported type permits and this tool never produces — which is exactly why it
   * needs a test. The rule at this depth is that a dropped caveat is counted
   * rather than silently sliced off the end.
   */
  /**
   * The two steps below shortening, both reached with type-valid input.
   *
   * Neither is reachable for the six frozen codes at their real lengths, which
   * is exactly why they need tests: the rule at this depth is that a caveat that
   * goes missing is counted, never quietly absent. The earlier version of this
   * test reached the edge with an `unknown` cast past the limitation union and
   * accepted an uncounted fallback, so an implementation that discarded every
   * limitation would have passed it.
   */
  it.each([
    [
      "a limitation list long enough to crowd itself out",
      "https://example.com/pricing",
      1_000,
    ],
    [
      "a page URL longer than the whole report",
      `https://example.com/${"deep/".repeat(4_000)}`,
      6,
    ],
  ])("counts what it dropped: %s", (_name, targetUrl, count) => {
    const normalized = normalizeTargetQueries(["pricing"]);
    if (!normalized.ok) throw new Error(normalized.reason);
    const evidence = buildKeywordEvidence(extract, normalized.queries, "product");
    if (evidence.availability !== "available") throw new Error("unavailable");
    // A valid code, repeated: the union bounds the vocabulary, not the length.
    const code = "density_basis_captured_text_only" as const;

    const text = buildCopyReport({
      targetUrl,
      scannedAt: "2026-08-17T12:00:00.000Z",
      cacheStatus: "miss",
      evidence: {
        ...evidence,
        limitations: Array.from({ length: count }, () => code),
      },
      limitationText: {
        [code]: "Density is measured inside the collected text only.",
      },
    });

    expect(text.length).toBeLessThanOrEqual(COPY_REPORT_MAX_CHARS);
    // A number, always. "It did not fit" without one hides what went missing.
    expect(text).toMatch(/\d+ (?:more )?limitations? (?:are )?omitted/);
    // And the report never ends mid-sentence pretending to be complete.
    expect(text.trimEnd().endsWith("_")).toBe(true);
    /**
     * And it keeps what it can. A count is necessary, not sufficient: an
     * implementation that discarded every limitation and returned the last-ditch
     * notice would satisfy the count assertion above while publishing none of
     * the caveats it had room for.
     *
     * Counting bullets does not express that — the header contributes three of
     * its own ("- Page:", "- Collected at:", "- Crawl cache:"), so a report with
     * no limitation in it still has bullets. The assertion has to name a
     * limitation, inside the limitations section.
     */
    if (targetUrl.length < 200) {
      expect(text).toContain("## Limitations");
      const section = text.slice(text.indexOf("## Limitations"));
      // The rendered form of a real limitation, shortened or whole. Derived
      // from the same sentence the fixture supplies so it cannot drift.
      expect(section).toContain(
        `- ${"Density is measured inside the collected text only.".slice(0, 16)}`,
      );
    }
  });

  it("does not mark a limitation as cut when nothing was removed from it", () => {
    const normalized = normalizeTargetQueries(["pricing"]);
    if (!normalized.ok) throw new Error(normalized.reason);
    const evidence = buildKeywordEvidence(extract, normalized.queries, "product");
    if (evidence.availability !== "available") throw new Error("unavailable");
    const code = "density_basis_captured_text_only" as const;

    const text = buildCopyReport({
      targetUrl: "https://example.com/pricing",
      scannedAt: "2026-08-17T12:00:00.000Z",
      cacheStatus: "miss",
      evidence: {
        ...evidence,
        // Enough repetitions to force the deepest branch even at this length.
        limitations: Array.from({ length: 4_000 }, () => code),
      },
      // Short enough that shortening it removes nothing.
      limitationText: { [code]: "Captured text." },
    });

    // The deepest branch really is the one under test.
    expect(text).toMatch(/\d+ more limitations omitted to fit/);
    expect(text).toContain("- Captured text.");
    expect(text).not.toContain("Captured text.…[cut]");
  });

  it("keeps a pipe in a query from splitting the table row it sits in", () => {
    // A code span does not protect a cell: GFM splits on the pipe first, so
    // `plan | tier` becomes two cells and every later column shifts.
    const text = buildCopyReport({
      targetUrl: extract.url,
      scannedAt: "2026-08-17T12:00:00.000Z",
      cacheStatus: "miss",
      evidence: evidenceFor(["plan | tier"]),
      limitationText,
    });

    const header = text
      .split("\n")
      .find((line) => line.startsWith("| Query |"));
    const row = text
      .split("\n")
      .find((line) => line.startsWith("|") && line.includes("plan"));
    const cells = (line: string) =>
      line.split(/(?<!\\)\|/).length;
    expect(header).toBeDefined();
    expect(row).toBeDefined();
    expect(cells(row ?? "")).toBe(cells(header ?? ""));
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

  it("holds the budget even when the fixed sections alone exceed it", () => {
    // Translation grows these sentences. The bound is a promise to whoever
    // pastes this somewhere with a limit, so it holds with no table at all.
    const text = buildCopyReport({
      targetUrl: extract.url,
      scannedAt: "2026-08-17T12:00:00.000Z",
      cacheStatus: "miss",
      evidence: evidenceFor(["pricing"]),
      limitationText: {
        ...limitationText,
        density_basis_captured_text_only: "x".repeat(COPY_REPORT_MAX_CHARS * 2),
      },
    });

    expect(text.length).toBeLessThanOrEqual(COPY_REPORT_MAX_CHARS);
    // Even here, what survives is the metadata and the limitation that caused
    // the overflow — not the explanatory prose, and not a silent stop.
    expect(text).toContain("# On-page keyword check");
    expect(text).toContain("## Limitations");
    expect(text).toContain("x".repeat(200));
    expect(text).not.toContain("## Coverage");
    // Every limitation is still here; the long one is shortened and says so.
    expect(text).toContain("[cut]");
    expect(text).toContain("Cut to fit");
    const effective = {
      ...limitationText,
      density_basis_captured_text_only: "x".repeat(COPY_REPORT_MAX_CHARS * 2),
    };
    for (const sentence of Object.values(effective)) {
      expect(text).toContain(sentence.slice(0, 16));
    }
  });

  /**
   * Across the whole range where translated sentences crowd out the table, the
   * report never exceeds the budget and never cuts anything silently. Asserting
   * one magic filler size would only prove the branch that size happens to hit;
   * five rows of at most eighty characters cannot blow a 16K budget on their
   * own, so the interesting cases all live in this range.
   */
  it.each([0, 8_000, 14_000, 15_000, 15_400, 16_000, 40_000])(
    "stays within the budget and says when it cut something (filler %i)",
    (filler) => {
      const long = "x".repeat(78);
      const text = buildCopyReport({
        targetUrl: extract.url,
        scannedAt: "2026-08-17T12:00:00.000Z",
        cacheStatus: "miss",
        evidence: evidenceFor([`${long}a`, `${long}b`, `${long}c`]),
        limitationText: {
          ...limitationText,
          density_basis_captured_text_only: "y".repeat(filler),
        },
      });

      expect(text.length).toBeLessThanOrEqual(COPY_REPORT_MAX_CHARS);

      const rowsShown = text
        .split("\n")
        .filter((line) => line.startsWith("| `")).length;
      // Rows may only go missing with the notice that says so. A report that
      // happens to land exactly on the budget without dropping anything is
      // not a truncation and owes no notice.
      if (rowsShown < 3) {
        expect(text).toMatch(
          /more rows omitted to fit|Coverage table omitted to fit|Detail omitted to fit|Cut to fit|limitations omitted to fit/,
        );
      }

      /**
       * The limitations are the last thing that may be cut.
       *
       * They are what keeps every number above them honest, so the budget is
       * spent on the explanatory middle and the coverage table first. Whenever
       * the limitations themselves fit inside the budget, all of them are
       * present — including the long one that forced the cut.
       */
      const allLimitations = [
        ...Object.values({
          ...limitationText,
          density_basis_captured_text_only: "y".repeat(filler),
        }),
      ];
      const limitationsSize = allLimitations.join("\n").length;
      if (limitationsSize < COPY_REPORT_MAX_CHARS - 512) {
        for (const sentence of allLimitations) {
          if (sentence === "") continue;
          expect(
            text.includes(sentence),
            `filler ${filler}: a limitation was cut`,
          ).toBe(true);
        }
      } else {
        /**
         * Past that point the limitations may not all fit whole, and the rule
         * becomes "all present, and any shortening is marked". A whole caveat
         * going missing is the loss a reader cannot see; a shortened sentence
         * announces itself.
         */
        for (const sentence of allLimitations) {
          if (sentence === "") continue;
          expect(
            text.includes(sentence.slice(0, 16)),
            `filler ${filler}: a limitation vanished entirely`,
          ).toBe(true);
          if (!text.includes(sentence)) {
            expect(
              text,
              `filler ${filler}: a limitation was shortened without saying so`,
            ).toContain("[cut]");
          }
        }
      }
    },
  );

  it("reports the declared page role when there is one", () => {
    expect(report()).toContain("`product`");
  });
});
