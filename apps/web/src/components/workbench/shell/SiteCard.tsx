"use client";

import { useTranslations } from "next-intl";
import type { AuditReport } from "@/lib/workbench/types";

export interface SidebarSite {
  readonly host: string;
  readonly marketCode: string | null;
  /** null = not wired yet (PR-3 reads sources readiness). */
  readonly gscConnected: boolean | null;
}

/**
 * Rail site card (opengengrowth `Sidebar.tsx` L87–97). The audit row is the one
 * mock-backed value here, so it carries the sample-data marker (design §6.8).
 */
export function SiteCard({
  site,
  lastAudit,
  ready,
}: {
  readonly site: SidebarSite;
  readonly lastAudit: AuditReport | null;
  readonly ready: boolean;
}) {
  const t = useTranslations("workbench.shell");
  return (
    <div
      className="mb-6 rounded-xl border border-wb-rail-3/50 bg-wb-rail-2 p-3.5 text-sm"
      data-wb-site-card=""
    >
      <div className="mb-3 text-xs font-medium text-zinc-200">{site.host}</div>
      <dl className="grid grid-cols-[40px_1fr] gap-y-1.5 text-xs">
        <dt className="text-wb-rail-label">{t("siteCard.market")}</dt>
        <dd className="text-zinc-300">
          {site.marketCode ?? t("siteCard.none")}
        </dd>
        <dt className="text-wb-rail-label">{t("siteCard.gsc")}</dt>
        <dd className="text-zinc-300">
          {site.gscConnected === null
            ? t("siteCard.none")
            : site.gscConnected
              ? t("siteCard.connected")
              : t("siteCard.notConnected")}
        </dd>
        <dt className="text-wb-rail-label">{t("siteCard.audit")}</dt>
        <dd className="text-zinc-300">
          {ready && lastAudit ? (
            <>
              {lastAudit.at.slice(5)}
              <span className="ml-1 text-[10px] text-amber-400/80">
                {t("sampleData")}
              </span>
            </>
          ) : (
            t("siteCard.none")
          )}
        </dd>
      </dl>
    </div>
  );
}
