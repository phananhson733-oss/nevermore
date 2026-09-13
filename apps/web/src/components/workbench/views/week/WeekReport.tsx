"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  WEEKLY_REPORT_META,
  weeklyReportMarkdown,
} from "@/lib/workbench/mock/builders/week";
import {
  useAddArtifact,
  type ArtifactDraft,
  type PreparedArtifact,
} from "../../hooks/useAddArtifact.ts";
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
 * Prepared in an effect, keyed by what the draft says, so the same
 * `PreparedArtifact` object survives every re-render until the report's content
 * changes. Preparing during render would mint a new id, read the clock and
 * build a new frozen object each pass — and `ArtifactActions` keys its
 * too-large notice (and `save()` its once-only guard) to that object, so a
 * parent re-render would silently reset both. While a new report is being
 * prepared the previous one stays mounted for that commit, so a "Saved" flash
 * is not torn down by the very save that changed the week's artifact count.
 *
 * Labels are the shared `artifactActions` messages, generated from
 * `ARTIFACT_ACTION_LABEL_KEYS` so a label the row gains is picked up here
 * without an edit, with the two the weekly report names itself
 * (`week.report.save` / `week.report.export`) laid over them.
 *
 * An empty project's report is disabled, with the sentence saying why
 * (W18): a report of dashes is not something to hand anyone.
 */

interface PreparedSlot {
  readonly key: string;
  readonly prepared: PreparedArtifact;
}

function usePreparedArtifact(draft: ArtifactDraft): PreparedArtifact | null {
  const prepare = useAddArtifact();
  const key = JSON.stringify([
    draft.module,
    draft.type,
    draft.engine,
    draft.title,
    draft.filename ?? null,
    draft.body,
  ]);
  const [slot, setSlot] = useState<PreparedSlot | null>(null);
  const canPrepare = prepare !== null;
  useEffect(() => {
    if (prepare === null) return;
    setSlot({ key, prepared: prepare(draft) });
    // `prepare` and `draft` are new objects on every render; `key` is what they
    // carry and `canPrepare` is whether the store can take a save at all.
  }, [key, canPrepare]);
  return slot?.prepared ?? null;
}

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
  now,
}: {
  readonly summary: WeekSummary;
  readonly brand: string;
  readonly now: Date;
}) {
  const t = useTranslations("workbench.week");
  const tActions = useTranslations("workbench.artifactActions");
  const title = t("artifactTitle", { brand });
  const body = weeklyReportMarkdown(weeklyReportInput(summary, brand, now));
  const prepared = usePreparedArtifact({ ...WEEKLY_REPORT_META, title, body });
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
