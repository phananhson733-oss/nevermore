import { describe, expect, it } from "vitest";

import type { InternalLinkAuditPayload } from "@sf/public-tools";

import {
  coverageSummary,
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
    maxPages: 2_000,
    linksObserved: 3,
    sitemapFetched: true,
    sitemapUrlsObserved: 10,
    nodes: [],
    edges: [],
    findings: [],
    ...overrides,
  };
}

describe("internal link audit result copy", () => {
  it.each([
    ["max_urls", "Synchronous page-safety boundary reached", "已达到同步扫描页面安全边界"],
    ["max_depth", "Synchronous depth-safety boundary reached", "已达到同步扫描深度安全边界"],
    ["max_duration", "Synchronous time-safety boundary reached", "已达到同步扫描处理时长安全边界"],
    ["max_total_bytes", "Synchronous response-data safety boundary reached", "已达到同步扫描响应数据安全边界"],
    ["max_requests", "Synchronous request-safety boundary reached", "已达到同步扫描请求安全边界"],
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
      "Collected 4 page(s) before the synchronous page-safety boundary was reached. You can review the available results, but they do not represent complete site coverage.",
    );
    expect(coverageSummary(report(), "zh")).toBe(
      "本次已采集 4 个页面；达到同步扫描页面安全边界后停止。当前结果可继续查看，但不能代表整站完整覆盖。",
    );
  });

  it("builds a localized complete coverage summary", () => {
    const completed = report({
      availability: "available",
      stopReason: null,
      pagesCrawled: 7,
    });
    expect(coverageSummary(completed, "en")).toBe(
      "Collected 7 page(s) and completed within the configured safety limits.",
    );
    expect(coverageSummary(completed, "zh")).toBe(
      "本次已采集 7 个页面，并在预设安全范围内完成。",
    );
  });
});
