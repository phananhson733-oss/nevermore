"use client";
// @input -- observed proportions and canonical URL evidence
// @output -- unit-aware values and safe evidence links using Signal Console tokens
// @pos -- shared presentational primitives; no statistical recomputation
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { describeProportion, normalCdf, Z95 } from "../../../lib/geo-tools/stats.ts";
import type { VisibilityProportion, VisibilityRunStatus } from "../../../lib/geo-tools/visibility-contract.ts";

export const PANEL = "min-w-0 border border-brand-border-card bg-brand-panel p-5 sm:p-6";
export const NOTE = "text-xs leading-relaxed text-text-dark-secondary";
export const CELL = "px-3 py-4 text-left align-top text-sm text-text-dark-primary first:pl-0 last:pr-0";
export const HEAD = "px-3 py-3 text-left text-xs font-normal text-text-dark-secondary first:pl-0 last:pr-0";
export const ACTION = "inline-flex min-h-10 items-center justify-center gap-2 border border-brand-border-strong bg-brand-panel px-3 py-2 text-sm text-text-dark-primary transition-colors hover:bg-brand-panel-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent-text disabled:opacity-50";
export const SUMMARY = "cursor-pointer text-sm text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent-text";

export function SectionTitle({ title, note, count }: { readonly title: string; readonly note?: string; readonly count?: number }) {
  return <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
    <div><h3 className="text-base font-semibold text-brand-accent-text">{title}</h3>{note && <p className={`mt-2 max-w-3xl ${NOTE}`}>{note}</p>}</div>
    {count !== undefined && <span className="border border-brand-border-card px-2 py-1 font-mono text-xs text-text-dark-secondary">{count}</span>}
  </div>;
}

export function RunStatus({ status }: { readonly status: VisibilityRunStatus }) {
  const t = useTranslations("tools.aiVisibility.report");
  return <span className={`inline-flex items-center gap-2 border px-2.5 py-1 font-mono text-xs ${status === "ok" ? "border-brand-accent-text/30 text-brand-accent-text" : "border-brand-border-strong text-text-dark-primary"}`}>
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status === "ok" ? "bg-brand-accent-text" : "bg-current"}`} />
    {t(status === "ok" ? "complete" : status)}
  </span>;
}

/** Only the existing statistical formatter may decide when a measured zero is printable. */
export function Rate({ proportion, unit, prominent = false }: { readonly proportion: VisibilityProportion; readonly unit: "questions" | "answers"; readonly prominent?: boolean }) {
  const t = useTranslations("tools.aiVisibility.report");
  const description = describeProportion({ ...proportion, level: 2 * normalCdf(Z95) - 1 });
  const value = description.kind === "unavailable" ? t("unavailable") : description.kind === "unobserved" ? t("unobserved") : description.kind === "zero" ? t("zero") : `${description.percent}%`;
  const interval = description.kind === "unobserved" || description.kind === "zero" ? t("upperBound", { hi: description.hiPercent }) : description.kind === "observed" ? t("interval", { lo: description.loPercent, hi: description.hiPercent }) : null;
  return <div data-rate-unit={unit}>
    <p className={`${prominent ? description.kind === "unavailable" || description.kind === "unobserved" ? "text-2xl" : "text-[32px]" : "text-sm"} font-mono font-semibold leading-tight tabular-nums text-text-dark-primary`}>{value}</p>
    {description.kind !== "unavailable" && <p className={`mt-2 font-mono ${NOTE}`}>{t(unit === "questions" ? "questionCount" : "answerCount", { successes: proportion.successes, trials: proportion.trials })}</p>}
    {interval && <p className={`mt-1 ${NOTE}`}>{interval}</p>}
  </div>;
}

export function EvidenceLinks({ urls }: { readonly urls: readonly string[] }) {
  return <ul className="grid min-w-0 gap-2">{urls.flatMap((raw) => {
    try {
      const url = new URL(raw);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
      const label = `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
      return [<li key={raw} className="min-w-0"><a href={url.href} title={url.href} target="_blank" rel="noopener noreferrer" className="inline-block max-w-full break-all text-sm text-brand-accent-text underline decoration-brand-accent-text/40 underline-offset-4 hover:decoration-brand-accent-text">{label}</a></li>];
    } catch { return []; }
  })}</ul>;
}

export function TableScroll({ children }: { readonly children: ReactNode }) { return <div className="overflow-x-auto overscroll-x-contain">{children}</div>; }
export function formatMoment(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}
