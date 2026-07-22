import { createHash } from "node:crypto";
import type { ObservationLineageView } from "./context.ts";

/** Deterministic, valid immutable IDs for engine-only test observations. */
export function testObservationLineage(
  key: string,
  options: {
    readonly sitePageUrl?: string | null;
    readonly pageSnapshot?: boolean;
  } = {},
): ObservationLineageView {
  const sitePageUrl = options.sitePageUrl ?? null;
  return {
    observationId: deterministicUuid(`${key}:observation`),
    snapshotId: deterministicUuid(`${key}:snapshot`),
    sitePageId:
      sitePageUrl === null
        ? null
        : deterministicUuid(`${sitePageUrl}:site-page`),
    sitePageUrl,
    pageSnapshotId:
      sitePageUrl !== null && options.pageSnapshot === true
        ? deterministicUuid(`${key}:page-snapshot`)
        : null,
  };
}

function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed, "utf8").digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
