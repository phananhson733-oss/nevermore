// @input  -- a QuickWinsResult rendered through the real message bundle
// @output -- a failing test when the table stops being readable without a mouse
// @pos    -- the guard on the accessibility contract the markup claims
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { QuickWinEvidenceRow, QuickWinsResult } from "@sf/public-tools";

import en from "../../i18n/messages/en.json";
import { QuickWinsEvidenceTable } from "./quick-wins-evidence-table.tsx";

function row(
  overrides: Partial<QuickWinEvidenceRow> = {},
): QuickWinEvidenceRow {
  return {
    query: "messi zodiac sign",
    position: 8.44,
    bucketId: "8-11",
    impressions: 3439,
    clicks: 3,
    observedCtr: 3 / 3439,
    baselineCtr: 0.0051,
    expectedClicks: 17.5,
    clickGap: 14.5,
    tailProbability: 0.0234,
    baselineBandUnderOnePercent: false,
    ...overrides,
  };
}

function result(rows: readonly QuickWinEvidenceRow[]): QuickWinsResult {
  return {
    window: { startDate: "2026-07-06", endDate: "2026-08-02" },
    rows,
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

function render(value: QuickWinsResult, locale = "en"): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={{ tools: { quickWins: en.tools.quickWins } }}
    >
      <QuickWinsEvidenceTable result={value} locale={locale} />
    </NextIntlClientProvider>,
  );
}

describe("QuickWinsEvidenceTable", () => {
  it("names the table for anyone who cannot see where it starts", () => {
    expect(render(result([row()]))).toContain("<caption");
  });

  it("announces which column is sorted and which way", () => {
    // Without aria-sort a screen reader reads eight identical header buttons
    // and no indication that pressing one did anything.
    const html = render(result([row()]));

    expect(html).toContain('aria-sort="descending"');
    expect(html.match(/aria-sort="none"/g)).toHaveLength(7);
  });

  it("makes every header a real button, not a clickable cell", () => {
    const html = render(result([row()]));

    expect(html.match(/<th[^>]*>\s*<button type="button"/g)).toHaveLength(8);
  });

  it("writes the band caveat down instead of hiding it in a tooltip", () => {
    // A `title` attribute is unreachable on a touch screen and inconsistent
    // through a screen reader, and this caveat changes how every flagged row
    // should be read.
    const html = render(result([row({ baselineBandUnderOnePercent: true })]));

    expect(html).toContain('aria-describedby="quick-wins-band-note"');
    expect(html).toContain('id="quick-wins-band-note"');
    expect(html).toContain("earns under 1%");
  });

  it("leaves the caveat out when no row carries it", () => {
    expect(render(result([row()]))).not.toContain(
      'id="quick-wins-band-note"',
    );
  });

  it("renders an unavailable rate as unavailable, never as 0%", () => {
    const html = render(
      result([row({ impressions: 0, observedCtr: null, tailProbability: null })]),
    );

    expect(html).toContain("—");
    expect(html).not.toContain("0.00%");
  });

  it("groups numbers for the locale it was given", () => {
    expect(render(result([row()]), "en")).toContain("3,439");
    expect(render(result([row()]), "de")).toContain("3.439");
  });

  it("offers the export", () => {
    expect(render(result([row()]))).toContain("Download CSV");
  });
});
