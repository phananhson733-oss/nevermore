// @input  -- the v3 result, the lane+band filtered rows in surface order, the two filter values, the viewer locale, and an error sink
// @output -- one "copy rows as plan" button with its own inline copied-count status line
// @pos    -- the clipboard export control in the Marketing competitor gap results table header

"use client";

import { useState } from "react";
import type {
  CompetitorKeywordGapResultV3,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";

import {
  buildCompetitorKeywordGapPlan,
  COPY_PLAN_MAX_ROWS,
} from "../../lib/tools/competitor-keyword-gap-copy-plan";
import { ACTION_BUTTON, type Translate } from "./competitor-keyword-gap-results-shared";

export function CopyPlanButton({
  result,
  rows,
  laneFilter,
  bandFilter,
  locale,
  onActionError,
  t,
}: {
  readonly result: CompetitorKeywordGapResultV3;
  /** The current lane and band filter in full order, never only the visible ten. */
  readonly rows: readonly CompetitorKeywordGapRow[];
  readonly laneFilter: string;
  readonly bandFilter: string;
  readonly locale: string;
  /** The table's shared alert: null clears it, a message replaces it. */
  readonly onActionError: (message: string | null) => void;
  readonly t: Translate;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const planRowCount = Math.min(rows.length, COPY_PLAN_MAX_ROWS);

  /**
   * The plan is built outside the try: it is pure over typed data, so a failure
   * there is a defect to surface, not a browser limitation to tell the visitor
   * about. Only the clipboard write can legitimately fail in the visitor's browser.
   */
  async function copyPlan(): Promise<void> {
    const plan = buildCompetitorKeywordGapPlan({
      locale: locale.startsWith("zh") ? "zh" : "en",
      result,
      rows,
      laneFilter,
      bandFilter,
    });
    try {
      await navigator.clipboard.writeText(plan.markdown);
      onActionError(null);
      setStatus(t("actions.copyPlanDone", { count: plan.rowCount }));
    } catch {
      setStatus(null);
      onActionError(t("actions.copyPlanFailed"));
    }
  }

  return (
    <>
      <button
        type="button"
        data-row-action="copy-plan"
        className={`${ACTION_BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={planRowCount === 0}
        onClick={() => void copyPlan()}
      >
        {t("actions.copyPlan", { count: planRowCount })}
      </button>
      {status !== null ? (
        <div
          role="status"
          aria-live="polite"
          className="text-[12.5px] text-text-dark-secondary"
        >
          {status}
        </div>
      ) : null}
    </>
  );
}
