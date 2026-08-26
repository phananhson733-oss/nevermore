import { describe, expect, it } from "vitest";

import {
  competitorKeywordGapCsv,
  competitorKeywordGapCsvFilename,
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
  "capturedAt",
  "siteDomain",
  "marketCode",
  "languageCode",
  "requestedCompetitors",
  "completedCompetitors",
  "unavailableCompetitors",
  "resultTruncated",
  "gscOverlayStatus",
  "gscQueryRowCount",
  "gscQueryPageRowCount",
  "keyword",
  "tool",
  "dfsCoreKeyword",
  "dfsSearchVolume",
  "dfsSearchVolumeAvailability",
  "dfsKeywordDifficulty",
  "dfsCpc",
  "dfsIntent",
  "dfsSearchVolumeTrendMonthly",
  "dfsSearchVolumeTrendQuarterly",
  "dfsSearchVolumeTrendYearly",
  "dfsCompetitorCount",
  "dfsBestCompetitorRank",
  "dfsCompetitorRanks",
  "dfsLinkedCompetitorDomain",
  "dfsLinkedCompetitorRank",
  "dfsLinkedCompetitorPageUrl",
  "dfsLinkedCompetitorPageTitle",
  "dfsLinkedCompetitorPageEtv",
  "dfsSerpSnapshotState",
  "dfsSerpItemTypes",
  "dfsSerpSnapshotUpdatedAt",
  "preScreenBand",
  "preScreenBasis",
  "preScreenReason",
  "ownState",
  "gscQueryStatus",
  "gscEvidenceBasis",
  "gscQueryImpressions",
  "gscQueryPosition",
  "gscPageStatus",
  "gscPageUrl",
  "gscPageImpressions",
  "gscPagePosition",
  "gscQueryPageCoverage",
  "nextStep",
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
    // These files get diffed against an older export and pasted into someone
    // else's sheet. A header that follows the reader's language, or that
    // quietly reorders, breaks both without any error to notice.
    expect(lines(competitorKeywordGapCsv(result([row()])))[0]).toBe(HEADER);
  });

  it("writes one line per row, none of them dropped or summarised", () => {
    // This is the full export, not the page's current filter or its first
    // screenful. Someone exports precisely because they want the rows the
    // table is not showing them.
    const csv = competitorKeywordGapCsv(
      result([
        row({ keyword: "alpha" }),
        row({ keyword: "bravo" }),
        row({ keyword: "charlie" }),
      ]),
    );
    const parts = lines(csv);

    expect(parts).toHaveLength(4);
    expect(cell(csv, "keyword", 1)).toBe("alpha");
    expect(cell(csv, "keyword", 2)).toBe("bravo");
    expect(cell(csv, "keyword", 3)).toBe("charlie");
  });

  it("gives every row the same cell count as the header", () => {
    // A cell added to the row builder without a column, or the reverse, shifts
    // every value after it into the wrong column. The file still opens, which
    // is what makes it worth a test.
    const csv = competitorKeywordGapCsv(result([row()]));
    const [header, first] = lines(csv);

    expect((first ?? "").split(",")).toHaveLength(
      (header ?? "").split(",").length,
    );
  });

  it("tags every row with the tool that produced it", () => {
    // Rows from several of these exports get sorted together in one sheet.
    // After that this column is the only way back to the ones this tool wrote.
    const csv = competitorKeywordGapCsv(
      result([row({ keyword: "alpha" }), row({ keyword: "bravo" })]),
    );

    expect(cell(csv, "tool", 1)).toBe("competitor_keyword_gap");
    expect(cell(csv, "tool", 2)).toBe("competitor_keyword_gap");
  });

  it("carries neither of the two names that claimed more than their values", () => {
    // `source` held a constant tool id on every row of every export, which
    // under that header reads as the provenance of the row's numbers. `cpcUsd`
    // named a currency: the value is DataForSEO's `keyword_info.cpc` carried
    // through untouched, and nothing between the provider and this file
    // converts, tags or checks one.
    const header = (
      lines(competitorKeywordGapCsv(result([row()])))[0] ?? ""
    ).split(",");

    expect(header).not.toContain("source");
    expect(header).toContain("tool");
    expect(header).not.toContain("cpcUsd");
    expect(header).toContain("dfsCpc");
  });

  it("carries provenance in each column's own name, not in a legend", () => {
    // In a spreadsheet the header is the only thing a value keeps. Without the
    // prefix a DataForSEO estimate and a Search Console measurement sit in
    // neighbouring columns looking exactly alike.
    const header = (
      lines(competitorKeywordGapCsv(result([row()])))[0] ?? ""
    ).split(",");

    for (const name of [
      "dfsSearchVolume",
      "dfsKeywordDifficulty",
      "dfsCpc",
      "dfsIntent",
      "dfsCoreKeyword",
      "dfsCompetitorCount",
      "dfsBestCompetitorRank",
      "dfsLinkedCompetitorPageEtv",
      "dfsSerpItemTypes",
    ]) {
      expect(header).toContain(name);
    }
  });

  it("repeats the run context on every row", () => {
    // A file whose market and site live only in its filename stops being true
    // the first time someone renames it, and a row pasted into another sheet
    // carries no filename at all.
    const csv = competitorKeywordGapCsv(
      result([row({ keyword: "alpha" }), row({ keyword: "bravo" })]),
    );

    for (const line of [1, 2]) {
      expect(cell(csv, "capturedAt", line)).toBe("2026-08-24T12:00:00.000Z");
      expect(cell(csv, "siteDomain", line)).toBe("acme.com");
      expect(cell(csv, "marketCode", line)).toBe("US");
      expect(cell(csv, "languageCode", line)).toBe("en");
      expect(cell(csv, "ownState", line)).toBe(
        "not_observed_in_provider_rankings",
      );
    }
  });

  it("repeats what the run could not reach on every row", () => {
    // The failure this prevents: a run where one of two competitors was never
    // fetched exports as rows of `dfsCompetitorCount=1` with a single
    // competitor in the ranks cell, and nothing in the file says the second was
    // never asked. Read that way, every absence becomes evidence a competitor
    // does not rank. The coverage card that says otherwise is on screen, and
    // the screen is not what gets pasted into the sheet.
    const csv = competitorKeywordGapCsv(
      result([row({ keyword: "alpha" }), row({ keyword: "bravo" })], {
        requestedCompetitors: 2,
        completedCompetitors: 1,
        unavailableCompetitors: 1,
        resultTruncated: true,
        overlayStatus: "partial",
      }),
    );

    for (const line of [1, 2]) {
      expect(cell(csv, "requestedCompetitors", line)).toBe("2");
      expect(cell(csv, "completedCompetitors", line)).toBe("1");
      expect(cell(csv, "unavailableCompetitors", line)).toBe("1");
      expect(cell(csv, "resultTruncated", line)).toBe("true");
      expect(cell(csv, "gscOverlayStatus", line)).toBe("partial");
    }
  });

  it("writes a complete run's coverage as the complete run it was", () => {
    // The other half of the same guard: the columns have to move with the run,
    // not sit on a constant that happens to match the fixture above.
    const csv = competitorKeywordGapCsv(result([row()]));

    expect(cell(csv, "requestedCompetitors")).toBe("2");
    expect(cell(csv, "completedCompetitors")).toBe("2");
    expect(cell(csv, "unavailableCompetitors")).toBe("0");
    expect(cell(csv, "resultTruncated")).toBe("false");
    expect(cell(csv, "gscOverlayStatus")).toBe("available");
  });

  it("neutralises a keyword a spreadsheet would run as a formula", () => {
    // The keyword is whatever a competitor ranks for, straight from the
    // provider. `=cmd|...` in a cell is a known Excel and Sheets execution
    // path, and these files get opened by the person who downloaded them
    // without a second thought.
    const csv = competitorKeywordGapCsv(result([row({ keyword: "=1+1" })]));

    expect(cell(csv, "keyword")).toBe("'=1+1");
  });

  it("leaves a negative number we generated as a number", () => {
    // The leading-character guard is for text cells. Applying it to a trend
    // percentage would prefix an apostrophe onto every declining keyword and
    // make the column unsortable in the spreadsheet.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          searchVolumeTrend: { monthly: -12, quarterly: -3.5, yearly: 0 },
        }),
      ]),
    );

    expect(cell(csv, "dfsSearchVolumeTrendMonthly")).toBe("-12");
    expect(cell(csv, "dfsSearchVolumeTrendQuarterly")).toBe("-3.5");
    expect(cell(csv, "dfsSearchVolumeTrendYearly")).toBe("0");
  });

  it("writes an unavailable metric as an empty cell and a reported zero as 0", () => {
    // The distinction the whole contract is built on: a figure the provider
    // did not have is not a figure of zero. A 0 in the sheet would be a claim
    // about the keyword that nobody made.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          searchVolume: { availability: "provider_no_data", value: null },
          cpc: { availability: "available", value: null },
          keywordDifficulty: { availability: "explicit_zero", value: 0 },
          searchVolumeTrend: null,
        }),
      ]),
    );

    expect(cell(csv, "dfsSearchVolume")).toBe("");
    expect(cell(csv, "dfsCpc")).toBe("");
    expect(cell(csv, "dfsKeywordDifficulty")).toBe("0");
    expect(cell(csv, "dfsSearchVolumeTrendMonthly")).toBe("");
  });

  it("exports the metric availability that makes an empty volume cell readable", () => {
    // Without this column an empty `dfsSearchVolume` and a provider-reported
    // zero look the same to anyone reading the file later.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          searchVolume: { availability: "provider_no_data", value: null },
        }),
      ]),
    );

    expect(cell(csv, "dfsSearchVolumeAvailability")).toBe("provider_no_data");
  });

  it("round-trips a value carrying a comma, a double quote and a newline", () => {
    // RFC 4180 quoting, or the row silently gains columns in every reader that
    // opens it.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          coreKeyword: 'natal "birth" chart, free\nonline',
        }),
      ]),
    );

    expect(csv).toContain('"natal ""birth"" chart, free\nonline"');
  });

  it("leads with a byte-order mark and separates lines with CRLF", () => {
    // Without the mark Excel decodes UTF-8 as the local codepage and a Chinese
    // keyword opens as mojibake; CRLF is what RFC 4180 specifies and what the
    // least forgiving reader expects.
    const csv = competitorKeywordGapCsv(
      result([row({ keyword: "白羊座 性格" }), row({ keyword: "bravo" })]),
    );

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("白羊座 性格");
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it("orders the competitor ranks best first, tie-broken on the domain", () => {
    // The cell gets diffed against an earlier export. Whatever order the
    // provider handed the competitors back in, two runs over the same ranks
    // have to produce the same bytes.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          competitorRanks: {
            "zulu.example": 3,
            "alpha.example": 3,
            "mid.example": 1,
          },
          competitorPages: {},
          competitorCount: 3,
          bestCompetitorRank: 1,
        }),
      ]),
    );

    expect(cell(csv, "dfsCompetitorRanks")).toBe(
      "mid.example#1|alpha.example#3|zulu.example#3",
    );
  });

  it("names the competitor the page columns describe, with its own rank", () => {
    // The failure this prevents: the page columns describe the best-ranked
    // competitor whose URL could be linked, which is not the best-ranked
    // competitor when the leader has no usable URL. Exported without the
    // domain and the rank, the line puts `dfsBestCompetitorRank=1` beside a
    // URL, a title and a traffic estimate that are all somebody else's -- and
    // the estimate then contradicts the chip on screen, which reads the
    // best-ranked competitor whatever its URL.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          competitorRanks: { "alpha.example": 1, "beta.example": 9 },
          competitorPages: {
            "alpha.example": { url: null, title: "Alpha post", etv: 900 },
            "beta.example": {
              url: "https://beta.example/guide",
              title: "Beta guide",
              etv: 31,
            },
          },
          competitorCount: 2,
          bestCompetitorRank: 1,
        }),
      ]),
    );

    expect(cell(csv, "dfsBestCompetitorRank")).toBe("1");
    expect(cell(csv, "dfsLinkedCompetitorDomain")).toBe("beta.example");
    expect(cell(csv, "dfsLinkedCompetitorRank")).toBe("9");
    expect(cell(csv, "dfsLinkedCompetitorPageUrl")).toBe(
      "https://beta.example/guide",
    );
    expect(cell(csv, "dfsLinkedCompetitorPageTitle")).toBe("Beta guide");
    expect(cell(csv, "dfsLinkedCompetitorPageEtv")).toBe("31");
    // The reason the two numbers differ, readable from the file alone.
    expect(cell(csv, "dfsCompetitorRanks")).toBe(
      "alpha.example#1|beta.example#9",
    );
  });

  it("takes the domain, the URL, the title and the estimate from one competitor", () => {
    // Five columns that name a single page. Filling the URL from one
    // competitor and the title from whichever competitor happened to have one
    // would describe a page that does not exist.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          competitorRanks: { "best.example": 2, "next.example": 5 },
          competitorPages: {
            "best.example": {
              url: "javascript:alert(1)",
              title: "Unusable",
              etv: 999,
            },
            "next.example": {
              url: "https://next.example/guide",
              title: "Guide",
              etv: 31,
            },
          },
        }),
      ]),
    );

    expect(cell(csv, "dfsLinkedCompetitorDomain")).toBe("next.example");
    expect(cell(csv, "dfsLinkedCompetitorRank")).toBe("5");
    expect(cell(csv, "dfsLinkedCompetitorPageUrl")).toBe(
      "https://next.example/guide",
    );
    expect(cell(csv, "dfsLinkedCompetitorPageTitle")).toBe("Guide");
    expect(cell(csv, "dfsLinkedCompetitorPageEtv")).toBe("31");
  });

  it("empties all five linked-competitor columns when no page can be linked", () => {
    // With no usable URL there is no page to name, so there is no competitor,
    // title or traffic estimate to attach to one either. A title standing
    // alone in the file reads as a page the reader could go and open.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          competitorRanks: { "one.example": 4 },
          competitorPages: {
            "one.example": { url: null, title: "Free chart", etv: 120.5 },
          },
          competitorCount: 1,
          bestCompetitorRank: 4,
        }),
      ]),
    );

    expect(cell(csv, "dfsLinkedCompetitorDomain")).toBe("");
    expect(cell(csv, "dfsLinkedCompetitorRank")).toBe("");
    expect(cell(csv, "dfsLinkedCompetitorPageUrl")).toBe("");
    expect(cell(csv, "dfsLinkedCompetitorPageTitle")).toBe("");
    expect(cell(csv, "dfsLinkedCompetitorPageEtv")).toBe("");
  });

  it("marks a dated snapshot as dated and carries the provider's date", () => {
    // A stored SERP snapshot is a third party's record of a day, not something
    // this run looked at, and the state column is what says so in a file that
    // has no badges.
    const csv = competitorKeywordGapCsv(result([row()]));

    expect(cell(csv, "dfsSerpSnapshotState")).toBe("dfs_snapshot_dated");
    expect(cell(csv, "dfsSerpItemTypes")).toBe("organic|people_also_ask");
    expect(cell(csv, "dfsSerpSnapshotUpdatedAt")).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("marks an undated snapshot as undated rather than leaving a blank date", () => {
    // The failure this prevents: the provider's `last_updated_time` is often
    // missing, so a snapshot carrying an AI Overview arrives with no date. With
    // only the date column, that case and "there was no snapshot at all" are
    // the same empty cell -- and an undated third-party record then reads as
    // something this run observed today. On screen it is spelled out as "DFS
    // snapshot, undated".
    const csv = competitorKeywordGapCsv(
      result([
        row({
          serpSnapshot: { itemTypes: ["ai_overview"], updatedAt: null },
        }),
      ]),
    );

    expect(cell(csv, "dfsSerpSnapshotState")).toBe("dfs_snapshot_undated");
    expect(cell(csv, "dfsSerpItemTypes")).toBe("ai_overview");
    expect(cell(csv, "dfsSerpSnapshotUpdatedAt")).toBe("");
  });

  it("carries a zero-row Search Console read into the file", () => {
    // The wrong-property case. The read succeeded, so the overlay status stays
    // "available" and every row's GSC evidence is empty -- which without these
    // counts reads as "Search Console was read and this site has no coverage",
    // the one inference the boundaries forbid. On screen it gets its own
    // escalation; here the zero is what carries it.
    const csv = competitorKeywordGapCsv(
      result([row()], { gscQueryRowCount: 0, gscQueryPageRowCount: 0 }),
    );

    expect(cell(csv, "gscOverlayStatus")).toBe("available");
    expect(cell(csv, "gscQueryRowCount")).toBe("0");
    expect(cell(csv, "gscQueryPageRowCount")).toBe("0");
  });

  it("leaves the row-count columns empty when the overlay was never requested", () => {
    // null is not 0 here: "not requested" and "requested and empty" are
    // different facts, and a 0 for the first would invent a read.
    const csv = competitorKeywordGapCsv(
      result([row()], {
        overlayStatus: "not_requested",
        gscQueryRowCount: null,
        gscQueryPageRowCount: null,
      }),
    );

    expect(cell(csv, "gscQueryRowCount")).toBe("");
    expect(cell(csv, "gscQueryPageRowCount")).toBe("");
  });

  it("calls a snapshot undated when its timestamp cannot be resolved", () => {
    // The provider's timestamp is copied through unvalidated and the surface
    // calls an unparseable one undated. Deciding on null alone made the file
    // say "dated" for the same snapshot the screen called undated.
    const csv = competitorKeywordGapCsv(
      result([
        row({
          serpSnapshot: {
            itemTypes: ["ai_overview"],
            updatedAt: "not-a-date",
          },
        }),
      ]),
    );

    expect(cell(csv, "dfsSerpSnapshotState")).toBe("dfs_snapshot_undated");
    expect(cell(csv, "dfsSerpSnapshotUpdatedAt")).toBe("not-a-date");
  });

  it("empties both snapshot columns when there is no snapshot", () => {
    // With no snapshot there is no date and no item types, and an item-type
    // list without a date would read as current.
    const csv = competitorKeywordGapCsv(result([row({ serpSnapshot: null })]));

    expect(cell(csv, "dfsSerpSnapshotState")).toBe("no_snapshot");
    expect(cell(csv, "dfsSerpItemTypes")).toBe("");
    expect(cell(csv, "dfsSerpSnapshotUpdatedAt")).toBe("");
  });
});

describe("competitorKeywordGapCsvFilename", () => {
  it("names the site and the day it was captured", () => {
    expect(competitorKeywordGapCsvFilename(result([]))).toBe(
      "competitor-keyword-gap-acme.com-2026-08-24.csv",
    );
  });

  it("falls back when capturedAt is not a day it can read", () => {
    // `capturedAt` arrives in an API response. A separator or a quote in it has
    // no business reaching a download attribute, and a date that does not exist
    // would put a lie in the name.
    expect(
      competitorKeywordGapCsvFilename(result([], { capturedAt: "yesterday" })),
    ).toBe("competitor-keyword-gap.csv");
    expect(
      competitorKeywordGapCsvFilename(
        result([], { capturedAt: "2026-13-45T00:00:00.000Z" }),
      ),
    ).toBe("competitor-keyword-gap.csv");
  });

  it("falls back on a site domain that could steer the download path", () => {
    // The domain started life as something a person typed into the form.
    expect(
      competitorKeywordGapCsvFilename(
        result([], { siteDomain: "../../etc/acme.com" }),
      ),
    ).toBe("competitor-keyword-gap.csv");
    expect(
      competitorKeywordGapCsvFilename(result([], { siteDomain: 'acme".com' })),
    ).toBe("competitor-keyword-gap.csv");
  });
});
