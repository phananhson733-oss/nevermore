// @input  -- locale, public SEO-audit API, and consent-gated event tracker
// @output -- interactive audit states plus tool_start/tool_complete analytics
// @pos    -- primary client surface for /[locale]/tools/seo-audit
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, ScanSearch } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SeoAuditPayload, SeoAuditReport } from "@sf/public-tools";
import { trackMarketingEvent } from "@/components/layout/google-analytics";
import { SeoAuditResults } from "./seo-audit-results";

interface SeoAuditToolProps {
  readonly locale: string;
  /**
   * `panel` 自带面板外框，给独立工具页用；`bare` 交给外层提供外框，给首页那种
   * 已经处在一张卡片里的嵌入位置用——否则两处各套一层会出现嵌套双描边。
   */
  readonly surface?: "panel" | "bare";
}

export function SeoAuditTool({ locale, surface = "panel" }: SeoAuditToolProps) {
  const t = useTranslations("tools.seoAudit");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [report, setReport] = useState<SeoAuditReport | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    trackMarketingEvent("tool_start", { tool_name: "seo_audit" });
    setLoading(true);
    setErrorCode(null);
    setReport(null);
    try {
      const response = await fetch("/api/tools/seo-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as {
        data?: SeoAuditPayload;
        error?: { code?: string };
      };
      if (!response.ok || !payload.data) {
        setErrorCode(payload.error?.code ?? "unknown");
        return;
      }
      setReport(payload.data.result);
      trackMarketingEvent("tool_complete", { tool_name: "seo_audit" });
    } catch {
      setErrorCode("unknown");
    } finally {
      setLoading(false);
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
