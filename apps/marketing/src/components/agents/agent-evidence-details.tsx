// @input  -- one selected evaluated check plus the joined neutral audit ledger
// @output -- exact affected URL/site observations with bounded disclosure
// @pos    -- shared browser-only evidence detail for Agent Stage 02 and Stage 04

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import { agentAffectedObservations } from "./agent-evidence-observations";

type SupportedLocale = "en" | "zh";

const DEFAULT_VISIBLE_OBSERVATIONS = 5;
export {
  agentAffectedObservations,
  type AgentAffectedObservation,
  type AgentAffectedObservationRecordGroup,
} from "./agent-evidence-observations";

function localized(
  value: Readonly<Record<SupportedLocale, string>>,
  locale: string,
): string {
  return value[locale === "zh" ? "zh" : "en"];
}

function evidenceValue(
  value: SeoAuditRecord["observations"][number]["values"][number]["value"],
): string {
  return value === null ? "—" : String(value);
}

function observationHref(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

const TRUTH_KEY: Readonly<Record<AgentAuditEvaluatedCheck["truth"], string>> = {
  observed: "observed",
  "not-observed": "notObserved",
  documented: "documented",
  inferred: "inferred",
  partial: "partial",
  "source-gated": "sourceGated",
  unavailable: "unavailable",
  illustrative: "illustrative",
};

function emptyCopyKeys(
  truth: AgentAuditEvaluatedCheck["truth"],
): readonly [string, string] {
  if (truth === "not-observed") {
    return ["evidenceNotObservedTitle", "evidenceNotObservedBody"];
  }
  if (
    truth === "source-gated" ||
    truth === "unavailable" ||
    truth === "illustrative"
  ) {
    return ["evidenceUnavailable", "sourceGatedBoundary"];
  }
  return ["evidenceNoObservationTitle", "evidenceNoObservationBody"];
}

export interface AgentEvidenceDetailsProps {
  readonly check: AgentAuditEvaluatedCheck;
  readonly records: readonly SeoAuditRecord[];
  readonly targetUrl?: string;
  readonly locale: string;
  readonly className?: string;
}

export function AgentEvidenceDetails({
  check,
  records,
  targetUrl,
  locale,
  className = "",
}: AgentEvidenceDetailsProps) {
  const t = useTranslations("agents.workbench.recommendations");
  const diagnosisT = useTranslations("agents.workbench.diagnosis");
  const auditT = useTranslations("tools.seoAudit");
  const [expanded, setExpanded] = useState(false);
  const observations = agentAffectedObservations(check, records, targetUrl);
  const shown = expanded
    ? observations
    : observations.slice(0, DEFAULT_VISIBLE_OBSERVATIONS);
  const urlCount = observations.filter(
    (observation) => observation.url !== null,
  ).length;

  if (observations.length === 0) {
    const [titleKey, bodyKey] = emptyCopyKeys(check.truth);
    return (
      <div
        data-testid="agent-evidence-empty"
        data-presence={
          check.truth === "not-observed"
            ? "not-observed"
            : check.truth === "source-gated" ||
                check.truth === "unavailable" ||
                check.truth === "illustrative"
              ? "source-gated"
              : "not-captured"
        }
        className={`rounded-row border border-brand-border bg-brand-panel-sunken p-4 ${className}`}
      >
        <p className="text-[12px] font-semibold text-text-dark-primary">
          {t(titleKey)}
        </p>
        <p className="mt-2 text-[11.5px] leading-[1.6] text-text-dark-secondary">
          {t(bodyKey)}
        </p>
      </div>
    );
  }

  return (
    <section
      data-testid="agent-evidence-details"
      data-observation-total={observations.length}
      className={className}
    >
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h5 className="text-[12px] font-semibold text-text-dark-primary">
            {t("affectedObservationsTitle", { total: urlCount })}
          </h5>
          <p className="mt-1 font-mono text-[10.5px] text-text-dark-faint">
            {t("affectedObservationsCount", {
              shown: shown.length,
              total: observations.length,
            })}
          </p>
        </div>
        {observations.length > DEFAULT_VISIBLE_OBSERVATIONS ? (
          <button
            type="button"
            data-testid="agent-evidence-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="rounded border border-brand-border-strong px-2.5 py-1.5 text-[11px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {expanded
              ? t("showFirstObservations", {
                  count: DEFAULT_VISIBLE_OBSERVATIONS,
                })
              : t("showAllObservations", { count: observations.length })}
          </button>
        ) : null}
      </header>

      <div className="mt-3 grid gap-2.5">
        {shown.map((observation, observationIndex) => {
          const href = observationHref(observation.url);
          const displayedTarget =
            observation.url ?? auditT("siteLevelObservation");
          return (
            <article
              key={`${observation.url ?? "site"}:${observationIndex}`}
              data-testid="agent-affected-observation"
              data-observation-kind={
                observation.url === null ? "site-level" : "url"
              }
              className="rounded-row border border-brand-border bg-brand-panel-sunken p-3.5"
            >
              {href === null ? (
                <p className="break-all font-mono text-[10.5px] text-brand-accent-text">
                  {displayedTarget}
                </p>
              ) : (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("openAffectedObservation", {
                    url: displayedTarget,
                  })}
                  className="break-all font-mono text-[10.5px] text-brand-accent-text underline decoration-brand-border underline-offset-4 transition-colors hover:text-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                >
                  {displayedTarget}
                </a>
              )}

              <div className="mt-3 grid gap-3">
                {observation.recordGroups.map((group, groupIndex) => (
                  <section
                    key={`${group.recordId}:${groupIndex}`}
                    data-record-id={group.recordId}
                    className="rounded-[8px] border border-brand-border-faint bg-brand-panel-raised p-3"
                  >
                    <dl className="grid gap-2 sm:grid-cols-3">
                      <div className="min-w-0">
                        <dt className="font-mono text-[10px] tracking-[0.08em] text-text-dark-faint uppercase">
                          {t("evidenceRecordLabel")}
                        </dt>
                        <dd className="mt-1 break-words text-[11px] text-text-dark-primary">
                          {auditT.has(`records.${group.recordId}.title`)
                            ? auditT(`records.${group.recordId}.title`)
                            : group.recordId}
                        </dd>
                        <dd className="mt-1 break-all font-mono text-[10px] text-text-dark-faint">
                          {group.recordId}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="font-mono text-[10px] tracking-[0.08em] text-text-dark-faint uppercase">
                          {t("sourceLabel")}
                        </dt>
                        <dd className="mt-1 break-words text-[11px] text-text-dark-primary">
                          {localized(group.source, locale)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="font-mono text-[10px] tracking-[0.08em] text-text-dark-faint uppercase">
                          {t("truthLabel")}
                        </dt>
                        <dd className="mt-1 text-[11px] text-text-dark-primary">
                          {diagnosisT(`truth.${TRUTH_KEY[group.truth]}`)}
                        </dd>
                      </div>
                    </dl>
                    {group.values.length > 0 ? (
                      <dl className="mt-3 grid gap-2 border-t border-brand-border-faint pt-3 sm:grid-cols-2">
                        {group.values.map((entry, valueIndex) => {
                          const messageKey = `evidence.${entry.label}`;
                          return (
                            <div
                              key={`${entry.label}:${valueIndex}`}
                              className="min-w-0"
                            >
                              <dt className="font-mono text-[10px] tracking-[0.08em] text-text-dark-faint uppercase">
                                {auditT.has(messageKey)
                                  ? auditT(messageKey)
                                  : entry.label}
                              </dt>
                              <dd className="mt-1 break-all font-mono text-[11px] text-text-dark-primary">
                                {evidenceValue(entry.value)}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    ) : null}
                  </section>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {urlCount > 1 ? (
        <p className="mt-3 text-[11.5px] leading-[1.6] text-text-dark-secondary">
          {t("affectedObservationsTemplateHint")}
        </p>
      ) : null}
    </section>
  );
}
