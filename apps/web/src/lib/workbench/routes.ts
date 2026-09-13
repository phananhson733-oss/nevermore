/**
 * Workbench route table (design §4.1–§4.3). Segment names are not customer
 * copy; the sidebar labels come from `workbench.nav.items.*`. `sources` stays
 * with the legacy page because the OAuth callback redirects there.
 */
export const WORKBENCH_PAGE_IDS = [
  "overview",
  "week",
  "keywords",
  "keywordLibrary",
  "competitors",
  "audit",
  "visibility",
  "profile",
  "dataSources",
  "links",
  "content",
  "kb",
  "answers",
  "artifacts",
  "settings",
] as const;

export type WorkbenchPageId = (typeof WORKBENCH_PAGE_IDS)[number];

export const WORKBENCH_SEGMENTS: Readonly<Record<WorkbenchPageId, string>> = {
  overview: "overview",
  week: "week",
  keywords: "keywords",
  keywordLibrary: "keyword-library",
  competitors: "competitors",
  audit: "audit",
  visibility: "visibility",
  profile: "profile",
  dataSources: "data-sources",
  links: "links",
  content: "content",
  kb: "kb",
  answers: "answers",
  artifacts: "artifacts",
  settings: "settings",
};

export type LegacySegment =
  | "legacy/overview"
  | "growth-map"
  | "context"
  | "setup-sources"
  | "sources"
  | "studio"
  | "execution"
  | "results";

/** "旧版页面 →" destinations per new page (design §4.3 table). */
export const LEGACY_LINKS: Readonly<Record<WorkbenchPageId, readonly LegacySegment[]>> = {
  overview: ["legacy/overview"],
  week: [],
  keywords: ["growth-map"],
  keywordLibrary: ["growth-map"],
  competitors: ["growth-map"],
  audit: ["growth-map"], // diagnosis/page.tsx is a redirect into growth-map (design §4.3 row corrected)
  visibility: [],
  profile: ["context", "setup-sources"],
  dataSources: ["sources"],
  links: [],
  content: ["studio", "execution"],
  kb: [],
  answers: ["results"],
  artifacts: [],
  settings: [],
};

/**
 * Legacy segment → existing `nav.*` label key, so the link reads as a page name,
 * not a path. Data, not markup: it lives here with the rest of the route table
 * so a test can pin it without importing `next/link`.
 */
export const LEGACY_LABEL_KEY: Readonly<Record<LegacySegment, string>> = {
  "legacy/overview": "overview",
  "growth-map": "growthMap",
  context: "context",
  "setup-sources": "sourceSetup",
  sources: "sources",
  studio: "studio",
  execution: "execution",
  results: "results",
};

export function workbenchHref(projectId: string, id: WorkbenchPageId): string {
  return `/p/${projectId}/${WORKBENCH_SEGMENTS[id]}`;
}

export function legacyHref(projectId: string, segment: LegacySegment): string {
  return `/p/${projectId}/${segment}`;
}

export function activeWorkbenchPage(
  pathname: string,
  projectId: string,
): WorkbenchPageId | null {
  const prefix = `/p/${projectId}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split(/[/?#]/)[0] ?? "";
  for (const id of WORKBENCH_PAGE_IDS) {
    if (WORKBENCH_SEGMENTS[id] === segment) return id;
  }
  return null;
}
