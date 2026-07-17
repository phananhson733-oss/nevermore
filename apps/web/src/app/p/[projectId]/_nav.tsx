"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cx } from "@/components/ui";
import styles from "./nav.module.css";

/**
 * Project section navigation (client) for the app-shell sidebar. `usePathname`
 * marks the active tab with `aria-current="page"`. Overview + Context are live
 * links; the remaining sections activate in later work packages and render as
 * non-interactive, muted, `aria-disabled` items with a visually-hidden
 * "coming soon" note — they are intentionally not linked (their routes do not
 * exist yet).
 */

type NavKey =
  | "overview"
  | "context"
  | "sources"
  | "diagnosis"
  | "plan"
  | "studio"
  | "report";

interface NavItem {
  readonly key: NavKey;
  readonly enabled: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: "overview", enabled: true },
  { key: "context", enabled: true },
  { key: "sources", enabled: false },
  { key: "diagnosis", enabled: false },
  { key: "plan", enabled: false },
  { key: "studio", enabled: false },
  { key: "report", enabled: false },
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
  const tShell = useTranslations("appShell");
  const pathname = usePathname();
  const active = activeSegment(pathname, projectId);
  const comingSoon = tShell("comingSoon");

  return (
    <nav className={styles.nav} aria-label="Project sections">
      {NAV_ITEMS.map((item) => {
        const label = t(item.key);
        if (item.enabled) {
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              href={`/p/${projectId}/${item.key}`}
              className={cx(
                styles.item,
                styles.link,
                isActive && styles.active,
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {label}
            </Link>
          );
        }
        return (
          <span
            key={item.key}
            className={cx(styles.item, styles.disabled)}
            aria-disabled="true"
            title={comingSoon}
          >
            {label}
            <span className={styles.srOnly}>{` — ${comingSoon}`}</span>
          </span>
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
