/**
 * Enterprise EXPORT bundle assembler (spec §10.5).
 *
 * The export service loads canonical rows, redacts field-level secrets/internal
 * data (SourceCredential, OAuthIntent, ImportPreview tokens, idempotency bodies,
 * logs, notes/provider-usage/AnalysisInvocation for client bundles, and any
 * other project's records), and hands this assembler an already-safe, plain,
 * serializable {@link BundleInput}. The assembler is purely mechanical: it
 * serializes each section to its file, applies the STRUCTURAL `client_bundle`
 * exclusions (drop observations.ndjson, ignored/needs_more_data findings and
 * their unreachable evidence, and non-ready/historical artifact revisions),
 * builds the manifest, zips (STORE method), and computes the archive's sha256.
 *
 * `service_bundle` layout:
 *   manifest.json, project.json, context.json, sources.json, snapshots.json,
 *   observations.ndjson, findings.json, evidence.json, actions.json,
 *   artifacts/<artifactId>/revision-<n>.md|json
 * `client_bundle` omits observations.ndjson and the excluded findings/evidence/
 * artifacts, retaining only each captured ready artifact's current revision.
 */

import { createHash } from "node:crypto";

import type { ContentFormat } from "../types.ts";
import { buildManifest, mediaTypeFor } from "./manifest.ts";
import type { BundleKind, Manifest, ManifestFileEntry } from "./manifest.ts";
import { createZip, ZipLimitError } from "./zip.ts";
import type { ZipEntry } from "./zip.ts";

/** JSON value types for the plain, already-serializable section payloads. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/** A single artifact revision as loaded from the DB (already redacted). */
export interface BundleArtifactRevision {
  readonly revision: number;
  readonly contentFormat: ContentFormat;
  /** Markdown/CSV bodies are strings; JSON bodies may be a string or object. */
  readonly content: string | JsonObject;
}

/** An artifact with its ordered revisions. `status` drives client exclusion. */
export interface BundleArtifact {
  readonly id: string;
  readonly status: string;
  /** Revision pointer captured in the same database snapshot as `status`. */
  readonly currentRevision: number;
  readonly revisions: readonly BundleArtifactRevision[];
}

/** A finding record; `reviewState` drives client exclusion. */
export type BundleFinding = JsonObject;

/** Input-only reachability edge; the fixed archive layout does not add a file. */
export interface BundleFindingEvidenceLink {
  readonly findingId: string;
  readonly evidenceId: string;
}

/**
 * The plain data object the export service populates from canonical, redacted
 * rows. The assembler never reaches back to the DB — everything it emits comes
 * from here.
 */
export interface BundleInput {
  readonly exportId: string;
  readonly projectId: string;
  readonly kind: BundleKind;
  readonly generatedAt: string;
  readonly outputLocale: string;
  readonly sourceSnapshotIds: readonly string[];
  readonly project: JsonObject;
  readonly context: JsonObject | null;
  readonly sources: readonly JsonObject[];
  readonly snapshots: readonly JsonObject[];
  readonly observations: readonly JsonObject[];
  readonly findings: readonly BundleFinding[];
  readonly findingEvidenceLinks: readonly BundleFindingEvidenceLink[];
  readonly evidence: readonly JsonObject[];
  readonly actions: readonly JsonObject[];
  readonly artifacts: readonly BundleArtifact[];
}

export interface AssembledBundle {
  readonly zip: Buffer;
  readonly checksum: string;
  readonly manifest: Manifest;
  readonly itemCounts: Record<string, number>;
}

export interface BundleAssemblyLimits {
  readonly maxItems: number;
  readonly maxEstimatedBytes: number;
  readonly maxArchiveBytes: number;
}

/**
 * Bound both serialization fan-out and the in-memory STORE archive. The mapped
 * compact-payload estimate protects the read/serialization layer; it is not a
 * ZIP-size prediction. The exact STORE size, including manifest and ZIP
 * metadata, is checked separately before the archive buffer is allocated.
 */
export const DEFAULT_BUNDLE_ASSEMBLY_LIMITS: BundleAssemblyLimits = {
  maxItems: 100_000,
  maxEstimatedBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
};

export class ExportBundleLimitError extends Error {
  readonly code = "EXPORT_BUNDLE_LIMIT_EXCEEDED" as const;

  constructor() {
    super("export bundle exceeds the supported size limit");
    this.name = "ExportBundleLimitError";
  }
}

/** Finding review states a client bundle must not carry (spec §10.5). */
export const CLIENT_EXCLUDED_FINDING_STATES: ReadonlySet<string> = new Set([
  "ignored",
  "needs_more_data",
]);

const ARTIFACT_EXTENSION: Record<ContentFormat, string> = {
  markdown: "md",
  json: "json",
  csv: "csv",
};

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function jsonEntry(path: string, value: unknown): ZipEntry {
  return { path, data: Buffer.from(`${JSON.stringify(value)}\n`, "utf8") };
}

function ndjsonEntry(path: string, rows: readonly unknown[]): ZipEntry {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  const text = body.length > 0 ? `${body}\n` : "";
  return { path, data: Buffer.from(text, "utf8") };
}

function artifactBody(revision: BundleArtifactRevision): Buffer {
  const { content } = revision;
  const text =
    typeof content === "string" ? content : `${JSON.stringify(content)}\n`;
  return Buffer.from(text, "utf8");
}

function artifactEntry(artifactId: string, revision: BundleArtifactRevision): ZipEntry {
  const ext = ARTIFACT_EXTENSION[revision.contentFormat];
  return {
    path: `artifacts/${artifactId}/revision-${revision.revision}.${ext}`,
    data: artifactBody(revision),
  };
}

function includeFindingInClientBundle(finding: BundleFinding): boolean {
  const state = finding["reviewState"];
  return typeof state !== "string" || !CLIENT_EXCLUDED_FINDING_STATES.has(state);
}

function visibleFindingId(finding: BundleFinding): string | null {
  const id = finding["id"];
  return typeof id === "string" ? id : null;
}

function evidenceId(row: JsonObject): string | null {
  const id = row["id"];
  return typeof id === "string" ? id : null;
}

function capturedReadyArtifact(artifact: BundleArtifact): BundleArtifact | null {
  if (artifact.status !== "ready") return null;
  const revisions = artifact.revisions.filter(
    (revision) => revision.revision === artifact.currentRevision,
  );
  if (revisions.length !== 1) {
    throw new Error("client bundle ready artifact current revision is unavailable");
  }
  return { ...artifact, revisions };
}

/**
 * Apply the structural `client_bundle` exclusions, returning an input whose
 * sections already reflect the archive (empty observations, visible findings,
 * their reachable evidence, and captured current ready revisions).
 * `service_bundle` is returned unchanged.
 */
function applyClientExclusions(input: BundleInput): BundleInput {
  if (input.kind === "service_bundle") {
    return input;
  }
  const findings = input.findings.filter(includeFindingInClientBundle);
  const visibleFindingIds = new Set(
    findings
      .map(visibleFindingId)
      .filter((id): id is string => id !== null),
  );
  const reachableEvidenceIds = new Set(
    input.findingEvidenceLinks
      .filter((link) => visibleFindingIds.has(link.findingId))
      .map((link) => link.evidenceId),
  );
  const artifacts = input.artifacts
    .map(capturedReadyArtifact)
    .filter((artifact): artifact is BundleArtifact => artifact !== null);

  return {
    ...input,
    observations: [],
    findings,
    evidence: input.evidence.filter((row) => {
      const id = evidenceId(row);
      return id !== null && reachableEvidenceIds.has(id);
    }),
    artifacts,
  };
}

function bundleItemCount(input: BundleInput): number {
  return (
    1 +
    (input.context === null ? 0 : 1) +
    input.sources.length +
    input.snapshots.length +
    input.observations.length +
    input.findings.length +
    input.evidence.length +
    input.actions.length +
    input.artifacts.length +
    input.artifacts.reduce(
      (total, artifact) => total + artifact.revisions.length,
      0,
    )
  );
}

function assertPositiveLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("bundle assembly limits must be positive safe integers");
  }
}

function assertEstimatedByteBudget(
  input: BundleInput,
  maxEstimatedBytes: number,
): void {
  let bytes = 0;
  const addBytes = (additional: number): void => {
    bytes += additional;
    if (bytes > maxEstimatedBytes) throw new ExportBundleLimitError();
  };
  const addJson = (value: unknown): void => {
    const encoded = JSON.stringify(value);
    addBytes(Buffer.byteLength(encoded ?? "null", "utf8") + 1);
  };

  addJson(input.project);
  addJson(input.context);
  for (const rows of [
    input.sources,
    input.snapshots,
    input.observations,
    input.findings,
    input.evidence,
    input.actions,
  ] as const) {
    for (const row of rows) addJson(row);
  }
  for (const artifact of input.artifacts) {
    addBytes(Buffer.byteLength(artifact.id, "utf8") + 64);
    for (const revision of artifact.revisions) {
      addBytes(64);
      if (typeof revision.content === "string") {
        addBytes(Buffer.byteLength(revision.content, "utf8"));
      } else {
        addJson(revision.content);
      }
    }
  }
}

function assertBundleLimits(limits: BundleAssemblyLimits): void {
  assertPositiveLimit(limits.maxItems);
  assertPositiveLimit(limits.maxEstimatedBytes);
  assertPositiveLimit(limits.maxArchiveBytes);
}

function assertBundleItemBudget(
  input: BundleInput,
  limits: BundleAssemblyLimits,
): void {
  if (bundleItemCount(input) > limits.maxItems) {
    throw new ExportBundleLimitError();
  }
}

/** Build the ordered data-file entries (everything except manifest.json). */
function buildDataEntries(input: BundleInput): readonly ZipEntry[] {
  const entries: ZipEntry[] = [
    jsonEntry("project.json", input.project),
    jsonEntry("context.json", input.context),
    jsonEntry("sources.json", input.sources),
    jsonEntry("snapshots.json", input.snapshots),
  ];

  if (input.kind === "service_bundle") {
    entries.push(ndjsonEntry("observations.ndjson", input.observations));
  }

  entries.push(
    jsonEntry("findings.json", input.findings),
    jsonEntry("evidence.json", input.evidence),
    jsonEntry("actions.json", input.actions),
  );

  for (const artifact of input.artifacts) {
    for (const revision of artifact.revisions) {
      entries.push(artifactEntry(artifact.id, revision));
    }
  }

  return entries;
}

/**
 * Assemble the enterprise export bundle: serialize + exclude + manifest + zip,
 * then checksum the archive. Deterministic — the same input yields the same
 * zip bytes and the same checksum.
 */
export function assembleBundle(
  input: BundleInput,
  limits: BundleAssemblyLimits = DEFAULT_BUNDLE_ASSEMBLY_LIMITS,
): AssembledBundle {
  assertBundleLimits(limits);
  const effective = applyClientExclusions(input);
  // maxItems describes archive-visible logical objects. Input-only reachability
  // edges and client-excluded rows are bounded by the worker read layer instead.
  assertBundleItemBudget(effective, limits);
  assertEstimatedByteBudget(effective, limits.maxEstimatedBytes);
  const dataEntries = buildDataEntries(effective);

  const fileEntries: readonly ManifestFileEntry[] = dataEntries.map((entry) => ({
    path: entry.path,
    sha256: sha256Hex(entry.data),
    bytes: entry.data.length,
    mediaType: mediaTypeFor(entry.path),
  }));

  const manifest = buildManifest(effective, fileEntries);
  const manifestEntry: ZipEntry = {
    path: "manifest.json",
    data: Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8"),
  };

  let zip: Buffer;
  try {
    zip = createZip([manifestEntry, ...dataEntries], {
      maxArchiveBytes: limits.maxArchiveBytes,
    });
  } catch (error) {
    if (error instanceof ZipLimitError) {
      throw new ExportBundleLimitError();
    }
    throw error;
  }
  const checksum = sha256Hex(zip);

  return { zip, checksum, manifest, itemCounts: { ...manifest.itemCounts } };
}
