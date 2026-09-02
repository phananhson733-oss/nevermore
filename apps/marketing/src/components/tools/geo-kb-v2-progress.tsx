"use client";
// @input  -- the gate values the editor already computes
// @output -- one ordered progress model naming what is next and what blocks it
// @pos    -- presentation only; it enables nothing the editor would refuse
import { useTranslations } from "next-intl";
import { geoKbV2Steps, type GeoKbV2StepInput } from "../../lib/geo-tools/kb-v2-steps.ts";

export function GeoKbV2Progress(input: GeoKbV2StepInput) {
  const t = useTranslations("tools.geoKnowledgeBase.steps");
  const steps = geoKbV2Steps(input);
  return <section data-geo-v2-progress aria-label={t("title")} className="min-w-0 rounded-card border border-brand-border-card bg-brand-bg px-4 py-4">
    <ol className="grid gap-2">
      {steps.map((step, index) => <li key={step.id} data-step={step.id} data-step-state={step.state} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span aria-hidden="true" className="tabular-nums text-text-dark-secondary">{index + 1}</span>
        <span className={step.state === "blocked" ? "text-text-dark-secondary" : "font-medium text-text-dark-primary"}>{t(step.id)}</span>
        <span className={`rounded-full border px-2 py-[1px] text-[11px] ${step.state === "done" ? "border-brand-accent text-brand-accent-text" : step.state === "ready" ? "border-brand-border-strong text-text-dark-primary" : "border-brand-border-card text-text-dark-secondary"}`}>{t(`states.${step.state}`)}</span>
        {step.reason === null ? null : <span className="text-[13px] text-text-dark-secondary">{t(`reasons.${step.reason}`)}</span>}
      </li>)}
    </ol>
  </section>;
}
