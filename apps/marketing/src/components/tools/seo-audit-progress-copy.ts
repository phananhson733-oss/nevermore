// @input  -- locale, the crawl's observed page and wire-request counts, client elapsed ms
// @output -- bilingual copy for the live crawl-progress panel
// @pos    -- presentation layer for the in-flight state of the public SEO Audit
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  resultCopyLocale,
  type SeoAuditResultCopyLocale,
} from "./seo-audit-result-copy.ts";

export type SeoAuditProgressLocale = SeoAuditResultCopyLocale;

export const progressCopyLocale = resultCopyLocale;

/**
 * Which part of the run the reader is watching.
 *
 * `crawl` is the site being fetched. `report` is everything after `crawlSite`
 * returns — the report built over up to 2,000 pages, serialized, and written
 * to the shared cache — during which no request goes to the site at all. The
 * panel used to claim a crawl for both.
 */
export type SeoAuditProgressPhase = "crawl" | "report";

export interface SeoAuditProgressCopy {
  readonly heading: string;
  /** The heading for the window after the crawl has stopped. */
  readonly reportHeading: string;
  /**
   * Two figures are on screen. This is what keeps them from being read as one:
   * the page count is the report's own "Pages inspected", and requests run
   * ahead of it because they include robots.txt, sitemap documents and
   * redirect hops.
   */
  readonly note: string;
  readonly noTotal: string;
  /**
   * What the two frozen-looking figures mean once the crawl is over: the page
   * count is final and the clock is still running, which is the exact state
   * that read as a hung page.
   */
  readonly reportNote: string;
}

const COPY: Record<SeoAuditProgressLocale, SeoAuditProgressCopy> = {
  en: {
    heading: "Crawl in progress",
    reportHeading: "Crawl finished, building the report",
    note: "The page count is the figure the finished report gives as Pages inspected. Requests run ahead of it: they include robots.txt, sitemap files, and every redirect.",
    noTotal:
      "This site's page count is not known before the crawl ends, so there is no percentage to show. The crawl itself stops after four minutes; the elapsed time above covers the whole request — it starts before the crawl does and runs until the report is ready — so it reads higher.",
    reportNote:
      "Nothing more is being fetched from the site. The pages already crawled are being turned into the report and stored, which is why the page count above has stopped moving while the clock has not.",
  },
  zh: {
    heading: "抓取进行中",
    reportHeading: "抓取已结束，正在生成报告",
    note: "页面数就是抓取结束后报告里「已检查页面」的那个数。请求数会跑在它前面：请求包含 robots.txt、站点地图文件和每一次重定向。",
    noTotal:
      "该站点的页面总数在抓取结束前无法得知，因此这里不显示完成百分比。抓取本身最长四分钟；上面的用时算的是整个请求——它早于抓取开始，并一直计到报告生成完毕——因此会更高一些。",
    reportNote:
      "已经不再向该站点发出任何请求。现在是把抓到的页面整理成报告并存下来，所以上面的页面数不再变化，而用时还在往前走。",
  },
};

export function progressCopy(
  locale: SeoAuditProgressLocale,
): SeoAuditProgressCopy {
  return COPY[locale];
}

/**
 * The page figure the crawl engine reported, which is the same quantity the
 * finished report states as `coverage.pagesInspected`. Zero is a real state
 * for as long as robots.txt and the sitemap documents are being read, and it
 * reads better as a sentence than as a bare "0".
 *
 * Once the crawl is over the same figure is final rather than running, so the
 * "so far" comes off: nothing is going to add to it.
 */
export function pagesCrawledLabel(
  count: number,
  locale: SeoAuditProgressLocale,
  phase: SeoAuditProgressPhase = "crawl",
): string {
  if (locale === "zh") {
    if (phase === "report") {
      return count === 0 ? "未抓取到任何页面" : `共抓取 ${count} 个页面`;
    }
    return count === 0 ? "尚未抓取到任何页面" : `已抓取 ${count} 个页面`;
  }
  const pages = `${count} ${count === 1 ? "page" : "pages"} crawled`;
  if (phase === "report") return count === 0 ? "No page crawled" : pages;
  if (count === 0) return "No page crawled yet";
  return `${pages} so far`;
}

/**
 * The wire-request count, phrased so it cannot be read as pages.
 *
 * Attributed to the crawl rather than to the run as a whole: canonical entry
 * resolution sends its own request before the crawl starts and is not counted,
 * so "requests sent to the site" would be one low.
 */
export function requestsSentLabel(
  count: number,
  locale: SeoAuditProgressLocale,
): string {
  if (locale === "zh") {
    return count === 0
      ? "本次抓取尚未发出请求"
      : `本次抓取已发出 ${count} 个请求`;
  }
  if (count === 0) return "No request sent by the crawl yet";
  return `${count} ${count === 1 ? "request" : "requests"} sent by the crawl`;
}

/**
 * Elapsed time measured by the caller's own clock.
 *
 * The server deliberately sends no duration: two elapsed numbers would invite
 * a blended one, and this is a real local measurement of how long the request
 * has been in flight.
 */
export function elapsedLabel(
  elapsedMs: number,
  locale: SeoAuditProgressLocale,
): string {
  const total = Number.isFinite(elapsedMs)
    ? Math.max(0, Math.floor(elapsedMs / 1_000))
    : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (locale === "zh") {
    return minutes === 0
      ? `已用 ${seconds} 秒`
      : `已用 ${minutes} 分 ${seconds} 秒`;
  }
  return minutes === 0
    ? `${seconds}s elapsed`
    : `${minutes}m ${seconds}s elapsed`;
}

export interface SeoAuditProgressStatus {
  readonly pagesCrawled: number;
  readonly requestsSent: number;
  readonly elapsedMs: number;
  readonly phase: SeoAuditProgressPhase;
}

/**
 * One sentence for assistive technology, sampled rather than streamed.
 *
 * The visible readout moves several times a second inside a polite live
 * region, which would queue hundreds of utterances for one crawl. This carries
 * the page figure, which is the one that answers "is it getting anywhere";
 * requests are a visual detail and are left off.
 */
export function progressAnnouncement(
  status: SeoAuditProgressStatus,
  locale: SeoAuditProgressLocale,
): string {
  const pages = pagesCrawledLabel(status.pagesCrawled, locale, status.phase);
  const elapsed = elapsedLabel(status.elapsedMs, locale);
  const copy = progressCopy(locale);
  const heading = status.phase === "report" ? copy.reportHeading : copy.heading;
  return locale === "zh"
    ? `${heading}。${pages}。${elapsed}。`
    : `${heading}. ${pages}. ${elapsed}.`;
}
