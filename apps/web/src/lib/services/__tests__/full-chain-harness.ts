import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["DATABASE_URL"] ??=
  "postgres://wzb@localhost:5432/signalframe_mvp_dev";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["OPENAI_API_KEY"] ??= "sk-test";
process.env["OPENAI_MODEL"] ??= "gpt-4o-mini";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";
// Point the worker blob store at the same dir the web services would use so the
// service ↔ worker split shares one on-disk store (spec §7.6, §13.3).
process.env["SF_BLOB_DIR"] ??= mkdtempSync(
  path.join(os.tmpdir(), "sf-full-chain-blob-"),
);

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { icpProfiles, asyncRuns, workspaces } from "@sf/db/schema";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  ExportBundlesRepository,
  ObservationsRepository,
  ProjectsRepository,
  contentHash,
  type ObservationInsert,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import {
  LocalFsBlobStore,
  METRIC_CRAWL_PAGE,
  subjectUrlOf,
  type CrawlLinkProjection,
  type CrawlPageProjection,
} from "@sf/sources";
import type { Logger } from "@sf/observability";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { createDiagnosticRun } from "@/lib/services/diagnostics";
import { listProjectFindings } from "@/lib/services/findings-list";
import { reviewProjectFinding } from "@/lib/services/finding-review";
import { listProjectActions } from "@/lib/services/actions-service";
import { createActionArtifact } from "@/lib/services/artifacts";
import { createProjectExport } from "@/lib/services/export-service";
import { getProjectReport } from "@/lib/services/report";
import { getBoss } from "@/lib/boss";
import type { WorkerContext } from "../../../../../worker/src/context.ts";
import { runDiagnostic } from "../../../../../worker/src/diagnostic/run-diagnostic.ts";
import { runArtifact } from "../../../../../worker/src/artifact/run-artifact.ts";
import { runExport } from "../../../../../worker/src/export/run-export.ts";

/**
 * Shared harness for the B2B + B2C full-vertical golden-fixture integration
 * tests (AC-044, AC-045, AC-022). A live crawl of a real 200-OK site yields no
 * confirmable findings, so both verticals run over a DETERMINISTIC golden crawl
 * snapshot and drive the REAL services (which enqueue via pg-boss) plus the REAL
 * worker runners (which process the run) end-to-end against a real local Postgres
 * — a reproducible, offline vertical E2E (browser responsive/a11y is covered
 * separately by Playwright and is intentionally untouched here).
 *
 * The golden snapshot is engineered so the 11-rule pipeline (spec §8.4) trips
 * findings across multiple domains with ZERO randomness:
 *  - a 404 page                       → TECH-HTTP-001   (technical_seo, spec §8.3)
 *  - a page canonicalizing to an
 *    uncrawled same-origin URL         → TECH-CANONICAL-002 (technical_seo)
 *  - a commercial priority page with
 *    < 2 internal inlinks              → TECH-LINKGRAPH-005 (technical_seo)
 *  - an ICP offer no page covers       → CONTENT-COVERAGE-001 (content_intent)
 * Crawl is AVAILABLE while GSC/GA4/CSV are UNAVAILABLE, so the search/gap/landing
 * rules are `skipped` and the run is `partial` — the honest degradation path
 * (spec §1.3: an unavailable metric is null, never 0; missing datasets skip
 * their rules, they never fabricate a defect).
 */

export const DATABASE_URL = process.env["DATABASE_URL"]!;
export const DB_AVAILABLE = Boolean(process.env["DATABASE_URL"]);

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

/** An ICP offer no fixture page mentions — guarantees CONTENT-COVERAGE-001. */
const UNCOVERED_OFFER = "Quantum cryptography residency compliance audit";

/** The exact crawl-only degradation strings the pipeline emits (pipeline.ts). */
export const DEGRADATION_LIMITATIONS: readonly string[] = [
  "Search Console not connected; search rules were skipped.",
  "GA4 not connected; landing conversion was skipped.",
  "No keyword-gap CSV; content gap was skipped.",
];

// --- worker-context harness (mirrors run-collection.integration.test.ts) -----

export function buildCtx(handle: DbHandle): WorkerContext {
  return {
    db: handle.db,
    boss: {} as unknown as PgBoss, // the runners under test never enqueue
    blobStore: new LocalFsBlobStore(process.env["SF_BLOB_DIR"]!),
    credentialKey: Buffer.alloc(32),
    appOrigin: "http://localhost:3000",
    openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
    logger: testLogger,
  };
}

// --- golden crawl fixture builders ------------------------------------------

function su(url: string): string {
  const subject = subjectUrlOf(url);
  if (!subject) throw new Error(`unparseable url: ${url}`);
  return subject;
}

function mkPage(o: {
  fetchUrl: string;
  status?: number;
  finalStatus?: number;
  robotsIndexable?: boolean;
  title?: string | null;
  h1?: readonly string[];
  canonicalTarget?: string | null;
  internalOutlinks?: readonly CrawlLinkProjection[];
}): CrawlPageProjection {
  return {
    fetchUrl: o.fetchUrl,
    status: o.status ?? 200,
    finalStatus: o.finalStatus ?? 200,
    redirectChain: [],
    canonicalTarget: o.canonicalTarget ?? null,
    robotsIndexable: o.robotsIndexable ?? true,
    robotsDirectives: [],
    title: o.title ?? null,
    metaDescription: null,
    h1: o.h1 ?? [],
    headings: [],
    wordCount: 120,
    internalOutlinks: o.internalOutlinks ?? [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 11,
    contentType: "text/html",
  };
}

function crawlObs(
  subjectRef: string,
  projection: CrawlPageProjection,
  capturedAt: string,
): ObservationInsert {
  return {
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef,
    observedAt: capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: "direct_public",
    grade: "B",
    support: "supports",
    limitation: "current public response",
  };
}

/**
 * The golden pages: home (indexable, no inlinks to /product), a commercial
 * priority /product page (0 inlinks + a broken same-origin canonical), and a 404
 * page. Deterministically trips HTTP / CANONICAL / LINKGRAPH / COVERAGE.
 */
function goldenObservations(
  origin: string,
  capturedAt: string,
): ObservationInsert[] {
  const home = `${origin}/`;
  const product = `${origin}/product`;
  const gone = `${origin}/gone`;
  return [
    crawlObs(
      su(home),
      mkPage({
        fetchUrl: home,
        title: "Northstar Analytics — Home",
        h1: ["Welcome to Northstar"],
        internalOutlinks: [],
      }),
      capturedAt,
    ),
    crawlObs(
      su(product),
      mkPage({
        fetchUrl: product,
        title: "Product Overview",
        h1: ["Product"],
        // Same-origin canonical to an uncrawled URL → TECH-CANONICAL-002.
        canonicalTarget: `${origin}/legacy-product`,
        internalOutlinks: [],
      }),
      capturedAt,
    ),
    crawlObs(
      su(gone),
      mkPage({
        fetchUrl: gone,
        status: 404,
        finalStatus: 404,
        robotsIndexable: false,
        title: null,
      }),
      capturedAt,
    ),
  ];
}

// --- persistence seeding ----------------------------------------------------

/** Seed a COMPLETE ICP and point the project at it (createDiagnosticRun gate). */
async function seedCompleteIcp(
  handle: DbHandle,
  scope: ProjectScope,
  origin: string,
  actor: string,
): Promise<void> {
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: {
        productName: "Northstar Analytics",
        oneLineDescription: "B2B analytics platform for revenue teams.",
        customerModel: "b2b",
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
        marketCodes: ["US"],
        // Offer no fixture page covers → CONTENT-COVERAGE-001 candidate.
        offers: [UNCOVERED_OFFER],
        useCases: [],
        differentiators: [],
        // Marks /product priority + commercial (TECH-LINKGRAPH-005 high severity).
        priorityUrls: [`${origin}/product`],
        primaryConversion: {
          label: "Book a demo",
          type: "demo",
          targetUrl: `${origin}/demo`,
        },
      },
      content_hash: contentHash({ icp: randomUUID() }),
      created_by: actor,
    })
    .returning();
  await new ProjectsRepository(handle.db).setCurrentIcpProfile(
    scope,
    scope.projectId,
    icp!.id,
  );
}

/** Seed one AVAILABLE crawl snapshot holding the golden observations. */
async function seedCrawlSnapshot(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  origin: string,
  actor: string,
): Promise<string> {
  const capturedAt = new Date().toISOString();
  const collectionRunId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "collection",
    status: "completed",
    initiated_by: actor,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  await new CollectionRunsRepository(handle.db).insertPlaceholder({
    runId: collectionRunId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: null,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: "crawl.site_graph.v1",
    parametersHash: contentHash({ c: collectionRunId }),
  });
  const observations = goldenObservations(origin, capturedAt);
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    collectionRunId,
    sourceConnectionId: null,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: "crawl.site_graph.v1",
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "static golden crawl fixture",
    rawObjectKey: null,
    rowCount: observations.length,
    checksum: contentHash({ s: collectionRunId }),
  });
  await new ObservationsRepository(handle.db).insertMany(
    scope,
    snapshot.id,
    observations,
  );
  return snapshot.id;
}

// --- the shared common chain: seed → diagnose → confirm → artifact ----------

export interface ChainResult {
  readonly scope: ProjectScope;
  readonly actor: string;
  readonly diagRunId: string;
  readonly httpFindingId: string;
  readonly actionId: string;
  readonly artifactId: string;
}

/**
 * The value chain shared by both verticals: createProject → seed complete ICP →
 * seed golden crawl snapshot → createDiagnosticRun (service, enqueues) →
 * runDiagnostic (worker) → confirm the TECH-HTTP-001 finding (service; same-tx
 * Action upsert, spec §9.1) → createActionArtifact (service, TEMPLATE mode) →
 * runArtifact (worker, no network). Returns the ids each vertical then exports.
 */
export async function runCommonChain(
  handle: DbHandle,
  ctx: WorkerContext,
  label: string,
): Promise<ChainResult> {
  const actor = randomUUID();
  const [ws] = await handle.db
    .insert(workspaces)
    .values({ name: `WS-${randomUUID()}` })
    .returning();
  const workspaceId = ws!.id;
  const origin = `https://${label}-${randomUUID().slice(0, 8)}.example`;

  const created = await createProject(
    { workspaceId },
    actor,
    randomUUID(),
    {
      clientName: label,
      projectName: label,
      siteUrl: origin,
      marketCodes: ["US"],
      siteLanguageCodes: ["en"],
      defaultDeliveryLocale: "en",
    },
    safeGuard,
  );
  const scope: ProjectScope = { workspaceId, projectId: created.project.id };
  const siteId = created.project.site.id;

  await seedCompleteIcp(handle, scope, origin, actor);
  const snapshotId = await seedCrawlSnapshot(
    handle,
    scope,
    siteId,
    origin,
    actor,
  );

  // createDiagnosticRun freezes the manifest + enqueues (spec §8.1, §13.2).
  const diag = await createDiagnosticRun(
    { workspaceId },
    scope.projectId,
    actor,
    randomUUID(),
    { snapshotIds: [snapshotId], outputLocale: "en" },
  );
  await runDiagnostic(ctx, {
    runId: diag.run.id,
    workspaceId,
    projectId: scope.projectId,
  });

  // Confirm the top technical finding → same-transaction Action (spec §9.1).
  const findings = await listProjectFindings({ workspaceId }, scope.projectId, {
    limit: 100,
    cursor: null,
    activeOnly: false,
  });
  const httpFinding = findings.data.find((f) => f.ruleId === "TECH-HTTP-001");
  if (!httpFinding)
    throw new Error("golden fixture did not trip TECH-HTTP-001");
  const review = await reviewProjectFinding(
    { workspaceId },
    scope.projectId,
    httpFinding.id,
    actor,
    { reviewState: "confirmed", baseRevision: httpFinding.reviewRevision },
  );
  if (!review.action) throw new Error("confirm did not create an Action");

  // Artifact create is ALWAYS async, even in TEMPLATE mode (spec §10.1); the
  // template path (generationMode: "template") never calls OpenAI.
  const artifact = await createActionArtifact(
    { workspaceId },
    scope.projectId,
    review.action.id,
    actor,
    {
      artifactType: "technical_ticket", // fix_http_status.v1 → technical_ticket
      generationMode: "template",
      outputLocale: "en",
      operatorInstructions: null,
    },
  );
  await runArtifact(ctx, {
    runId: artifact.run.id,
    workspaceId,
    projectId: scope.projectId,
  });

  return {
    scope,
    actor,
    diagRunId: diag.run.id,
    httpFindingId: httpFinding.id,
    actionId: review.action.id,
    artifactId: artifact.resourceRef.id,
  };
}

export interface ExportChainResult {
  readonly manifest: Record<string, unknown>;
  readonly runStatus: string;
  readonly row: NonNullable<
    Awaited<ReturnType<ExportBundlesRepository["findById"]>>
  >;
}

export async function runExportChain(
  handle: DbHandle,
  ctx: WorkerContext,
  scope: ProjectScope,
  actor: string,
  kind: "service_bundle" | "client_bundle",
): Promise<ExportChainResult> {
  const created = await createProjectExport(
    { workspaceId: scope.workspaceId },
    scope.projectId,
    actor,
    randomUUID(),
    { kind, outputLocale: "en" },
  );
  await runExport(ctx, {
    runId: created.run.id,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
  });
  const row = await new ExportBundlesRepository(handle.db).findById(
    scope,
    created.resourceRef.id,
  );
  if (!row) throw new Error("export bundle row missing after runExport");
  const asyncRun = await new AsyncRunsRepository(handle.db).findById(
    scope,
    created.run.id,
  );
  return {
    manifest: (row.manifest ?? {}) as Record<string, unknown>,
    runStatus: asyncRun?.status ?? "missing",
    row,
  };
}

// --- a faithful mini JSON-Schema validator for the manifest -----------------

type SchemaNode = Record<string, unknown>;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Load the manifest JSON-Schema authority (in-repo mirror, else the spec repo). */
function loadManifestSchema(): SchemaNode {
  const candidates = [
    path.join(process.cwd(), "schemas", "service-bundle-manifest.schema.json"),
    path.join(
      process.cwd(),
      "..",
      "signalframe-mvp",
      "implementation-spec-v0.2",
      "schemas",
      "service-bundle-manifest.schema.json",
    ),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return JSON.parse(readFileSync(c, "utf8")) as SchemaNode;
  }
  throw new Error("service-bundle-manifest.schema.json not found");
}

/**
 * Validate `value` against `node`, collecting human-readable errors. Interprets
 * exactly the JSON-Schema keywords the manifest schema uses ($ref/$defs, const,
 * enum, type, required, additionalProperties:false, properties, items, minItems,
 * uniqueItems, minimum, pattern, format uuid/date-time, min/maxLength) so the
 * test stays coupled to the real schema file rather than a hand-copied shape.
 */
function validateNode(
  node: SchemaNode,
  value: unknown,
  where: string,
  defs: SchemaNode,
  errors: string[],
): void {
  const ref = node["$ref"];
  if (typeof ref === "string") {
    const target = defs[ref.replace("#/$defs/", "")];
    if (isObject(target)) validateNode(target, value, where, defs, errors);
    return;
  }
  if ("const" in node && value !== node["const"]) {
    errors.push(`${where}: expected const ${JSON.stringify(node["const"])}`);
  }
  const enumVals = node["enum"];
  if (Array.isArray(enumVals) && !enumVals.includes(value)) {
    errors.push(`${where}: ${JSON.stringify(value)} not in enum`);
  }
  switch (node["type"]) {
    case "object": {
      if (!isObject(value)) {
        errors.push(`${where}: expected object`);
        return;
      }
      const props = isObject(node["properties"]) ? node["properties"] : {};
      const required = Array.isArray(node["required"]) ? node["required"] : [];
      for (const key of required) {
        if (typeof key === "string" && !(key in value)) {
          errors.push(`${where}/${key}: required property missing`);
        }
      }
      if (node["additionalProperties"] === false) {
        for (const key of Object.keys(value)) {
          if (!(key in props))
            errors.push(`${where}/${key}: additional property`);
        }
      }
      for (const [key, sub] of Object.entries(props)) {
        if (isObject(sub) && key in value) {
          validateNode(sub, value[key], `${where}/${key}`, defs, errors);
        }
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${where}: expected array`);
        return;
      }
      const minItems = node["minItems"];
      if (typeof minItems === "number" && value.length < minItems) {
        errors.push(`${where}: expected >= ${minItems} items`);
      }
      if (
        node["uniqueItems"] === true &&
        new Set(value.map((v) => JSON.stringify(v))).size !== value.length
      ) {
        errors.push(`${where}: items must be unique`);
      }
      if (isObject(node["items"])) {
        const itemSchema = node["items"];
        value.forEach((v, i) =>
          validateNode(itemSchema, v, `${where}/${i}`, defs, errors),
        );
      }
      return;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`${where}: expected integer`);
        return;
      }
      const min = node["minimum"];
      if (typeof min === "number" && value < min) {
        errors.push(`${where}: expected >= ${min}`);
      }
      return;
    }
    case "string": {
      if (typeof value !== "string") {
        errors.push(`${where}: expected string`);
        return;
      }
      const minLength = node["minLength"];
      if (typeof minLength === "number" && value.length < minLength) {
        errors.push(`${where}: shorter than ${minLength}`);
      }
      const maxLength = node["maxLength"];
      if (typeof maxLength === "number" && value.length > maxLength) {
        errors.push(`${where}: longer than ${maxLength}`);
      }
      const pattern = node["pattern"];
      if (typeof pattern === "string" && !new RegExp(pattern).test(value)) {
        errors.push(`${where}: does not match ${pattern}`);
      }
      if (node["format"] === "uuid" && !UUID_RE.test(value)) {
        errors.push(`${where}: not a uuid`);
      }
      if (node["format"] === "date-time" && Number.isNaN(Date.parse(value))) {
        errors.push(`${where}: not a date-time`);
      }
      return;
    }
    default:
      return;
  }
}

export function validateManifest(
  manifest: unknown,
  schema: SchemaNode,
): string[] {
  const defs = isObject(schema["$defs"]) ? schema["$defs"] : {};
  const errors: string[] = [];
  validateNode(schema, manifest, "#", defs, errors);
  return errors;
}

export function manifestFilePaths(
  manifest: Record<string, unknown>,
): string[] {
  const files = manifest["files"];
  if (!Array.isArray(files)) return [];
  return files
    .map((f) =>
      isObject(f) && typeof f["path"] === "string" ? f["path"] : null,
    )
    .filter((p): p is string => p !== null);
}

export function manifestItemCount(
  manifest: Record<string, unknown>,
  key: string,
): number {
  const counts = manifest["itemCounts"];
  if (!isObject(counts)) return -1;
  const v = counts[key];
  return typeof v === "number" ? v : -1;
}

export const MANIFEST_SCHEMA = loadManifestSchema();

/**
 * Stop the enqueue-only pg-boss the web services' getBoss() started, once per
 * test file, so the run does not leak a connection pool. Best-effort.
 */
export async function stopSharedBoss(): Promise<void> {
  if (!DB_AVAILABLE) return;
  try {
    const boss = await getBoss();
    await boss.stop({ graceful: false });
  } catch {
    // best-effort cleanup
  }
}

// Re-exports so each chain test imports everything from this one harness.
export { createDbHandle, listProjectFindings, listProjectActions, getProjectReport };
export { ExecutionArtifactsRepository } from "@sf/db";
export type { DbHandle, ProjectScope, WorkerContext };
