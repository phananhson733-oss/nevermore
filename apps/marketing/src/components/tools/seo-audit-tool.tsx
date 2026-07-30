// @input  -- current locale and public /api/tools/seo-audit response
// @output -- interactive URL form and Website Health Map states
// @pos    -- primary client surface for /[locale]/tools/seo-audit
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, ScanSearch } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  SeoAuditPayload,
  SeoAuditReport,
} from "@sf/public-tools";
import { SeoAuditHealthMap } from "./seo-audit-health-map";

interface SeoAuditToolProps {
  readonly locale: string;
}

export function SeoAuditTool({ locale }: SeoAuditToolProps) {
  const t = useTranslations("tools.seoAudit");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [report, setReport] = useState<SeoAuditReport | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      <div className="relative overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718] p-5 md:p-7">
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-brand-accent/10 blur-3xl"
        />
        <form
          onSubmit={handleSubmit}
          className="relative grid gap-3 md:grid-cols-[1fr_auto] md:items-end"
        >
          <label className="block">
            <span
              id="seo-audit-url-label"
              className="mb-2 block text-[12px] font-medium uppercase tracking-[0.14em] text-text-dark-secondary"
            >
              {t("formLabel")}
            </span>
            <span className="flex h-12 items-center gap-3 rounded-xl border border-brand-border/80 bg-brand-bg px-4 focus-within:border-brand-accent/70">
              <ScanSearch
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-brand-accent-text"
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
                className="min-w-0 flex-1 bg-transparent text-[14px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary/60"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent/90 disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? t("running") : t("submit")}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </form>
      </div>
      {errorCode ? (
        <p
          id="seo-audit-error"
          role="alert"
          className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-[13px] text-red-200"
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
              ].includes(errorCode)
                ? errorCode
                : "unknown"
            }`,
          )}
        </p>
      ) : null}
      <p
        id="seo-audit-scope"
        className="text-[12px] leading-relaxed text-text-dark-secondary"
      >
        {t("scopeShort")}
      </p>
      {report ? <SeoAuditHealthMap report={report} /> : null}
    </section>
  );
}
