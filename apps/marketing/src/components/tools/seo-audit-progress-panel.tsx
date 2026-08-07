// @input  -- the crawl's last reported page and request counts, plus the caller's elapsed clock
// @output -- the in-flight crawl panel, with no denominator of any kind
// @pos    -- the "it is still working" surface of /[locale]/tools/seo-audit
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useEffect, useRef, useState } from "react";
import {
  elapsedLabel,
  pagesCrawledLabel,
  progressAnnouncement,
  progressCopy,
  requestsSentLabel,
  type SeoAuditProgressLocale,
  type SeoAuditProgressPhase,
} from "./seo-audit-progress-copy";

/**
 * How often the sampled sentence below may change.
 *
 * The crawl advances several times a second for up to four minutes inside a
 * polite live region, so an announceable readout queues roughly a thousand
 * utterances. Sampling is not throttled rendering: the visible figures still
 * move on every update, and an unchanged sentence writes no DOM at all, so it
 * announces nothing.
 */
const ANNOUNCE_INTERVAL_MS = 30_000;

/**
 * The latest value, re-read on a fixed cadence rather than on every change.
 *
 * `now` is for the parts of the sentence that are not figures. A change there
 * is read immediately and restarts the cadence: the cadence exists because the
 * figures move several times a second, and something that happens once per run
 * must not wait up to half a minute to be said. Holding the phase back left a
 * screen-reader user hearing "Crawl in progress" through the whole window in
 * which the visible panel said the crawl had ended.
 */
function useSampled(value: string, intervalMs: number, now: string): string {
  const latest = useRef(value);
  const [sampled, setSampled] = useState(value);

  useEffect(() => {
    latest.current = value;
  }, [value]);

  useEffect(() => {
    setSampled(latest.current);
    const timer = setInterval(() => setSampled(latest.current), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, now]);

  return sampled;
}

interface SeoAuditProgressPanelProps {
  /** The crawl engine's collected-page count, as last reported. */
  readonly pagesCrawled: number;
  /** Wire requests, which run ahead of the page count. */
  readonly requestsSent: number;
  readonly elapsedMs: number;
  readonly locale: SeoAuditProgressLocale;
  /**
   * Required, because every sentence here is a claim about what the server is
   * doing right now and the two windows are not the same claim.
   */
  readonly phase: SeoAuditProgressPhase;
}

/**
 * The site's page count is unknowable before the crawl ends, so this panel has
 * no bar, no percentage, no ETA and no denominator. The only moving figures
 * are two the crawl reported and one the caller measured.
 */
export function SeoAuditProgressPanel({
  pagesCrawled,
  requestsSent,
  elapsedMs,
  locale,
  phase,
}: SeoAuditProgressPanelProps) {
  const copy = progressCopy(locale);
  const announced = useSampled(
    progressAnnouncement(
      { pagesCrawled, requestsSent, elapsedMs, phase },
      locale,
    ),
    ANNOUNCE_INTERVAL_MS,
    phase,
  );
  // Once the crawl has stopped, every line has to describe the window that is
  // actually running: the report being built from the pages already collected.
  const reporting = phase === "report";

  return (
    <div
      data-testid="seo-audit-progress"
      className="border-brand-border-card bg-brand-panel rounded-[12px] border px-4 py-3.5"
    >
      {/* Everything that moves. Assistive technology gets the sampled sentence
          below instead, so a four-minute crawl says a handful of things
          rather than one per update. */}
      <div aria-hidden="true" data-testid="seo-audit-progress-readout">
        <p className="flex items-center gap-2.5 text-[13px] font-semibold text-text-dark-primary">
          <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-brand-accent/25 border-t-brand-accent" />
          {reporting ? copy.reportHeading : copy.heading}
        </p>
        <p className="mt-2 font-mono text-[13px] text-text-dark-primary">
          {pagesCrawledLabel(pagesCrawled, locale, phase)}
        </p>
        <p className="mt-1 font-mono text-[12.5px] text-text-dark-secondary">
          {requestsSentLabel(requestsSent, locale)}
        </p>
        <p className="mt-1 font-mono text-[12.5px] text-text-dark-secondary">
          {elapsedLabel(elapsedMs, locale)}
        </p>
      </div>
      <p className="sr-only" data-testid="seo-audit-progress-status">
        {announced}
      </p>
      <p className="mt-2.5 text-[12.5px] leading-relaxed text-text-dark-secondary">
        {copy.note}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dark-secondary">
        {reporting ? copy.reportNote : copy.noTotal}
      </p>
    </div>
  );
}
