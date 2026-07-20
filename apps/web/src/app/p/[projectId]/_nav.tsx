"use client";

import {
  Database,
  FileText,
  LayoutDashboard,
  ListTodo,
  PenTool,
  Search,
  Target,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type MouseEvent } from "react";
import { cx } from "@/components/ui";
import {
  hasUnsavedContextChanges,
  shouldConfirmContextNavigation,
} from "./_context-navigation-guard";
import {
  projectHistoryPosition,
  withProjectHistoryPosition,
} from "./_project-history-position.ts";
import styles from "./nav.module.css";

/**
 * Project section navigation (client) for the app-shell sidebar. Grouped into
 * Workspace / Evidence & Diagnosis / Execution & Delivery (visual language from
 * the delivery Artifact). `usePathname` marks the active tab with
 * `aria-current="page"`, which drives the mint left-accent. Every section is a
 * live route.
 */

type NavKey =
  | "overview"
  | "context"
  | "sources"
  | "diagnosis"
  | "plan"
  | "studio"
  | "report";

type NavGroup = "workspace" | "evidence" | "delivery";

interface NavItem {
  readonly key: NavKey;
  readonly group: NavGroup;
  readonly icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: "overview", group: "workspace", icon: LayoutDashboard },
  { key: "context", group: "workspace", icon: Target },
  { key: "sources", group: "evidence", icon: Database },
  { key: "diagnosis", group: "evidence", icon: Search },
  { key: "plan", group: "delivery", icon: ListTodo },
  { key: "studio", group: "delivery", icon: PenTool },
  { key: "report", group: "delivery", icon: FileText },
];

/** The first path segment under `/p/{projectId}/`, or null when not matched. */
function activeSegment(pathname: string, projectId: string): string | null {
  const prefix = `/p/${projectId}/`;
  if (!pathname.startsWith(prefix)) return null;
  const seg = pathname.slice(prefix.length).split("/")[0] ?? "";
  return seg.length > 0 ? seg : null;
}

export function ProjectNav({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("nav");
  const tContext = useTranslations("context");
  const tShell = useTranslations("appShell");
  const pathname = usePathname();
  const active = activeSegment(pathname, projectId);
  const historyPositionRef = useRef<number | null>(null);
  const historyPathRef = useRef<string | null>(null);
  let lastGroup: NavGroup | "" = "";

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
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.key;
        const Icon = item.icon;
        const showGroup = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div className={styles.entry} key={item.key}>
            {showGroup ? (
              <p className={styles.groupLabel}>{t(item.group)}</p>
            ) : null}
            <Link
              href={`/p/${projectId}/${item.key}`}
              className={cx(styles.item, isActive && styles.active)}
              aria-current={isActive ? "page" : undefined}
              onClick={(event) => confirmNavigation(event, isActive)}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{t(item.key)}</span>
            </Link>
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
  const seg = activeSegment(pathname, projectId);
  const match = seg ? NAV_ITEMS.find((item) => item.key === seg) : undefined;
  if (!match) return null;
  return (
    <span className={className} aria-current="page">
      {t(match.key)}
    </span>
  );
}
