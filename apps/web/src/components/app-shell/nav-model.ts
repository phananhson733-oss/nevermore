export type PrimaryNavKey =
  | "overview"
  | "growth-map"
  | "execution"
  | "results";

export type PrimaryNavLabelKey =
  | "overview"
  | "growthMap"
  | "execution"
  | "results";

export type ProjectPageLabelKey =
  | PrimaryNavLabelKey
  | "context"
  | "sources"
  | "settings";

export type NavigationBadgeKey = "diagnosis" | "studio" | null;

export interface PrimaryNavItem {
  readonly key: PrimaryNavKey;
  readonly labelKey: PrimaryNavLabelKey;
  readonly hrefSegment: PrimaryNavKey;
  readonly activeSegments: readonly string[];
  readonly badgeKey: NavigationBadgeKey;
}

/** One closed four-module information architecture for every customer shell. */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  {
    key: "overview",
    labelKey: "overview",
    hrefSegment: "overview",
    activeSegments: ["overview"],
    badgeKey: null,
  },
  {
    key: "growth-map",
    labelKey: "growthMap",
    hrefSegment: "growth-map",
    activeSegments: ["growth-map", "diagnosis"],
    badgeKey: "diagnosis",
  },
  {
    key: "execution",
    labelKey: "execution",
    hrefSegment: "execution",
    activeSegments: ["execution", "plan", "studio"],
    badgeKey: "studio",
  },
  {
    key: "results",
    labelKey: "results",
    hrefSegment: "results",
    activeSegments: ["results", "report"],
    badgeKey: null,
  },
];

function activeSegment(pathname: string, projectId: string): string | null {
  const prefix = `/p/${projectId}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split("/")[0] ?? "";
  return segment.length > 0 ? segment : null;
}

export function primaryNavigation(projectId: string): readonly {
  readonly key: PrimaryNavKey;
  readonly href: string;
}[] {
  return PRIMARY_NAV_ITEMS.map((item) => ({
    key: item.key,
    href: `/p/${projectId}/${item.hrefSegment}`,
  }));
}

export function activePrimaryNavKey(
  pathname: string,
  projectId: string,
): PrimaryNavKey | null {
  const segment = activeSegment(pathname, projectId);
  if (segment === null) return null;
  return (
    PRIMARY_NAV_ITEMS.find((item) => item.activeSegments.includes(segment))
      ?.key ?? null
  );
}

/** Secondary setup routes stay out of primary nav but retain a breadcrumb. */
export function currentProjectPageLabelKey(
  pathname: string,
  projectId: string,
): ProjectPageLabelKey | null {
  const primaryKey = activePrimaryNavKey(pathname, projectId);
  if (primaryKey !== null) {
    return (
      PRIMARY_NAV_ITEMS.find((item) => item.key === primaryKey)?.labelKey ??
      null
    );
  }
  const segment = activeSegment(pathname, projectId);
  return segment === "context" ||
    segment === "sources" ||
    segment === "settings"
    ? segment
    : null;
}
