import { describe, expect, it } from "vitest";

import { CSV_TAIL_FLOOR, evidenceCsv, evidenceCsvFilename } from "./csv.ts";
import type { QuickWinEvidenceRow, QuickWinsResult } from "./types.ts";

const WINDOW = { startDate: "2026-07-06", endDate: "2026-08-02" };

function row(
  overrides: Partial<QuickWinEvidenceRow> = {},
): QuickWinEvidenceRow {
  return {
    query: "messi zodiac sign",
    position: 8.4,
    bucketId: "8-11",
    impressions: 3439,
    clicks: 3,
    observedCtr: 3 / 3439,
    baselineCtr: 0.0051,
    expectedClicks: 17.5389,
    clickGap: 14.5389,
    tailProbability: 0.0004,
    baselineBandUnderOnePercent: true,
    track: "band_is_the_story",
    ...overrides,
  };
}

function result(rows: readonly QuickWinEvidenceRow[]): QuickWinsResult {
  return {
    window: WINDOW,
    rows,
    actions: [],
    curve: {
      buckets: [],
      rowsUsed: 0,
      brandRowsExcluded: 0,
      rowsBeyondBands: 0,
    },
    lowCtrBands: [],
    excluded: {
      below_impression_floor: 0,
      position_outside_bands: 0,
      bucket_not_usable: 0,
      no_leave_one_out_baseline: 0,
    },
    anonymization: null,
    limitations: [],
    drafts: [],
    draftsSkipped: {},
  };
}

/** The header line, with the byte-order mark stripped. */
function lines(csv: string): string[] {
  return csv.replace(/^\uFEFF/, "").split("\r\n");
}

describe("evidenceCsv", () => {
  it("leads with a byte-order mark so a non-ASCII query survives Excel", () => {
    // Without it Excel decodes UTF-8 as the local codepage and a Chinese or
    // accented query opens as mojibake. The file is for spreadsheets, so it
    // has to work in the spreadsheet people actually have.
    const csv = evidenceCsv(result([row({ query: "白羊座 性格" })]));

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("白羊座 性格");
  });

  it("carries the measured window on every row", () => {
    // A file whose period is only in its filename stops being true the first
    // time someone renames it. The window is the one fact the numbers are
    // meaningless without.
    const [header, first] = lines(evidenceCsv(result([row()])));

    expect(header?.startsWith("windowStart,windowEnd,query")).toBe(true);
    expect(first?.startsWith("2026-07-06,2026-08-02,")).toBe(true);
  });

  it("exports the checking path as its stable code, not a localized label", () => {
    // Someone filtering the export down to their morning's worklist filters on
    // `track == "read_the_serp"`. A column carrying the reader's language
    // breaks that the first time a colleague opens the page in the other one.
    const csv = evidenceCsv(result([row({ track: "read_the_serp" })]));
    const [header, first] = lines(csv);
    const index = (header?.split(",") ?? []).indexOf("track");

    expect(index).toBeGreaterThan(-1);
    expect((first?.split(",") ?? [])[index]).toBe("read_the_serp");
  });

  it("writes an unavailable rate as an empty cell, never as zero", () => {
    // The whole engine holds this line: a rate we could not compute is not a
    // rate of zero. A spreadsheet that shows 0% would be a different claim.
    const csv = evidenceCsv(
      result([
        row({
          impressions: 0,
          clicks: 0,
          observedCtr: null,
          tailProbability: null,
        }),
      ]),
    );
    const [header, first] = lines(csv);
    const columns = header?.split(",") ?? [];
    const cells = first?.split(",") ?? [];

    expect(cells[columns.indexOf("observedCtr")]).toBe("");
    expect(cells[columns.indexOf("tailProbability")]).toBe("");
  });

  it("writes an underflowed tail probability as a floor, matching the screen", () => {
    // Double precision runs out of exponent long before a probability becomes
    // impossible. Writing the literal 0 would tell a reader this cannot
    // happen; the table on screen says `< 0.0001` and the file must not
    // contradict it.
    const csv = evidenceCsv(result([row({ tailProbability: 0 })]));
    const [header, first] = lines(csv);
    const index = (header?.split(",") ?? []).indexOf("tailProbability");

    expect((first?.split(",") ?? [])[index]).toBe(`<${CSV_TAIL_FLOOR}`);
  });

  it("neutralises a query that a spreadsheet would run as a formula", () => {
    // Search Console returns whatever people typed. `=cmd|...` in a cell is a
    // known Excel/Sheets execution path, and these files get opened by the
    // person who downloaded them without a second thought.
    const csv = evidenceCsv(result([row({ query: "=1+1" })]));

    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/,=1\+1/);
  });

  it("quotes a query containing a comma, a quote, or a newline", () => {
    const csv = evidenceCsv(
      result([row({ query: 'best "cheap" flights, 2026\nnow' })]),
    );

    expect(csv).toContain('"best ""cheap"" flights, 2026\nnow"');
  });

  it("keeps a negative gap numeric rather than escaping it as text", () => {
    // The leading-character guard exists for text cells. Applying it to a
    // number we generated ourselves would make every above-baseline row
    // unsortable in the spreadsheet.
    const csv = evidenceCsv(result([row({ clickGap: -4.2 })]));

    expect(csv).toContain(",-4.2,");
    expect(csv).not.toContain("'-4.2");
  });

  it("emits a header and nothing else when there are no rows", () => {
    const parts = lines(evidenceCsv(result([])));

    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("query");
  });

  it("preserves the order the engine sorted the rows into", () => {
    const csv = evidenceCsv(
      result([row({ query: "first" }), row({ query: "second" })]),
    );
    const [, a, b] = lines(csv);

    expect(a).toContain("first");
    expect(b).toContain("second");
  });
});

describe("evidenceCsvFilename", () => {
  it("names the window it covers", () => {
    expect(evidenceCsvFilename(WINDOW)).toBe(
      "seo-quick-wins-2026-07-06-to-2026-08-02.csv",
    );
  });

  it("refuses to put anything but a date into the name", () => {
    // The window comes from the API response. A path separator or a quote in
    // it has no business reaching a download attribute.
    expect(
      evidenceCsvFilename({ startDate: "../../etc", endDate: "2026-08-02" }),
    ).toBe("seo-quick-wins.csv");
  });
});
