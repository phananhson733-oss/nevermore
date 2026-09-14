"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { GscMetric } from "@/lib/workbench/mock/gsc";
import type { GscImport } from "@/lib/workbench/mock/gsc-import";
import type { ImportNotice } from "./use-gsc-import.ts";

/**
 * What the last import did, in the pane (T10 Step 3). The live region is always
 * mounted — a region inserted together with its text is not announced — and
 * holds nothing until the first import.
 *
 * - Counts first: "N parsed · M skipped". Repeated queries are part of M and get
 *   their own sentence, which also says which row survived (Step 1b).
 * - The cap sentence appears only when rows were cut; its two numbers are the
 *   kept and the parsed count, in that order (pinned in the pane's test).
 * - Columns are named from `recognized` and from nothing else (Q7): a column
 *   whose cells are all blank was recognised, and inferring "not recognised"
 *   from null values would say the opposite. `recognized === null` (no header
 *   named a metric) says the columns were read by position instead — but only
 *   when there were records to read.
 * - Nothing imported says the saved rows were left unchanged: the parse
 *   dispatched nothing (`use-gsc-import.ts`).
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function GscImportNotice({ notice, limit }: { readonly notice: ImportNotice | null; readonly limit: string }) {
  return (
    <div role="status" data-wb-import-notice="" className="mt-4 flex flex-col gap-1 text-sm text-slate-700">
      {notice === null ? null : <NoticeBody notice={notice} limit={limit} />}
    </div>
  );
}

const METRICS = ["clicks", "impressions", "ctr", "position"] as const satisfies readonly GscMetric[];

function NoticeBody({ notice, limit }: { readonly notice: ImportNotice; readonly limit: string }) {
  const t = useTranslations("workbench.dataSources.import");
  if (notice.kind === "tooLarge") return <p data-wb-result="tooLarge">{t("tooLarge", { limit })}</p>;
  if (notice.kind === "readFailed") return <p data-wb-result="readFailed">{t("readFailed")}</p>;
  return <ResultLines result={notice.result} />;
}

function ResultLines({ result }: { readonly result: GscImport }) {
  const t = useTranslations("workbench.dataSources");
  const { recognized } = result;
  const missing = recognized === null ? null : METRICS.filter((metric) => !recognized[metric]);
  return (
    <>
      <p data-wb-result="counts">
        {t("result.parsed", { count: result.parsed })} · {t("result.skipped", { count: result.skipped })}
      </p>
      {result.duplicates > 0 ? (
        <p data-wb-result="duplicates">{t("result.duplicates", { count: result.duplicates })}</p>
      ) : null}
      {result.rows.length < result.parsed ? (
        <p data-wb-result="truncated">
          {t("import.truncated", { kept: result.rows.length, total: result.parsed })}
        </p>
      ) : null}
      <ColumnsLine missing={missing} sawRecords={result.parsed + result.skipped > 0} />
      {result.rows.length === 0 ? <p data-wb-result="nothing">{t("result.nothingImported")}</p> : null}
    </>
  );
}

function ColumnsLine({
  missing,
  sawRecords,
}: {
  readonly missing: readonly GscMetric[] | null;
  readonly sawRecords: boolean;
}) {
  const t = useTranslations("workbench.dataSources");
  const format = useFormatter();
  if (missing === null) {
    return sawRecords ? <p data-wb-result="noHeader">{t("result.noHeader")}</p> : null;
  }
  if (missing.length === 0) return null;
  const columns = format.list(
    missing.map((metric) => t(`table.${metric}`)),
    { type: "conjunction" },
  );
  return <p data-wb-result="unrecognized">{t("result.unrecognizedColumns", { columns })}</p>;
}
