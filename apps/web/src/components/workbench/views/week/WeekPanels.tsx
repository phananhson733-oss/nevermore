"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { WeekEvent } from "@/lib/workbench/mock/builders/week";
import { workbenchHref, type WorkbenchPageId } from "@/lib/workbench/routes";
import {
  BUTTON_MINI,
  BUTTON_SECONDARY,
  CARD_PAD,
  CARD_SHELL,
  PANEL_BODY,
  PANEL_HEAD,
  PANEL_SHELL,
  PANEL_TITLE,
  ROW_RULE,
} from "../../ui/panel.ts";
import { UNKNOWN_TEXT } from "../../ui/stat-format.ts";
import { weekNextSteps, type BorderlineQuery, type WeekSummary } from "./week-summary.ts";

/**
 * Everything under the cards: the summary row (Q18's other three numbers), the
 * event feed, the borderline list (Q17) and the next steps.
 *
 * - A count that is not known gets its own sentence with an em dash, never a
 *   zero in the counted one (a plural's `#` cannot print a dash).
 * - The borderline panel lists positions from the latest import and nothing
 *   else: no before/after, no arrow, no signed number (Q17). With no usable
 *   position it shows a dash, not "no queries in that range" — that sentence is
 *   a measurement and there was none.
 * - Every "go" is a `<Link>` (Q21), so the Studio unsaved-changes guard sees it.
 */

function eventTarget(event: WeekEvent): WorkbenchPageId {
  return event.kind === "artifact" ? "artifacts" : event.module;
}

function SummaryRow({ summary }: { readonly summary: WeekSummary }) {
  const t = useTranslations("workbench.week.summaryRow");
  return (
    <ul
      data-wb-frame=""
      data-wb-week-summary=""
      className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600"
    >
      <li data-wb-summary="artifacts">{t("artifacts", { count: summary.artifactsThisWeek })}</li>
      <li data-wb-summary="answerGaps">
        {summary.answerGaps === null
          ? t("answerGapsUnknown", { value: UNKNOWN_TEXT })
          : t("answerGaps", { count: summary.answerGaps })}
      </li>
      <li data-wb-summary="kbGaps">
        {summary.kbGaps === null
          ? t("kbGapsUnknown", { value: UNKNOWN_TEXT })
          : t("kbGaps", { count: summary.kbGaps })}
      </li>
    </ul>
  );
}

function FeedPanel({
  events,
  projectId,
}: {
  readonly events: readonly WeekEvent[];
  readonly projectId: string;
}) {
  const t = useTranslations("workbench.week.feed");
  const tModule = useTranslations("workbench.enums.module");
  return (
    <section data-wb-week-feed="" className={PANEL_SHELL}>
      <div data-wb-frame="" className={PANEL_HEAD}>
        <h2 className={PANEL_TITLE}>{t("title")}</h2>
        <span className="text-xs text-slate-500">{t("count", { count: events.length })}</span>
      </div>
      {events.length === 0 ? (
        <p data-wb-frame="" className={`${PANEL_BODY} text-sm text-slate-500`}>
          {t("empty")}
        </p>
      ) : (
        <ul>
          {events.map((event, index) => (
            <li
              key={`${event.kind}-${event.at}-${index}`}
              data-wb-event=""
              className={`${ROW_RULE} flex flex-col gap-2 px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-6 md:px-6`}
            >
              <time dateTime={event.at} className="shrink-0 font-mono text-xs text-slate-500">
                {event.at}
              </time>
              <span className="min-w-0 flex-1 break-words text-sm text-slate-700">
                <span className="text-slate-500">{tModule(event.module)}</span>
                {event.title === null ? null : <span className="ml-2">{event.title}</span>}
              </span>
              <Link href={workbenchHref(projectId, eventTarget(event))} className={BUTTON_MINI}>
                {t("view")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BorderlineRows({ rows }: { readonly rows: readonly BorderlineQuery[] }) {
  return (
    <ul className="mt-4 max-h-[420px] overflow-y-auto">
      {rows.map((row, index) => (
        <li
          key={`${row.query}-${index}`}
          data-wb-borderline=""
          className={`${ROW_RULE} flex items-center justify-between gap-4 py-2 first:border-t-0`}
        >
          <span className="min-w-0 break-words text-sm text-slate-700">{row.query}</span>
          <span className="shrink-0 font-mono text-xs text-slate-500">{String(row.position)}</span>
        </li>
      ))}
    </ul>
  );
}

function BorderlinePanel({ borderline }: { readonly borderline: WeekSummary["borderline"] }) {
  const t = useTranslations("workbench.week.borderlineList");
  return (
    <section data-wb-week-borderline="" className={`${PANEL_SHELL} h-fit`}>
      <div data-wb-frame="" className={PANEL_HEAD}>
        <h2 className={PANEL_TITLE}>{t("title")}</h2>
      </div>
      <div className={PANEL_BODY}>
        <p data-wb-frame="" className="text-sm text-slate-500">
          {t("detail")}
        </p>
        {borderline === null ? (
          <p data-wb-borderline-unknown="" className="mt-4 text-sm text-slate-500">
            {UNKNOWN_TEXT}
          </p>
        ) : borderline.length === 0 ? (
          <p data-wb-frame="" className="mt-4 text-sm text-slate-500">
            {t("empty")}
          </p>
        ) : (
          <BorderlineRows rows={borderline} />
        )}
      </div>
    </section>
  );
}

function NextSteps({ summary, projectId }: { readonly summary: WeekSummary; readonly projectId: string }) {
  const t = useTranslations("workbench.week.next");
  return (
    <section data-wb-frame="" data-wb-week-next="" className={`mt-6 ${CARD_SHELL} ${CARD_PAD}`}>
      <h2 className={PANEL_TITLE}>{t("title")}</h2>
      <ol className="mt-2">
        {weekNextSteps(summary).map((step) => (
          <li
            key={step.id}
            data-wb-step={step.id}
            className={`${ROW_RULE} flex flex-wrap items-center justify-between gap-3 py-4 first:border-t-0`}
          >
            <span className="text-sm text-slate-700">
              {step.count === null
                ? t("step.keepGoing")
                : t(`step.${step.id}`, { count: step.count })}
            </span>
            <Link href={workbenchHref(projectId, step.target)} className={BUTTON_SECONDARY}>
              {t("cta")}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WeekPanels({
  summary,
  projectId,
}: {
  readonly summary: WeekSummary;
  readonly projectId: string;
}) {
  return (
    <>
      <SummaryRow summary={summary} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        <FeedPanel events={summary.events} projectId={projectId} />
        <BorderlinePanel borderline={summary.borderline} />
      </div>
      <NextSteps summary={summary} projectId={projectId} />
    </>
  );
}
