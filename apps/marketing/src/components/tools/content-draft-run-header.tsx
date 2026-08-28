// @input  -- one DraftResult's run meta, its brief reference and the draft translator
// @output -- the run mode badge, generation time, elapsed vs budget, section counts, model id
//            (as reported) and the coverage-check temperature, plus both fingerprints
// @pos    -- first card of the content draft result; the only place run.mode is explained

import type { DraftResult } from "@sf/public-tools/content-brief/contract";

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
  type DraftTranslate,
} from "./content-draft-results-shared";

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
 * The coverage check is the call whose temperature the page reports
 * (handoff §5.4: requested 0, effective only when the deployment says so).
 * "effective = requested" is never assumed.
 */
function Temperature({
  llm,
  t,
}: {
  readonly llm: DraftResult["run"]["reads"]["llm_coverage"];
  readonly t: DraftTranslate;
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

function Fingerprint({
  label,
  value,
  name,
}: {
  readonly label: string;
  readonly value: string;
  readonly name: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[10.5px] text-text-dark-secondary">
      <span className="uppercase tracking-[0.12em]">{label}</span>
      <span data-fingerprint={name} className="break-all">
        {value}
      </span>
    </div>
  );
}

export function DraftRunHeader({
  result,
  locale,
  t,
}: {
  readonly result: DraftResult;
  readonly locale: string;
  readonly t: DraftTranslate;
}) {
  const { run } = result;
  // Present in both branches of LlmAggregateMeta: a paid call that then
  // failed still names the deployment it went to.
  const modelId = run.reads.llm_sections.model_id;
  const sections = run.reads.sections;
  return (
    <section data-draft-run-header data-run-mode={run.mode} className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {t("run.eyebrow")}
          </div>
          <h3 className="mt-2 text-[20px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            {result.brief_ref.keyword}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span data-brief-ref className={BADGE}>
              {t("run.briefRef", { runId: result.brief_ref.run_id })}
            </span>
            {run.reran_from !== null ? (
              <span data-reran-from={run.reran_from} className={BADGE}>
                {t("run.rerunFrom", { runId: run.reran_from })}
              </span>
            ) : null}
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
          <span data-run-elapsed className={`${MONO_FIGURE} block`}>
            {t("run.elapsed", {
              elapsed: seconds(run.elapsed_ms),
              budget: seconds(run.budget_ms),
            })}
          </span>
          <span data-run-sections className={`${BODY_TEXT} font-mono text-[11px]`}>
            {t("run.sections", {
              requested: sections.requested,
              ok: sections.ok,
              failed: sections.failed,
              skipped: sections.skipped,
            })}
          </span>
        </Cell>
        <Cell label={t("run.model")}>
          {modelId === null ? (
            <span className={BODY_TEXT}>{t("run.modelNone")}</span>
          ) : (
            <span className={`${MONO_FIGURE} flex flex-wrap items-baseline gap-x-2`}>
              <span data-model-id>{modelId}</span>
              <span className="text-[10.5px] text-text-dark-secondary">
                {t("run.modelReported")}
              </span>
            </span>
          )}
          <span className={`${BODY_TEXT} block font-mono text-[11px]`}>
            {t("run.calls", { calls: run.reads.llm_sections.calls })} ·{" "}
            {t("run.words", { count: result.totals.word_count })}
          </span>
        </Cell>
        <Cell label={t("run.temperature")}>
          <Temperature llm={run.reads.llm_coverage} t={t} />
        </Cell>
      </div>
      <div className="mt-4 space-y-1">
        <Fingerprint label={t("run.fingerprint")} value={run.fingerprint} name="draft" />
        <Fingerprint
          label={t("run.briefFingerprint")}
          value={result.brief_ref.fingerprint}
          name="brief"
        />
      </div>
    </section>
  );
}
