"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LEGACY_LINKS, legacyHref } from "@/lib/workbench/routes";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { cn } from "../../ui/cn.ts";
import { LegacyLinks } from "../../ui/LegacyLinks.tsx";
import { PageHead } from "../../ui/PageHead.tsx";
import { BUTTON_MINI, PANEL_SHELL, PANEL_TITLE } from "../../ui/panel.ts";
import { DataSourcesPanel } from "./DataSourcesPanel.tsx";
import { GscImportPane } from "./GscImportPane.tsx";
import { GscRowsTable } from "./GscRowsTable.tsx";

/**
 * Data sources (design §12, T10): two things and nothing else (Q5).
 *
 * 1. Real connections, read only (`DataSourcesPanel`), with a link to the legacy
 *    `sources` page where connecting and disconnecting still live (the OAuth
 *    callback redirects there). No "daily 06:00 sync" and no GA4 403 box: this
 *    app has no sync schedule and no producer for either (Q15).
 * 2. The GSC import saved in this browser (`GscImportPane`) beside the rows it
 *    saved (`GscRowsTable`).
 *
 * No sample chip in the page head (codex #4): the page's only action imports the
 * operator's own data, so an unconditional "sample data" label would be false.
 * The one sample marker lives on the rows table and follows `gscRowsSource`
 * (Q6).
 *
 * The real section does not wait for the local store: it reads the server. The
 * import area renders a skeleton until storage has been read (Q10) — before
 * that, "no rows" would be the seed talking, and a parse would be discarded by
 * hydration. The root is `<main>`'s direct child with its own padding and
 * `.wb-reset`, two-pane width (Q26); frame copy carries `data-wb-frame` (Q30).
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function DataSourcesView({ projectId }: { readonly projectId: string }) {
  const { ready } = useWorkbench();
  const tNav = useTranslations("workbench.nav.items");
  const t = useTranslations("workbench.dataSources");
  return (
    <div className="wb-reset mx-auto min-h-full max-w-[1600px] p-6 font-sans text-slate-900 md:p-10">
      <div data-wb-frame="">
        <PageHead
          title={tNav("dataSources")}
          subtitle={t("subtitle")}
          aside={<LegacyLinks projectId={projectId} segments={LEGACY_LINKS.dataSources} />}
        />
      </div>
      <RealConnectionsSection projectId={projectId} />
      {ready ? <ImportArea projectId={projectId} /> : <ImportSkeleton />}
    </div>
  );
}

const IMPORT_GRID = "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]";

function RealConnectionsSection({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("workbench.dataSources.real");
  return (
    <section data-wb-real-connections="" className="mb-8">
      <div data-wb-frame="" className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className={PANEL_TITLE}>{t("title")}</h2>
        <Link href={legacyHref(projectId, "sources")} className={BUTTON_MINI}>
          {t("manageLegacy")}
        </Link>
      </div>
      <DataSourcesPanel projectId={projectId} />
    </section>
  );
}

function ImportArea({ projectId }: { readonly projectId: string }) {
  const { state } = useWorkbench();
  return (
    <div className={IMPORT_GRID}>
      <GscImportPane />
      <GscRowsTable projectId={projectId} rows={state.gscRows} source={state.gscRowsSource} />
    </div>
  );
}

function ImportSkeleton() {
  return (
    <div aria-busy="true" data-wb-skeleton="" className={IMPORT_GRID}>
      <div aria-hidden="true" className={cn(PANEL_SHELL, "h-80 animate-pulse motion-reduce:animate-none")} />
      <div aria-hidden="true" className={cn(PANEL_SHELL, "h-80 animate-pulse motion-reduce:animate-none")} />
    </div>
  );
}
