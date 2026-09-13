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
 * changes. Preparing during render would mint a new id and read the clock on
 * every pass; one object per content keeps whatever the shared row ties to the
 * object it is handed out of this view's concern.
 *
 * Only a prepared report whose key matches the current draft is handed on
 * (codex S7b #3), and only while the store can take a save at all (codex S7r2
 * #2). In the render after the content changes and before the effect prepares
 * the new text, the previous object would otherwise reach the row, and a click
 * in that window would copy, export or save last render's report; the row shows
 * its skeleton for that render instead. When `useAddArtifact` answers `null`
 * the effect prepares nothing and keeps the old slot, so the key alone would
 * go on handing that object out for as long as the content stays the same. Whatever the row was showing
 * for the previous report (a "Saved" flash, a refusal) goes with it, which is
 * the price of never offering text the page no longer says.
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
  return canPrepare && slot?.key === key ? slot.prepared : null;
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
