import type { InternalLinkAuditPayload } from "@sf/public-tools";

import type { InternalLinkAuditLocale } from "./internal-link-audit-content";

type AuditReport = InternalLinkAuditPayload["result"];

const STOP_REASON_LABELS: Record<
  InternalLinkAuditLocale,
  Readonly<Record<string, string>>
> = {
  en: {
    max_urls: "Synchronous page-safety boundary reached",
    max_depth: "Synchronous depth-safety boundary reached",
    max_duration: "Synchronous time-safety boundary reached",
    max_total_bytes: "Synchronous response-data safety boundary reached",
    max_requests: "Synchronous request-safety boundary reached",
    aborted: "Collection ended early",
  },
  zh: {
    max_urls: "已达到同步扫描页面安全边界",
    max_depth: "已达到同步扫描深度安全边界",
    max_duration: "已达到同步扫描处理时长安全边界",
    max_total_bytes: "已达到同步扫描响应数据安全边界",
    max_requests: "已达到同步扫描请求安全边界",
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
      ? `本次已采集 ${report.pagesCrawled} 个页面；达到同步扫描页面安全边界后停止。当前结果可继续查看，但不能代表整站完整覆盖。`
      : `Collected ${report.pagesCrawled} page(s) before the synchronous page-safety boundary was reached. You can review the available results, but they do not represent complete site coverage.`;
  }

  return locale === "zh"
    ? `本次已采集 ${report.pagesCrawled} 个页面，并在达到预设安全边界后停止。当前结果可继续查看，但不能代表整站完整覆盖。`
    : `Collected ${report.pagesCrawled} page(s) before reaching a configured safety boundary. You can review the available results, but they do not represent complete site coverage.`;
}
