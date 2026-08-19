// @input  -- a generated core_8 query set and the confirmed context behind it
// @output -- the confirm step: what will be asked, how often, and with whose names in it
// @pos    -- the last screen before money is spent on this run

"use client";

import { useTranslations } from "next-intl";

import type { GeoContextSnapshotV1 } from "../../../lib/agents/geo-context";
import { promptContainsTargetAlias } from "../../../lib/agents/geo-context";
import type {
  GeoQuerySetV1,
  GeoQueryUnitV1,
} from "../../../lib/agents/geo-query-contract";
import { findGeoTemplate } from "../../../lib/agents/geo-template-registry";
import { geoPlannedCallCount } from "../../../lib/agents/geo-query-contract";

const FIELD_CLASS =
  "h-11 w-full rounded-[10px] border border-brand-border-strong bg-brand-panel-sunken px-3 text-[13.5px] text-text-dark-primary placeholder:text-text-dark-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const TAG_CLASS =
  "inline-flex items-center rounded-row border px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase";

function Tag({
  tone,
  children,
}: {
  readonly tone: "neutral" | "accent" | "warn";
  readonly children: React.ReactNode;
}) {
  const toneClass =
    tone === "accent"
      ? "border-brand-accent/50 text-brand-accent-text"
      : tone === "warn"
        ? "border-brand-accent-2/50 text-brand-accent-2"
        : "border-brand-border-strong text-text-dark-secondary";
  return <span className={`${TAG_CLASS} ${toneClass}`}>{children}</span>;
}

/**
 * One question, with everything that decides how to read its answer.
 *
 * Mode, brand conditioning and sample count are shown together because they are
 * the three facts that make a citation count mean something — or mean nothing.
 * A visitor who cannot see that a question already contains their own brand
 * name cannot know that a mention in its answer is tautology.
 */
function QueryRow({
  query,
  context,
  disabled,
  onEdit,
}: {
  readonly query: GeoQueryUnitV1;
  readonly context: GeoContextSnapshotV1;
  readonly disabled: boolean;
  readonly onEdit: (queryId: string, text: string) => void;
}) {
  const t = useTranslations("agents.geo");
  const prompted = promptContainsTargetAlias(query.text, context.brandAliases);
  const measured = query.templateId !== null && query.source !== "user_edit";
  /**
   * The shipped template's own record of what it was not measured against.
   *
   * Read from the registry rather than carried on the query, because the query
   * is a rendered string and this is a property of the wording it came from. An
   * edited query has no template and therefore no calibration to qualify — the
   * `demoted` chip already says the stronger thing about it.
   */
  const calibrationGaps =
    query.templateId === null || query.templateVersion === null || !measured
      ? []
      : (findGeoTemplate(query.templateId, query.templateVersion)?.limitations ??
        []);

  return (
    <li className="grid gap-2 border-t border-brand-border-card py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10.5px] tracking-[0.1em] text-text-dark-tertiary uppercase">
          {t(`slots.${query.slot}`)}
        </span>
        <Tag tone={query.mode === "retrieval_probe" ? "accent" : "neutral"}>
          {t(`modes.${query.mode}`)}
        </Tag>
        <Tag tone="neutral">
          {t("queries.sampleCount", { count: query.samplesPlanned })}
        </Tag>
        <Tag tone="neutral">{t(`stances.${query.brandStance}`)}</Tag>
        {prompted && <Tag tone="warn">{t("queries.promptedBrand")}</Tag>}
        {query.mode === "retrieval_probe" && measured && (
          <Tag tone="accent">{t("queries.measured")}</Tag>
        )}
        {query.source === "user_edit" && (
          <Tag tone="warn">{t("queries.demoted")}</Tag>
        )}
      </div>
      <input
        id={`geo-q-${query.queryId}`}
        aria-label={t(`slots.${query.slot}`)}
        className={FIELD_CLASS}
        value={query.text}
        maxLength={500}
        disabled={disabled}
        onChange={(event) => onEdit(query.queryId, event.target.value)}
      />
      {query.retrievalTriggerClause !== null && (
        <p className="text-[11px] leading-[1.55] text-text-dark-tertiary">
          {t("queries.triggerClause", { clause: query.retrievalTriggerClause })}
        </p>
      )}
      {/*
        What the calibration behind this wording does not cover, on the screen
        where the visitor decides whether to pay for it. The registry has
        recorded these codes since it was written and nothing read them, so a
        measurement whose seeds used a famous competitor and a visitor whose
        competitor is not famous looked identical right up to the report.
      */}
      {calibrationGaps.length > 0 && (
        <ul className="grid gap-0.5">
          {calibrationGaps.map((code) => (
            <li
              key={code}
              className="text-[11px] leading-[1.55] text-text-dark-tertiary"
            >
              {t(`queries.calibration.${code}`)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function GeoQueryReview({
  querySet,
  context,
  disabled,
  onEdit,
}: {
  readonly querySet: GeoQuerySetV1;
  readonly context: GeoContextSnapshotV1;
  readonly disabled: boolean;
  readonly onEdit: (queryId: string, text: string) => void;
}) {
  const t = useTranslations("agents.geo");

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-text-dark-primary">
        {t("queries.title")}
      </h2>
      <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
        {t("queries.cohortNote")}
      </p>
      <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
        {t("queries.editNote")}
      </p>
      <ol className="mt-4">
        {querySet.queries.map((query) => (
          <QueryRow
            key={query.queryId}
            query={query}
            context={context}
            disabled={disabled}
            onEdit={onEdit}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * The exact plan, priced in calls, before the button that spends them.
 *
 * The number here and the number on the invoice are the same number: the server
 * builds this plan from the same query set and refuses the run if the two
 * disagree. The split is shown rather than a total alone because the uniform
 * three-sample policy is deliberately broken, and a visitor who sees "18" with
 * no breakdown has no way to notice that.
 */
export function GeoRunPlan({
  querySet,
  context,
}: {
  readonly querySet: GeoQuerySetV1;
  readonly context: GeoContextSnapshotV1;
}) {
  const t = useTranslations("agents.geo");
  const retrieval = querySet.queries.filter(
    (query) => query.mode === "retrieval_probe",
  );
  const natural = querySet.queries.filter(
    (query) => query.mode === "natural_demand",
  );
  const calls = geoPlannedCallCount(querySet);
  const outsideCalibration = context.marketCode !== "US";

  return (
    <div className="rounded-card border border-brand-border-card bg-brand-panel p-4 md:p-5">
      <h3 className="text-[12.5px] font-semibold text-text-dark-primary">
        {t("plan.title")}
      </h3>
      <p className="mt-1.5 font-mono text-[11.5px] text-brand-accent-text">
        {t("plan.calls", { calls })}
      </p>
      <ul className="mt-2 grid gap-1">
        <li className="text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {t("plan.retrievalLine", {
            questions: retrieval.length,
            samples: 3,
            calls: retrieval.length * 3,
          })}
        </li>
        <li className="text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {t("plan.naturalLine", {
            questions: natural.length,
            samples: 1,
            calls: natural.length,
          })}
        </li>
      </ul>
      <dl className="mt-3 grid gap-1.5 text-[11.5px] text-text-dark-secondary sm:grid-cols-2">
        <div>
          <dt className="text-text-dark-tertiary">{t("plan.surface")}</dt>
          <dd className="font-mono text-[11px]">{t("plan.surfaceValue")}</dd>
        </div>
        <div>
          <dt className="text-text-dark-tertiary">{t("plan.market")}</dt>
          <dd className="font-mono text-[11px]">{context.marketCode}</dd>
        </div>
        <div>
          <dt className="text-text-dark-tertiary">{t("plan.queryLanguage")}</dt>
          <dd className="font-mono text-[11px]">
            {context.targetQueryLanguage}
          </dd>
        </div>
        <div>
          <dt className="text-text-dark-tertiary">{t("plan.querySet")}</dt>
          <dd className="font-mono text-[11px]">
            {querySet.querySetContentHash.slice(7, 19)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11.5px] leading-[1.55] text-text-dark-secondary">
        {t("plan.searchPermission")}
      </p>
      {outsideCalibration && (
        <p
          role="note"
          className="mt-2 rounded-row border border-brand-accent-2/50 px-3 py-2 text-[11.5px] leading-[1.55] text-brand-accent-2"
        >
          {t("plan.outsideCalibration", { market: context.marketCode })}
        </p>
      )}
    </div>
  );
}
