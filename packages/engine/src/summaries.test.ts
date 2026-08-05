import { describe, expect, it } from "vitest";
import { buildSummary } from "./summaries.ts";

describe("buildSummary", () => {
  it("rejects a missing required summary argument instead of rendering a broken customer title", () => {
    expect(() =>
      buildSummary("SEARCH-CTR-004", { position: "3.0" }, "en"),
    ).toThrow(/SEARCH-CTR-004.*ctr/);
  });

  it("rejects empty and non-finite summary arguments", () => {
    expect(() =>
      buildSummary("SEARCH-DECAY-002", { delta: "" }, "en"),
    ).toThrow(/SEARCH-DECAY-002.*delta/);
    expect(() =>
      buildSummary(
        "CRO-LANDING-003",
        { pageRate: Number.NaN, baseline: "7.27%" },
        "en",
      ),
    ).toThrow(/CRO-LANDING-003.*pageRate/);
  });

  it("renders complete English and Chinese summaries from evidence-derived arguments", () => {
    expect(
      buildSummary(
        "CRO-LANDING-003",
        { pageRate: "4.00%", baseline: "7.27%" },
        "en",
      ).summary,
    ).toBe(
      "A landing page converts (4.00%) well below the site baseline (7.27%).",
    );
    expect(
      buildSummary(
        "SEARCH-DECAY-002",
        { delta: "50.0%" },
        "zh-CN",
      ).summary,
    ).toBe("某有历史需求的页面点击量较前 28 天下降 50.0%。");
  });

  it("describes the observed sitemap/indexability contradiction without prescribing the fix", () => {
    const url = "https://example.com/noindex";

    expect(buildSummary("TECH-INDEXABILITY-006", { url }, "en")).toEqual({
      summary:
        "https://example.com/noindex is listed in the sitemap but was observed with a page-level non-indexable signal.",
      summaryLocale: "en",
    });
    expect(buildSummary("TECH-INDEXABILITY-006", { url }, "zh-CN")).toEqual({
      summary:
        "https://example.com/noindex 已列入 Sitemap，但观测到页面级不可索引信号。",
      summaryLocale: "zh-CN",
    });
    expect(() => buildSummary("TECH-INDEXABILITY-006", {}, "en")).toThrow(
      /TECH-INDEXABILITY-006.*url/,
    );
  });
});
