"use client";

import {
  ChartNoAxesCombined,
  LayoutDashboard,
  Map,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type MouseEvent } from "react";
import { cx } from "@/components/ui";
import type { ProjectShellProjection } from "@/lib/services/project-shell";
import {
  hasUnsavedContextChanges,
  shouldConfirmContextNavigation,
} from "./_context-navigation-guard";
import {
  projectHistoryPosition,
  withProjectHistoryPosition,
} from "./_project-history-position.ts";
import {
  PRIMARY_NAV_ITEMS,
  activePrimaryNavKey,
  currentProjectPageLabelKey,
  type PrimaryNavKey,
} from "./_nav-model.ts";
import styles from "./nav.module.css";

/**
 * Customer-visible project navigation. The shell exposes exactly four stable
 * concepts while legacy routes remain valid compatibility aliases.
 */

const PRIMARY_NAV_ICONS: Readonly<Record<PrimaryNavKey, typeof Map>> = {
  overview: LayoutDashboard,
  "growth-map": Map,
  execution: Wrench,
  results: ChartNoAxesCombined,
};

export function ProjectNav({
  projectId,
  navigationBadges,
}: {
  readonly projectId: string;
  readonly navigationBadges: ProjectShellProjection["navigationBadges"];
}) {
  const t = useTranslations("nav");
  const tContext = useTranslations("context");
  const tShell = useTranslations("appShell");
  const pathname = usePathname();
  const active = activePrimaryNavKey(pathname, projectId);
  const historyPositionRef = useRef<number | null>(null);
  const historyPathRef = useRef<string | null>(null);

  // Give every project-shell entry a position without pushing a duplicate
  // entry. Studio can then reverse a cancelled Back or Forward traversal while
  // preserving Next's opaque router state and the browser's forward history.
  useEffect(() => {
    const existing = projectHistoryPosition(window.history.state);
    const previousPath = historyPathRef.current;
    if (previousPath === pathname) return;

    if (
      existing !== null &&
      (previousPath === null || existing !== historyPositionRef.current)
    ) {
      historyPositionRef.current = existing;
      historyPathRef.current = pathname;
      return;
    }
    // A push may preserve the custom state from the prior entry. Equal to the
    // previous position on a new pathname means inherited, not a traversal.
    const next = (historyPositionRef.current ?? -1) + 1;
    window.history.replaceState(
      withProjectHistoryPosition(window.history.state, next),
      "",
    );
    historyPositionRef.current = next;
    historyPathRef.current = pathname;
  }, [pathname]);

  function confirmNavigation(
    event: MouseEvent<HTMLAnchorElement>,
    current: boolean,
  ): void {
    const modified =
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    if (
      !shouldConfirmContextNavigation({
        dirty: hasUnsavedContextChanges(),
        current,
        button: event.button,
        modified,
      })
    ) {
      return;
    }
    if (!window.confirm(tContext("leaveWarning"))) event.preventDefault();
  }

  return (
    <nav className={styles.nav} aria-label={tShell("projectSections")}>
      {PRIMARY_NAV_ITEMS.map((item) => {
        const isActive = active === item.key;
        const Icon = PRIMARY_NAV_ICONS[item.key];
        const badge =
          item.badgeKey === null ? null : navigationBadges[item.badgeKey];
        const badgeDescriptionId = `sf-${item.key}-nav-count`;
        return (
          <div className={styles.entry} key={item.key}>
            <Link
              href={`/p/${projectId}/${item.hrefSegment}`}
              className={cx(styles.item, isActive && styles.active)}
              aria-current={isActive ? "page" : undefined}
              aria-describedby={badge === null ? undefined : badgeDescriptionId}
              onClick={(event) => confirmNavigation(event, isActive)}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{t(item.labelKey)}</span>
              {badge === null ? null : (
                <span data-nav-count="" aria-hidden="true">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
            {badge === null ? null : (
              <span id={badgeDescriptionId} data-nav-count-label="">
                {item.badgeKey === "diagnosis"
                  ? tShell("growthMapBadge", { count: badge })
                  : tShell("executionBadge", { count: badge })}
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The current section name for the topbar breadcrumb. Reuses the same pathname
 * derivation so the breadcrumb always tracks the active tab; renders nothing on
 * an unrecognized route (the breadcrumb then shows the client name only).
 */
export function CurrentPageLabel({
  projectId,
  className,
}: {
  readonly projectId: string;
  readonly className?: string | undefined;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const labelKey = currentProjectPageLabelKey(pathname, projectId);
  if (labelKey === null) return null;
  return (
    <span className={className} aria-current="page">
      {t(labelKey)}
    </span>
  );
}
