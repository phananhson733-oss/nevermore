"use client";

import Link from "next/link";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { legacyHref, workbenchHref } from "@/lib/workbench/routes";
import { BUTTON_MINI, PANEL_TITLE } from "../../ui/panel.ts";
import { DataSourcesPanel } from "../data-sources/DataSourcesPanel.tsx";

/**
 * The settings page's data-sources block (T11 Step 3): status only. It names
 * the block, says import and management live elsewhere, links to the
 * workbench data-sources page and to the legacy `sources` page (where OAuth
 * connect / disconnect still live), and mounts the shared read-only
 * `DataSourcesPanel` for the status itself.
 *
 * No action of its own: no button, no form, no OAuth link, and no
 * `data-wb-real-action` — the delete block stays the page's only real action.
 * The panel's CONTEXT_INCOMPLETE branch adds one `/context` link; that is a way
 * out, not an action, and it stays inside this block.
 *
 * A plain section, not a card: the panel's provider cards are cards already.
 * Frame copy carries `data-wb-frame` (Q30).
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function SourcesSummaryBlock({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("workbench.settings.sources");
  const titleId = useId();
  return (
    <section data-wb-sources-summary="" aria-labelledby={titleId} className="mb-6">
      <div data-wb-frame="" className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className={PANEL_TITLE}>
          {t("title")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={workbenchHref(projectId, "dataSources")} className={BUTTON_MINI}>
            {t("cta")}
          </Link>
          <Link href={legacyHref(projectId, "sources")} className={BUTTON_MINI}>
            {t("legacyCta")}
          </Link>
        </div>
      </div>
      <p data-wb-frame="" data-wb-sources-summary-note="" className="mb-4 text-sm text-slate-600">
        {t("note")}
      </p>
      <DataSourcesPanel projectId={projectId} />
    </section>
  );
}
