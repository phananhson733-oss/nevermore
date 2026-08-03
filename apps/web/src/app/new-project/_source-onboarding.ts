export const OPTIONAL_GOOGLE_SOURCES = ["gsc", "ga4"] as const;

export type OptionalGoogleSource =
  (typeof OPTIONAL_GOOGLE_SOURCES)[number];

export function toggleOptionalGoogleSource(
  current: readonly OptionalGoogleSource[],
  provider: OptionalGoogleSource,
  selected: boolean,
): OptionalGoogleSource[] {
  if (selected) {
    return current.includes(provider) ? [...current] : [...current, provider];
  }
  return current.filter((item) => item !== provider);
}

export function newProductContinuationPath(
  projectId: string,
  selectedSources: readonly OptionalGoogleSource[],
): string {
  const segment = selectedSources.length > 0 ? "setup-sources" : "context";
  return `/p/${encodeURIComponent(projectId)}/${segment}`;
}
