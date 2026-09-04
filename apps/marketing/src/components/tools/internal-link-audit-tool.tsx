// @input  -- locale, visitor URL, public crawl API, consent-gated event tracker
// @output -- real crawl report with analytics and compact evidence boundaries
// @pos    -- primary client surface for /[locale]/tools/internal-link-audit

"use client";

import type { InternalLinkAuditPayload } from "@sf/public-tools";
import { ArrowRight, Link2, ScanLine } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { type InternalLinkAuditLocale } from "./internal-link-audit-content";
import { retryAfterMessage } from "./internal-link-audit-result-copy";
import { InternalLinkAuditUrlLedger } from "./internal-link-audit-url-ledger";
import { trackMarketingEvent } from "@/components/layout/google-analytics";

type Phase = "idle" | "running" | "result" | "error";

interface InternalLinkAuditToolProps {
  readonly locale: string;
}
const COPY = {
  en: {
    label: "Website URL",
    placeholder: "yourdomain.com",
    start: "Run internal link audit",
    running: "Crawling public static HTML…",
    help: "We start from the submitted public URL, follow same-origin static HTML links, and respect robots.txt. To avoid repeatedly hitting the same site, public crawl facts may be temporarily shared from a server-side cache; no submitter identity or page body is stored.",
    scope:
      "No login required · roughly 950 pages per run · four-minute processing boundary",
    progress: [
      "Checking robots and sitemap",
      "Following same-origin HTML links",
      "Building the page hierarchy",
    ],
    errorInvalid:
      "Enter a publicly reachable HTTP(S) domain. Local, IP-literal, credentialed, and reserved addresses are not accepted.",
    errorRate:
      "This network has run several crawls recently. Each one fetches hundreds of pages from the target site, so there is an hourly ceiling.",
    errorTargetBusy:
      "This site has been crawled several times in the last hour, by you or by someone else. The limit protects the site being audited from repeated automated traffic.",
    errorRobotsDisallowed:
      "This site's robots.txt asks crawlers not to fetch its pages, so nothing was crawled. That is the site owner's choice and says nothing about the site's link structure.",
    errorRobotsUnreachable:
      "This site's robots.txt could not be read, so nothing was crawled. A crawler that cannot read the rules has to assume it is not allowed.",
    errorQuotaUnavailable:
      "Something on our side is down: the service that enforces usage limits is not responding, and this tool will not crawl a site without a working limit in place. This is not about your usage — nothing you did caused it, and nothing has been counted against you.",
    errorProgress:
      "An audit for this browser address is already running. Please wait for it to finish.",
    errorTimeout:
      "The synchronous crawl reached its execution-time boundary before a report could be returned. Large sites may need a future asynchronous scan.",
    errorGeneric:
      "We could not collect a safe public crawl result for that site. Check that it is publicly reachable and try again.",
  },
  zh: {
    label: "网站 URL",
    placeholder: "yourdomain.com",
    start: "开始内链审计",
    running: "正在抓取公开静态 HTML…",
    help: "工具从提交的公开 URL 开始，跟随同源静态 HTML 链接并遵守 robots.txt。为避免短时间内重复抓取同一站点，公开抓取事实可能由服务端临时缓存并共享；不保存提交者身份或页面正文。",
    scope: "无需登录 · 单次约覆盖 950 页 · 四分钟处理边界",
    progress: ["检查 robots 与 Sitemap", "跟随同源 HTML 链接", "生成页面层级"],
    errorInvalid:
      "请输入可公开访问的 HTTP(S) 域名。不接受本地地址、IP 地址、带凭据或保留地址。",
    errorRate:
      "该网络最近已发起多次抓取。每次都会从目标站点获取数百个页面，因此设有每小时上限。",
    errorTargetBusy:
      "这个站点在过去一小时内已被抓取多次（可能来自你，也可能来自其他人）。该限制用于保护被审计的站点免受重复的自动化流量。",
    errorRobotsDisallowed:
      "该站点的 robots.txt 要求爬虫不要抓取其页面，因此没有抓取任何内容。这是站点所有者的选择，与该站的链接结构无关。",
    errorRobotsUnreachable:
      "该站点的 robots.txt 无法读取，因此没有抓取任何内容。读不到规则的爬虫必须假定自己不被允许。",
    errorQuotaUnavailable:
      "这是我们这边的故障：负责执行用量限制的服务没有响应，而这个工具在限制不可用时不会去抓取任何站点。这与你的使用量无关——不是你做了什么导致的，也没有记在你头上。",
    errorProgress: "该浏览器地址已有一次审计正在进行，请等待它完成。",
    errorTimeout:
      "同步抓取在返回报告前触及执行时间边界。大型网站可能需要后续异步扫描版本。",
    errorGeneric:
      "无法为该网站采集安全的公开抓取结果。请确认网站可公开访问后重试。",
  },
} as const;

type ToolCopy = (typeof COPY)[keyof typeof COPY];

function errorMessage(
  code: string,
  copy: ToolCopy,
  locale: InternalLinkAuditLocale,
  retryAfterHeader: string | null,
): string {
  if (code === "invalid_url" || code === "invalid_request")
    return copy.errorInvalid;
  if (code === "rate_limited" || code === "target_busy") {
    const base = code === "target_busy" ? copy.errorTargetBusy : copy.errorRate;
    const retry = retryAfterMessage(retryAfterHeader, locale);
    return retry ? `${base} ${retry}` : base;
  }
  if (code === "quota_unavailable") {
    const retry = retryAfterMessage(retryAfterHeader, locale);
    return retry
      ? `${copy.errorQuotaUnavailable} ${retry}`
      : copy.errorQuotaUnavailable;
  }
  if (code === "robots_disallowed") return copy.errorRobotsDisallowed;
  if (code === "robots_unreachable") return copy.errorRobotsUnreachable;
  if (code === "scan_in_progress") return copy.errorProgress;
  if (code === "scan_timeout") return copy.errorTimeout;
  return copy.errorGeneric;
}

export function InternalLinkAuditTool({
  locale: localeValue,
}: InternalLinkAuditToolProps) {
  const locale: InternalLinkAuditLocale = localeValue === "zh" ? "zh" : "en";
  const copy = COPY[locale];
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState(0);
  const [payload, setPayload] = useState<InternalLinkAuditPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (phase === "result") resultHeadingRef.current?.focus();
  }, [phase]);
  useEffect(() => {
    if (phase !== "running") return;
    const first = window.setTimeout(() => setStage(1), 800);
    const second = window.setTimeout(() => setStage(2), 2200);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [phase]);
  const report = payload?.result ?? null;
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    trackMarketingEvent("tool_start", { tool_name: "internal_link_audit" });
    setError(null);
    setPayload(null);
    setPhase("running");
    setStage(0);
    try {
      const response = await fetch("/api/tools/internal-link-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: InternalLinkAuditPayload;
        error?: { code?: string };
      } | null;
      if (!response.ok || !body?.data) {
        setError(
          errorMessage(
            body?.error?.code ?? "scan_failed",
            copy,
            locale,
            response.headers.get("Retry-After"),
          ),
        );
        setPhase("error");
        return;
      }
      setPayload(body.data);
      setPhase("result");
      trackMarketingEvent("tool_complete", {
        tool_name: "internal_link_audit",
      });
    } catch {
      setError(copy.errorGeneric);
      setPhase("error");
    }
  }
  return (
    <section
      id="internal-link-audit-tool"
      aria-busy={phase === "running"}
      className="scroll-mt-24"
      data-testid="internal-link-audit-tool"
    >
      <div className="relative overflow-hidden rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-7">
        <form
          onSubmit={handleSubmit}
          className="relative grid gap-2.5 md:grid-cols-[1fr_auto] md:items-end"
        >
          <label className="block">
            <span
              id="internal-link-url-label"
              className="mb-2 block font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary"
            >
              {copy.label}
            </span>
            <span className="flex h-12.5 items-center gap-2.5 rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 transition-colors focus-within:border-brand-accent/70">
              <Link2
                aria-hidden="true"
                className="size-[15px] shrink-0 text-brand-accent"
              />
              <input
                id="internal-link-url"
                type="text"
                inputMode="url"
                autoComplete="url"
                required
                maxLength={2048}
                aria-invalid={phase === "error"}
                aria-labelledby="internal-link-url-label"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={copy.placeholder}
                className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={phase === "running"}
            className="inline-flex h-12.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-5.5 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta disabled:cursor-wait disabled:opacity-70 disabled:shadow-none"
          >
            {phase === "running" ? copy.running : copy.start}
            {phase === "running" ? (
              <ScanLine
                aria-hidden="true"
                className="size-4 animate-pulse motion-reduce:animate-none"
              />
            ) : (
              <ArrowRight aria-hidden="true" className="size-4" />
            )}
          </button>
        </form>
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-[10px] border border-brand-error/25 bg-brand-error/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-error"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-4 grid gap-2 border-t border-brand-border pt-4 text-[12.5px] leading-[1.6] text-text-dark-secondary md:grid-cols-2">
          <p>{copy.help}</p>
          <p>{copy.scope}</p>
        </div>
      </div>

      {phase === "running" ? (
        <div
          className="mt-5 rounded-card border border-brand-border-card bg-brand-panel p-5"
          role="status"
          aria-live="polite"
          data-testid="internal-link-progress"
        >
          <div className="mb-4 flex items-center justify-between">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-brand-accent-text">
              {copy.running}
            </p>
            <span className="font-mono text-[10.5px] text-text-dark-secondary">
              0{stage + 1}/03
            </span>
          </div>
          <ol className="grid gap-2 md:grid-cols-3">
            {copy.progress.map((item, index) => (
              <li
                key={item}
                className={`rounded-[10px] border px-3.5 py-3 text-[12.5px] ${
                  index <= stage
                    ? "border-brand-accent/40 bg-brand-accent/[0.08] text-text-dark-primary"
                    : "border-brand-border text-text-dark-secondary"
                }`}
              >
                {item}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {payload && report && phase === "result" ? (
        <InternalLinkAuditUrlLedger
          payload={payload}
          locale={locale}
          headingRef={resultHeadingRef}
        />
      ) : null}
    </section>
  );
}
