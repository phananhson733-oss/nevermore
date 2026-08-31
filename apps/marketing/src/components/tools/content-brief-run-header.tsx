// @input  -- one ContentBrief's run meta and the tool translator
// @output -- keyword-first run summary with actual read gaps; exact model metadata in a closed disclosure
// @pos    -- compact opening of the Content Brief editorial result

import type { ContentBrief } from "@sf/public-tools/content-brief/contract";

import {
  BADGE,
  BODY_TEXT,
  MONO_FIGURE,
  PILL,
  collectedTime,
  modeTone,
  reasonCopy,
  seconds,
  translated,
  type Translate,
} from "./content-brief-results-shared";

/** Describe this run's recorded gaps, never an OR-list of hypothetical causes. */
function runSummary(brief: ContentBrief, t: Translate): string {
  const { run } = brief;
  const { serp, crawl, gsc, product_profile: profile, llm } = run.reads;
  const gaps: string[] = [];
  if (serp.status === "partial") {
    gaps.push(`${t("coverage.serp")}: ${t("coverage.serpRows", serp)} · ${t("coverage.serpUnresolved", { count: serp.unresolved })}`);
  }
  if (crawl.status === "partial") {
    gaps.push(`${t("coverage.crawl")}: ${t("coverage.crawlObserved", crawl)} · ${t("coverage.crawlDetail", crawl)}`);
  }
  if (gsc.status === "partial") {
    const parts: string[] = [];
    if (gsc.truncated.length > 0) {
      parts.push(t("coverage.gscTruncated", { dimensions: gsc.truncated.map((dimension) => translated(t, `coverage.gscDimensions.${dimension}`)).join(" · ") }));
    }
    const rows = gsc.unreadable_rows;
    if (rows.query + rows.query_page + rows.page > 0) {
      parts.push(t("coverage.gscUnreadable", { query: rows.query, queryPage: rows.query_page, page: rows.page }));
    }
    if (parts.length === 0) parts.push(t("modes.partial"));
    gaps.push(`${t("coverage.gsc")}: ${parts.join(" · ")}`);
  }
  for (const [name, read] of [["serp", serp], ["crawl", crawl], ["gsc", gsc], ["profile", profile], ["llm", llm]] as const) {
    if (read.status === "unavailable" && read.reason !== "not_requested") {
      gaps.push(`${t(`coverage.${name}`)}: ${reasonCopy(t, "unavailable", read.reason)}`);
    }
  }
  if (run.mode === "unavailable") return `${t("modeBody.unavailable")} ${gaps.join("; ")}`;
  return gaps.length > 0 ? gaps.join("; ") : translated(t, `modeBody.${run.mode}`);
}

function Cell({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Temperature does not lie: the requested value is printed as requested, and
 * the effective value is printed only when the deployment reported one. A
 * deployment-level pin can override the request, so "effective = requested"
 * is never assumed.
 */
function Temperature({
  llm,
  t,
}: {
  readonly llm: ContentBrief["run"]["reads"]["llm"];
  readonly t: Translate;
}) {
  if (llm.status !== "complete") {
    return <span className={BODY_TEXT}>{t("run.modelNone")}</span>;
  }
  return (
    <span className={`${MONO_FIGURE} flex flex-wrap gap-x-2`}>
      <span data-temperature-requested>
        {t("run.temperatureRequested", { value: llm.temperature_requested })}
      </span>
      <span
        data-temperature-effective={
          llm.temperature_effective === null ? "not_reported" : "reported"
        }
        className="text-text-dark-secondary"
      >
        {llm.temperature_effective === null
          ? t("run.temperatureNotReported")
          : t("run.temperatureEffective", { value: llm.temperature_effective })}
      </span>
    </span>
  );
}

export function RunHeader({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const { run } = brief;
  // Present in both branches of LlmReadMeta: a paid call that then failed
  // validation still names the deployment it went to.
  const modelId = run.reads.llm.model_id;
  return (
    <section data-run-header data-brief-header data-run-mode={run.mode} className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {t("run.eyebrow")}
          </div>
          <h3 className="mt-2 text-[24px] leading-[1.2] font-semibold tracking-[-0.03em] text-text-dark-primary sm:text-[26px]">
            {brief.keyword.primary}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className={BADGE}>{brief.keyword.market}</span>
            <span className={BADGE}>{brief.keyword.language}</span>
            {brief.keyword.supporting.map((keyword) => (
              <span key={keyword} className={BADGE}>
                {keyword}
              </span>
            ))}
          </div>
        </div>
        <span data-mode-badge className={`${PILL} ${modeTone(run.mode)}`}>
          {translated(t, `modes.${run.mode}`)}
        </span>
      </div>
      <p data-mode-body className={`mt-3 ${BODY_TEXT}`}>
        {runSummary(brief, t)}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-dark-secondary">
        <span>{t("run.collectedAt")} {collectedTime(run.collected_at, locale)} UTC</span>
        <span data-run-elapsed>
          {t("run.elapsed", {
            elapsed: seconds(run.elapsed_ms),
            budget: seconds(run.budget_ms),
          })}
        </span>
      </div>
      <details data-run-details className="mt-3 border-t border-brand-border-card pt-2">
        <summary className="cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
          {t("run.details")}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Cell label={t("run.model")}>
            {modelId === null ? (
              <span className={BODY_TEXT}>{t("run.modelNone")}</span>
            ) : (
              <span
                className={`${MONO_FIGURE} flex flex-wrap items-baseline gap-x-2`}
              >
                <span data-model-id className="min-w-0 break-all">{modelId}</span>
                <span className="text-[10.5px] text-text-dark-secondary">
                  {t("run.modelReported")}
                </span>
              </span>
            )}
          </Cell>
          <Cell label={t("run.temperature")}>
            <Temperature llm={run.reads.llm} t={t} />
          </Cell>
        </div>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-2 font-mono text-[10.5px] text-text-dark-secondary">
          <span className="uppercase tracking-[0.12em]">
            {t("run.fingerprint")}
          </span>
          <span data-run-fingerprint className="break-all">
            {run.fingerprint}
          </span>
        </div>
      </details>
    </section>
  );
}
