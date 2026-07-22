export type ProjectRouteSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

/** Build a canonical project route while preserving all server-visible query state. */
export function canonicalProjectRoute(
  projectId: string,
  segment: "execution" | "results",
  searchParams: ProjectRouteSearchParams,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      query.append(key, value);
      continue;
    }
    for (const item of value) query.append(key, item);
  }
  const suffix = query.toString();
  return `/p/${projectId}/${segment}${suffix ? `?${suffix}` : ""}`;
}

const LEGACY_GROWTH_MAP_OBJECTS: Readonly<Record<string, string>> = {
  url: "pages",
  urls: "pages",
  page: "pages",
  pages: "pages",
  keyword: "keywords",
  keywords: "keywords",
  competitor: "competitors",
  competitors: "competitors",
};

/**
 * Translate the server-visible Diagnosis query into the Growth Map vocabulary.
 * Canonical keys win when both old and new clients supplied the same state.
 */
export function growthMapCompatibilityRoute(
  projectId: string,
  searchParams: ProjectRouteSearchParams,
): string {
  const query = new URLSearchParams();
  const hasCanonicalSearch = searchParams.q !== undefined;
  const hasCanonicalObject = searchParams.object !== undefined;

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || key === "search" || key === "tab") continue;
    if (typeof value === "string") query.append(key, value);
    else for (const item of value) query.append(key, item);
  }

  if (!hasCanonicalSearch) {
    const legacySearch = searchParams.search;
    const first =
      typeof legacySearch === "string" ? legacySearch : legacySearch?.[0];
    if (first !== undefined) query.append("q", first);
  }

  if (!hasCanonicalObject) {
    const legacyTab = searchParams.tab;
    const first = typeof legacyTab === "string" ? legacyTab : legacyTab?.[0];
    const translated = first ? LEGACY_GROWTH_MAP_OBJECTS[first] : undefined;
    if (translated !== undefined) query.append("object", translated);
  }

  const suffix = query.toString();
  return `/p/${projectId}/growth-map${suffix ? `?${suffix}` : ""}`;
}

/** Canonical internal deep link to one exact Finding in the URL portfolio. */
export function growthMapFindingRoute(
  projectId: string,
  findingId: string,
  normalizedUrl?: string | null,
): string {
  const query = new URLSearchParams({ object: "pages", findingId });
  if (normalizedUrl) query.set("q", normalizedUrl);
  return `/p/${projectId}/growth-map?${query.toString()}`;
}
