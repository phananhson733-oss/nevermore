"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { activeWorkbenchPage, workbenchHref } from "@/lib/workbench/routes";
import { useWorkbench, useWorkbenchCounts } from "@/lib/workbench/store/hooks";
import { cn } from "../ui/cn.ts";
import { SiteCard, type SidebarSite } from "./SiteCard.tsx";
import { TONE_DOT, WORKBENCH_NAV } from "./workbench-nav.ts";
import { useProjectShellEffects } from "./useProjectShellEffects.ts";

export type { SidebarSite };

/**
 * The workbench rail (opengengrowth `Sidebar.tsx` L86–142). Off-canvas below
 * `md`, where it is also `inert` while closed once hydrated — the media query
 * only resolves after mount — so the background nav is unreachable by keyboard
 * and AT.
 */
export function Sidebar({
  projectId,
  site,
  siteCount,
  open,
  mobile,
  id,
}: {
  readonly projectId: string;
  readonly site: SidebarSite;
  readonly siteCount: number;
  readonly open: boolean;
  readonly mobile: boolean;
  readonly id: string;
}) {
  const t = useTranslations("workbench");
  const pathname = usePathname();
  const active = activeWorkbenchPage(pathname, projectId);
  const counts = useWorkbenchCounts();
  const { state, ready } = useWorkbench();
  const { confirmNavigation } = useProjectShellEffects();

  return (
    <aside
      id={id}
      data-app-shell-sidebar=""
      inert={mobile && !open}
      className={cn(
        // `h-dvh`, not `min-h-screen`: a fixed box with only a minimum height
        // grows to fit its content, so `overflow-y-auto` never has anything to
        // scroll and the last nav items fall below the fold on short viewports.
        "wb-reset fixed left-0 top-0 z-30 flex h-dvh w-64 flex-col overflow-y-auto border-r border-wb-rail-line bg-wb-rail font-sans text-wb-rail-text transition-transform duration-300 ease-in-out md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex min-h-full flex-col p-4 pt-5">
        <div className="mb-6 flex items-center gap-3 px-1" data-wb-brand="">
          <div
            className="flex h-8 w-8 items-center justify-center rounded bg-white text-sm font-bold text-zinc-900 shadow-sm"
            aria-hidden="true"
          >
            GG
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-zinc-100">
              GenGrowth
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {t("shell.tagline")}
            </div>
          </div>
        </div>

        <SiteCard site={site} lastAudit={state.lastAudit} ready={ready} />

        <nav aria-label={t("nav.label")} className="flex-1 space-y-5 pb-6">
          {WORKBENCH_NAV.map((group) => (
            <div key={group.id}>
              <h4 className="mb-1.5 px-2.5 text-[11px] font-medium text-wb-rail-muted">
                {t(`nav.groups.${group.id}`)}
              </h4>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = active === item.id;
                  const badge =
                    item.badge === null
                      ? null
                      : counts === null
                        ? "loading"
                        : counts[item.badge];
                  return (
                    <Link
                      key={item.id}
                      href={workbenchHref(projectId, item.id)}
                      aria-current={isActive ? "page" : undefined}
                      data-wb-nav={item.id}
                      onClick={(event) => confirmNavigation(event, isActive)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                        isActive
                          ? "bg-wb-rail-3 text-zinc-100"
                          : "text-wb-rail-text hover:bg-wb-rail-2 hover:text-zinc-200",
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full opacity-80",
                            TONE_DOT[item.tone],
                          )}
                          aria-hidden="true"
                        />
                        <span>{t(`nav.items.${item.id}`)}</span>
                      </span>
                      {badge === "loading" ? (
                        <span
                          className="h-3 w-5 animate-pulse rounded bg-wb-rail-3"
                          aria-hidden="true"
                        />
                      ) : badge ? (
                        <span
                          className="text-[11px] font-medium text-wb-rail-muted"
                          data-wb-badge={item.id}
                        >
                          {badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-4 border-t border-wb-rail-3/50 px-2 pt-4 text-[11px] leading-relaxed text-wb-rail-muted">
          <span className="block font-medium">
            {t("shell.sites", { count: siteCount })} · {t("shell.shortcutHint")}
          </span>
          <span className="mt-1 block text-[10px] text-wb-rail-dim">
            {t("shell.footerNote")}
            <br />
            {t("shell.footerDetail")}
          </span>
        </div>
      </div>
    </aside>
  );
}
