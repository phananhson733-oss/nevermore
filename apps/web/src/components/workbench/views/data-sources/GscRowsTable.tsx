"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { countByGscStatus, gscStatus } from "@/lib/workbench/mock/gsc";
import { workbenchHref } from "@/lib/workbench/routes";
import type { GscRow, GscRowsSource, GscStatus } from "@/lib/workbench/types";
import { Chip, type ChipTone } from "../../ui/Chip.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import {
  BUTTON_MINI,
  PANEL_HEAD,
  PANEL_SHELL,
  PANEL_TAG,
  PANEL_TITLE,
  TABLE_HEAD_ROW,
  TABLE_ROW,
  TABLE_SHELL,
} from "../../ui/panel.ts";

/**
 * The GSC rows saved in this browser (T10 Step 4): the first
 * `GSC_TABLE_LIMIT` rows, with "showing the first N of M" when there are more.
 *
 * - A number that is not there is "—", never 0; a real 0 prints as 0. CTR is
 *   stored as a percent (0.7 means 0.7%) and formatted as one.
 * - The status chip is `gscStatus` → `workbench.enums.gscStatus`; `unknown`
 *   gets the neutral tone, and its position cell is "—" for the same reason the
 *   keyword matrix drops it (`keywords.ts` `gscDraft`).
 * - The summary counts "rows with an unknown position", not "rows without a
 *   ranking": a row with no usable position may sit anywhere, and saying it
 *   has none turns missing evidence into an observed negative (codex #5).
 * - The sample marker follows `gscRowsSource === "sample"` and nothing else
 *   (Q6): not `state.demo` (after a sample load the operator's own import keeps
 *   `demo` true), and not unconditionally (this block's one action is importing
 *   the operator's own data, codex #4). `null` provenance shows no marker —
 *   neither label is true of it.
 *
 * The rows arrive deduplicated by the import boundary (`mock/gsc-import.ts`),
 * so this table does not dedupe; rows persisted before that boundary existed
 * are shown as stored.
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function GscRowsTable({
  projectId,
  rows,
  source,
}: {
  readonly projectId: string;
  readonly rows: readonly GscRow[];
  readonly source: GscRowsSource | null;
}) {
  const t = useTranslations("workbench.dataSources.table");
  const tEmpty = useTranslations("workbench.dataSources.empty");
  const tPanes = useTranslations("workbench.panes");
  return (
    <section data-wb-gsc-table="" className={PANEL_SHELL}>
      <div data-wb-frame="" className={PANEL_HEAD}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={PANEL_TAG}>{tPanes("out")}</span>
          <h2 className={PANEL_TITLE}>{t("title")}</h2>
          {rows.length === 0 ? null : (
            <span data-wb-gsc-count="" className="text-xs text-slate-500">
              {t("count", { count: rows.length })}
            </span>
          )}
          {source === "sample" ? <SampleMark /> : null}
        </div>
        {rows.length === 0 ? null : (
          <Link href={workbenchHref(projectId, "keywords")} className={BUTTON_MINI}>
            {t("toKeywords")}
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <div data-wb-frame="">
          <EmptyState title={tEmpty("title")} detail={tEmpty("detail")} />
        </div>
      ) : (
        <RowsBody rows={rows} />
      )}
    </section>
  );
}

export const GSC_TABLE_LIMIT = 60;

const DASH = "—";

/** `ctr` is stored as a percent; `Intl` percent style wants a fraction. */
const PERCENT = 100;

const COLUMNS = ["query", "clicks", "impressions", "ctr", "position", "status"] as const;

const TEXT_COLUMNS: ReadonlySet<(typeof COLUMNS)[number]> = new Set(["query", "status"]);

const STATUS_TONE: Readonly<Record<GscStatus, ChipTone>> = {
  ranked: "seo",
  borderline: "warn",
  gap: "bad",
  unknown: "neutral",
};

const NUMERIC_CELL = "whitespace-nowrap py-2.5 pr-4 text-right tabular-nums";

function SampleMark() {
  const tShell = useTranslations("workbench.shell");
  return (
    <span data-wb-gsc-sample="">
      <Chip tone="warn">{tShell("sampleData")}</Chip>
    </span>
  );
}

function RowsBody({ rows }: { readonly rows: readonly GscRow[] }) {
  const t = useTranslations("workbench.dataSources.table");
  const unknown = countByGscStatus(rows).unknown;
  const shown = rows.slice(0, GSC_TABLE_LIMIT);
  return (
    <div className="p-4 md:px-6">
      <p data-wb-frame="" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>{t("legend")}</span>
        {unknown === 0 ? null : <span data-wb-unknown-rank="">{t("unknownRank", { count: unknown })}</span>}
      </p>
      <div className="overflow-x-auto">
        <table className={TABLE_SHELL}>
          <thead data-wb-frame="">
            <tr className={TABLE_HEAD_ROW}>
              {COLUMNS.map((column) => (
                <th key={column} scope="col" className={TEXT_COLUMNS.has(column) ? "py-2 pr-4" : "py-2 pr-4 text-right"}>
                  {t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <GscRowLine key={`${index}:${row.query}`} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > GSC_TABLE_LIMIT ? (
        <p data-wb-frame="" data-wb-showing="" className="mt-3 text-xs text-slate-500">
          {t("showing", { shown: shown.length, total: rows.length })}
        </p>
      ) : null}
    </div>
  );
}

function GscRowLine({ row }: { readonly row: GscRow }) {
  const format = useFormatter();
  const tStatus = useTranslations("workbench.enums.gscStatus");
  const status = gscStatus(row);
  const count = (value: number | null): string => (value === null ? DASH : format.number(value));
  return (
    <tr data-wb-gsc-row="" className={TABLE_ROW}>
      <td className="min-w-[160px] break-words py-2.5 pr-4 font-medium text-slate-900">{row.query}</td>
      <td className={NUMERIC_CELL}>{count(row.clicks)}</td>
      <td className={NUMERIC_CELL}>{count(row.impressions)}</td>
      <td className={NUMERIC_CELL}>
        {row.ctr === null ? DASH : format.number(row.ctr / PERCENT, { style: "percent", maximumFractionDigits: 2 })}
      </td>
      <td className={NUMERIC_CELL}>
        {status === "unknown" || row.position === null
          ? DASH
          : format.number(row.position, { maximumFractionDigits: 1 })}
      </td>
      <td className="whitespace-nowrap py-2.5">
        <Chip tone={STATUS_TONE[status]}>{tStatus(status)}</Chip>
      </td>
    </tr>
  );
}
