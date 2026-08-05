import { describe, expect, it } from "vitest";

import type { InternalLinkAuditPayload } from "@sf/public-tools";

import {
  actionSummary,
  coverageSummary,
  retryAfterMessage,
  stopReasonLabel,
} from "./internal-link-audit-result-copy";

type AuditReport = InternalLinkAuditPayload["result"];

function report(
  overrides: Partial<AuditReport> = {},
): AuditReport {
  return {
    targetUrl: "https://example.com/",
    availability: "partial",
    stopReason: "max_urls",
    limitation: "Backend-only limitation text.",
    pagesCrawled: 4,
    linksObserved: 3,
    sitemapFetched: true,
    sitemapUrlsObserved: 10,
    actionablePages: 3,
    clickDepthDistribution: {
      oneClick: 1,
      twoClicks: 1,
      threeClicks: 0,
      fourPlusClicks: 2,
      unreachable: 1,
    },
    nodes: [],
    edges: [],
    findings: [],
    ...overrides,
  };
}

describe("internal link audit result copy", () => {
  it.each([
    ["max_urls", "Collection boundary reached", "已达到本次采集处理边界"],
    ["max_depth", "Crawl depth limit reached", "已达到抓取深度上限"],
    ["max_duration", "Time limit reached", "已达到处理时长上限"],
    ["max_total_bytes", "Response data limit reached", "已达到响应数据量上限"],
    ["max_requests", "Request limit reached", "已达到请求次数上限"],
    ["aborted", "Collection ended early", "本次采集提前结束"],
  ])("localizes %s without exposing the raw reason", (reason, en, zh) => {
    expect(stopReasonLabel(reason, "en")).toBe(en);
    expect(stopReasonLabel(reason, "zh")).toBe(zh);
  });

  it("uses a localized fallback for unknown stop reasons", () => {
    expect(stopReasonLabel("future_boundary", "en")).toBe(
      "Safety boundary reached",
    );
    expect(stopReasonLabel("future_boundary", "zh")).toBe("已达到安全边界");
  });

  it("builds a user-facing partial coverage summary", () => {
    expect(coverageSummary(report(), "en")).toBe(
      "Collected 4 page(s) before this online run reached a processing boundary. You can review the available evidence, but it does not represent complete site coverage.",
    );
    expect(coverageSummary(report(), "zh")).toBe(
      "本次在线扫描已采集 4 个页面，并在达到处理边界后停止。当前证据仍可继续查看，但不能代表整站完整覆盖。",
    );
  });

  it("builds a localized complete coverage summary", () => {
    const completed = report({
      availability: "available",
      stopReason: null,
      pagesCrawled: 7,
    });
    expect(coverageSummary(completed, "en")).toBe(
      "Collected 7 reachable static HTML page(s) in this online run.",
    );
    expect(coverageSummary(completed, "zh")).toBe(
      "本次在线扫描已采集 7 个可访问的静态 HTML 页面。",
    );
  });

  it("puts the actionable click-depth conclusion ahead of crawl process facts", () => {
    expect(actionSummary(report(), "en")).toContain(
      "3 indexable page(s) need attention",
    );
    expect(actionSummary(report(), "en")).toContain("Coverage was partial");
    expect(actionSummary(report(), "zh")).toContain(
      "有 3 个可索引页面需要关注",
    );
  });

  it("does not invent a problem when no actionable page was found", () => {
    expect(
      actionSummary(report({ actionablePages: 0 }), "en"),
    ).toContain("No indexable internal-link structure issue");
  });

  it("formats a trusted Retry-After value without inventing a wait time", () => {
    expect(retryAfterMessage("42", "en")).toBe("Try again in 42 seconds.");
    expect(retryAfterMessage("42", "zh")).toBe("请在 42 秒后重试。");
    expect(retryAfterMessage("Fri, 31 Jul 2026 12:00:00 GMT", "en")).toBeNull();
    expect(retryAfterMessage(null, "zh")).toBeNull();
  });
});
