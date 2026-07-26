"use client";

/**
 * Client report block for the Results screen (R3 blueprint D2). This is the
 * report query boundary: it owns the locale-parameterised `report` read, the
 * `outputLocale` URL/draft controller, and the block-scoped loading / error /
 * retry states. A report failure renders inside this block only — it never
 * swallows the sibling recheck block, and a recheck failure never reaches
 * here. TanStack Query owns the server state (spec §3.2); the report is
 * read-only canonical (no UI-side re-ranking, spec §10.4).
 *
 * `outputLocale` requests the report methodology/export locale independently
 * of the UI locale. Canonical findings, actions, and artifacts keep their
 * recorded content locale, which the document labels explicitly. Print uses
 * the `@media print` block in `report.module.css`.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Spinner, cx } from "@/components/ui";
import {
  normalizeOutputLocale,
  useProjectReport,
  type Report,
} from "@/lib/api/hooks-report";
import { ProblemState } from "../_problem-display";
import { ReportDocument } from "./_report-document.tsx";
import { ExportSection } from "./_export-rail.tsx";
import styles from "./report.module.css";

function localeSuggestions(
  report: Report | undefined,
  committedLocale: string | undefined,
  draftLocale: string,
): readonly string[] {
  const values = new Set<string>();
  if (report) {
    values.add(report.project.defaultDeliveryLocale);
    for (const code of report.project.site.languageCodes) values.add(code);
  }
  if (committedLocale !== undefined) values.add(committedLocale);
  const draft = normalizeOutputLocale(draftLocale);
  if (draft !== undefined) values.add(draft);
  return [...values];
}

function reportUrlWithLocale(
  pathname: string,
  searchParams: { readonly toString: () => string },
  outputLocale: string | undefined,
): string {
  const next = new URLSearchParams(searchParams.toString());
  if (outputLocale === undefined) next.delete("outputLocale");
  else next.set("outputLocale", outputLocale);
  const query = next.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

/**
 * Resolve the locale used by an export click from the current input render.
 * This deliberately does not wait for `router.replace`: browser click ordering
 * fires the input blur before the button click, while the URL transition is
 * asynchronous. A blank draft means "use the project delivery locale"; a
 * non-empty invalid draft keeps the last committed locale.
 */
function exportLocaleForDraft(
  draftLocale: string,
  committedLocale: string,
  defaultDeliveryLocale: string,
): string {
  if (draftLocale.trim().length === 0) return defaultDeliveryLocale;
  return normalizeOutputLocale(draftLocale) ?? committedLocale;
}

/**
 * Report block entry: owns the `report` query (locale-parameterised) and
 * renders the block-scoped loading / error / ready states.
 */
export function ReportSection({
  projectId,
  initialOutputLocale,
}: {
  readonly projectId: string;
  readonly initialOutputLocale?: string | undefined;
}) {
  const tCommon = useTranslations("common");
  const tReport = useTranslations("report");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialLocale = normalizeOutputLocale(initialOutputLocale);
  const rawSearchLocale = searchParams.get("outputLocale");
  const outputLocale = normalizeOutputLocale(rawSearchLocale) ?? initialLocale;
  const invalidSearchLocale =
    rawSearchLocale !== null &&
    normalizeOutputLocale(rawSearchLocale) === undefined;
  const query = useProjectReport(projectId, outputLocale);
  const [draftLocale, setDraftLocale] = useState<string>(outputLocale ?? "");
  const [draftDirty, setDraftDirty] = useState<boolean>(false);

  useEffect(() => {
    if (!invalidSearchLocale) return;
    router.replace(reportUrlWithLocale(pathname, searchParams, undefined), {
      scroll: false,
    });
  }, [invalidSearchLocale, pathname, router, searchParams]);

  useEffect(() => {
    if (draftDirty) return;
    const canonical = outputLocale ?? query.data?.outputLocale ?? "";
    if (draftLocale !== canonical) setDraftLocale(canonical);
  }, [draftDirty, draftLocale, outputLocale, query.data?.outputLocale]);

  const outputLocaleSuggestions = useMemo(
    () => localeSuggestions(query.data, outputLocale, draftLocale),
    [draftLocale, outputLocale, query.data],
  );

  function replaceOutputLocale(nextLocale: string | undefined): void {
    router.replace(reportUrlWithLocale(pathname, searchParams, nextLocale), {
      scroll: false,
    });
  }

  function commitOutputLocale(): void {
    const trimmedDraft = draftLocale.trim();
    setDraftDirty(false);
    if (trimmedDraft.length === 0) {
      const fallback =
        query.data?.project.defaultDeliveryLocale ??
        query.data?.outputLocale ??
        "";
      setDraftLocale(fallback);
      if (rawSearchLocale !== null || outputLocale !== undefined) {
        replaceOutputLocale(undefined);
      }
      return;
    }

    const nextLocale = normalizeOutputLocale(trimmedDraft);
    if (nextLocale === undefined) {
      const fallback = outputLocale ?? query.data?.outputLocale ?? "";
      setDraftLocale(fallback);
      return;
    }
    setDraftLocale(nextLocale);
    if (nextLocale !== outputLocale) replaceOutputLocale(nextLocale);
  }

  function resetOutputLocale(): void {
    setDraftDirty(false);
    setDraftLocale(outputLocale ?? query.data?.outputLocale ?? "");
  }

  if (query.isLoading) {
    return (
      <div className={styles.state}>
        <Spinner size="lg" label={tCommon("loading")} />
        <p className={styles.stateText}>{tCommon("loading")}</p>
      </div>
    );
  }

  if (query.error !== null || query.data === undefined) {
    return (
      <div className={styles.state}>
        <ProblemState
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const committedOutputLocale = outputLocale ?? query.data.outputLocale;
  const exportOutputLocale = exportLocaleForDraft(
    draftLocale,
    committedOutputLocale,
    query.data.project.defaultDeliveryLocale,
  );

  return (
    <div className={styles.page} data-report-page="">
      <div className={styles.workspace} data-report-workspace="">
        <ReportDocument report={query.data} />
        <aside
          className={cx(styles.manifestRail, styles.noPrint)}
          data-report-manifest-rail=""
          aria-label={tReport("export")}
        >
          <ExportSection
            projectId={projectId}
            exportOutputLocale={exportOutputLocale}
            outputLocale={draftLocale}
            outputLocaleSuggestions={outputLocaleSuggestions}
            onOutputLocaleChange={(locale) => {
              setDraftLocale(locale);
              setDraftDirty(true);
            }}
            onOutputLocaleCommit={commitOutputLocale}
            onOutputLocaleReset={resetOutputLocale}
            onPrint={() => window.print()}
          />
        </aside>
      </div>
    </div>
  );
}
