// @input  -- action lists rendered through the real message bundle
// @output -- a failing test when advice loses its numbers, its rows, or its honesty
// @pos    -- the guard on the "what to do next" card
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { QuickWinAction } from "@sf/public-tools";

import en from "../../i18n/messages/en.json";
import { QuickWinsActions } from "./quick-wins-actions.tsx";

function render(actions: readonly QuickWinAction[]): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en}>
      <QuickWinsActions actions={actions} locale="en" />
    </NextIntlClientProvider>,
  );
}

describe("QuickWinsActions", () => {
  it("renders nothing at all when the run supported no advice", () => {
    // An empty "what to do next" heading over a blank card tells the reader we
    // had nothing to say and dressed it up anyway.
    expect(render([])).toBe("");
  });

  it("names the rows an action came from, not just how many", () => {
    const markup = render([
      {
        id: "open_serps_for_top_gaps",
        kind: "external_data",
        queries: ["messi zodiac sign", "leo traits"],
        bands: [],
        measures: [
          { key: "serpRowCount", value: 7 },
          { key: "largestGapClicks", value: 68 },
        ],
      },
    ]);

    expect(markup).toContain("messi zodiac sign");
    expect(markup).toContain("leo traits");
    // The engine caps the named list; the count is the real total, so the
    // overflow has to be visible or the cap reads as the answer.
    expect(markup).toContain("+5 more in the table");
    expect(markup).toContain("68");
  });

  it("shows an unavailable measure as a dash, never as zero", () => {
    // `size_the_withheld_share` fires precisely when the share could not be
    // computed. A 0% withheld share is the one answer we know to be false, and
    // it would tell the reader their table is complete.
    const markup = render([
      {
        id: "size_the_withheld_share",
        kind: "external_data",
        queries: [],
        bands: [],
        measures: [
          { key: "withheldImpressionShare", value: null },
          { key: "withheldClickShare", value: null },
        ],
      },
    ]);

    expect(markup).toContain("—");
    expect(markup).not.toContain("0% of impressions");
  });

  it("rounds a share of the property whole, and a band's rate to two decimals", () => {
    // Different quantities, different precision. "43.00% of impressions"
    // claims a precision the underlying subtraction does not have; 0.48% and
    // 1.93% rounded whole both become the same number and the sentence built
    // on the difference between them stops meaning anything.
    const share = render([
      {
        id: "size_the_withheld_share",
        kind: "external_data",
        queries: [],
        bands: [],
        measures: [
          { key: "withheldImpressionShare", value: 0.43 },
          { key: "withheldClickShare", value: 0.64 },
        ],
      },
    ]);
    expect(share).toContain("43%");
    expect(share).not.toContain("43.00%");

    const rate = render([
      {
        id: "avoid_curve_as_law",
        kind: "avoid",
        queries: [],
        bands: ["8-11", "11-16"],
        measures: [
          { key: "higherBandCtr", value: 0.0048 },
          { key: "lowerBandCtr", value: 0.0193 },
        ],
      },
    ]);
    expect(rate).toContain("0.48%");
    expect(rate).toContain("1.93%");
  });

  it("writes a click count in prose without a plus sign", () => {
    // The table column signs the gap because it carries both directions. In a
    // sentence about a shortfall, "+68 clicks" reads as an increase — the
    // opposite of what the sentence says.
    const markup = render([
      {
        id: "avoid_gap_as_forecast",
        kind: "avoid",
        queries: [],
        bands: [],
        measures: [{ key: "totalGapClicks", value: 214 }],
      },
    ]);

    expect(markup).toContain("214 clicks");
    expect(markup).not.toContain("+214");
  });

  it("names both bands when the curve inverts", () => {
    const markup = render([
      {
        id: "avoid_curve_as_law",
        kind: "avoid",
        queries: [],
        bands: ["8-11", "11-16"],
        measures: [
          { key: "higherBandCtr", value: 0.0048 },
          { key: "lowerBandCtr", value: 0.0193 },
        ],
      },
    ]);

    expect(markup).toContain("8-11");
    expect(markup).toContain("11-16");
    expect(markup).toContain("0.48%");
    expect(markup).toContain("1.93%");
  });

  it("labels each action with what kind of move it is", () => {
    const markup = render([
      {
        id: "apply_wording_candidates",
        kind: "do",
        queries: ["a"],
        bands: [],
        measures: [{ key: "candidateCount", value: 1 }],
      },
      {
        id: "avoid_gap_as_forecast",
        kind: "avoid",
        queries: [],
        bands: [],
        measures: [{ key: "totalGapClicks", value: 4 }],
      },
    ]);

    expect(markup).toContain("Do now");
    // "Don't" is as much a recommendation as "do", and the report has more of
    // them. Losing the badge would flatten both into undifferentiated prose.
    expect(markup).toContain("Don");
  });
});
