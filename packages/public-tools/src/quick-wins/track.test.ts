import { describe, expect, it } from "vitest";

import { trackCounts, trackForRow, withTracks } from "./track.ts";
import type { QuickWinEvidenceRow } from "./types.ts";

function row(overrides: Partial<QuickWinEvidenceRow> = {}): QuickWinEvidenceRow {
  return {
    query: "example query",
    position: 8.4,
    bucketId: "8-11",
    impressions: 4000,
    clicks: 12,
    observedCtr: 0.003,
    baselineCtr: 0.02,
    expectedClicks: 80,
    clickGap: 68,
    tailProbability: 0.0001,
    baselineBandUnderOnePercent: false,
    track: "read_the_serp",
    ...overrides,
  };
}

const NO_DRAFTS: ReadonlySet<string> = new Set();

describe("trackForRow", () => {
  it("sends a material shortfall with no same-site control to the SERP", () => {
    expect(trackForRow(row(), NO_DRAFTS)).toBe("read_the_serp");
  });

  it("puts a row with a wording candidate on the compare path", () => {
    expect(trackForRow(row(), new Set(["example query"]))).toBe(
      "compare_with_own_page",
    );
  });

  it("lets a wording candidate outrank the low-band caveat", () => {
    // The caveat says per-query comparison inside a sub-1% band is circular
    // because there is no control. A candidate IS a control: a page in the
    // same band, on the same site, earning clearly more. Ranking the caveat
    // first would bury the one row in that band that has an answer.
    const inLowBand = row({ baselineBandUnderOnePercent: true });
    expect(trackForRow(inLowBand, new Set(["example query"]))).toBe(
      "compare_with_own_page",
    );
    expect(trackForRow(inLowBand, NO_DRAFTS)).toBe("band_is_the_story");
  });

  it("treats a shortfall under one click as noise", () => {
    // Clicks are counted in whole numbers, so a 0.4-click shortfall means the
    // prediction and the observation agree as closely as the unit allows.
    expect(trackForRow(row({ clickGap: 0.4 }), NO_DRAFTS)).toBe(
      "gap_within_noise",
    );
    expect(trackForRow(row({ clickGap: 1 }), NO_DRAFTS)).toBe("read_the_serp");
  });

  it("ranks noise ahead of the draft and band paths", () => {
    // A sub-one-click gap is not worth anyone's time no matter what else is
    // true about the row, so neither a candidate nor a low band promotes it.
    expect(trackForRow(row({ clickGap: 0.2 }), new Set(["example query"]))).toBe(
      "gap_within_noise",
    );
    expect(
      trackForRow(
        row({ clickGap: 0.2, baselineBandUnderOnePercent: true }),
        NO_DRAFTS,
      ),
    ).toBe("gap_within_noise");
  });

  it("recommends nothing for a row at or above the site's own rate", () => {
    // These rows are in the table on purpose — dropping them would turn a
    // measurement into a complaint list — and a "next step" on one would be an
    // instruction to fix something that is working.
    expect(trackForRow(row({ clickGap: 0 }), NO_DRAFTS)).toBe(
      "at_or_above_curve",
    );
    expect(trackForRow(row({ clickGap: -30 }), NO_DRAFTS)).toBe(
      "at_or_above_curve",
    );
    expect(
      trackForRow(row({ clickGap: -30 }), new Set(["example query"])),
    ).toBe("at_or_above_curve");
  });

  it("classifies a non-finite gap as nothing-to-do rather than as work", () => {
    // evidence.ts drops these before they get here. If one ever arrived, the
    // failure that recommends no work is the safe one.
    for (const gap of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(trackForRow(row({ clickGap: gap }), NO_DRAFTS), String(gap)).toBe(
        "at_or_above_curve",
      );
    }
  });
});

describe("withTracks", () => {
  it("preserves row order and mutates nothing", () => {
    const input = [
      row({ query: "a", clickGap: 90 }),
      row({ query: "b", clickGap: -4 }),
    ];
    const out = withTracks(input, new Set(["a"]));

    expect(out.map((r) => r.query)).toEqual(["a", "b"]);
    expect(out.map((r) => r.track)).toEqual([
      "compare_with_own_page",
      "at_or_above_curve",
    ]);
    expect(input[0]?.track).toBe("read_the_serp");
  });
});

describe("trackCounts", () => {
  it("reports every track, including the ones with no rows", () => {
    // A tab labelled "0" is a different statement from a tab that is missing:
    // the first says we looked, the second says nothing at all.
    expect(trackCounts([])).toEqual({
      compare_with_own_page: 0,
      read_the_serp: 0,
      band_is_the_story: 0,
      gap_within_noise: 0,
      at_or_above_curve: 0,
    });
  });

  it("counts what it was given", () => {
    const rows = withTracks(
      [
        row({ query: "a", clickGap: 90 }),
        row({ query: "b", clickGap: 90 }),
        row({ query: "c", clickGap: 90, baselineBandUnderOnePercent: true }),
        row({ query: "d", clickGap: 0.1 }),
      ],
      new Set(["a"]),
    );

    expect(trackCounts(rows)).toEqual({
      compare_with_own_page: 1,
      read_the_serp: 1,
      band_is_the_story: 1,
      gap_within_noise: 1,
      at_or_above_curve: 0,
    });
  });
});
