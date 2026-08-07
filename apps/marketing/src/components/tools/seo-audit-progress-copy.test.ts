import { describe, expect, it } from "vitest";
import { PUBLIC_TOOL_SYNC_CRAWL_BUDGET } from "@sf/sources/crawl-public-preview";
import {
  elapsedLabel,
  pagesCrawledLabel,
  progressAnnouncement,
  progressCopy,
  progressCopyLocale,
  requestsSentLabel,
} from "./seo-audit-progress-copy.ts";

const LOCALES = ["en", "zh"] as const;

describe("progressCopyLocale", () => {
  it("narrows to the two shipped locales", () => {
    expect(progressCopyLocale("zh")).toBe("zh");
    expect(progressCopyLocale("en")).toBe("en");
    expect(progressCopyLocale("de")).toBe("en");
  });
});

/**
 * This is the figure the launch gate asked for, and it is the crawl engine's
 * own collected-page count — the same number the finished report states as
 * "Pages inspected". It may never be phrased as anything else.
 */
describe("pagesCrawledLabel", () => {
  it("says no page has been collected rather than showing a bare zero", () => {
    expect(pagesCrawledLabel(0, "en")).toBe("No page crawled yet");
    expect(pagesCrawledLabel(0, "zh")).toBe("尚未抓取到任何页面");
  });

  it("agrees in number in English", () => {
    expect(pagesCrawledLabel(1, "en")).toBe("1 page crawled so far");
    expect(pagesCrawledLabel(12, "en")).toBe("12 pages crawled so far");
  });

  it("spaces the numeral in Chinese", () => {
    expect(pagesCrawledLabel(1, "zh")).toBe("已抓取 1 个页面");
    expect(pagesCrawledLabel(12, "zh")).toBe("已抓取 12 个页面");
  });
});

describe("requestsSentLabel", () => {
  /**
   * Requests are the secondary figure and are labelled as requests, never as
   * pages: they include robots.txt, every sitemap document and every redirect
   * hop, so they run strictly ahead of the page count.
   */
  it.each(LOCALES)("names the quantity for %s readers", (locale) => {
    const label = requestsSentLabel(37, locale);
    expect(label).toMatch(locale === "en" ? /requests/ : /请求/);
    expect(label).not.toMatch(locale === "en" ? /page/i : /页面/);
  });

  it("agrees in number in English", () => {
    expect(requestsSentLabel(0, "en")).toBe("No request sent by the crawl yet");
    expect(requestsSentLabel(1, "en")).toBe("1 request sent by the crawl");
    expect(requestsSentLabel(37, "en")).toBe("37 requests sent by the crawl");
  });

  it("spaces the numeral in Chinese", () => {
    expect(requestsSentLabel(0, "zh")).toBe("本次抓取尚未发出请求");
    expect(requestsSentLabel(1, "zh")).toBe("本次抓取已发出 1 个请求");
    expect(requestsSentLabel(37, "zh")).toBe("本次抓取已发出 37 个请求");
  });
});

describe("elapsedLabel", () => {
  it.each([
    [0, "0s elapsed", "已用 0 秒"],
    [1_400, "1s elapsed", "已用 1 秒"],
    [59_999, "59s elapsed", "已用 59 秒"],
    [60_000, "1m 0s elapsed", "已用 1 分 0 秒"],
    [154_000, "2m 34s elapsed", "已用 2 分 34 秒"],
  ])("renders %sms in both locales", (elapsedMs, en, zh) => {
    expect(elapsedLabel(elapsedMs, "en")).toBe(en);
    expect(elapsedLabel(elapsedMs, "zh")).toBe(zh);
  });

  it("never runs backwards past zero on a clock adjustment", () => {
    expect(elapsedLabel(-5_000, "en")).toBe("0s elapsed");
    expect(elapsedLabel(Number.NaN, "zh")).toBe("已用 0 秒");
  });
});

/**
 * The panel sits inside one polite live region and the crawl moves several
 * times a second, so the visible readout is hidden from assistive technology
 * and this sentence is announced on a sampled cadence instead. It carries the
 * page figure, which is the one that answers "is it getting anywhere".
 */
describe("progressAnnouncement", () => {
  it("states the page count and the elapsed time in English", () => {
    expect(
      progressAnnouncement(
        {
          pagesCrawled: 12,
          requestsSent: 40,
          elapsedMs: 120_000,
          phase: "crawl",
        },
        "en",
      ),
    ).toBe("Crawl in progress. 12 pages crawled so far. 2m 0s elapsed.");
  });

  it("states the page count and the elapsed time in Chinese", () => {
    expect(
      progressAnnouncement(
        {
          pagesCrawled: 12,
          requestsSent: 40,
          elapsedMs: 120_000,
          phase: "crawl",
        },
        "zh",
      ),
    ).toBe("抓取进行中。已抓取 12 个页面。已用 2 分 0 秒。");
  });

  it.each(LOCALES)("announces the zero state for %s readers", (locale) => {
    const announcement = progressAnnouncement(
      { pagesCrawled: 0, requestsSent: 3, elapsedMs: 4_000, phase: "crawl" },
      locale,
    );
    expect(announcement).toContain(pagesCrawledLabel(0, locale));
  });

  it.each(LOCALES)(
    "announces the report phase to %s readers without claiming a crawl",
    (locale) => {
      const status = {
        pagesCrawled: 12,
        requestsSent: 40,
        elapsedMs: 250_000,
      } as const;
      const announcement = progressAnnouncement(
        { ...status, phase: "report" },
        locale,
      );

      expect(announcement).toContain(progressCopy(locale).reportHeading);
      expect(announcement).not.toContain(progressCopy(locale).heading);
      expect(announcement).toContain(pagesCrawledLabel(12, locale, "report"));
    },
  );
});

/**
 * `crawlSite` returning is not the end of the request. The report is built
 * over up to 2,000 pages, serialized, and written to the shared cache after
 * that, and for the whole of that window the panel used to say "Crawl in
 * progress" over a page count that had stopped moving and a clock that had
 * not — including past the four minutes the same panel quotes as the crawl's
 * limit. The copy for that window has to describe that window.
 */
describe("the report-building phase", () => {
  it.each(LOCALES)("stops asserting a crawl to %s readers", (locale) => {
    const copy = progressCopy(locale);

    expect(copy.reportHeading).not.toBe(copy.heading);
    expect(copy.reportHeading).toMatch(
      locale === "en" ? /finished/i : /已结束/,
    );
    expect(copy.reportHeading).toMatch(locale === "en" ? /report/i : /报告/);
  });

  it.each(LOCALES)(
    "tells %s readers the site is no longer being fetched",
    (locale) => {
      const reportNote = progressCopy(locale).reportNote;

      expect(reportNote).toMatch(
        locale === "en" ? /no longer|nothing more/i : /不再/,
      );
      // The two things on screen that look wrong in this window, named.
      expect(reportNote).toMatch(locale === "en" ? /page count/i : /页面数/);
      expect(reportNote).toMatch(locale === "en" ? /clock|elapsed/i : /用时/);
    },
  );

  it("counts the pages as final rather than as a running total", () => {
    expect(pagesCrawledLabel(12, "en", "report")).toBe("12 pages crawled");
    expect(pagesCrawledLabel(1, "en", "report")).toBe("1 page crawled");
    expect(pagesCrawledLabel(12, "zh", "report")).toBe("共抓取 12 个页面");
  });

  it.each(LOCALES)(
    "keeps the crawl phrasing for %s readers by default",
    (locale) => {
      expect(pagesCrawledLabel(12, locale)).toBe(
        pagesCrawledLabel(12, locale, "crawl"),
      );
    },
  );
});

describe("the progress panel copy", () => {
  /**
   * Two figures are on screen. The note is what keeps them from being read as
   * one: the page count is the report's own, and requests run ahead of it
   * because they include robots.txt, sitemap documents and redirect hops.
   */
  it.each(LOCALES)("tells %s readers which figure is which", (locale) => {
    const note = progressCopy(locale).note;
    expect(note).toMatch(locale === "en" ? /Pages inspected/ : /已检查页面/);
    expect(note).toMatch(/robots\.txt/);
    expect(note).toMatch(locale === "en" ? /redirect/i : /重定向/);
  });

  it.each(LOCALES)("denies a percentage to %s readers", (locale) => {
    const noTotal = progressCopy(locale).noTotal;
    expect(noTotal).toMatch(
      locale === "en" ? /no percentage/i : /不显示完成百分比/,
    );
  });

  /**
   * The site's page count is unknowable before the crawl ends, so any
   * denominator, bar, ETA, or remaining count would be invented. The word
   * "percentage" is allowed only in the sentence that refuses to show one,
   * which is why this bans the figure rather than the vocabulary.
   */
  it.each(LOCALES)("shows %s readers no invented figure", (locale) => {
    const text = Object.values(progressCopy(locale)).join(" ");
    expect(text).not.toContain("%");
    expect(text).not.toMatch(/\bETA\b/i);
    for (const banned of [
      "estimat",
      "remaining",
      "about to finish",
      "预计",
      "剩余",
      "大约还",
      "还需",
    ]) {
      expect(text.toLowerCase(), `${locale} promises: ${banned}`).not.toContain(
        banned.toLowerCase(),
      );
    }
  });

  /**
   * The four minutes quoted to the reader is the engine's wall clock, not a
   * number someone typed. If the budget moves, this fails instead of the copy
   * quietly becoming false.
   */
  it("quotes the wall-clock budget the engine actually enforces", () => {
    expect(PUBLIC_TOOL_SYNC_CRAWL_BUDGET.maxWallClockMs).toBe(240_000);
    expect(progressCopy("en").noTotal).toContain("four minutes");
    expect(progressCopy("zh").noTotal).toContain("四分钟");
  });

  /**
   * The 240-second budget starts inside the engine — after canonical entry
   * resolution with its own 15-second timeout, after two gate quota
   * round-trips and the cache probe — while the elapsed line starts before
   * `fetch()`. On a max-budget run the panel therefore shows more than four
   * minutes, so the sentence has to attribute the limit to the crawl and say
   * the displayed time measures more than the crawl.
   */
  it.each(LOCALES)(
    "does not tell %s readers the displayed clock stops at four minutes",
    (locale) => {
      const noTotal = progressCopy(locale).noTotal;
      expect(noTotal).toMatch(locale === "en" ? /crawl itself/i : /抓取本身/);
      expect(noTotal).toMatch(
        locale === "en" ? /elapsed time above/i : /上面的用时/,
      );
    },
  );

  it.each(LOCALES)("gives %s readers a heading", (locale) => {
    expect(progressCopy(locale).heading.length).toBeGreaterThan(0);
  });

  /**
   * The clock overruns the crawl at both ends: it starts before the crawl does
   * and keeps running while the report is built and stored afterwards. Saying
   * only the first half left the second half looking like a stuck page.
   */
  it.each(LOCALES)(
    "tells %s readers the clock runs until the report is ready",
    (locale) => {
      expect(progressCopy(locale).noTotal).toMatch(
        locale === "en" ? /until the report/i : /报告/,
      );
    },
  );

  it("punctuates the Chinese copy full-width", () => {
    const text = [
      ...Object.values(progressCopy("zh")),
      pagesCrawledLabel(0, "zh"),
      pagesCrawledLabel(3, "zh"),
      pagesCrawledLabel(3, "zh", "report"),
      requestsSentLabel(0, "zh"),
      requestsSentLabel(3, "zh"),
      progressAnnouncement(
        { pagesCrawled: 3, requestsSent: 9, elapsedMs: 1_000, phase: "crawl" },
        "zh",
      ),
      progressAnnouncement(
        { pagesCrawled: 3, requestsSent: 9, elapsedMs: 1_000, phase: "report" },
        "zh",
      ),
    ].join(" ");
    expect(text).not.toMatch(/[一-鿿], /);
    expect(text).not.toMatch(/[一-鿿]\. /);
    expect(text).not.toMatch(/[一-鿿][,.]$/);
  });
});
