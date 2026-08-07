// @input  -- locale, public SEO-audit API, and consent-gated event tracker
// @output -- interactive audit states plus tool_start/tool_complete analytics
// @pos    -- primary client surface for /[locale]/tools/seo-audit
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ScanSearch } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SeoAuditReport } from "@sf/public-tools";
import { trackMarketingEvent } from "@/components/layout/google-analytics";
import {
  readSeoAuditStream,
  type SeoAuditStreamEvent,
} from "../../lib/tools/seo-audit-stream";
import { SeoAuditResults } from "./seo-audit-results";
import { SeoAuditProgressPanel } from "./seo-audit-progress-panel";
import {
  progressCopyLocale,
  type SeoAuditProgressPhase,
} from "./seo-audit-progress-copy";

interface SeoAuditToolProps {
  readonly locale: string;
  /**
   * `panel` 自带面板外框，给独立工具页用；`bare` 交给外层提供外框，给首页那种
   * 已经处在一张卡片里的嵌入位置用——否则两处各套一层会出现嵌套双描边。
   */
  readonly surface?: "panel" | "bare";
}

/**
 * A monotonic reading, because the wall clock is not one: an NTP step
 * backwards mid-crawl makes `Date.now()` differences negative, which the label
 * clamps to "0s elapsed" and then holds frozen for the length of the
 * adjustment.
 */
function monotonicNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** What the crawl last reported about itself. Never advanced by this component. */
interface CrawlProgress {
  readonly pagesCrawled: number;
  readonly requestsSent: number;
}

/** Start and elapsed live together so one can never be reset without the other. */
interface RunClock {
  readonly startedAt: number;
  readonly elapsedMs: number;
}

export function SeoAuditTool({ locale, surface = "panel" }: SeoAuditToolProps) {
  const t = useTranslations("tools.seoAudit");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [report, setReport] = useState<SeoAuditReport | null>(null);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  /**
   * Which part of the run is happening, as reported by the server. It is the
   * only side that knows when the crawl returned; from here the two windows
   * look identical, because in both of them the page count sits still.
   */
  const [phase, setPhase] = useState<SeoAuditProgressPhase>("crawl");
  const [clock, setClock] = useState<RunClock | null>(null);
  const startedAt = clock?.startedAt ?? null;

  /**
   * Elapsed time is measured here rather than sent by the server, because it
   * is a real local fact — how long this request has been in flight — and two
   * elapsed numbers would invite a blended one. It stops the moment the run
   * ends, so it can never keep counting past an answer.
   */
  useEffect(() => {
    if (startedAt === null) return;
    const ticker = setInterval(() => {
      setClock((current) =>
        current === null || current.startedAt !== startedAt
          ? current
          : { startedAt, elapsedMs: monotonicNow() - startedAt },
      );
    }, 1_000);
    return () => clearInterval(ticker);
  }, [startedAt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    trackMarketingEvent("tool_start", { tool_name: "seo_audit" });
    setLoading(true);
    setErrorCode(null);
    setReport(null);
    setProgress(null);
    setPhase("crawl");
    // Reset here rather than in the ticker effect: an effect runs after paint,
    // so a second run would paint the first run's elapsed time once.
    setClock({ startedAt: monotonicNow(), elapsedMs: 0 });
    try {
      const response = await fetch("/api/tools/seo-audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Opt into the progress stream. Without this header the endpoint
          // returns the same single JSON object it always has, which the same
          // reader parses, so a client/server version skew is harmless.
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ url }),
      });

      const terminal: SeoAuditStreamEvent[] = [];
      await readSeoAuditStream(response, (streamEvent) => {
        if (streamEvent.kind === "progress") {
          setProgress({
            pagesCrawled: streamEvent.pagesCrawled,
            requestsSent: streamEvent.requestsSent,
          });
          return;
        }
        if (streamEvent.kind === "stage") {
          // The crawl is over. The figures on screen are the crawl's final
          // ones from here on, and nothing more is being fetched from the site.
          setPhase("report");
          return;
        }
        terminal.push(streamEvent);
      });

      const answer = terminal.at(-1);
      if (answer?.kind !== "result") {
        setErrorCode(answer?.kind === "error" ? answer.code : "unknown");
        return;
      }
      setReport(answer.payload.result);
      trackMarketingEvent("tool_complete", { tool_name: "seo_audit" });
    } catch {
      setErrorCode("unknown");
    } finally {
      setLoading(false);
      setClock(null);
      setProgress(null);
      setPhase("crawl");
    }
  }

  return (
    <section
      id="seo-audit-tool"
      data-locale={locale}
      className="scroll-mt-8 space-y-5"
      aria-busy={loading}
      aria-live="polite"
    >
      <div
        className={
          surface === "panel"
            ? "border-brand-border-card bg-brand-panel rounded-[16px] border p-5 md:p-7"
            : ""
        }
      >
        <form
          onSubmit={handleSubmit}
          className="grid gap-2.5 md:grid-cols-[1fr_auto] md:items-end"
        >
          <label className="block">
            <span
              id="seo-audit-url-label"
              className="mb-2 block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase"
            >
              {t("formLabel")}
            </span>
            <span className="flex h-12.5 items-center gap-2.5 rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 transition-colors focus-within:border-brand-accent/70">
              <ScanSearch
                aria-hidden="true"
                className="size-[15px] shrink-0 text-brand-accent"
              />
              <input
                id="seo-audit-url"
                type="text"
                inputMode="url"
                autoComplete="url"
                required
                maxLength={2048}
                aria-invalid={Boolean(errorCode)}
                aria-labelledby="seo-audit-url-label"
                aria-describedby={
                  errorCode
                    ? "seo-audit-scope seo-audit-error"
                    : "seo-audit-scope"
                }
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("placeholder")}
                className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-5.5 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta disabled:cursor-wait disabled:opacity-70 disabled:shadow-none"
          >
            {loading ? t("running") : t("submit")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </form>
      </div>
      {/* Only once the response has reported a crawl. A cache hit and every
          gate refusal send no progress line because they run no crawl, and
          this panel asserts one is running. It is destroyed on completion or
          error, so it can never narrate a run that already ended, and once the
          server says the crawl returned it stops claiming one is running. The
          section is already one polite live region; a nested one would
          double-announce. */}
      {loading && progress !== null ? (
        <SeoAuditProgressPanel
          pagesCrawled={progress.pagesCrawled}
          requestsSent={progress.requestsSent}
          elapsedMs={clock?.elapsedMs ?? 0}
          locale={progressCopyLocale(locale)}
          phase={phase}
        />
      ) : null}
      {errorCode ? (
        <p
          id="seo-audit-error"
          role="alert"
          className="rounded-[10px] border border-brand-error/25 bg-brand-error/[0.08] px-4 py-3 text-[13px] text-brand-error"
        >
          {t(
            `errors.${
              [
                "invalid_url",
                "invalid_request",
                "payload_too_large",
                "unsupported_media_type",
                "scan_failed",
                "scan_timeout",
                "scan_in_progress",
                "rate_limited",
                "target_busy",
                "quota_unavailable",
                "robots_disallowed",
                "robots_unreachable",
              ].includes(errorCode)
                ? errorCode
                : "unknown"
            }`,
          )}
        </p>
      ) : null}
      <p
        id="seo-audit-scope"
        className="text-[12.5px] leading-relaxed text-text-dark-secondary"
      >
        {t("scopeShort")}
      </p>
      {report ? <SeoAuditResults report={report} locale={locale} /> : null}
    </section>
  );
}
