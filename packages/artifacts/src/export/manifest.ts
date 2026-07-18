/**
 * Enterprise export manifest (spec §10.5). The produced object MUST validate
 * against `schemas/service-bundle-manifest.schema.json` exactly:
 * `additionalProperties: false` everywhere, all version literals pinned as
 * consts, `files[]` describing every data file's sha256/bytes/mediaType and
 * `itemCounts` describing the object counts actually present in the bundle.
 *
 * `manifest.json` is NOT self-referenced in `files[]` (its own hash can't be
 * known before it is serialized); `files[]` lists only the data members.
 */

/** Pinned manifest literals (JSON Schema `const` values). */
export const MANIFEST_SCHEMA_VERSION = "signalframe.service-bundle.0.2.0" as const;
export const PRODUCT_VERSION = "0.2.0" as const;
export const CONTRACT_VERSION = "2026-07-18" as const;
export const RULE_SET_VERSION = "mvp.rules.0.2.0" as const;

export type BundleKind = "service_bundle" | "client_bundle";

/** The four media types the manifest schema allows for a file entry. */
export type BundleMediaType =
  | "application/json"
  | "application/x-ndjson"
  | "text/markdown; charset=utf-8"
  | "text/csv; charset=utf-8";

export interface ManifestFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mediaType: BundleMediaType;
}

export interface ManifestItemCounts {
  readonly projects: number;
  readonly contexts: number;
  readonly sources: number;
  readonly snapshots: number;
  readonly observations: number;
  readonly findings: number;
  readonly evidence: number;
  readonly actions: number;
  readonly artifacts: number;
  readonly artifactRevisions: number;
}

export interface Manifest {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly productVersion: typeof PRODUCT_VERSION;
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly exportId: string;
  readonly projectId: string;
  readonly kind: BundleKind;
  readonly generatedAt: string;
  readonly outputLocale: string;
  readonly ruleSetVersion: typeof RULE_SET_VERSION;
  readonly sourceSnapshotIds: readonly string[];
  readonly files: readonly ManifestFileEntry[];
  readonly itemCounts: ManifestItemCounts;
}

/**
 * Structural view of a bundle input that {@link buildManifest} needs to count
 * and label the archive. `BundleInput` (in `bundle.ts`) is assignable to this;
 * keeping it structural avoids a value-level import cycle with the assembler.
 */
export interface ManifestSource {
  readonly exportId: string;
  readonly projectId: string;
  readonly kind: BundleKind;
  readonly generatedAt: string;
  readonly outputLocale: string;
  readonly sourceSnapshotIds: readonly string[];
  readonly project: unknown;
  readonly context: unknown;
  readonly sources: readonly unknown[];
  readonly snapshots: readonly unknown[];
  readonly observations: readonly unknown[];
  readonly findings: readonly unknown[];
  readonly evidence: readonly unknown[];
  readonly actions: readonly unknown[];
  readonly artifacts: readonly { readonly revisions: readonly unknown[] }[];
}

const JSON_EXT = ".json";
const NDJSON_EXT = ".ndjson";
const MARKDOWN_EXT = ".md";
const CSV_EXT = ".csv";

/**
 * Resolve the manifest media type from a file path's extension. Only the four
 * schema-allowed types are recognised; anything else is a programmer error.
 */
export function mediaTypeFor(path: string): BundleMediaType {
  if (path.endsWith(NDJSON_EXT)) return "application/x-ndjson";
  if (path.endsWith(JSON_EXT)) return "application/json";
  if (path.endsWith(MARKDOWN_EXT)) return "text/markdown; charset=utf-8";
  if (path.endsWith(CSV_EXT)) return "text/csv; charset=utf-8";
  throw new Error(`manifest: unsupported media type for path "${path}"`);
}

function countItems(input: ManifestSource): ManifestItemCounts {
  return {
    projects: input.project != null ? 1 : 0,
    contexts: input.context != null ? 1 : 0,
    sources: input.sources.length,
    snapshots: input.snapshots.length,
    observations: input.observations.length,
    findings: input.findings.length,
    evidence: input.evidence.length,
    actions: input.actions.length,
    artifacts: input.artifacts.length,
    artifactRevisions: input.artifacts.reduce(
      (total, artifact) => total + artifact.revisions.length,
      0,
    ),
  };
}

/**
 * Build the manifest object from the (already exclusion-applied) bundle source
 * and the computed per-file entries. Counts reflect exactly what the archive
 * carries, so a client bundle reports 0 observations and only its retained
 * findings/artifacts.
 */
export function buildManifest(
  input: ManifestSource,
  files: readonly ManifestFileEntry[],
): Manifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    productVersion: PRODUCT_VERSION,
    contractVersion: CONTRACT_VERSION,
    exportId: input.exportId,
    projectId: input.projectId,
    kind: input.kind,
    generatedAt: input.generatedAt,
    outputLocale: input.outputLocale,
    ruleSetVersion: RULE_SET_VERSION,
    sourceSnapshotIds: input.sourceSnapshotIds,
    files,
    itemCounts: countItems(input),
  };
}
