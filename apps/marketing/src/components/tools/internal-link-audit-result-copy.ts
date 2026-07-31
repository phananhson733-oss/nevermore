import type { InternalLinkAuditPayload } from "@sf/public-tools";

import type { InternalLinkAuditLocale } from "./internal-link-audit-content";

type AuditReport = InternalLinkAuditPayload["result"];

const STOP_REASON_LABELS: Record<
  InternalLinkAuditLocale,
  Readonly<Record<string, string>>
> = {
  en: {
    max_urls: "Collection boundary reached",
    max_depth: "Crawl depth limit reached",
    max_duration: "Time limit reached",
    max_total_bytes: "Response data limit reached",
    max_requests: "Request limit reached",
    aborted: "Collection ended early",
  },
  zh: {
    max_urls: "已达到本次采集处理边界",
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
      ? `本次在线扫描已采集 ${report.pagesCrawled} 个可访问的静态 HTML 页面。`
      : `Collected ${report.pagesCrawled} reachable static HTML page(s) in this online run.`;
  }

  return locale === "zh"
    ? `本次在线扫描已采集 ${report.pagesCrawled} 个页面，并在达到处理边界后停止。当前证据仍可继续查看，但不能代表整站完整覆盖。`
    : `Collected ${report.pagesCrawled} page(s) before this online run reached a processing boundary. You can review the available evidence, but it does not represent complete site coverage.`;
}

export function retryAfterMessage(
  retryAfterHeader: string | null,
  locale: InternalLinkAuditLocale,
): string | null {
  if (!retryAfterHeader || !/^\d+$/.test(retryAfterHeader.trim())) return null;
  const seconds = Number(retryAfterHeader);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return locale === "zh"
    ? `请在 ${seconds} 秒后重试。`
    : `Try again in ${seconds} seconds.`;
}
