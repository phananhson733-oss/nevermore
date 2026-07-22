import { growthMapLocationHref } from "./_growth-map-view-model.ts";

export type GrowthMapNavigationPatch = Parameters<
  typeof growthMapLocationHref
>[2];

export interface GrowthMapNavigationJournal {
  readonly canonicalSearch: string;
  readonly requestedSearch: string;
  readonly pendingSearches: readonly string[];
}

export interface GrowthMapNavigationRequest {
  readonly href: string;
  readonly search: string;
  readonly journal: GrowthMapNavigationJournal;
}

function searchFromHref(href: string): string {
  const queryIndex = href.indexOf("?");
  return queryIndex === -1 ? "" : href.slice(queryIndex + 1);
}

export function createGrowthMapNavigationJournal(
  canonicalSearch: string,
): GrowthMapNavigationJournal {
  return {
    canonicalSearch,
    requestedSearch: canonicalSearch,
    pendingSearches: [],
  };
}

export function recordGrowthMapNavigationHref(
  journal: GrowthMapNavigationJournal,
  href: string,
): GrowthMapNavigationJournal {
  const requestedSearch = searchFromHref(href);
  return {
    ...journal,
    requestedSearch,
    pendingSearches: [...journal.pendingSearches, requestedSearch],
  };
}

export function requestGrowthMapNavigation(
  journal: GrowthMapNavigationJournal,
  pathname: string,
  patch: GrowthMapNavigationPatch,
): GrowthMapNavigationRequest {
  const href = growthMapLocationHref(
    pathname,
    journal.requestedSearch,
    patch,
  );
  const nextJournal = recordGrowthMapNavigationHref(journal, href);
  return {
    href,
    search: nextJournal.requestedSearch,
    journal: nextJournal,
  };
}

/**
 * Keep later local intent authoritative while older router replacements are
 * still committing. An unknown canonical query is browser/external navigation
 * and becomes the new baseline immediately.
 */
export function observeGrowthMapCanonicalSearch(
  journal: GrowthMapNavigationJournal,
  canonicalSearch: string,
): GrowthMapNavigationJournal {
  if (canonicalSearch === journal.canonicalSearch) return journal;

  const settledIndex = journal.pendingSearches.lastIndexOf(canonicalSearch);
  if (settledIndex === -1) {
    return createGrowthMapNavigationJournal(canonicalSearch);
  }

  const pendingSearches = journal.pendingSearches.slice(settledIndex + 1);
  return {
    canonicalSearch,
    requestedSearch: pendingSearches.at(-1) ?? canonicalSearch,
    pendingSearches,
  };
}

/** Drop superseded intents once React reports that the latest URL is settled. */
export function settleGrowthMapNavigation(
  journal: GrowthMapNavigationJournal,
  canonicalSearch: string,
): GrowthMapNavigationJournal {
  return journal.requestedSearch === canonicalSearch
    ? createGrowthMapNavigationJournal(canonicalSearch)
    : journal;
}
