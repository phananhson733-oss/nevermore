import { describe, expect, it } from "vitest";

import {
  COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS,
  competitorKeywordGapCsv,
  competitorKeywordGapCsvFilename,
  competitorKeywordGapCsvRowCount,
} from "./csv.ts";
import type {
  CompetitorKeywordGapResultV3,
  CompetitorKeywordGapRow,
} from "./types.ts";

/**
 * The contract's column list, spelled out rather than imported.
 *
 * Importing `COLUMNS` would make the header test compare the module with
 * itself and pass through any rename. This literal is the thing other people's
 * sheets and older exports are keyed on, so it is written down here where a
 * change to it has to be a deliberate edit.
 */
const HEADER = [
  "keyword",
  "marketCode",
  "languageCode",
  "dfsSearchVolume",
  "dfsKeywordDifficulty",
  "dfsCpc",
  "dfsIntent",
  "dfsCompetitorRanks",
  "dfsLinkedCompetitorPageUrl",
].join(",");

function row(
  overrides: Partial<CompetitorKeywordGapRow> = {},
): CompetitorKeywordGapRow {
  return {
    keyword: "birth chart calculator",
    competitorRanks: { "one.example": 4, "two.example": 9 },
    competitorPages: {
      "one.example": {
        url: "https://one.example/chart",
        title: "Free chart",
        etv: 120.5,
      },
      "two.example": { url: null, title: "Runner up", etv: 7 },
    },
    competitorCount: 2,
    bestCompetitorRank: 4,
    ownState: "not_observed_in_provider_rankings",
    searchVolume: { availability: "available", value: 1000 },
    cpc: { availability: "available", value: 1.25 },
    keywordDifficulty: { availability: "available", value: 18 },
    providerIntent: "informational",
    coreKeyword: "birth chart",
    searchVolumeTrend: { monthly: -12, quarterly: 3, yearly: 40 },
    serpSnapshot: {
      itemTypes: ["organic", "people_also_ask"],
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    preScreen: {
      band: "prioritize_serp_check",
      basis: "dfs_estimate",
      reason: "kd_low_rank_top10",
    },
    gsc: {
      queryStatus: "observed_weak",
      evidenceBasis: "query_page",
      queryImpressions: 340,
      queryPosition: 18.4,
      pageStatus: "observed_partial",
      pageUrl: "https://acme.com/tools/chart",
      pageImpressions: 210,
      pagePosition: 19.1,
      queryPageCoverage: 0.6176470588235294,
      nextStep: "review_existing_query",
    },
    ...overrides,
  };
}

function result(
  rows: readonly CompetitorKeywordGapRow[],
  overrides: Partial<CompetitorKeywordGapResultV3> = {},
): CompetitorKeywordGapResultV3 {
  return {
    capturedAt: "2026-08-24T12:00:00.000Z",
    siteDomain: "acme.com",
    competitorDomains: ["one.example", "two.example"],
    marketCode: "US",
    languageCode: "en",
    sampleRule: {
      maxCompetitorRank: 20,
      perCompetitorLimit: 300,
      serpSnapshotRequested: true,
    },
    requestedCompetitors: 2,
    completedCompetitors: 2,
    unavailableCompetitors: 0,
    competitors: [],
    rows,
    resultTruncated: false,
    overlayStatus: "available",
    gscQueryTruncated: false,
    gscQueryPageTruncated: false,
    gscQueryRowCount: 42,
    gscQueryPageRowCount: 60,
    ...overrides,
  };
}

/** The lines, with the byte-order mark stripped. */
function lines(csv: string): string[] {
  return csv.replace(/^\uFEFF/, "").split("\r\n");
}

/**
 * One cell by column name.
 *
 * Splits on every comma, so it is only valid for fixtures whose cells carry
 * none. The quoting case has its own test that does not go through here.
 */
function cell(csv: string, column: string, line = 1): string {
  const parts = lines(csv);
  const index = (parts[0] ?? "").split(",").indexOf(column);
  expect(index).toBeGreaterThan(-1);
  return (parts[line] ?? "").split(",")[index] ?? "";
}


describe("competitorKeywordGapCsv", () => {
  it("writes the stable English field ids as the header, in contract order", () => {
    expect(lines(competitorKeywordGapCsv(result([row()])))[0]).toBe(HEADER);
  });

  it("leads with a byte-order mark and separates lines with CRLF", () => {
    // Without the mark Excel decodes UTF-8 as the local codepage and every
    // non-ASCII keyword opens as mojibake; RFC 4180 specifies CRLF and Excel
    // is the less forgiving reader of the two conventions.
    const csv = competitorKeywordGapCsv(result([row(), row({ keyword: "b" })]));

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toHaveLength(3);
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("carries the run's market and language onto every row", () => {
    // The numbers are market-specific and the file outlives the page that
    // named the market, so it travels on each line rather than in a footnote a
    // filtered sheet would drop.
    const csv = competitorKeywordGapCsv(
      result([row(), row({ keyword: "second" })], {
        marketCode: "GB",
        languageCode: "en",
      }),
    );

    expect(cell(csv, "marketCode", 1)).toBe("GB");
    expect(cell(csv, "marketCode", 2)).toBe("GB");
    expect(cell(csv, "languageCode", 2)).toBe("en");
  });

  it("writes the provider's estimates without rounding them", () => {
    // The page rounds for reading; the file is what someone runs their own
    // arithmetic against, and a rounded value is a different number.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          searchVolume: { availability: "available", value: 2900 },
          keywordDifficulty: { availability: "available", value: 18 },
          cpc: { availability: "available", value: 1.257 },
          providerIntent: "commercial",
        }),
      ]),
    );

    expect(cell(csv, "dfsSearchVolume")).toBe("2900");
    expect(cell(csv, "dfsKeywordDifficulty")).toBe("18");
    expect(cell(csv, "dfsCpc")).toBe("1.257");
    expect(cell(csv, "dfsIntent")).toBe("commercial");
  });

  it("empties a metric the provider had no data for, and keeps a reported zero", () => {
    // The distinction survives even without an availability column: an empty
    // cell is "not told", a 0 is "told it is nothing". Writing 0 for the first
    // would invent a fact in a column people sort by.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          keyword: "no data",
          searchVolume: { availability: "provider_no_data", value: null },
          keywordDifficulty: { availability: "provider_no_data", value: null },
          cpc: { availability: "explicit_zero", value: 0 },
          providerIntent: null,
        }),
      ]),
    );

    expect(cell(csv, "dfsSearchVolume")).toBe("");
    expect(cell(csv, "dfsKeywordDifficulty")).toBe("");
    expect(cell(csv, "dfsCpc")).toBe("0");
    expect(cell(csv, "dfsIntent")).toBe("");
  });

  it("lists every competitor with its rank, best first", () => {
    const csv = competitorKeywordGapCsv(
      result([
        row({
          competitorRanks: { "b.example": 3, "a.example": 11, "c.example": 3 },
          competitorPages: {},
        }),
      ]),
    );

    // Rank first, then the domain, so two exports of one run cannot disagree.
    expect(cell(csv, "dfsCompetitorRanks")).toBe(
      "b.example#3|c.example#3|a.example#11",
    );
  });

  it("links the best-ranked competitor page whose URL is safe to open", () => {
    // The best-ranked competitor's URL is not always usable. When it is not,
    // the cell holds the next one's -- and no separate domain column is needed
    // to see that, because the URL carries its own host and the ranks cell
    // beside it says which competitor that host belongs to.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          competitorRanks: { "one.example": 1, "two.example": 9 },
          competitorPages: {
            "one.example": { url: null, title: "Leader", etv: 900 },
            "two.example": {
              url: "https://two.example/guide",
              title: "Runner up",
              etv: 31,
            },
          },
        }),
      ]),
    );

    expect(cell(csv, "dfsCompetitorRanks")).toBe(
      "one.example#1|two.example#9",
    );
    expect(cell(csv, "dfsLinkedCompetitorPageUrl")).toBe(
      "https://two.example/guide",
    );
  });

  it("refuses a competitor URL that is not plain http(s)", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://user:pass@one.example/x",
    ]) {
      const csv = competitorKeywordGapCsv(
        result([
          row({
            competitorRanks: { "one.example": 4 },
            competitorPages: { "one.example": { url, title: null, etv: null } },
          }),
        ]),
      );

      expect(cell(csv, "dfsLinkedCompetitorPageUrl")).toBe("");
    }
  });

  it("neutralises a keyword a spreadsheet would run as a formula", () => {
    // Keywords are whatever a competitor ranks for, straight from the provider,
    // and these files are opened without a second thought.
    const csv = competitorKeywordGapCsv(
      result([row({ keyword: "=cmd|'/c calc'!A0" })]),
    );

    expect(lines(csv)[1]).toContain("'=cmd|'/c calc'!A0");
  });

  // Every lead the guard claims to cover, not just `=`. With one case the
  // guard could be narrowed to `/^[=]/` and the suite would stay green, which
  // is the whole set of leads Excel acts on minus the one we happened to pick.
  it.each([["=SUM(A1)"], ["+1+1"], ["-1+1"], ["@SUM(A1)"], ["\tlead"], ["\rlead"]])(
    "neutralises a keyword starting %j",
    (keyword) => {
      const csv = competitorKeywordGapCsv(result([row({ keyword })]));

      expect(cell(csv, "keyword")).toContain(`'${keyword}`);
    },
  );

  it("neutralises a provider intent a spreadsheet would run as a formula", () => {
    // `providerIntent` is provider text too, and it reaches the sheet through
    // `optionalText`. Testing the guard only through `keyword` would let the
    // guard be dropped from the optional path without a test noticing.
    const csv = competitorKeywordGapCsv(
      result([row({ providerIntent: "=cmd|'/c calc'!A0" })]),
    );

    expect(cell(csv, "dfsIntent")).toContain("'=cmd");
  });

  it("does not neutralise a number we generated ourselves", () => {
    // A leading `-` on a text cell is a formula lead; on a number it is the
    // sign, and quoting it would make the column unsortable.
    const csv = competitorKeywordGapCsv(
      result([row({ cpc: { availability: "available", value: -1.5 } })]),
    );

    expect(cell(csv, "dfsCpc")).toBe("-1.5");
  });

  it("quotes a value carrying a comma, a quote or a newline", () => {
    const csv = competitorKeywordGapCsv(
      result([row({ keyword: 'a, "b"\nc' })]),
    );

    expect(lines(csv).join("\r\n")).toContain('"a, ""b""\nc"');
  });

  it("quotes a value carrying a bare carriage return", () => {
    // A lone CR inside a cell splits the record for any reader that treats CR
    // as a terminator. The comma/quote/newline fixture above carries LF only,
    // so without this one the `\r` could be dropped from the quoting trigger
    // and every test would stay green.
    const csv = competitorKeywordGapCsv(result([row({ keyword: "a\rb" })]));

    expect(csv).toContain('"a\rb"');
  });

  it("takes the highest search volumes across the merged row set", () => {
    // The merged set, not a slice per competitor: the run already merged every
    // competitor's keywords into one list, and the file is the top of THAT.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          keyword: "small",
          searchVolume: { availability: "available", value: 10 },
        }),
        row({
          keyword: "largest",
          searchVolume: { availability: "available", value: 90000 },
        }),
        row({
          keyword: "middle",
          searchVolume: { availability: "available", value: 500 },
        }),
      ]),
    );

    expect(lines(csv).slice(1).length).toBe(3);
    expect(cell(csv, "keyword", 1)).toBe("largest");
    expect(cell(csv, "keyword", 2)).toBe("middle");
    expect(cell(csv, "keyword", 3)).toBe("small");
  });

  it("sorts a row with no reported volume last, not among the small numbers", () => {
    // "Not told" is not "told it is small". Sorting an unknown among the low
    // volumes would let it displace a keyword that has a real number, in a file
    // whose entire premise is "the biggest ones".
    const csv = competitorKeywordGapCsv(
      result([
        row({
          keyword: "unknown",
          searchVolume: { availability: "provider_no_data", value: null },
        }),
        row({
          keyword: "tiny",
          searchVolume: { availability: "explicit_zero", value: 0 },
        }),
        row({
          keyword: "known",
          searchVolume: { availability: "available", value: 20 },
        }),
      ]),
    );

    expect(cell(csv, "keyword", 1)).toBe("known");
    expect(cell(csv, "keyword", 2)).toBe("tiny");
    expect(cell(csv, "keyword", 3)).toBe("unknown");
  });

  it("breaks a volume tie on code units, not on the reader's collation", () => {
    // `localeCompare` reads the runtime locale, so the same run downloaded in a
    // zh browser and an en browser orders CJK against Latin differently -- and
    // when the cut falls inside a tie group, that decides which rows are IN the
    // file. The pair below is the discriminator: every Latin-script collation
    // this product runs under puts "Ärger" before "zebra", code units put it
    // after, so a revert to `localeCompare` fails here.
    const rows = ["zebra", "Ärger"].map((keyword) =>
      row({
        keyword,
        searchVolume: { availability: "available", value: 400 },
      }),
    );

    const csv = competitorKeywordGapCsv(result(rows));

    expect([1, 2].map((line) => cell(csv, "keyword", line))).toEqual([
      "zebra",
      "Ärger",
    ]);
  });

  it("breaks a volume tie on the keyword, so one run exports identically twice", () => {
    const rows = ["delta", "alpha", "charlie"].map((keyword) =>
      row({
        keyword,
        searchVolume: { availability: "available", value: 400 },
      }),
    );

    const csv = competitorKeywordGapCsv(result(rows));

    expect([1, 2, 3].map((line) => cell(csv, "keyword", line))).toEqual([
      "alpha",
      "charlie",
      "delta",
    ]);
    expect(competitorKeywordGapCsv(result(rows))).toBe(csv);
  });

  it("stops at the row cap and keeps the largest, not the first seen", () => {
    // Ascending input, so a file that merely truncated the run's own order
    // would carry the SMALLEST volumes and still be the right length.
    const rows = Array.from({ length: COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS + 40 }, (_, index) =>
      row({
        keyword: `k${String(index).padStart(4, "0")}`,
        searchVolume: { availability: "available", value: index + 1 },
      }),
    );

    const csv = competitorKeywordGapCsv(result(rows));
    const body = lines(csv).slice(1);

    expect(body).toHaveLength(COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS);
    expect(cell(csv, "keyword", 1)).toBe("k0189");
    expect(cell(csv, "dfsSearchVolume", 1)).toBe("190");
    expect(
      cell(csv, "dfsSearchVolume", COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS),
    ).toBe("41");
  });

  it("caps at one hundred and fifty rows", () => {
    // The literal, written down once. Every other cap test builds its fixture
    // FROM the constant, so all of them would follow a change from 150 to 200
    // and stay green -- proving only that the module agrees with itself. The
    // agreed number is a product decision, so changing it has to fail here.
    expect(COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS).toBe(150);
  });

  it("writes exactly the cap at the cap, and the cap again one row past it", () => {
    // The boundary itself. The over-cap fixture is forty rows past the edge, so
    // a bug that only fires at exactly 150 -- or an off-by-one that only shows
    // at 151 -- lives entirely between the existing cases.
    const at = Array.from({ length: 150 }, (_, index) =>
      row({ keyword: `k${String(index).padStart(4, "0")}` }),
    );

    expect(lines(competitorKeywordGapCsv(result(at))).slice(1)).toHaveLength(
      150,
    );
    expect(competitorKeywordGapCsvRowCount({ rows: at })).toBe(150);
    expect(
      lines(
        competitorKeywordGapCsv(
          result([...at, row({ keyword: "k9999" })]),
        ),
      ).slice(1),
    ).toHaveLength(150);
  });

  it("fills the cap with unmeasured rows when too few have a volume", () => {
    // The two existing cap tests never meet: one has three rows and a missing
    // volume, the other has 190 rows that all have one. Between them sits the
    // case the sentence under the button describes -- an over-cap run where
    // most rows have no estimate at all. The file still holds 150 rows, and
    // most of them carry an empty volume cell, which is why that sentence says
    // "highest first, then the ones with no estimate" rather than claiming all
    // 150 are the highest.
    const measured = Array.from({ length: 20 }, (_, index) =>
      row({
        keyword: `m${String(index).padStart(3, "0")}`,
        searchVolume: { availability: "available", value: 1000 - index },
      }),
    );
    const unmeasured = Array.from({ length: 180 }, (_, index) =>
      row({
        keyword: `u${String(index).padStart(3, "0")}`,
        searchVolume: { availability: "provider_no_data", value: null },
      }),
    );

    const csv = competitorKeywordGapCsv(result([...measured, ...unmeasured]));
    const body = lines(csv).slice(1);
    const empties = body.filter(
      (_, index) => cell(csv, "dfsSearchVolume", index + 1) === "",
    );

    expect(body).toHaveLength(150);
    // Every measured row survived, in order, and the rest is filler.
    expect(cell(csv, "keyword", 1)).toBe("m000");
    expect(cell(csv, "keyword", 20)).toBe("m019");
    expect(cell(csv, "keyword", 21)).toBe("u000");
    expect(empties).toHaveLength(130);
  });

  it("exports every row when the run returned fewer than the cap", () => {
    const csv = competitorKeywordGapCsv(
      result([row({ keyword: "a" }), row({ keyword: "b" })]),
    );

    expect(lines(csv).slice(1)).toHaveLength(2);
  });

  it("writes a header and nothing else for a run with no rows", () => {
    const csv = competitorKeywordGapCsv(result([]));

    expect(lines(csv)).toEqual([HEADER]);
  });
});

describe("competitorKeywordGapCsvRowCount", () => {
  it("reports what the file will contain, so a label cannot overstate it", () => {
    expect(competitorKeywordGapCsvRowCount({ rows: [] })).toBe(0);
    expect(
      competitorKeywordGapCsvRowCount({
        rows: Array.from({ length: 12 }, () => row()),
      }),
    ).toBe(12);
    expect(
      competitorKeywordGapCsvRowCount({
        rows: Array.from(
          { length: COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS + 500 },
          () => row(),
        ),
      }),
    ).toBe(COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS);
  });
});

describe("competitorKeywordGapCsvFilename", () => {
  it("carries the site and the day the run captured its evidence", () => {
    // It matters more than usual now: the columns no longer carry the date, so
    // the filename is the only place the file says how old its numbers are.
    expect(
      competitorKeywordGapCsvFilename({
        capturedAt: "2026-08-24T12:00:00.000Z",
        siteDomain: "acme.com",
      }),
    ).toBe("competitor-keyword-gap-acme.com-2026-08-24.csv");
  });

  it("drops the date rather than writing one that is not a day", () => {
    // The shape check alone passes 2026-13-45; a date that does not exist has
    // no business in a filename, and losing it beats stating it falsely.
    for (const capturedAt of ["2026-13-45T00:00:00.000Z", "not-a-date", ""]) {
      expect(
        competitorKeywordGapCsvFilename({ capturedAt, siteDomain: "acme.com" }),
      ).toBe("competitor-keyword-gap.csv");
    }
  });

  it("refuses a site domain that could steer a download attribute", () => {
    for (const siteDomain of [
      "acme.com/../etc",
      'acme"quote.com',
      "acme com",
      `${"a".repeat(254)}.com`,
    ]) {
      expect(
        competitorKeywordGapCsvFilename({
          capturedAt: "2026-08-24T12:00:00.000Z",
          siteDomain,
        }),
      ).toBe("competitor-keyword-gap.csv");
    }
  });
});
