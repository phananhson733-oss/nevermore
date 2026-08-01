const AUTOMATIC_ANALYSIS_REFRESH_QUERY_KEY = "autoRefresh";
const AUTOMATIC_ANALYSIS_REFRESH_QUERY_VALUE = "1";

export function automaticAnalysisRefreshUrl(projectId: string): string {
  return `/p/${encodeURIComponent(projectId)}/sources?${AUTOMATIC_ANALYSIS_REFRESH_QUERY_KEY}=${AUTOMATIC_ANALYSIS_REFRESH_QUERY_VALUE}`;
}

export function hasAutomaticAnalysisRefreshIntent(search: string): boolean {
  return (
    new URLSearchParams(search).get(AUTOMATIC_ANALYSIS_REFRESH_QUERY_KEY) ===
    AUTOMATIC_ANALYSIS_REFRESH_QUERY_VALUE
  );
}

export function withoutAutomaticAnalysisRefreshIntent(href: string): string {
  const url = new URL(href, "https://gengrowth.local");
  url.searchParams.delete(AUTOMATIC_ANALYSIS_REFRESH_QUERY_KEY);
  return `${url.pathname}${url.search}${url.hash}`;
}
