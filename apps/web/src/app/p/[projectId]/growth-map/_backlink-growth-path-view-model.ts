import type {
  BacklinkMetric,
  BacklinkSnapshotSource,
} from "@sf/contracts";

export type BacklinkMetricPresentation =
  | {
      readonly kind: "provider_total" | "observed_count";
      readonly value: number;
    }
  | { readonly kind: "unavailable"; readonly value: null };

export function backlinkMetricPresentation(
  metric: BacklinkMetric,
): BacklinkMetricPresentation {
  if (metric.semantics === "unavailable" || metric.value === null) {
    return { kind: "unavailable", value: null };
  }
  return {
    kind:
      metric.semantics === "provider_index_total"
        ? "provider_total"
        : "observed_count",
    value: metric.value,
  };
}
export function backlinkAuthorityPresentation(
  source: BacklinkSnapshotSource,
): BacklinkSnapshotSource["authorityMetric"] {
  return source.sourceKind === "provider_import"
    ? source.authorityMetric
    : null;
}

export function backlinkPageHref(
  projectId: string,
  sitePageId: string,
): string {
  const params = new URLSearchParams({
    object: "pages",
    selectedSitePageId: sitePageId,
  });
  return `/p/${encodeURIComponent(projectId)}/growth-map?${params.toString()}`;
}
