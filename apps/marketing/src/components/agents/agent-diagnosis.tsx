// @input  -- complete Agent Audit view model and controlled scope/group/check selection
// @output -- responsive Stage 02 context, two-level diagnosis, ledger, and evidence detail
// @pos    -- presentation-only Diagnosis surface; recommendation state stays outside this module

"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Database,
  FileSearch,
  Gauge,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { gscAuthorizeHref } from "../tools/gsc-connect-panel";

import type {
  AgentAuditCheckView,
  AgentAuditEngineState,
  AgentAuditResultState,
  AgentAuditScope,
  AgentAuditScopeView,
  AgentAuditTruthState,
  AgentAuditViewModel,
  AgentAuditPolicyOverride,
  AgentAuditPolicyOverrides,
} from "./agent-audit-model";

/**
 * Fewest scored checks a scope must contribute before a 0-100 health number is
 * shown at all.
 *
 * A weighted mean over one or two checks is arithmetically valid and
 * editorially worthless: a single clean observation in one group would render
 * as "100/100" for a 27-check scope. Below this floor the card states the
 * evidence gap instead of a number.
 */
const MIN_SCORED_CHECKS_FOR_HEALTH = 3;

const RESULT_STYLE: Readonly<Record<AgentAuditResultState, string>> = {
  blocker: "border-brand-error/35 bg-brand-error/10 text-brand-error",
  warning: "border-brand-warning/35 bg-brand-warning/10 text-brand-warning",
  tip: "border-brand-info/35 bg-brand-info/10 text-brand-info",
  pass: "border-brand-success/35 bg-brand-success/10 text-brand-success",
  excluded:
    "border-brand-border-strong bg-brand-panel-raised text-text-dark-secondary",
};

const RESULT_ICON = {
  blocker: AlertTriangle,
  warning: AlertTriangle,
  tip: CircleHelp,
  pass: CheckCircle2,
  excluded: CircleHelp,
} as const;

/**
 * Axis states this surface can actually render.
 *
 * The shared unions still carry `needs_integration`, `documented`, `inferred`,
 * and `illustrative`, but no branch of the audit evaluator returns them, so
 * labelling them here promised badges a visitor could never see. The maps cover
 * the reachable states exactly — adding a reachable state breaks the build —
 * and the lookup below stays total for the wider union.
 */
type RenderedEngineState = Exclude<AgentAuditEngineState, "needs_integration">;
type RenderedTruthState = Exclude<
  AgentAuditTruthState,
  "documented" | "inferred" | "illustrative"
>;

const ENGINE_KEY: Readonly<Record<RenderedEngineState, string>> = {
  ready: "ready",
  needs_supplement: "needsSupplement",
  not_integrated: "notIntegrated",
  access_required: "accessRequired",
};

const TRUTH_KEY: Readonly<Record<RenderedTruthState, string>> = {
  observed: "observed",
  not_observed: "notObserved",
  partial: "partial",
  source_gated: "sourceGated",
  unavailable: "unavailable",
};

/**
 * Message suffix for an axis state, or null when this build has no label for it.
 * A null renders as an explicit "unrecognised" chip rather than dropping the
 * axis, so an engine that ships a new state ahead of the UI stays visible.
 */
function axisMessageKey<State extends string>(
  labels: Readonly<Record<State, string>>,
  state: string,
): string | null {
  return Object.hasOwn(labels, state)
    ? (labels as Readonly<Record<string, string>>)[state]!
    : null;
}

function valueOrFallback(value: string | number | null, fallback: string) {
  return value === null ? fallback : String(value);
}

/**
 * Checks that actually moved the health number.
 *
 * `evaluated` counts a different population: a check can be evaluated and still
 * carry no score, because page group 1 is judged but never scored and excluded
 * checks contribute nothing. The scope summary exposes no scored count, so it
 * is derived here from the per-check contract instead.
 */
function countScoredChecks(scopeView: AgentAuditScopeView): number {
  return scopeView.groups.reduce(
    (total, group) =>
      total +
      group.checks.filter(
        (check) => check.scored && check.scoreContribution !== null,
      ).length,
    0,
  );
}

/**
 * Data sources that would actually raise the score if they arrived.
 *
 * Only scored checks count: an excluded check that never scores (page group 1
 * is judged, not scored) would still contribute nothing after its source lands,
 * so listing it here would promise a number this source cannot deliver.
 */
function pendingDataSources(scopeView: AgentAuditScopeView): readonly string[] {
  const sources = new Set<string>();
  for (const group of scopeView.groups) {
    if (group.total === 0) continue;
    for (const check of group.checks) {
      if (check.result === "excluded" && check.scored) {
        sources.add(check.dataSource);
      }
    }
  }
  return [...sources];
}

function AxisChip({
  label,
  value,
  describedBy,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly describedBy?: string;
  readonly className?: string;
}) {
  return (
    <span
      aria-describedby={describedBy}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] tracking-[0.06em] uppercase ${className ?? "border-brand-border-strong bg-brand-panel-raised text-text-dark-secondary"}`}
    >
      {/* The axis name is half of what the chip says. The faint tier is
          documented as "unreadable is fine, no information is lost" — that is
          false for a label whose value is meaningless without it. */}
      <span className="text-text-dark-secondary">{label}</span>
      {value}
    </span>
  );
}

function CheckState({
  check,
  axisPrefix,
}: {
  readonly check: AgentAuditCheckView;
  readonly axisPrefix: string;
}) {
  const t = useTranslations("agents.workbench.diagnosis");
  const Icon = RESULT_ICON[check.result];
  const engineKey = axisMessageKey(ENGINE_KEY, check.engine);
  const truthKey = axisMessageKey(TRUTH_KEY, check.truth);

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        aria-describedby={`${axisPrefix}-result`}
        className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] tracking-[0.06em] uppercase ${RESULT_STYLE[check.result]}`}
      >
        <Icon aria-hidden="true" className="size-3" />
        {t(`results.${check.result}`)}
      </span>
      <span className="sr-only">
        {t("axes.result")}: {t(`results.${check.result}`)}
      </span>
      <AxisChip
        label={t("axes.engine")}
        value={
          engineKey === null
            ? t("axes.unknownState")
            : t(`engines.${engineKey}`)
        }
        describedBy={`${axisPrefix}-engine`}
      />
      <AxisChip
        label={t("axes.truth")}
        value={
          truthKey === null ? t("axes.unknownState") : t(`truth.${truthKey}`)
        }
        describedBy={`${axisPrefix}-truth`}
      />
    </span>
  );
}

/** Visible, screen-reader-referenced explanation of the three badge axes. */
function AxisLegend({ axisPrefix }: { readonly axisPrefix: string }) {
  const t = useTranslations("agents.workbench.diagnosis");
  const axes = [
    ["result", t("axes.result"), t("axisLegend.result")],
    ["engine", t("axes.engine"), t("axisLegend.engine")],
    ["truth", t("axes.truth"), t("axisLegend.truth")],
  ] as const;

  return (
    <dl
      data-testid="diagnosis-axis-legend"
      className="mt-4 grid gap-3 rounded-row border border-brand-border-dashed bg-brand-panel-sunken px-3.5 py-3 sm:grid-cols-3"
    >
      {axes.map(([axis, term, description]) => (
        <div key={axis} className="min-w-0">
          <dt className="font-mono text-[10.5px] tracking-[0.1em] text-text-dark-faint uppercase">
            {term}
          </dt>
          <dd
            id={`${axisPrefix}-${axis}`}
            className="mt-1 text-[12px] leading-[1.55] text-text-dark-primary"
          >
            {description}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DetailFact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-row border border-brand-border-faint bg-brand-panel-raised p-3.5">
      <dt className="font-mono text-[10.5px] tracking-[0.1em] text-text-dark-faint uppercase">
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-[12px] leading-[1.6] text-text-dark-primary">
        {children}
      </dd>
    </div>
  );
}

/**
 * Local threshold and weight editor.
 *
 * NOT MOUNTED IN PRODUCTION. `AgentResults` never passes `onSavePolicy`, so the
 * whole section is unreachable on the shipped Workbench; only tests render it.
 * Editing a threshold here also never rejudges anything: the evaluator runs
 * once against real evidence, and saving records a local review rule only,
 * which is what the closing line says. Kept pending an owner decision on
 * whether local policy ships at all.
 */
function PolicyEditor({
  scope,
  check,
  override,
  onSave,
  onReset,
}: {
  readonly scope: AgentAuditScope;
  readonly check: AgentAuditCheckView;
  readonly override: AgentAuditPolicyOverride | undefined;
  readonly onSave: (
    checkId: string,
    override: AgentAuditPolicyOverride,
  ) => void;
  readonly onReset: (checkId: string) => void;
}) {
  const t = useTranslations("agents.workbench.diagnosis.policy");
  const [threshold, setThreshold] = useState(
    override?.threshold ?? check.threshold,
  );
  const [weight, setWeight] = useState(
    String(override?.weight ?? check.scoreWeight),
  );
  const officialLocked = check.thresholdAuthority === "official";
  const weightLocked = check.blocking || !check.scored;
  const dirty = override !== undefined;

  function save(): void {
    const next: AgentAuditPolicyOverride = {};
    const thresholdValue = threshold.trim();
    if (
      !officialLocked &&
      thresholdValue.length > 0 &&
      thresholdValue !== check.threshold
    ) {
      Object.assign(next, { threshold: thresholdValue });
    }
    const weightValue = Number.parseFloat(weight);
    if (
      !weightLocked &&
      Number.isFinite(weightValue) &&
      weightValue >= 0.25 &&
      weightValue <= 10 &&
      weightValue !== check.scoreWeight
    ) {
      Object.assign(next, { weight: weightValue });
    }
    if (Object.keys(next).length === 0) {
      onReset(check.id);
      return;
    }
    onSave(check.id, next);
  }

  return (
    <section
      data-testid={`diagnosis-policy-${scope}-${check.id}`}
      className="mt-5 rounded-row border border-brand-border-dashed bg-brand-panel-sunken p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-[12.5px] font-semibold text-text-dark-primary">
            {t("title")}
          </h4>
          <p className="mt-1 text-[12px] leading-[1.55] text-text-dark-primary">
            {officialLocked ? t("officialLocked") : t("adjustable")}
          </p>
        </div>
        <span
          data-policy-dirty={String(dirty)}
          className={`rounded border px-2.5 py-1 font-mono text-[10.5px] tracking-[0.06em] uppercase ${
            dirty
              ? "border-brand-warning/30 bg-brand-warning/[0.07] text-brand-warning"
              : "border-brand-border-strong text-text-dark-secondary"
          }`}
        >
          {dirty ? t("localOverride") : t("acceptedPreset")}
        </span>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
        <label className="block">
          <span className="mb-1.5 block font-mono text-[10.5px] tracking-[0.08em] text-text-dark-faint uppercase">
            {t("threshold")}
          </span>
          <input
            data-policy-threshold={check.id}
            type="text"
            maxLength={512}
            disabled={officialLocked}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[11.5px] text-text-dark-primary outline-none focus:border-brand-accent/70 disabled:cursor-not-allowed disabled:opacity-55"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[10.5px] tracking-[0.08em] text-text-dark-faint uppercase">
            {t("weight")}
          </span>
          <input
            data-policy-weight={check.id}
            type="number"
            min="0.25"
            max="10"
            step="0.25"
            disabled={weightLocked}
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            className="h-10.5 w-full rounded-[9px] border border-brand-border-strong bg-brand-panel-raised px-3 text-[11.5px] text-text-dark-primary outline-none focus:border-brand-accent/70 disabled:cursor-not-allowed disabled:opacity-55"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          data-policy-action="save"
          onClick={save}
          className="inline-flex h-9.5 items-center justify-center rounded-[8px] bg-brand-gradient px-4 text-[11.5px] font-semibold text-brand-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          {t("save")}
        </button>
        <button
          type="button"
          data-policy-action="reset-check"
          onClick={() => onReset(check.id)}
          className="inline-flex h-9.5 items-center justify-center rounded-[8px] border border-brand-border-strong px-4 text-[11.5px] font-medium text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          {t("resetCheck")}
        </button>
      </div>
      <p className="mt-3 text-[12px] leading-[1.55] text-text-dark-primary">
        {dirty ? t("rerunRequired") : t("doesNotRejudge")}
      </p>
    </section>
  );
}

export interface AgentDiagnosisProps {
  readonly model: AgentAuditViewModel;
  readonly scope: AgentAuditScope;
  readonly selectedGroupId: string | null;
  readonly selectedCheckId: string | null;
  readonly onScopeChange: (scope: AgentAuditScope) => void;
  readonly onGroupChange: (groupId: string) => void;
  readonly onCheckChange: (checkId: string) => void;
  readonly policyOverrides?: AgentAuditPolicyOverrides;
  readonly onSavePolicy?: (
    checkId: string,
    override: AgentAuditPolicyOverride,
  ) => void;
  readonly onResetCheckPolicy?: (checkId: string) => void;
  readonly onResetScopePolicy?: (scope: AgentAuditScope) => void;
}

export function AgentDiagnosis({
  model,
  scope,
  selectedGroupId,
  selectedCheckId,
  onScopeChange,
  onGroupChange,
  onCheckChange,
  policyOverrides = {},
  onSavePolicy,
  onResetCheckPolicy,
  onResetScopePolicy,
}: AgentDiagnosisProps) {
  const t = useTranslations("agents.workbench.diagnosis");
  const activeScope = model.scopes[scope];
  const defaultGroupId =
    scope === "site" ? model.defaults.siteGroupId : model.defaults.pageGroupId;
  const activeGroup =
    activeScope.groups.find((group) => group.id === selectedGroupId) ??
    activeScope.groups.find((group) => group.id === defaultGroupId) ??
    activeScope.groups[0] ??
    null;
  const activeCheck =
    activeGroup?.checks.find((check) => check.id === selectedCheckId) ??
    activeGroup?.checks[0] ??
    null;
  const contextStatus =
    model.context.reviewState === "confirmed" ? "confirmed" : "draft";
  const scopePolicyDirty = activeScope.groups.some((group) =>
    group.checks.some((check) => policyOverrides[check.id] !== undefined),
  );
  const activePolicy = activeCheck
    ? policyOverrides[activeCheck.id]
    : undefined;
  const axisPrefix = `${model.agent}-diagnosis-axis`;
  const scoredChecks = countScoredChecks(activeScope);
  const healthReportable =
    activeScope.health !== null && scoredChecks >= MIN_SCORED_CHECKS_FOR_HEALTH;
  const pendingSources = healthReportable
    ? []
    : pendingDataSources(activeScope);

  return (
    <section
      data-testid="agent-diagnosis"
      className="mt-8 space-y-5"
      aria-labelledby={`${model.agent}-diagnosis-title`}
    >
      <header className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <p className="font-mono text-[10.5px] tracking-[0.12em] text-brand-accent-text uppercase">
              {t("eyebrow")}
            </p>
            <h2
              id={`${model.agent}-diagnosis-title`}
              className="mt-2 text-[22px] font-semibold text-text-dark-primary"
            >
              {t(`title.${model.agent}`)}
            </h2>
            <p className="mt-2 max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
              {t(`description.${model.agent}`)}
            </p>
          </div>
          <span
            data-context-status={contextStatus}
            className={`inline-flex w-fit rounded border px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] uppercase ${
              contextStatus === "confirmed"
                ? "border-brand-success/35 bg-brand-success/10 text-brand-success"
                : "border-brand-warning/35 bg-brand-warning/10 text-brand-warning"
            }`}
          >
            {t(`context.${contextStatus}`)}
          </span>
        </div>

        <div className="mt-5 grid gap-px overflow-hidden rounded-row border border-brand-border-faint bg-brand-border-faint sm:grid-cols-2 lg:grid-cols-5">
          {[
            [t("context.country"), model.context.country],
            [t("context.locale"), model.context.locale],
            [t("context.device"), model.context.device],
            [t("context.pageType"), model.context.pageType],
            [
              t("context.targetQuery"),
              model.context.targetQuery || t("context.targetQueryUnconfirmed"),
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="min-w-0 bg-brand-panel-sunken px-3.5 py-3"
            >
              <p className="font-mono text-[10.5px] tracking-[0.09em] text-text-dark-faint uppercase">
                {label}
              </p>
              <p className="mt-1 truncate text-[11.5px] font-medium text-text-dark-primary">
                {value}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 truncate text-[11px] text-text-dark-secondary">
          <span className="font-medium text-text-dark-primary">
            {model.context.productName}
          </span>{" "}
          · {model.context.primaryIcp}
        </p>
      </header>

      <div className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10.5px] tracking-[0.1em] text-text-dark-faint uppercase">
              {t("scopeLabel")}
            </p>
            <div className="mt-2 inline-flex rounded-[10px] border border-brand-border bg-brand-panel-sunken p-1">
              {(["site", "page"] as const).map((candidate) => {
                const selected = candidate === scope;
                return (
                  <button
                    key={candidate}
                    type="button"
                    data-testid={`diagnosis-scope-${candidate}`}
                    aria-pressed={selected}
                    onClick={() => onScopeChange(candidate)}
                    className={`rounded-[7px] px-3.5 py-2 text-[11.5px] font-semibold transition-colors ${
                      selected
                        ? "bg-brand-panel-raised text-brand-accent-text shadow-sm"
                        : "text-text-dark-secondary hover:text-text-dark-primary"
                    }`}
                  >
                    {t(`scopes.${candidate}`, {
                      groups: model.scopes[candidate].groups.length,
                      checks: model.scopes[candidate].total,
                    })}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="font-mono text-[10.5px] text-text-dark-secondary">
            {t("scopeSummary", {
              groups: activeScope.groups.length,
              total: activeScope.total,
            })}
          </p>
          {onResetScopePolicy ? (
            <button
              type="button"
              data-policy-action="reset-scope"
              disabled={!scopePolicyDirty}
              onClick={() => onResetScopePolicy(scope)}
              className="rounded-[8px] border border-brand-border-strong px-3 py-2 font-mono text-[11px] text-text-dark-secondary transition-colors hover:text-text-dark-primary disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t(
                scopePolicyDirty ? "policy.resetScope" : "policy.scopeAtPreset",
              )}
            </button>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-row border border-brand-error/25 bg-brand-error/[0.06] p-4">
            <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.09em] text-brand-error uppercase">
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              {t("blockers")}
            </p>
            <strong className="mt-2 block text-[25px] font-semibold text-text-dark-primary">
              {activeScope.blockers}
            </strong>
            <p className="mt-1.5 text-[12px] leading-[1.55] text-text-dark-primary">
              {t("blockersHint")}
            </p>
          </article>
          <article
            data-testid="diagnosis-health"
            data-health-state={healthReportable ? "scored" : "insufficient"}
            className={`rounded-row border p-4 ${
              activeScope.healthDimmed
                ? "border-brand-border bg-brand-panel-sunken opacity-70"
                : "border-brand-accent/25 bg-brand-accent/[0.06]"
            }`}
          >
            <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.09em] text-brand-accent-text uppercase">
              <Gauge aria-hidden="true" className="size-3.5" />
              {t("health")}
            </p>
            {healthReportable ? (
              <>
                <strong className="mt-2 block text-[25px] font-semibold text-text-dark-primary">
                  {activeScope.health}/100
                </strong>
                <p className="mt-1.5 text-[12px] leading-[1.55] text-text-dark-primary">
                  {t("healthScoredCount", { scored: scoredChecks })}
                </p>
              </>
            ) : (
              <>
                <strong className="mt-2 block text-[13.5px] leading-[1.45] font-semibold text-text-dark-primary">
                  {t("healthInsufficient")}
                </strong>
                <p className="mt-1.5 text-[12px] leading-[1.55] text-text-dark-primary">
                  {t("healthInsufficientHint", {
                    scored: scoredChecks,
                    minimum: MIN_SCORED_CHECKS_FOR_HEALTH,
                  })}
                </p>
                {pendingSources.length > 0 ? (
                  <p className="mt-1.5 text-[12px] leading-[1.55] text-text-dark-primary">
                    {t("healthPendingSources", {
                      sources: pendingSources.join(" · "),
                    })}
                  </p>
                ) : null}
              </>
            )}
            <p className="mt-1.5 text-[12px] leading-[1.55] text-text-dark-primary">
              {t("healthHint")}
            </p>
            {activeScope.healthDimmed ? (
              <p
                data-health-dimmed="true"
                className="mt-1.5 text-[12px] leading-[1.55] text-text-dark-primary"
              >
                {t("healthDimmedReason", { blockers: activeScope.blockers })}
              </p>
            ) : null}
          </article>
          <article className="rounded-row border border-brand-border bg-brand-panel-sunken p-4">
            <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.09em] text-text-dark-faint uppercase">
              <FileSearch aria-hidden="true" className="size-3.5" />
              {t("checksLabel")}
            </p>
            <strong className="mt-2 block text-[17px] font-semibold text-text-dark-primary">
              {t("evaluatedTotal", {
                evaluated: activeScope.evaluated,
                total: activeScope.total,
              })}
            </strong>
            <p className="mt-1.5 text-[12px] leading-[1.55] text-text-dark-primary">
              {activeScope.excluded} {t("results.excluded")}
            </p>
          </article>
          <article className="rounded-row border border-brand-border bg-brand-panel-sunken p-4">
            <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.09em] text-text-dark-faint uppercase">
              <Database aria-hidden="true" className="size-3.5" />
              {t("axes.engine")}
            </p>
            <strong className="mt-2 block text-[17px] font-semibold text-text-dark-primary">
              {t("engineCoverage", {
                ready: activeScope.enginesReady,
                total: activeScope.total,
              })}
            </strong>
            <p className="mt-1.5 text-[12px] leading-[1.55] text-text-dark-primary">
              {t("inventoryCoverage", {
                ready: activeScope.inventoryReady,
                total: activeScope.total,
              })}
            </p>
          </article>
        </div>

        {/*
          The one thing a signed-in visitor could not tell from this panel: six
          checks say "authorized source required" and nothing said whether this
          tool had ever asked. Signing in with Google does not grant Search
          Console to the audit, so the state has to be visible and the way to
          change it has to be one click from here.
        */}
        <p
          data-testid="diagnosis-search-source"
          className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-row border border-brand-border-dashed bg-brand-panel-sunken px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-text-dark-primary"
        >
          <Database aria-hidden="true" className="size-3.5 shrink-0 text-text-dark-faint" />
          {model.searchSource.state === "connected" ? (
            <span>
              {t("searchSource.present", {
                property: model.searchSource.property,
                start: model.searchSource.startDate,
                end: model.searchSource.endDate,
              })}
            </span>
          ) : model.searchSource.state === "unavailable" ? (
            // Reachable and did not answer. Offering the grant here would send
            // a visitor who is already connected back through OAuth to fix
            // something OAuth cannot.
            <span>{t("searchSource.unavailable")}</span>
          ) : (
            <>
              <span>{t("searchSource.absent")}</span>
              <Link
                href={gscAuthorizeHref(model.locale, "/agents/seo")}
                className="font-semibold text-brand-accent-text underline decoration-brand-border underline-offset-4 transition-colors hover:text-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent"
              >
                {t("searchSource.connect")}
              </Link>
            </>
          )}
        </p>

        <p
          data-testid="diagnosis-boundary"
          className="mt-3 rounded-row border border-brand-border-dashed bg-brand-panel-sunken px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-text-dark-primary"
        >
          {t("excludedBoundary")}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.72fr)_minmax(0,1.28fr)]">
        <nav
          aria-label={t("groupsLabel")}
          className="rounded-card border border-brand-border-card bg-brand-panel p-4"
        >
          <p className="px-1 font-mono text-[10.5px] tracking-[0.1em] text-text-dark-faint uppercase">
            {t("groupsLabel")}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {activeScope.groups.map((group) => {
              const selected = group.id === activeGroup?.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  data-testid={`diagnosis-group-${group.id}`}
                  aria-pressed={selected}
                  onClick={() => onGroupChange(group.id)}
                  className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-row border px-3.5 py-3 text-left transition-colors ${
                    selected
                      ? "border-brand-accent/40 bg-brand-accent/[0.07]"
                      : "border-brand-border-faint bg-brand-panel-sunken hover:border-brand-border-strong"
                  }`}
                >
                  <span className="font-mono text-[10.5px] font-semibold text-brand-accent-text">
                    {group.id}
                  </span>
                  <span className="min-w-0 truncate text-[11.5px] font-medium text-text-dark-primary">
                    {group.title}
                  </span>
                  <span className="font-mono text-[10.5px] text-text-dark-faint">
                    {group.evaluated}/{group.total}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <section className="rounded-card border border-brand-border-card bg-brand-panel p-4 md:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-brand-border pb-4">
            <div>
              <p className="font-mono text-[10.5px] tracking-[0.1em] text-brand-accent-text uppercase">
                {activeGroup?.id} · {t("checksLabel")}
              </p>
              <h3 className="mt-1.5 text-[17px] font-semibold text-text-dark-primary">
                {activeGroup?.title}
              </h3>
            </div>
            <span className="font-mono text-[11px] text-text-dark-secondary">
              {activeGroup
                ? t("evaluatedTotal", {
                    evaluated: activeGroup.evaluated,
                    total: activeGroup.total,
                  })
                : null}
            </span>
          </div>

          <AxisLegend axisPrefix={axisPrefix} />

          <div className="mt-4 grid gap-2">
            {activeGroup?.checks.map((check) => {
              const selected = check.id === activeCheck?.id;
              return (
                <button
                  key={check.id}
                  type="button"
                  data-testid={`diagnosis-check-${check.id}`}
                  aria-label={t("selectCheck", { check: check.title })}
                  aria-pressed={selected}
                  onClick={() => onCheckChange(check.id)}
                  className={`grid min-w-0 gap-3 rounded-row border px-3.5 py-3 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
                    selected
                      ? "border-brand-accent/40 bg-brand-accent/[0.06]"
                      : "border-brand-border-faint bg-brand-panel-sunken hover:border-brand-border-strong"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="font-mono text-[10.5px] text-brand-accent-text">
                      {check.id}
                    </span>
                    <strong className="mt-1 block text-[12px] font-semibold text-text-dark-primary">
                      {check.title}
                    </strong>
                  </span>
                  <CheckState check={check} axisPrefix={axisPrefix} />
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {scope === "page" ? (
        <aside
          data-testid="diagnosis-heading-preset"
          className="rounded-card border border-brand-info/25 bg-brand-info/[0.06] p-4 md:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10.5px] tracking-[0.1em] text-brand-info uppercase">
                {t("headingPreset.label")}
              </p>
              <p className="mt-2 text-[13px] font-semibold text-text-dark-primary">
                {t("headingPreset.range", {
                  h2Min: model.headingPreset.h2.min,
                  h2Max: model.headingPreset.h2.max,
                  h3Min: model.headingPreset.h3.min,
                  h3Max: model.headingPreset.h3.max,
                  words: model.headingPreset.substanceWords,
                })}
              </p>
            </div>
            <span className="rounded border border-brand-info/30 px-2.5 py-1 font-mono text-[10.5px] text-brand-info uppercase">
              {t("headingPreset.softRule")}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-primary">
            {t("headingPreset.boundary")}
          </p>
        </aside>
      ) : null}

      <section
        data-testid="diagnosis-focused-detail"
        className="rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-6"
      >
        {activeCheck ? (
          <>
            <header className="grid gap-4 border-b border-brand-border pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div>
                <p className="font-mono text-[10.5px] tracking-[0.1em] text-brand-accent-text uppercase">
                  {activeCheck.id} · {t("detailLabel")}
                </p>
                <h3 className="mt-2 text-[19px] font-semibold text-text-dark-primary">
                  {activeCheck.title}
                </h3>
              </div>
              <CheckState check={activeCheck} axisPrefix={axisPrefix} />
            </header>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DetailFact label={t("detail.measuredValue")}>
                {valueOrFallback(
                  activeCheck.measurement,
                  t("detail.notMeasured"),
                )}
              </DetailFact>
              <DetailFact label={t("detail.threshold")}>
                {activePolicy?.threshold ?? activeCheck.threshold}
              </DetailFact>
              <DetailFact label={t("detail.thresholdAuthority")}>
                {t(`authorities.${activeCheck.thresholdAuthority}`)}
              </DetailFact>
              <DetailFact label={t("detail.dataSource")}>
                {activeCheck.dataSource}
              </DetailFact>
              <DetailFact label={t("detail.impact")}>
                {activeCheck.impact}
              </DetailFact>
              <DetailFact label={t("detail.howToFix")}>
                {activeCheck.howToFix}
              </DetailFact>
              <DetailFact label={t("detail.scoreContribution")}>
                {valueOrFallback(
                  activeCheck.scoreContribution,
                  t("detail.notScored"),
                )}
              </DetailFact>
              <DetailFact label={t("detail.boundary")}>
                {activeCheck.boundary}
              </DetailFact>
            </dl>
            {onSavePolicy && onResetCheckPolicy ? (
              <PolicyEditor
                key={`${scope}:${activeCheck.id}:${policyOverrides[activeCheck.id]?.threshold ?? ""}:${policyOverrides[activeCheck.id]?.weight ?? ""}`}
                scope={scope}
                check={activeCheck}
                override={activePolicy}
                onSave={onSavePolicy}
                onReset={onResetCheckPolicy}
              />
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-3 text-[12px] text-text-dark-secondary">
            <Activity aria-hidden="true" className="size-4 text-brand-info" />
            {t("noCheckSelected")}
          </div>
        )}
      </section>
    </section>
  );
}
