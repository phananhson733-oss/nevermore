"use client";

import { useTranslations } from "next-intl";
import {
  WEEKLY_REPORT_META,
  weeklyReportMarkdown,
} from "@/lib/workbench/mock/builders/week";
import { artifactGscData } from "@/lib/workbench/mock/provenance";
import type { GscRowsSource } from "@/lib/workbench/types";
import { usePreparedArtifact } from "../../hooks/usePreparedArtifact.ts";
import {
  ARTIFACT_ACTION_LABEL_KEYS,
  ArtifactActions,
  type ArtifactActionLabels,
} from "../../ui/ArtifactActions.tsx";
import { CARD_SHELL, PANEL_TITLE } from "../../ui/panel.ts";
import { weeklyReportInput, type WeekSummary } from "./week-summary.ts";

/**
 * The weekly report's actions (plan Task 8 Steps 3-4; Q23 / Q37; jsx W13/W18).
 *
 * The body comes from the mock-layer builder and is stamped once, by
 * `useAddArtifact`; copy, export, save and "copy for an AI" all hand over that
 * one prepared text (`ArtifactActions`).
 *
 * The declaration stamped above it follows the GSC rows' source (Q36). The
 * report's only GSC-derived lines are the borderline count and its unknown-rank
 * aside, both printed only when `summary.borderline` is known; otherwise the
 * report shows no GSC data and carries the sample sentence.
 *
 * Prepared by the shared `hooks/usePreparedArtifact.ts` (T9 review P3-5): one
 * object per report content, and nothing while the report's current text is not
 * prepared yet or the store cannot take a save (codex S7b #3, S7r2 #2); the row
 * shows its skeleton then.
 *
 * Labels are the shared `artifactActions` messages, generated from
 * `ARTIFACT_ACTION_LABEL_KEYS` so a label the row gains is picked up here
 * without an edit, with the two the weekly report names itself
 * (`week.report.save` / `week.report.export`) laid over them.
 *
 * An empty project's report is disabled, with the sentence saying why
 * (W18): a report of dashes is not something to hand anyone.
 */

type LabelField = keyof typeof ARTIFACT_ACTION_LABEL_KEYS;

function actionLabels(
  translate: (key: LabelField) => string,
  own: Pick<ArtifactActionLabels, "save" | "exportFile">,
): ArtifactActionLabels {
  const fields = Object.keys(ARTIFACT_ACTION_LABEL_KEYS) as LabelField[];
  const shared = Object.fromEntries(
    fields.map((field) => [field, translate(field)]),
  ) as Record<LabelField, string>;
  return { ...shared, ...own };
}

export function WeekReport({
  summary,
  brand,
  gscRowsSource,
  now,
}: {
  readonly summary: WeekSummary;
  readonly brand: string;
  /** The source of the rows `summary.borderline` was counted from. */
  readonly gscRowsSource: GscRowsSource | null;
  readonly now: Date;
}) {
  const t = useTranslations("workbench.week");
  const tActions = useTranslations("workbench.artifactActions");
  const title = t("artifactTitle", { brand });
  const body = weeklyReportMarkdown(weeklyReportInput(summary, brand, now));
  const gscData = artifactGscData(summary.borderline !== null, gscRowsSource);
  const prepared = usePreparedArtifact({ ...WEEKLY_REPORT_META, title, body, gscData });
  const labels = actionLabels((field) => tActions(field), {
    save: t("report.save"),
    exportFile: t("report.export"),
  });

  return (
    <section data-wb-week-report="" className={`mt-6 ${CARD_SHELL} p-5 md:p-6`}>
      <h2 className={`${PANEL_TITLE} mb-3 break-words`}>{title}</h2>
      {prepared === null ? (
        <div
          data-wb-skeleton=""
          className="h-[28px] w-64 max-w-full animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none"
        />
      ) : (
        <div data-wb-frame="" className="flex flex-col gap-2">
          <ArtifactActions
            prepared={prepared}
            labels={labels}
            disabled={summary.empty}
          />
          {summary.empty ? (
            <p data-wb-report-disabled="" className="text-sm text-slate-500">
              {t("report.disabled")}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
