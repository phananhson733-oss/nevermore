// @input  -- the crawl's observed page and request counts and the client's elapsed clock
// @output -- a failing test when the in-flight panel invents a figure or floods a reader
// @pos    -- the guard on what the reader is told while a crawl is running

/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeoAuditProgressPanel } from "./seo-audit-progress-panel.tsx";
import {
  progressAnnouncement,
  progressCopy,
} from "./seo-audit-progress-copy.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function render(props: {
  readonly pagesCrawled: number;
  readonly requestsSent: number;
  readonly elapsedMs: number;
  readonly locale: "en" | "zh";
  readonly phase?: "crawl" | "report";
}): string {
  const { phase = "crawl", ...rest } = props;
  return renderToStaticMarkup(
    <SeoAuditProgressPanel {...rest} phase={phase} />,
  );
}

describe("SeoAuditProgressPanel", () => {
  /**
   * The launch gate asked for pages crawled, and this is the crawl engine's own
   * collected-page count: the same quantity the finished report states as
   * "Pages inspected". Requests are kept as a labelled secondary detail
   * because they are the only thing moving while robots.txt and the sitemap
   * documents are being read.
   */
  it("leads with the page count and labels the request count in English", () => {
    const markup = render({
      pagesCrawled: 12,
      requestsSent: 37,
      elapsedMs: 154_000,
      locale: "en",
    });

    expect(markup).toContain("12 pages crawled so far");
    expect(markup).toContain("37 requests sent by the crawl");
    expect(markup).toContain("2m 34s elapsed");
    expect(markup).toContain(progressCopy("en").heading);
    expect(markup).toContain(progressCopy("en").note);
    // The apostrophe in "site's" arrives HTML-escaped, so match the tail.
    expect(markup).toContain("there is no percentage to show");
    expect(markup).toContain("The crawl itself stops after four minutes");
    expect(markup.indexOf("12 pages crawled so far")).toBeLessThan(
      markup.indexOf("37 requests sent by the crawl"),
    );
  });

  it("leads with the page count and labels the request count in Chinese", () => {
    const markup = render({
      pagesCrawled: 12,
      requestsSent: 37,
      elapsedMs: 154_000,
      locale: "zh",
    });

    expect(markup).toContain("已抓取 12 个页面");
    expect(markup).toContain("本次抓取已发出 37 个请求");
    expect(markup).toContain("已用 2 分 34 秒");
    expect(markup).toContain(progressCopy("zh").heading);
  });

  /**
   * A crawl that has sent requests but collected no page yet is a real state,
   * and saying so is the only honest thing to render.
   */
  it.each(["en", "zh"] as const)(
    "says no page has been collected yet in %s",
    (locale) => {
      const markup = render({
        pagesCrawled: 0,
        requestsSent: 2,
        elapsedMs: 3_000,
        locale,
      });

      const expected =
        locale === "en" ? "No page crawled yet" : "尚未抓取到任何页面";
      expect(markup).toContain(expected);
    },
  );

  /**
   * The measured 2.5-minute production run showed no progress element, no
   * spinner and no animation at all, which read as a hung page. An
   * indeterminate spinner carries no number, so it cannot be wrong.
   */
  it("animates without claiming a completion fraction", () => {
    const markup = render({
      pagesCrawled: 1,
      requestsSent: 4,
      elapsedMs: 9_000,
      locale: "en",
    });

    expect(markup).toContain("animate-spin");
    expect(markup).not.toContain("<progress");
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain("aria-valuenow");
  });

  /**
   * This panel sits inside a polite live region and the crawl advances about
   * four times a second for up to four minutes, so an announceable readout
   * queues roughly a thousand utterances. The moving figures are therefore
   * hidden from assistive technology, which gets one sampled sentence instead.
   */
  it("keeps every moving figure out of the accessibility tree", () => {
    const markup = render({
      pagesCrawled: 3,
      requestsSent: 9,
      elapsedMs: 9_000,
      locale: "en",
    });
    const readoutStart = markup.indexOf(
      '<div aria-hidden="true" data-testid="seo-audit-progress-readout">',
    );
    const readout = markup.slice(
      readoutStart,
      markup.indexOf('data-testid="seo-audit-progress-status"'),
    );

    expect(readoutStart).toBeGreaterThan(-1);
    for (const moving of [
      "3 pages crawled so far",
      "9 requests sent by the crawl",
      "9s elapsed",
    ]) {
      expect(readout).toContain(moving);
    }
  });

  it.each(["en", "zh"] as const)(
    "announces one sampled sentence to %s readers",
    (locale) => {
      const status = {
        pagesCrawled: 3,
        requestsSent: 9,
        elapsedMs: 9_000,
        phase: "crawl",
      } as const;
      const markup = render({ ...status, locale });

      expect(markup).toContain(
        `<p class="sr-only" data-testid="seo-audit-progress-status">${progressAnnouncement(status, locale)}</p>`,
      );
    },
  );

  /**
   * `crawlSite` returning is not the end of the request: the report is built,
   * serialized and cached afterwards, and the panel stayed on "Crawl in
   * progress" for all of it — over a page count that had stopped moving and a
   * clock ticking past the four minutes this same panel quotes as the crawl's
   * limit. The panel may only assert a crawl while one is running.
   */
  it("stops asserting a crawl once the crawl is over", () => {
    const markup = render({
      pagesCrawled: 12,
      requestsSent: 37,
      elapsedMs: 250_000,
      locale: "en",
      phase: "report",
    });

    expect(markup).toContain(progressCopy("en").reportHeading);
    expect(markup).not.toContain(progressCopy("en").heading);
    expect(markup).toContain(progressCopy("en").reportNote);
    // The count is final now, so it is no longer phrased as a running total.
    expect(markup).toContain("12 pages crawled");
    expect(markup).not.toContain("12 pages crawled so far");
    // And the caveat about a four-minute crawl is not the caveat for a window
    // in which the crawl has already stopped.
    expect(markup).not.toContain("The crawl itself stops after four minutes");
  });

  it("announces the report phase in Chinese", () => {
    const status = {
      pagesCrawled: 12,
      requestsSent: 37,
      elapsedMs: 250_000,
      phase: "report",
    } as const;
    const markup = render({ ...status, locale: "zh" });

    expect(markup).toContain("抓取已结束，正在生成报告");
    expect(markup).toContain("共抓取 12 个页面");
    expect(markup).toContain(
      `<p class="sr-only" data-testid="seo-audit-progress-status">${progressAnnouncement(status, "zh")}</p>`,
    );
  });

  /**
   * The caveats are static: they are announced once when the panel appears and
   * never again, so they belong in the live region rather than behind
   * aria-hidden with the moving figures.
   */
  it("leaves the honesty caveats announceable", () => {
    const markup = render({
      pagesCrawled: 3,
      requestsSent: 9,
      elapsedMs: 9_000,
      locale: "en",
    });
    const afterReadout = markup.slice(
      markup.indexOf('data-testid="seo-audit-progress-status"'),
    );

    expect(afterReadout).toContain(progressCopy("en").note);
    expect(afterReadout).toContain("there is no percentage to show");
    expect(afterReadout).not.toContain('aria-hidden="true"');
  });
});

/**
 * The sampled sentence is the only thing assistive technology gets, and its
 * 30-second cadence exists for the figures, which move several times a second.
 * The phase is not one of those: it changes once per run, and on that cadence a
 * screen-reader user is told "Crawl in progress" for up to half a minute after
 * the crawl ended — through the whole window the visible panel spent saying the
 * opposite.
 */
describe("SeoAuditProgressPanel, announced across a phase change", () => {
  const status = {
    pagesCrawled: 3,
    requestsSent: 37,
    elapsedMs: 9_000,
  } as const;

  it("announces the end of the crawl when it happens, not at the next sample", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const announced = (): string =>
      container.querySelector('[data-testid="seo-audit-progress-status"]')
        ?.textContent ?? "";

    try {
      act(() =>
        root.render(
          <SeoAuditProgressPanel {...status} locale="en" phase="crawl" />,
        ),
      );
      expect(announced()).toBe(
        progressAnnouncement({ ...status, phase: "crawl" }, "en"),
      );

      act(() =>
        root.render(
          <SeoAuditProgressPanel {...status} locale="en" phase="report" />,
        ),
      );
      expect(announced()).toBe(
        progressAnnouncement({ ...status, phase: "report" }, "en"),
      );
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  /**
   * And the figures keep their cadence: a page count that re-announced on every
   * change would queue roughly a thousand utterances over one crawl.
   */
  it("still samples the moving figures rather than announcing each one", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const announced = (): string =>
      container.querySelector('[data-testid="seo-audit-progress-status"]')
        ?.textContent ?? "";

    try {
      act(() =>
        root.render(
          <SeoAuditProgressPanel {...status} locale="en" phase="crawl" />,
        ),
      );
      const first = announced();

      act(() =>
        root.render(
          <SeoAuditProgressPanel
            {...status}
            pagesCrawled={4}
            locale="en"
            phase="crawl"
          />,
        ),
      );

      expect(announced()).toBe(first);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
