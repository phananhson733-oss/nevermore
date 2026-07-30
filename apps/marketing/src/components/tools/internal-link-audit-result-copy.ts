import type { InternalLinkAuditPayload } from "@sf/public-tools";

import type { InternalLinkAuditLocale } from "./internal-link-audit-content";

type AuditReport = InternalLinkAuditPayload["result"];

const STOP_REASON_LABELS: Record<
  InternalLinkAuditLocale,
  Readonly<Record<string, string>>
> = {
  en: {
    max_urls: "Page limit reached",
    max_depth: "Crawl depth limit reached",
    max_duration: "Time limit reached",
    max_total_bytes: "Response data limit reached",
    max_requests: "Request limit reached",
    aborted: "Collection ended early",
  },
  zh: {
    max_urls: "已达到页面数量上限",
    max_depth: "已达到抓取深度上限",
    max_duration: "已达到处理时长上限",
    max_total_bytes: "已达到响应数据量上限",
    max_requests: "已达到请求次数上限",
    aborted: "本次采集提前结束",
  },
};

export function stopReasonLabel(
  stopReason: string | null,
  locale: InternalLinkAuditLocale,
): string {
  if (!stopReason) {
    return locale === "zh" ? "已达到安全边界" : "Safety boundary reached";
  }
  return (
    STOP_REASON_LABELS[locale][stopReason] ??
    (locale === "zh" ? "已达到安全边界" : "Safety boundary reached")
  );
}

export function coverageSummary(
  report: AuditReport,
  locale: InternalLinkAuditLocale,
): string {
  if (report.availability !== "partial") {
    return locale === "zh"
      ? `本次已采集 ${report.pagesCrawled} 个页面，并在预设安全范围内完成。`
      : `Collected ${report.pagesCrawled} page(s) and completed within the configured safety limits.`;
  }

  if (report.stopReason === "max_urls") {
    return locale === "zh"
      ? `本次已采集 ${report.pagesCrawled} 个页面；达到 ${report.maxPages} 页安全预算后停止。当前结果可继续查看，但不能代表整站完整覆盖。`
      : `Collected ${report.pagesCrawled} page(s) before the ${report.maxPages}-page safety budget was reached. You can review the available results, but they do not represent complete site coverage.`;
  }

  return locale === "zh"
    ? `本次已采集 ${report.pagesCrawled} 个页面，并在达到预设安全边界后停止。当前结果可继续查看，但不能代表整站完整覆盖。`
    : `Collected ${report.pagesCrawled} page(s) before reaching a configured safety boundary. You can review the available results, but they do not represent complete site coverage.`;
}
