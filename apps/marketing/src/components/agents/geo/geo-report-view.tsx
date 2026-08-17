// @input  -- one contract-valid GEO report and the active locale
// @output -- coverage with its real denominator, per-question verdicts, and limits
// @pos    -- the only rendering of GEO evidence; every number here comes from the payload

"use client";

import { useTranslations } from "next-intl";

import type {
  GeoQuestionObservation,
  GeoReportData,
  GeoSample,
} from "../../../lib/agents/geo-report-contract";

const VERDICT_TONE: Readonly<Record<string, string>> = {
  stable_cited: "border-brand-accent/50 text-brand-accent-text",
  intermittent: "border-brand-accent-2/50 text-brand-accent-2",
  not_observed: "border-brand-border-strong text-text-dark-secondary",
  // A real finding about the question, not a gap in the data, so it keeps
  // readable secondary text; only `inconclusive` drops to the faintest tier.
  answered_from_memory: "border-brand-border-dashed text-text-dark-secondary",
  inconclusive: "border-brand-border-dashed text-text-dark-tertiary",
};

function formatDate(value: string, locale: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : value;
}

function SampleRow({
  sample,
  competitorLabel,
  stateLabel,
  sampleLabel,
  noCitations,
  limitationLabel,
}: {
  readonly sample: GeoSample;
  readonly competitorLabel: string;
  readonly stateLabel: string;
  readonly sampleLabel: string;
  readonly noCitations: string;
  readonly limitationLabel: string | null;
}) {
  const competitors = new Set(sample.competitorHosts);
  return (
    <li className="grid gap-1.5 border-t border-brand-border-card py-2.5 first:border-t-0 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10.5px] text-text-dark-tertiary">
          {sampleLabel}
        </span>
        <span className="text-[11.5px] text-text-dark-secondary">
          {stateLabel}
        </span>
      </div>
      <div className="min-w-0">
        {sample.citedHosts.length === 0 ? (
          <p className="text-[11.5px] text-text-dark-tertiary">
            {/* A sample that never searched observed nothing, so it must not
                read as "no sources were cited" — that is the report's own rule
                about never rendering an absence of observation as a finding. */}
            {limitationLabel ?? (sample.webSearchPerformed ? noCitations : "")}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {sample.citedHosts.map((host) => (
              <li
                key={host}
                className="inline-flex items-center gap-1 rounded-row border border-brand-border-strong bg-brand-panel px-2 py-0.5 font-mono text-[10.5px] text-text-dark-secondary"
              >
                {host}
                {competitors.has(host) && (
                  <span className="text-brand-accent-2">{competitorLabel}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function QuestionCard({
  question,
}: {
  readonly question: GeoQuestionObservation;
}) {
  const t = useTranslations("agents.geo");
  const { aggregate } = question;
  const tone =
    VERDICT_TONE[aggregate.verdict] ?? VERDICT_TONE["inconclusive"] ?? "";

  return (
    <li className="rounded-card border border-brand-border-card bg-brand-panel-sunken p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[46rem] text-[13.5px] leading-[1.6] text-text-dark-primary">
          {question.question}
        </p>
        <span
          className={`shrink-0 rounded-row border px-2.5 py-1 font-mono text-[10.5px] ${tone}`}
        >
          {t(`verdicts.${aggregate.verdict}`)}
        </span>
      </div>

      <p className="mt-2 text-[11.5px] leading-[1.55] text-text-dark-secondary">
        {t(`verdicts.${aggregate.verdict}Hint`)}
      </p>

      {aggregate.admissibleSamples > 0 && (
        <p className="mt-1.5 font-mono text-[11px] text-brand-accent-text">
          {t("results.citedInCount", {
            cited: aggregate.targetCitedIn,
            total: aggregate.admissibleSamples,
          })}
        </p>
      )}

      <ul className="mt-3">
        {question.samples.map((sample) => (
          <SampleRow
            key={sample.sampleIndex}
            sample={sample}
            competitorLabel={t("results.competitorTag")}
            stateLabel={t(`states.${sample.state}`)}
            sampleLabel={t("results.sampleLabel", {
              index: sample.sampleIndex,
            })}
            noCitations={t("results.noCitedHosts")}
            limitationLabel={
              sample.limitation === null
                ? null
                : t(`sampleLimitations.${sample.limitation}`)
            }
          />
        ))}
      </ul>
    </li>
  );
}

export function GeoReportView({
  report,
  locale,
  onRestart,
}: {
  readonly report: GeoReportData;
  readonly locale: string;
  readonly onRestart: () => void;
}) {
  const t = useTranslations("agents.geo");
  const { run, coverage, questions } = report;

  const counters = [
    ["coverageAttempted", coverage.samplesAttempted],
    ["coverageObserved", coverage.samplesObserved],
    ["coverageNotSearched", coverage.samplesSearchNotPerformed],
    ["coverageUnavailable", coverage.samplesUnavailable],
  ] as const;

  return (
    <section className="grid gap-5">
      <div className="rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 md:p-6">
        <h2 className="text-[16px] font-semibold text-text-dark-primary">
          {t("results.title")}
        </h2>
        <p className="mt-1 font-mono text-[11px] text-text-dark-tertiary">
          {t("results.sampledAt", { date: formatDate(run.sampledAt, locale) })}
          {" · "}
          {t("results.model")}: {run.provider.model}
          {" · "}
          {t("results.market")}: {run.provider.marketCode}
        </p>

        <h3 className="mt-5 text-[12.5px] font-semibold text-text-dark-primary">
          {t("results.coverageTitle")}
        </h3>
        <dl className="mt-2 grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card sm:grid-cols-4">
          {counters.map(([key, value]) => (
            <div key={key} className="bg-brand-panel p-3.5">
              <dt className="text-[11px] text-text-dark-secondary">
                {t(`results.${key}`)}
              </dt>
              <dd className="mt-1 font-mono text-[20px] text-text-dark-primary tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {t("results.coverageNote")}
        </p>
        <p className="mt-1.5 text-[11.5px] leading-[1.55] text-text-dark-tertiary">
          {t("results.notStored")}
        </p>
      </div>

      <div>
        <h3 className="text-[14px] font-semibold text-text-dark-primary">
          {t("results.questionsTitle")}
        </h3>
        {questions.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-text-dark-secondary">
            {t("results.empty")}
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {questions.map((question) => (
              <QuestionCard key={question.questionId} question={question} />
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-card border border-brand-border-dashed bg-brand-panel-sunken p-5">
        <h3 className="text-[12.5px] font-semibold text-text-dark-primary">
          {t("limitations.title")}
        </h3>
        <ul className="mt-2 grid gap-1.5">
          {["sampling", "platform", "citation", "denominator"].map((key) => (
            <li
              key={key}
              className="text-[11.5px] leading-[1.6] text-text-dark-secondary"
            >
              {t(`limitations.${key}`)}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex h-11 items-center justify-center rounded-[10px] border border-brand-border-strong bg-transparent px-4 text-[13px] text-text-dark-secondary transition-colors hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          {t("workbench.back")}
        </button>
      </div>
    </section>
  );
}
