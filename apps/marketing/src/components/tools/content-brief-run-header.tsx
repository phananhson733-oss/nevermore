// @input  -- one ContentBrief's run meta and the tool translator
// @output -- the run mode badge, capture time, elapsed vs budget, model id and temperature
// @pos    -- first card of the content brief result; the only place run.mode is explained

import type { ContentBrief } from "@sf/public-tools/content-brief/contract";

import {
  BADGE,
  BODY_TEXT,
  CARD,
  MONO_FIGURE,
  PILL,
  collectedTime,
  modeTone,
  seconds,
  translated,
  type Translate,
} from "./content-brief-results-shared";

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
    <section data-run-header data-run-mode={run.mode} className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {t("run.eyebrow")}
          </div>
          <h3 className="mt-2 text-[20px] font-semibold tracking-[-0.03em] text-text-dark-primary">
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
        {translated(t, `modeBody.${run.mode}`)}
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cell label={t("run.collectedAt")}>
          <span className={MONO_FIGURE}>
            {collectedTime(run.collected_at, locale)}
          </span>
        </Cell>
        <Cell label={t("run.title")}>
          <span data-run-elapsed className={MONO_FIGURE}>
            {t("run.elapsed", {
              elapsed: seconds(run.elapsed_ms),
              budget: seconds(run.budget_ms),
            })}
          </span>
        </Cell>
        <Cell label={t("run.model")}>
          {modelId === null ? (
            <span className={BODY_TEXT}>{t("run.modelNone")}</span>
          ) : (
            <span
              className={`${MONO_FIGURE} flex flex-wrap items-baseline gap-x-2`}
            >
              <span data-model-id>{modelId}</span>
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
    </section>
  );
}
