// @input  -- one report, its confirmed context, and the derived action plan
// @output -- a review-select-preview-copy step that authorizes nothing
// @pos    -- the last screen of the GEO Agent, and the boundary of this product

"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import {
  buildGeoActionHandoff,
  serializeGeoActionHandoff,
  serializeGeoActionHandoffMarkdown,
} from "../../../lib/agents/geo-action-handoff";
import {
  deriveGeoActionPlan,
  GEO_MAX_ACTION_CANDIDATES,
} from "../../../lib/agents/geo-action-mapping";
import type { GeoContextSnapshotV1 } from "../../../lib/agents/geo-context";
import type { GeoReportDataV3 } from "../../../lib/agents/geo-report-contract";

const BUTTON_CLASS =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-accent/50 bg-brand-panel px-5 text-[13.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const CHECKBOX_CLASS =
  "size-4 shrink-0 accent-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

export function GeoActionPanel({
  report,
  context,
}: {
  readonly report: GeoReportDataV3;
  readonly context: GeoContextSnapshotV1;
}) {
  const t = useTranslations("agents.geo");
  // The confirmed page travels in, so the existing-page check names the URL the
  // visitor entered rather than a fabricated site root.
  const plan = useMemo(
    () => deriveGeoActionPlan(report, context.targetUrl),
    [context.targetUrl, report],
  );
  const [selected, setSelected] = useState<readonly string[]>([]);
  /**
   * Query id to the question a visitor actually confirmed.
   *
   * Bounded on purpose: a candidate merged from every question would otherwise
   * print the whole cohort into one label and stop being readable.
   */
  const questionTextFor = useMemo(() => {
    const byId = new Map(
      report.questions.map((question) => [question.queryId, question.text]),
    );
    return (queryIds: readonly string[]): readonly string[] =>
      queryIds
        .map((id) => byId.get(id))
        .filter((text): text is string => text !== undefined)
        .slice(0, 3);
  }, [report.questions]);
  const [copied, setCopied] = useState<"idle" | "done" | "markdown" | "failed">("idle");
  /**
   * The packet text, kept only when the clipboard refused it.
   *
   * The failure copy tells the visitor to select the packet and copy it, which
   * needs a packet on the page to select.
   */
  const [fallback, setFallback] = useState<string | null>(null);

  const toggle = useCallback((actionId: string) => {
    setCopied("idle");
    setFallback(null);
    setSelected((current) =>
      current.includes(actionId)
        ? current.filter((entry) => entry !== actionId)
        : current.length >= GEO_MAX_ACTION_CANDIDATES
          ? current
          : [...current, actionId],
    );
  }, []);

  const built = useMemo(
    () =>
      buildGeoActionHandoff({
        report,
        context,
        candidates: plan.candidates,
        selectedActionIds: selected,
        now: () => new Date(),
      }),
    [context, plan.candidates, report, selected],
  );

  // The builder enforces the packet bounds itself and refuses rather than
  // returning something that cannot be copied, so there is nothing left to
  // re-check here.
  const packetText = useMemo(
    () => (built.ok ? serializeGeoActionHandoff(built.packet) : null),
    [built],
  );
  // The JSON is for an agent. A reader who is not going to paste it anywhere
  // left this screen with nothing, which is the whole complaint this answers.
  const markdownText = useMemo(
    () => (built.ok ? serializeGeoActionHandoffMarkdown(built.packet) : null),
    [built],
  );

  const copyMarkdown = useCallback(async () => {
    if (markdownText === null) return;
    try {
      await navigator.clipboard.writeText(markdownText);
      setCopied("markdown");
      setFallback(null);
    } catch {
      setCopied("failed");
      setFallback(markdownText);
    }
  }, [markdownText]);

  const copy = useCallback(async () => {
    if (packetText === null) return;
    try {
      await navigator.clipboard.writeText(packetText);
      setCopied("done");
      setFallback(null);
    } catch {
      // Browsers deny the clipboard in plenty of ordinary situations. The
      // packet goes on the page instead, so "select it and copy" is true.
      setCopied("failed");
      setFallback(packetText);
    }
  }, [packetText]);

  return (
    <section className="rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 md:p-6">
      <h3 className="text-[14px] font-semibold text-text-dark-primary">
        {t("actions.title")}
      </h3>
      <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
        {t("actions.intro")}
      </p>

      {plan.candidates.length === 0 ? (
        <p className="mt-3 rounded-row border border-brand-border-dashed px-3 py-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t(`actions.zero.${plan.zeroActionReason ?? "needs_more_evidence"}`)}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {plan.candidates.map((candidate) => (
            <li key={candidate.actionId} className="flex items-start gap-2">
              <input
                id={`geo-action-${candidate.actionId}`}
                type="checkbox"
                className={`${CHECKBOX_CLASS} mt-1`}
                checked={selected.includes(candidate.actionId)}
                onChange={() => toggle(candidate.actionId)}
              />
              <label
                className="grid gap-0.5"
                htmlFor={`geo-action-${candidate.actionId}`}
              >
                <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] leading-[1.5] text-text-dark-primary">
                  {/*
                    The kind leads, because "do not" and "do" read identically
                    once they are both a checkbox with a noun beside it, and a
                    reader scanning five rows acts on the first one either way.
                  */}
                  <span
                    className={`inline-flex items-center rounded-row border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase ${
                      candidate.kind === "avoid"
                        ? "border-brand-accent-2/50 text-brand-accent-2"
                        : candidate.kind === "external_data"
                          ? "border-brand-border-dashed text-text-dark-tertiary"
                          : "border-brand-accent/50 text-brand-accent-text"
                    }`}
                  >
                    {t(`actionKinds.${candidate.kind}`)}
                  </span>
                  {t(`assetTypes.${candidate.assetType}`)}
                </span>
                <span className="text-[11.5px] leading-[1.5] text-text-dark-secondary">
                  {candidate.reasonCounts === null
                    ? t(`actionReasons.${candidate.reason}`)
                    : t(`actionReasonsCounted.${candidate.reason}`, {
                        observed: candidate.reasonCounts.observed,
                        evaluable: candidate.reasonCounts.evaluable,
                      })}
                </span>
                {/*
                  Named questions, not ids. "Observed in 0 of 13" is only
                  actionable once the reader knows which thirteen, and the
                  report already has the text a few sections up.
                */}
                {questionTextFor(candidate.queryIds).length > 0 && (
                  <span className="text-[11px] leading-[1.5] text-text-dark-tertiary">
                    {t("actionBasis.questions", {
                      questions: questionTextFor(candidate.queryIds).join(" · "),
                    })}
                  </span>
                )}
                <span className="font-mono text-[10.5px] text-text-dark-tertiary">
                  {t("actions.requiresReview")}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {packetText !== null && (
        <div className="mt-4">
          <h4 className="text-[12.5px] font-semibold text-text-dark-primary">
            {t("actions.previewTitle")}
          </h4>
          <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
            {t("actions.previewHint")}
          </p>
          <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
            {t("handoff.markdownNote")}
          </p>
          <pre className="mt-2 max-h-72 overflow-auto rounded-row border border-brand-border-card bg-brand-panel p-3 font-mono text-[10.5px] leading-[1.5] text-text-dark-secondary">
            {packetText}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() => {
                void copy();
              }}
            >
              {t("actions.copy")}
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() => {
                void copyMarkdown();
              }}
            >
              {t("handoff.copyMarkdown")}
            </button>
            {copied === "done" && (
              <span className="text-[11.5px] text-brand-accent-text">
                {t("actions.copied")}
              </span>
            )}
            {copied === "markdown" && (
              <span className="text-[11.5px] text-brand-accent-text">
                {t("handoff.copiedMarkdown")}
              </span>
            )}
            {copied === "failed" && (
              <span className="text-[11.5px] text-brand-accent-2">
                {t("actions.copyFailed")}
              </span>
            )}
          </div>
          {fallback !== null && (
            <textarea
              readOnly
              aria-label={t("actions.previewTitle")}
              className="mt-3 h-48 w-full rounded-row border border-brand-border-card bg-brand-panel p-3 font-mono text-[10.5px] text-text-dark-secondary"
              value={fallback}
            />
          )}
          <p className="mt-2 text-[11.5px] leading-[1.55] text-text-dark-tertiary">
            {t("actions.copyIsNotApproval")}
          </p>
        </div>
      )}
    </section>
  );
}
