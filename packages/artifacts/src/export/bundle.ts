/**
 * Enterprise EXPORT bundle assembler (spec §10.5).
 *
 * The export service loads canonical rows, redacts field-level secrets/internal
 * data (SourceCredential, OAuthIntent, ImportPreview tokens, idempotency bodies,
 * logs, notes/provider-usage/AnalysisInvocation for client bundles, and any
 * other project's records), and hands this assembler an already-safe, plain,
 * serializable {@link BundleInput}. The assembler is purely mechanical: it
 * serializes each section to its file, applies the STRUCTURAL `client_bundle`
 * exclusions (drop observations.ndjson, ignored/needs_more_data findings, and
 * draft artifacts), builds the manifest, zips (STORE method), and computes the
 * archive's sha256.
 *
 * `service_bundle` layout:
 *   manifest.json, project.json, context.json, sources.json, snapshots.json,
 *   observations.ndjson, findings.json, evidence.json, actions.json,
 *   artifacts/<artifactId>/revision-<n>.md|json
 * `client_bundle` omits observations.ndjson and the excluded findings/artifacts.
 */

import { createHash } from "node:crypto";

import type { ContentFormat } from "../types.ts";
import { buildManifest, mediaTypeFor } from "./manifest.ts";
import type { BundleKind, Manifest, ManifestFileEntry } from "./manifest.ts";
import { createZip } from "./zip.ts";
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
  readonly status?: string;
  readonly revisions: readonly BundleArtifactRevision[];
}

/** A finding record; `reviewState` drives client exclusion. */
export type BundleFinding = JsonObject;

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

/** Finding review states a client bundle must not carry (spec §10.5). */
export const CLIENT_EXCLUDED_FINDING_STATES: ReadonlySet<string> = new Set([
  "ignored",
  "needs_more_data",
]);

/** Artifact statuses a client bundle must not carry (draft + non-final). */
export const CLIENT_EXCLUDED_ARTIFACT_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "generating",
  "failed",
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
  return { path, data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8") };
}

function ndjsonEntry(path: string, rows: readonly unknown[]): ZipEntry {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  const text = body.length > 0 ? `${body}\n` : "";
  return { path, data: Buffer.from(text, "utf8") };
}

function artifactBody(revision: BundleArtifactRevision): Buffer {
  const { content } = revision;
  const text =
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
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

function includeArtifactInClientBundle(artifact: BundleArtifact): boolean {
  return (
    artifact.status === undefined ||
    !CLIENT_EXCLUDED_ARTIFACT_STATUSES.has(artifact.status)
  );
}

/**
 * Apply the structural `client_bundle` exclusions, returning an input whose
 * sections already reflect the archive (empty observations, filtered findings
 * and artifacts). `service_bundle` is returned unchanged.
 */
function applyClientExclusions(input: BundleInput): BundleInput {
  if (input.kind === "service_bundle") {
    return input;
  }
  return {
    ...input,
    observations: [],
    findings: input.findings.filter(includeFindingInClientBundle),
    artifacts: input.artifacts.filter(includeArtifactInClientBundle),
  };
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
export function assembleBundle(input: BundleInput): AssembledBundle {
  const effective = applyClientExclusions(input);
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
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  };

  const zip = createZip([manifestEntry, ...dataEntries]);
  const checksum = sha256Hex(zip);

  return { zip, checksum, manifest, itemCounts: { ...manifest.itemCounts } };
}
