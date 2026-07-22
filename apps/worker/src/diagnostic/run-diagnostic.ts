import { isDeepStrictEqual } from "node:util";
import {
  ActionsRepository,
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingsRepository,
  FindingTargetsRepository,
  IcpProfilesRepository,
  MAX_SITE_PAGE_ID_LOOKUP,
  normalizedUrlHash,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  SitePagesRepository,
  SitesRepository,
  sameTimestamptzInstant,
  TelemetryRepository,
  toRunAttempt,
  type DataSnapshotRow,
  type DiagnosticRunRow,
  type CanonicalValue,
  type EvidenceInsert,
  type FindingObservationInsert,
  type FindingTargetInsert,
  type ObservationRow,
  type PageSnapshotWithSitePageIdentityRow,
  type ProjectScope,
  type RunAttempt,
  type SitePageRow,
} from "@sf/db";
import { isBcp47LanguageTag } from "@sf/contracts";
import {
  LLMError,
  createOpenAIFindingSummaryClient,
  type AnalysisInvocationRecord,
  type FindingSummaryClient,
  type FindingSummaryClientOptions,
} from "@sf/artifacts";
import {
  ALL_RULES,
  DiagnosticContext,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
  parseIcp,
  runPipeline,
  type CoverageInput,
  type DatasetAvailability,
  type FindingSummaryGenerator,
  type ObservationView,
  type RunFinding,
} from "@sf/engine";
import type { Logger } from "@sf/observability";
import {
  CRAWL_DATASET_KEY,
  CRAWL_BUDGET,
  CRAWL_METHOD_VERSION,
  CRAWL_PROJECTION_LIMITS,
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
  METRIC_CRAWL_PAGE,
  METRIC_CRAWL_ROBOTS,
  METRIC_CRAWL_SITEMAP,
  METRIC_CSV_KEYWORD_GAP,
  METRIC_GA4_LANDING,
  METRIC_GSC_PAGE,
  canonicalizeUrl,
  clusterKey,
  normalizeSiteOrigin,
} from "@sf/sources";
import { z } from "zod";
import { exactCandidatesForCanonicalSubject } from "../collection/observation-site-page-lineage.ts";
import type { WorkerContext } from "../context.ts";
import {
  isTransientInfrastructureError,
  transientFailureCode,
} from "../handlers/transient-errors.ts";
import { runtimeFailureMetadata } from "../runtime-failure.ts";
import {
  DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED,
  DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED_SUMMARY,
  supportsCurrentDiagnosticExecutor,
} from "./executor-version.ts";

/**
 * Diagnostic job runner (spec §8.2, §8.6). Loads the frozen manifest + its
 * snapshots' observations, builds the pure `DiagnosticContext`, runs the 11-rule
 * pipeline, then persists rule results + findings + evidence and resolves stale
 * findings — all in one transaction. Cross-run identity uses the pipeline's
 * `findingKey`; a re-hit preserves the human review state and flips `regressed`.
 */

export interface DiagnoseJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface FindingSummaryGeneratorDependencies {
  readonly createClient?: (
    options: FindingSummaryClientOptions,
  ) => FindingSummaryClient;
}

export const MAX_FINDING_SUMMARY_INVOCATIONS_PER_RUN = 8;
export const FINDING_SUMMARY_REQUEST_TIMEOUT_MS = 30_000;

export type FindingSummaryGeneratorStage = FindingSummaryGenerator & {
  /** Throws after the pipeline when invocation accounting is not trustworthy. */
  assertHealthy(): void;
};

const INVOCATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function needsGeneratedSummary(locale: string): boolean {
  const normalized = locale.toLowerCase();
  return (
    normalized !== "en" &&
    !normalized.startsWith("en-") &&
    normalized !== "zh-cn"
  );
}

async function persistFindingSummaryInvocation(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
  invocation: AnalysisInvocationRecord,
): Promise<string | null> {
  try {
    const invocationId = await new AnalysisInvocationsRepository(ctx.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      asyncRunId: runId,
      task: "finding_summary",
      provider: invocation.provider,
      model: invocation.model,
      promptSetVersion: invocation.promptSetVersion,
      inputHash: invocation.inputHash,
      outputHash: invocation.outputHash,
      status: invocation.status,
      inputTokens: invocation.inputTokens,
      outputTokens: invocation.outputTokens,
      costUsd: invocation.costUsd,
      latencyMs: invocation.latencyMs,
      errorCode: invocation.errorCode,
    });
    if (!INVOCATION_UUID_RE.test(invocationId)) return null;
    try {
      ctx.logger.info("finding_summary_invocation_recorded", {
        task: "finding_summary",
        status: invocation.status,
      });
    } catch {
      // Observability cannot turn an optional localized summary into a run error.
    }
    return invocationId;
  } catch (error) {
    // Do not expose DB/provider detail, but do preserve the error for the run-level
    // health latch: a real model call without its immutable audit row must prevent
    // the diagnostic from reaching completed.
    try {
      ctx.logger.warn("finding_summary_invocation_persist_failed", {
        task: "finding_summary",
        status: invocation.status,
      });
    } catch {
      // A failing log sink cannot replace the original infrastructure failure.
    }
    throw error;
  }
}

/**
 * Worker-owned adapter between the engine hook and the model client. A real
 * invocation id is returned only after its immutable row exists. Model failures
 * return null so the engine selects the honestly labelled English fallback;
 * invocation count/persistence failures additionally trip the run-level health
 * latch so the engine's optional-summary fallback cannot complete the run.
 */
export function createFindingSummaryGenerator(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
  dependencies: FindingSummaryGeneratorDependencies = {},
): FindingSummaryGeneratorStage {
  const createClient =
    dependencies.createClient ?? createOpenAIFindingSummaryClient;
  let client: FindingSummaryClient | null = null;
  let clientCreationFailed = false;
  let attemptedInvocations = 0;
  let persistedInvocationCount: Promise<number> | null = null;
  let healthFailed = false;
  let fatalHealthError: unknown;

  const generator: FindingSummaryGeneratorStage = Object.assign(async (
    input: Parameters<FindingSummaryGenerator>[0],
  ) => {
    if (ctx.signal?.aborted) return null;
    if (healthFailed) return null;
    if (clientCreationFailed) return null;
    if (!needsGeneratedSummary(input.outputLocale)) return null;

    persistedInvocationCount ??= new AnalysisInvocationsRepository(
      ctx.db,
    ).countByAsyncRunTask(scope, runId, "finding_summary");
    let historicalInvocations: number;
    try {
      historicalInvocations = await persistedInvocationCount;
    } catch (error) {
      healthFailed = true;
      fatalHealthError = error;
      try {
        ctx.logger.warn("finding_summary_invocation_count_failed", {
          task: "finding_summary",
        });
      } catch {
        // Optional summaries fail closed even if logging is unavailable.
      }
      return null;
    }

    if (ctx.signal?.aborted) return null;
    if (
      historicalInvocations + attemptedInvocations >=
      MAX_FINDING_SUMMARY_INVOCATIONS_PER_RUN
    ) {
      return null;
    }

    if (client === null) {
      try {
        client = createClient({
          apiKey: ctx.openai.apiKey,
          model: ctx.openai.model,
          ...(ctx.openai.baseUrl ? { baseUrl: ctx.openai.baseUrl } : {}),
          ...(ctx.openai.authScheme
            ? { authScheme: ctx.openai.authScheme }
            : {}),
          timeoutMs: FINDING_SUMMARY_REQUEST_TIMEOUT_MS,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
      } catch {
        clientCreationFailed = true;
        return null;
      }
    }

    if (ctx.signal?.aborted) return null;
    attemptedInvocations += 1;
    let result: Awaited<ReturnType<FindingSummaryClient["generateSummary"]>>;
    try {
      result = await client.generateSummary(input);
    } catch (error) {
      if (error instanceof LLMError && error.invocation) {
        try {
          await persistFindingSummaryInvocation(
            ctx,
            scope,
            runId,
            error.invocation,
          );
        } catch (persistenceError) {
          healthFailed = true;
          fatalHealthError = persistenceError;
        }
      }
      return null;
    }

    let invocationId: string | null;
    try {
      invocationId = await persistFindingSummaryInvocation(
        ctx,
        scope,
        runId,
        result.invocation,
      );
    } catch (error) {
      healthFailed = true;
      fatalHealthError = error;
      return null;
    }
    if (invocationId === null) return null;
    return {
      summary: result.summary,
      summaryLocale: result.summaryLocale,
      invocationId,
    };
  }, {
    assertHealthy(): void {
      if (healthFailed) throw fatalHealthError;
    },
  });

  return generator;
}

export function createFindingSummaryGeneratorForRun(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
  dependencies: FindingSummaryGeneratorDependencies = {},
): FindingSummaryGeneratorStage | undefined {
  if (!ctx.findingSummariesEnabled) return undefined;
  return createFindingSummaryGenerator(ctx, scope, runId, dependencies);
}

export function warnOnSlowRules(
  logger: Logger,
  runId: string,
  ruleResults: readonly {
    readonly ruleId: string;
    readonly durationMs: number;
  }[],
): void {
  for (const rule of ruleResults) {
    if (rule.durationMs > 250) {
      logger.warn("diagnostic_rule_slow", {
        runId,
        ruleId: rule.ruleId,
        durationMs: rule.durationMs,
      });
    }
  }
}

interface ManifestSnapshot {
  readonly snapshotId: string;
  readonly provider: string;
  readonly datasetKey: string;
  readonly schemaVersion: string;
  readonly methodVersion: string;
  readonly checksum: string;
  readonly availability: string;
  readonly capturedAt: string;
  readonly sourceWindow: Record<string, unknown>;
}

interface ManifestIcp {
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
}

interface FrozenDiagnosticManifest {
  readonly icp: ManifestIcp;
  readonly snapshots: readonly ManifestSnapshot[];
}

export interface EvidenceLineage {
  readonly snapshotId: string;
  readonly collectionRunId: string;
}

interface FrozenSnapshotSelection {
  readonly lineageByProvider: ReadonlyMap<string, EvidenceLineage>;
  readonly snapshotsById: ReadonlyMap<string, DataSnapshotRow>;
}

interface ObservationSourceRegistration {
  readonly datasetKey: string;
  readonly methodVersion: string;
  readonly origin: string;
  readonly grade: string;
  readonly subjectTypeByMetric: ReadonlyMap<string, string>;
}

/**
 * The only provider/dataset/method/metric tuples the current source adapters can
 * produce. In particular, CSV and DataForSEO intentionally share the logical
 * keyword-gap metric and dataset while retaining distinct provider provenance.
 */
const OBSERVATION_SOURCE_REGISTRY: ReadonlyMap<
  string,
  ObservationSourceRegistration
> = new Map([
  [
    "crawl",
    {
      datasetKey: CRAWL_DATASET_KEY,
      methodVersion: CRAWL_METHOD_VERSION,
      origin: "direct_public",
      grade: "B",
      subjectTypeByMetric: new Map([
        [METRIC_CRAWL_PAGE, "url"],
        [METRIC_CRAWL_ROBOTS, "site"],
        [METRIC_CRAWL_SITEMAP, "site"],
      ]),
    },
  ],
  [
    "gsc",
    {
      datasetKey: "gsc.page_query_daily.v1",
      methodVersion: "gsc.page_query_daily.v1",
      origin: "first_party",
      grade: "A",
      subjectTypeByMetric: new Map([[METRIC_GSC_PAGE, "url"]]),
    },
  ],
  [
    "ga4",
    {
      datasetKey: "ga4.organic_landing_daily.v1",
      methodVersion: "ga4.organic_landing_daily.v1",
      origin: "first_party",
      grade: "A",
      subjectTypeByMetric: new Map([[METRIC_GA4_LANDING, "url"]]),
    },
  ],
  [
    "csv",
    {
      datasetKey: "csv.keyword_gap.v1",
      methodVersion: "csv.keyword_gap.v1",
      origin: "user_provided",
      grade: "C",
      subjectTypeByMetric: new Map([
        [METRIC_CSV_KEYWORD_GAP, "keyword_cluster"],
      ]),
    },
  ],
  [
    "dataforseo",
    {
      datasetKey: DATAFORSEO_DATASET_KEY,
      methodVersion: DATAFORSEO_METHOD_VERSION,
      origin: "vendor_observation",
      grade: "B",
      subjectTypeByMetric: new Map([
        [METRIC_CSV_KEYWORD_GAP, "keyword_cluster"],
      ]),
    },
  ],
]);

const OBSERVATION_CONTRACT_MISMATCH =
  "observation does not match its frozen source contract";
const nonnegativeInteger = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const finiteNonnegative = z.number().finite().nonnegative();
const boundedCrawlUrl = z.url().max(CRAWL_PROJECTION_LIMITS.maxUrlChars);
const nullableBoundedString = (maximum: number) =>
  z.string().max(maximum).nullable();

const crawlLinkProjectionSchema = z
  .object({
    targetSubjectUrl: boundedCrawlUrl,
    rel: nullableBoundedString(CRAWL_PROJECTION_LIMITS.maxRelChars),
    anchorText: nullableBoundedString(
      CRAWL_PROJECTION_LIMITS.maxAnchorTextChars,
    ),
  })
  .strict();

const crawlPageProjectionSchema = z
  .object({
    fetchUrl: boundedCrawlUrl,
    status: z.number().int().min(100).max(599).nullable(),
    finalStatus: z.number().int().min(100).max(599).nullable(),
    redirectChain: z
      .array(boundedCrawlUrl)
      .max(CRAWL_BUDGET.maxRedirects),
    canonicalTarget: boundedCrawlUrl.nullable(),
    robotsIndexable: z.boolean(),
    robotsDirectives: z
      .array(
        z.string().max(CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars),
      )
      .max(CRAWL_PROJECTION_LIMITS.maxRobotsDirectives),
    title: nullableBoundedString(CRAWL_PROJECTION_LIMITS.maxTitleChars),
    metaDescription: nullableBoundedString(
      CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars,
    ),
    h1: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxH1Chars))
      .max(CRAWL_PROJECTION_LIMITS.maxH1),
    headings: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxHeadingChars))
      .max(CRAWL_PROJECTION_LIMITS.maxHeadings),
    wordCount: nonnegativeInteger.nullable(),
    internalOutlinks: z
      .array(crawlLinkProjectionSchema)
      .max(CRAWL_PROJECTION_LIMITS.maxInternalOutlinks),
    jsonLd: z
      .object({
        types: z
          .array(
            z.string().max(CRAWL_PROJECTION_LIMITS.maxJsonLdTypeChars),
          )
          .max(CRAWL_PROJECTION_LIMITS.maxJsonLdTypes),
        errorCount: nonnegativeInteger.max(
          CRAWL_PROJECTION_LIMITS.maxJsonLdBlocks,
        ),
      })
      .strict(),
    sitemapMember: z.boolean(),
    bodyExcerpt: nullableBoundedString(
      CRAWL_PROJECTION_LIMITS.maxBodyExcerptChars,
    ),
    paragraphs: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxParagraphChars))
      .max(CRAWL_PROJECTION_LIMITS.maxParagraphs),
    responseMs: finiteNonnegative.nullable(),
    contentType: nullableBoundedString(
      CRAWL_PROJECTION_LIMITS.maxContentTypeChars,
    ),
  })
  .strict()
  .refine(
    (value) =>
      value.robotsIndexable ===
      !value.robotsDirectives.some(
        (directive) => directive === "noindex" || directive === "none",
      ),
  )
  .refine((value) => value.status !== null && value.finalStatus !== null)
  .refine(
    (value) =>
      value.status !== null &&
      value.finalStatus !== null &&
      (value.redirectChain.length === 0
        ? value.status === value.finalStatus
        : [301, 302, 303, 307, 308].includes(value.status)),
  );

const robotsRuleSchema = z
  .string()
  .max(CRAWL_PROJECTION_LIMITS.maxRobotsRuleChars);
const crawlRobotsProjectionSchema = z
  .object({
    fetched: z.boolean(),
    groups: z
      .array(
        z
          .object({
            userAgent: z
              .string()
              .max(CRAWL_PROJECTION_LIMITS.maxUserAgentChars),
            disallow: z
              .array(robotsRuleSchema)
              .max(CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup),
            allow: z
              .array(robotsRuleSchema)
              .max(CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup),
          })
          .strict(),
      )
      .max(CRAWL_PROJECTION_LIMITS.maxRobotsGroups),
    sitemaps: z
      .array(boundedCrawlUrl)
      .max(CRAWL_PROJECTION_LIMITS.maxSitemaps),
  })
  .strict();

const crawlSitemapProjectionSchema = z
  .object({
    fetched: z.boolean(),
    urlCount: nonnegativeInteger.max(
      CRAWL_PROJECTION_LIMITS.maxSitemapUrls,
    ),
    subjectUrls: z
      .array(boundedCrawlUrl)
      .max(CRAWL_PROJECTION_LIMITS.maxSitemapUrls),
  })
  .strict()
  .refine((value) => value.urlCount === value.subjectUrls.length);

const gscWindowMetricsSchema = z
  .object({
    clicks: finiteNonnegative,
    impressions: finiteNonnegative,
    position: finiteNonnegative.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (value.impressions === 0 && value.position === null) ||
      (value.impressions > 0 && value.position !== null),
  );
const gscTopQuerySchema = z
  .object({
    query: z.string(),
    clicks: finiteNonnegative,
    impressions: finiteNonnegative,
    position: finiteNonnegative.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (value.impressions === 0 && value.position === null) ||
      (value.impressions > 0 && value.position !== null),
  );
const gscPageProjectionSchema = z
  .object({
    current28d: gscWindowMetricsSchema,
    previous28d: gscWindowMetricsSchema,
    topQueries: z.array(gscTopQuerySchema).max(10),
  })
  .strict();

const ga4UnavailableReasonSchema = z.enum([
  "GA4_KEY_EVENT_UNMAPPED",
  "GA4_KEY_EVENT_REPORT_INCOMPATIBLE",
  "GA4_KEY_EVENT_REPORT_TRUNCATED",
]);
const ga4LandingProjectionSchema = z
  .object({
    sessions: nonnegativeInteger,
    engagedSessions: nonnegativeInteger.nullable(),
    engagementRate: z.number().finite().min(0).max(1).nullable(),
    keyEvents: nonnegativeInteger.nullable(),
    keyEventUnavailableReason: ga4UnavailableReasonSchema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.engagedSessions === null
        ? value.engagementRate === null
        : value.engagedSessions <= value.sessions &&
          (value.sessions === 0
            ? value.engagementRate === null
            : value.engagementRate ===
              value.engagedSessions / value.sessions),
  )
  .refine(
    (value) =>
      (value.keyEvents === null) ===
      (value.keyEventUnavailableReason !== null),
  );

const absoluteHttpUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.href === value
    );
  } catch {
    return false;
  }
});
const competitorDomainSchema = z
  .string()
  .regex(
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
  );
const keywordGapProjectionSchema = z
  .object({
    keyword: z.string().min(1).refine((value) => value.trim() === value),
    clusterKey: z.string().min(1).refine((value) => value.trim() === value),
    searchVolume: finiteNonnegative.nullable(),
    currentUrl: absoluteHttpUrlSchema.nullable(),
    currentRank: finiteNonnegative.nullable(),
    competitorDomain: competitorDomainSchema.nullable(),
    competitorRank: finiteNonnegative.nullable(),
    marketCode: z.string().regex(/^[A-Z]{2}$/),
    languageCode: z.string().refine(isBcp47LanguageTag),
  })
  .strict();

const SOURCE_EVIDENCE_PROVIDERS = new Set(
  OBSERVATION_SOURCE_REGISTRY.keys(),
);
const SNAPSHOT_AVAILABILITIES = new Set([
  "available",
  "partial",
  "unavailable",
]);
const MANIFEST_KEYS = [
  "deliveryLocale",
  "icp",
  "projectId",
  "promptSetVersion",
  "ruleSetVersion",
  "siteId",
  "snapshots",
] as const;
const ICP_MANIFEST_KEYS = ["contentHash", "id", "version"] as const;
const SNAPSHOT_MANIFEST_KEYS = [
  "availability",
  "capturedAt",
  "checksum",
  "datasetKey",
  "methodVersion",
  "provider",
  "schemaVersion",
  "snapshotId",
  "sourceWindow",
] as const;

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const orderedExpected = [...expected].sort();
  return (
    actual.length === orderedExpected.length &&
    actual.every((key, index) => key === orderedExpected[index])
  );
}

function requiredManifestString(
  entry: Record<string, unknown>,
  key: string,
): string {
  const value = entry[key];
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error("frozen snapshot manifest is malformed");
  }
  return value;
}

function requiredManifestObject(
  entry: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = entry[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("frozen diagnostic manifest is malformed");
  }
  return value as Record<string, unknown>;
}

function readManifestSnapshots(manifest: Record<string, unknown>): ManifestSnapshot[] {
  const raw = manifest["snapshots"];
  if (!Array.isArray(raw)) {
    throw new Error("frozen snapshot manifest is malformed");
  }
  const snapshots: ManifestSnapshot[] = [];
  const snapshotIds = new Set<string>();
  const providers = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("frozen snapshot manifest is malformed");
    }
    const entry = value as Record<string, unknown>;
    if (!hasExactKeys(entry, SNAPSHOT_MANIFEST_KEYS)) {
      throw new Error("frozen snapshot manifest is malformed");
    }
    const sourceWindow = requiredManifestObject(entry, "sourceWindow");
    const snapshot: ManifestSnapshot = {
      snapshotId: requiredManifestString(entry, "snapshotId"),
      provider: requiredManifestString(entry, "provider"),
      datasetKey: requiredManifestString(entry, "datasetKey"),
      schemaVersion: requiredManifestString(entry, "schemaVersion"),
      methodVersion: requiredManifestString(entry, "methodVersion"),
      checksum: requiredManifestString(entry, "checksum"),
      availability: requiredManifestString(entry, "availability"),
      capturedAt: requiredManifestString(entry, "capturedAt"),
      sourceWindow,
    };
    const sourceRegistration = OBSERVATION_SOURCE_REGISTRY.get(
      snapshot.provider,
    );
    if (
      !sourceRegistration ||
      !SNAPSHOT_AVAILABILITIES.has(snapshot.availability) ||
      snapshotIds.has(snapshot.snapshotId) ||
      providers.has(snapshot.provider)
    ) {
      throw new Error("frozen snapshot manifest selection is ambiguous");
    }
    snapshotIds.add(snapshot.snapshotId);
    providers.add(snapshot.provider);
    snapshots.push(snapshot);
  }
  if (
    !snapshots.some(
      (snapshot) =>
        snapshot.provider === "crawl" &&
        snapshot.methodVersion === CRAWL_METHOD_VERSION &&
        (snapshot.availability === "available" ||
          snapshot.availability === "partial"),
    )
  ) {
    throw new Error("frozen diagnostic manifest requires a usable crawl snapshot");
  }
  return snapshots;
}

function readFrozenDiagnosticManifest(
  diagnostic: DiagnosticRunRow,
): FrozenDiagnosticManifest {
  const manifest = diagnostic.input_manifest;
  if (
    !hasExactKeys(manifest, MANIFEST_KEYS) ||
    contentHash(manifest as unknown as CanonicalValue) !==
      diagnostic.input_hash ||
    manifest["projectId"] !== diagnostic.project_id ||
    manifest["siteId"] !== diagnostic.site_id ||
    manifest["ruleSetVersion"] !== diagnostic.rule_set_version ||
    manifest["promptSetVersion"] !== diagnostic.prompt_set_version ||
    manifest["deliveryLocale"] !== diagnostic.output_locale ||
    diagnostic.rule_set_version !== RULE_SET_VERSION ||
    diagnostic.prompt_set_version !== PROMPT_SET_VERSION
  ) {
    throw new Error("frozen diagnostic manifest does not match its run");
  }

  const rawIcp = requiredManifestObject(manifest, "icp");
  if (!hasExactKeys(rawIcp, ICP_MANIFEST_KEYS)) {
    throw new Error("frozen ICP manifest is malformed");
  }
  const version = rawIcp["version"];
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new Error("frozen ICP manifest is malformed");
  }
  const icp: ManifestIcp = {
    id: requiredManifestString(rawIcp, "id"),
    version: version as number,
    contentHash: requiredManifestString(rawIcp, "contentHash"),
  };
  if (
    icp.id !== diagnostic.icp_profile_id ||
    icp.version !== diagnostic.icp_profile_version
  ) {
    throw new Error("frozen ICP manifest does not match its run");
  }

  return { icp, snapshots: readManifestSnapshots(manifest) };
}

function validateFrozenSnapshotSelection(
  manifestSnapshots: readonly ManifestSnapshot[],
  actualSnapshots: readonly DataSnapshotRow[],
  siteId: string,
): FrozenSnapshotSelection {
  if (actualSnapshots.length !== manifestSnapshots.length) {
    throw new Error("frozen snapshot selection is incomplete");
  }
  const snapshotsById = new Map<string, DataSnapshotRow>();
  for (const snapshot of actualSnapshots) {
    if (snapshotsById.has(snapshot.id)) {
      throw new Error("frozen snapshot selection is ambiguous");
    }
    snapshotsById.set(snapshot.id, snapshot);
  }

  const lineageByProvider = new Map<string, EvidenceLineage>();
  for (const manifestSnapshot of manifestSnapshots) {
    const actual = snapshotsById.get(manifestSnapshot.snapshotId);
    const sourceRegistration = actual
      ? OBSERVATION_SOURCE_REGISTRY.get(actual.provider)
      : undefined;
    if (
      !actual ||
      !sourceRegistration ||
      actual.dataset_key !== sourceRegistration.datasetKey ||
      actual.method_version !== sourceRegistration.methodVersion ||
      actual.site_id !== siteId ||
      actual.provider !== manifestSnapshot.provider ||
      actual.dataset_key !== manifestSnapshot.datasetKey ||
      actual.schema_version !== manifestSnapshot.schemaVersion ||
      actual.method_version !== manifestSnapshot.methodVersion ||
      actual.checksum !== manifestSnapshot.checksum ||
      actual.availability !== manifestSnapshot.availability ||
      !sameTimestamptzInstant(
        actual.captured_at,
        manifestSnapshot.capturedAt,
      ) ||
      !isDeepStrictEqual(actual.source_window, manifestSnapshot.sourceWindow)
    ) {
      throw new Error("frozen snapshot manifest does not match its snapshot");
    }
    if (lineageByProvider.has(actual.provider)) {
      throw new Error("frozen snapshot selection is ambiguous");
    }
    lineageByProvider.set(actual.provider, {
      snapshotId: actual.id,
      collectionRunId: actual.collection_run_id,
    });
  }
  return { lineageByProvider, snapshotsById };
}

/**
 * Reject every normalized row that the frozen source adapter could not have
 * produced. This runs before DiagnosticContext construction, so a historical or
 * cross-provider row cannot be reinterpreted by metric-key dispatch.
 */
function invalidFrozenObservation(): never {
  throw new Error(OBSERVATION_CONTRACT_MISMATCH);
}

function canonicalSubjectAtOrigin(
  subjectRef: string,
  siteOrigin: string,
): boolean {
  const pair = canonicalizeUrl(subjectRef);
  if (!pair || pair.subjectUrl !== subjectRef) return false;
  try {
    return new URL(pair.subjectUrl).origin === siteOrigin;
  } catch {
    return false;
  }
}

function canonicalFetchAtOrigin(
  fetchUrl: string,
  siteOrigin: string,
): ReturnType<typeof canonicalizeUrl> {
  const pair = canonicalizeUrl(fetchUrl);
  if (!pair || pair.fetchUrl !== fetchUrl) return null;
  try {
    return new URL(pair.fetchUrl).origin === siteOrigin ? pair : null;
  } catch {
    return null;
  }
}

function validateCrawlPageIdentity(
  value: z.infer<typeof crawlPageProjectionSchema>,
  subjectRef: string,
  siteOrigin: string,
): boolean {
  const fetch = canonicalFetchAtOrigin(value.fetchUrl, siteOrigin);
  if (!fetch || fetch.subjectUrl !== subjectRef) return false;
  if (
    value.canonicalTarget !== null &&
    canonicalizeUrl(value.canonicalTarget)?.fetchUrl !== value.canonicalTarget
  ) {
    return false;
  }
  for (const redirect of value.redirectChain) {
    if (!canonicalFetchAtOrigin(redirect, siteOrigin)) return false;
  }
  for (const link of value.internalOutlinks) {
    if (!canonicalSubjectAtOrigin(link.targetSubjectUrl, siteOrigin)) {
      return false;
    }
  }
  return true;
}

function validateAvailableObservationValue(
  observation: ObservationRow,
  siteOrigin: string,
): void {
  if (
    observation.value_numeric !== null ||
    observation.value_text !== null ||
    observation.value_json === null ||
    observation.value_json === undefined ||
    observation.unit !== null
  ) {
    invalidFrozenObservation();
  }

  switch (observation.metric_key) {
    case METRIC_CRAWL_PAGE: {
      const parsed = crawlPageProjectionSchema.safeParse(
        observation.value_json,
      );
      if (
        !parsed.success ||
        !validateCrawlPageIdentity(
          parsed.data,
          observation.subject_ref,
          siteOrigin,
        )
      ) {
        invalidFrozenObservation();
      }
      return;
    }
    case METRIC_CRAWL_ROBOTS:
      if (
        !crawlRobotsProjectionSchema.safeParse(observation.value_json)
          .success ||
        observation.subject_ref !== siteOrigin
      ) {
        invalidFrozenObservation();
      }
      return;
    case METRIC_CRAWL_SITEMAP: {
      const parsed = crawlSitemapProjectionSchema.safeParse(
        observation.value_json,
      );
      if (
        !parsed.success ||
        observation.subject_ref !== siteOrigin ||
        !parsed.data.subjectUrls.every((subjectUrl) =>
          canonicalSubjectAtOrigin(subjectUrl, siteOrigin),
        )
      ) {
        invalidFrozenObservation();
      }
      return;
    }
    case METRIC_GSC_PAGE:
      if (
        !gscPageProjectionSchema.safeParse(observation.value_json).success ||
        !canonicalSubjectAtOrigin(observation.subject_ref, siteOrigin)
      ) {
        invalidFrozenObservation();
      }
      return;
    case METRIC_GA4_LANDING:
      if (
        !ga4LandingProjectionSchema.safeParse(observation.value_json).success ||
        !canonicalSubjectAtOrigin(observation.subject_ref, siteOrigin)
      ) {
        invalidFrozenObservation();
      }
      return;
    case METRIC_CSV_KEYWORD_GAP: {
      const parsed = keywordGapProjectionSchema.safeParse(
        observation.value_json,
      );
      if (!parsed.success || parsed.data.clusterKey !== observation.subject_ref) {
        invalidFrozenObservation();
      }
      const value = parsed.data;
      // `currentUrl` is a provider-observed ranking/result projection, not the
      // identity of the keyword-cluster subject. CSV imports and DataForSEO may
      // legitimately report an absolute URL on another origin (for example a
      // competitor result). Keep the strict absolute-URL schema above, while
      // preserving the provider fact exactly instead of inventing a Site-scope
      // constraint that the collection adapters do not make.
      if (
        observation.provider === "csv" &&
        (value.keyword.length > 500 ||
          (value.searchVolume !== null &&
            !Number.isSafeInteger(value.searchVolume)))
      ) {
        invalidFrozenObservation();
      }
      if (
        observation.provider === "dataforseo" &&
        (value.competitorDomain !== null ||
          value.competitorRank !== null ||
          clusterKey(value.keyword) !== value.clusterKey ||
          !/^[a-z]{2,8}$/.test(value.languageCode))
      ) {
        invalidFrozenObservation();
      }
      return;
    }
    default:
      invalidFrozenObservation();
  }
}

function validateFrozenObservations(
  observations: readonly ObservationRow[],
  frozenSelection: FrozenSnapshotSelection,
  siteOrigin: string,
): void {
  for (const observation of observations) {
    const snapshot = frozenSelection.snapshotsById.get(observation.snapshot_id);
    const sourceRegistration = snapshot
      ? OBSERVATION_SOURCE_REGISTRY.get(snapshot.provider)
      : undefined;
    const expectedSubjectType = sourceRegistration?.subjectTypeByMetric.get(
      observation.metric_key,
    );
    if (
      !snapshot ||
      !sourceRegistration ||
      observation.provider !== snapshot.provider ||
      snapshot.dataset_key !== sourceRegistration.datasetKey ||
      snapshot.method_version !== sourceRegistration.methodVersion ||
      expectedSubjectType === undefined ||
      observation.subject_type !== expectedSubjectType ||
      !sameTimestamptzInstant(
        observation.observed_at,
        snapshot.captured_at,
      ) ||
      observation.origin !== sourceRegistration.origin ||
      observation.grade !== sourceRegistration.grade ||
      observation.method !== "observed" ||
      observation.support !== "supports" ||
      observation.unit !== null ||
      !SNAPSHOT_AVAILABILITIES.has(observation.availability) ||
      (snapshot.availability === "unavailable" &&
        observation.availability !== "unavailable")
    ) {
      invalidFrozenObservation();
    }

    if (observation.availability === "available") {
      validateAvailableObservationValue(observation, siteOrigin);
      continue;
    }
    if (
      observation.value_numeric !== null ||
      observation.value_text !== null ||
      observation.value_json !== null
    ) {
      invalidFrozenObservation();
    }
    if (
      observation.metric_key === METRIC_CRAWL_ROBOTS ||
      observation.metric_key === METRIC_CRAWL_SITEMAP
    ) {
      if (observation.subject_ref !== siteOrigin) invalidFrozenObservation();
    } else if (
      (observation.metric_key === METRIC_CRAWL_PAGE ||
        observation.metric_key === METRIC_GSC_PAGE ||
        observation.metric_key === METRIC_GA4_LANDING) &&
      !canonicalSubjectAtOrigin(observation.subject_ref, siteOrigin)
    ) {
      invalidFrozenObservation();
    }
  }
}

const OBSERVATION_LINEAGE_MISMATCH =
  "observation does not match its frozen durable page lineage";

function invalidObservationLineage(): never {
  throw new Error(OBSERVATION_LINEAGE_MISMATCH);
}

function hasDurableUrlIdentity(
  normalizedUrl: string,
  normalizedUrlHashValue: string,
  siteOrigin: string,
): boolean {
  return (
    normalizedUrlHash(normalizedUrl) === normalizedUrlHashValue &&
    canonicalFetchAtOrigin(normalizedUrl, siteOrigin)?.fetchUrl === normalizedUrl
  );
}

function validateFrozenPageIdentity(
  page: PageSnapshotWithSitePageIdentityRow,
  scope: ProjectScope,
  siteId: string,
  siteOrigin: string,
  crawlSnapshot: DataSnapshotRow,
): void {
  if (
    page.workspace_id !== scope.workspaceId ||
    page.project_id !== scope.projectId ||
    page.site_id !== siteId ||
    page.data_snapshot_id !== crawlSnapshot.id ||
    !sameTimestamptzInstant(page.captured_at, crawlSnapshot.captured_at) ||
    !hasDurableUrlIdentity(
      page.normalized_url,
      page.normalized_url_hash,
      siteOrigin,
    )
  ) {
    invalidObservationLineage();
  }
}

function validateSitePageIdentity(
  page: SitePageRow,
  scope: ProjectScope,
  siteId: string,
  siteOrigin: string,
): void {
  if (
    page.workspace_id !== scope.workspaceId ||
    page.project_id !== scope.projectId ||
    page.site_id !== siteId ||
    !hasDurableUrlIdentity(
      page.normalized_url,
      page.normalized_url_hash,
      siteOrigin,
    )
  ) {
    invalidObservationLineage();
  }
}

/**
 * Join immutable Observation lineage only through durable IDs. The frozen Crawl
 * PageSnapshot read is the authoritative exact fetch identity; analytics rows
 * may share that page or resolve through their own persisted SitePage FK. No
 * URL is recovered from subjectRef or evidence.
 */
async function loadObservationViews(
  ctx: WorkerContext,
  scope: ProjectScope,
  siteId: string,
  siteOrigin: string,
  observations: readonly ObservationRow[],
  frozenSelection: FrozenSnapshotSelection,
): Promise<ObservationView[]> {
  const crawlLineage = frozenSelection.lineageByProvider.get("crawl");
  const crawlSnapshot = crawlLineage
    ? frozenSelection.snapshotsById.get(crawlLineage.snapshotId)
    : undefined;
  if (!crawlSnapshot || crawlSnapshot.provider !== "crawl") {
    invalidObservationLineage();
  }

  const frozenPages = await new PageSnapshotsRepository(
    ctx.db,
  ).listByDataSnapshotWithSitePageIdentity(scope, crawlSnapshot.id);
  const pageBySitePageId = new Map<
    string,
    PageSnapshotWithSitePageIdentityRow
  >();
  const pageSnapshotIds = new Set<string>();
  for (const page of frozenPages) {
    validateFrozenPageIdentity(
      page,
      scope,
      siteId,
      siteOrigin,
      crawlSnapshot,
    );
    if (
      pageBySitePageId.has(page.site_page_id) ||
      pageSnapshotIds.has(page.page_snapshot_id)
    ) {
      invalidObservationLineage();
    }
    pageBySitePageId.set(page.site_page_id, page);
    pageSnapshotIds.add(page.page_snapshot_id);
  }

  const observationIds = new Set<string>();
  const unresolvedSitePageIds = new Set<string>();
  for (const observation of observations) {
    if (observationIds.has(observation.id)) invalidObservationLineage();
    observationIds.add(observation.id);
    if (
      observation.site_page_id !== null &&
      observation.subject_type !== "url"
    ) {
      invalidObservationLineage();
    }
    if (
      observation.site_page_id !== null &&
      !pageBySitePageId.has(observation.site_page_id)
    ) {
      unresolvedSitePageIds.add(observation.site_page_id);
    }
  }

  const sitePageById = new Map<string, SitePageRow>();
  const orderedSitePageIds = [...unresolvedSitePageIds].sort();
  const sitePagesRepository = new SitePagesRepository(ctx.db);
  for (
    let offset = 0;
    offset < orderedSitePageIds.length;
    offset += MAX_SITE_PAGE_ID_LOOKUP
  ) {
    const expectedIds = orderedSitePageIds.slice(
      offset,
      offset + MAX_SITE_PAGE_ID_LOOKUP,
    );
    const expectedIdSet = new Set(expectedIds);
    const loaded = await sitePagesRepository.findByIds(scope, expectedIds);
    for (const page of loaded) {
      if (
        !expectedIdSet.has(page.id) ||
        sitePageById.has(page.id)
      ) {
        invalidObservationLineage();
      }
      validateSitePageIdentity(page, scope, siteId, siteOrigin);
      sitePageById.set(page.id, page);
    }
  }
  if (
    orderedSitePageIds.some((sitePageId) => !sitePageById.has(sitePageId))
  ) {
    invalidObservationLineage();
  }

  return observations.map((observation) => {
    const frozenPage =
      observation.site_page_id === null
        ? undefined
        : pageBySitePageId.get(observation.site_page_id);
    const sitePage =
      observation.site_page_id === null
        ? undefined
        : sitePageById.get(observation.site_page_id);
    if (
      observation.site_page_id !== null &&
      frozenPage === undefined &&
      sitePage === undefined
    ) {
      invalidObservationLineage();
    }
    const sitePageUrl =
      frozenPage?.normalized_url ?? sitePage?.normalized_url ?? null;
    const pageSnapshotId = frozenPage?.page_snapshot_id ?? null;

    if (
      (observation.metric_key === METRIC_GSC_PAGE ||
        observation.metric_key === METRIC_GA4_LANDING) &&
      observation.site_page_id !== null
    ) {
      const exactCandidates = exactCandidatesForCanonicalSubject(
        observation.subject_ref,
        siteOrigin,
      );
      if (
        sitePageUrl === null ||
        exactCandidates === null ||
        !exactCandidates.includes(sitePageUrl)
      ) {
        invalidObservationLineage();
      }
    }

    if (observation.metric_key === METRIC_CRAWL_PAGE) {
      const projection = crawlPageProjectionSchema.safeParse(
        observation.value_json,
      );
      if (
        observation.snapshot_id !== crawlSnapshot.id ||
        observation.site_page_id === null ||
        frozenPage === undefined ||
        !projection.success ||
        projection.data.fetchUrl !== frozenPage.normalized_url
      ) {
        invalidObservationLineage();
      }
    }

    return {
      observationId: observation.id,
      snapshotId: observation.snapshot_id,
      sitePageId: observation.site_page_id,
      sitePageUrl,
      pageSnapshotId,
      metricKey: observation.metric_key,
      subjectType: observation.subject_type,
      subjectRef: observation.subject_ref,
      provider: observation.provider,
      availability: observation.availability,
      valueJson: observation.value_json,
      observedAt: observation.observed_at,
    } satisfies ObservationView;
  });
}

export function lineageForEvidenceProvider(
  sourceProvider: string,
  lineageByProvider: ReadonlyMap<string, EvidenceLineage>,
): EvidenceLineage | null {
  if (!SOURCE_EVIDENCE_PROVIDERS.has(sourceProvider)) return null;
  const lineage = lineageByProvider.get(sourceProvider);
  if (!lineage) {
    throw new Error("source evidence has no frozen snapshot lineage");
  }
  return lineage;
}

function buildCoverage(snaps: readonly ManifestSnapshot[]): {
  coverage: CoverageInput;
  capturedAt: Record<string, string>;
  availabilityByProvider: Record<string, DatasetAvailability>;
} {
  const capturedAt: Record<string, string> = {};
  const availabilityByProvider: Record<string, DatasetAvailability> = {};
  for (const snapshot of snaps) {
    capturedAt[snapshot.provider] = snapshot.capturedAt;
    availabilityByProvider[snapshot.provider] =
      snapshot.availability === "available" ||
      snapshot.availability === "partial"
        ? snapshot.availability
        : "unavailable";
  }
  const availFor = (provider: string): DatasetAvailability =>
    availabilityByProvider[provider] ?? "unavailable";
  const keywordGapAvailability = (): DatasetAvailability => {
    const sources = [availFor("csv"), availFor("dataforseo")];
    if (sources.includes("available")) return "available";
    if (sources.includes("partial")) return "partial";
    return "unavailable";
  };
  return {
    coverage: {
      crawl: availFor("crawl"),
      gsc: availFor("gsc"),
      ga4: availFor("ga4"),
      // The frozen `csv` coverage key is the canonical keyword-gap dataset slot.
      // It may now be supplied by either an operator CSV or DataForSEO.
      csv: keywordGapAvailability(),
    },
    capturedAt,
    availabilityByProvider,
  };
}

export async function runDiagnostic(
  ctx: WorkerContext,
  payload: DiagnoseJobPayload,
): Promise<void> {
  const { runId, workspaceId, projectId } = payload;
  const scope: ProjectScope = { workspaceId, projectId };
  const runs = new AsyncRunsRepository(ctx.db);

  const claimed = await runs.claim(scope, runId);
  if (!claimed) return;
  const attempt = toRunAttempt(claimed);

  const diagRun = await new DiagnosticRunsRepository(ctx.db).findById(
    scope,
    runId,
  );
  if (!diagRun) {
    await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "NOT_FOUND",
      lastErrorSummary: "diagnostic run missing",
    });
    return;
  }
  if (!supportsCurrentDiagnosticExecutor(diagRun)) {
    await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED,
      lastErrorSummary: DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED_SUMMARY,
    });
    return;
  }

  try {
    const result = await computeAndPersist(
      ctx,
      scope,
      diagRun,
      claimed.initiated_by,
      attempt,
    );
    if (result === null) return;
    ctx.logger.info("diagnostic_done", {
      runId,
      status: result.status,
      findingCount: result.findingCount,
    });
  } catch (error) {
    if (isTransientInfrastructureError(error)) {
      const code = transientFailureCode(error);
      if (!(await runs.resetToQueued(attempt))) {
        ctx.logger.info("diagnostic_skip_stale_attempt", { code });
        return;
      }
      ctx.logger.warn("diagnostic_transient_error", { code });
      throw error;
    }
    const terminalized = await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
    if (!terminalized) {
      ctx.logger.info("diagnostic_skip_stale_attempt", {
        code: "UNAVAILABLE",
      });
      return;
    }
    ctx.logger.error(
      "diagnostic_failed",
      runtimeFailureMetadata("UNAVAILABLE", error),
    );
  }
}

async function computeAndPersist(
  ctx: WorkerContext,
  scope: ProjectScope,
  diagRun: DiagnosticRunRow,
  actorId: string,
  attempt: RunAttempt,
): Promise<{ status: "completed" | "partial"; findingCount: number } | null> {
  const frozenManifest = readFrozenDiagnosticManifest(diagRun);
  const manifestSnaps = frozenManifest.snapshots;
  const snapshotIds = manifestSnaps.map((s) => s.snapshotId);
  const actualSnapshots = await new DataSnapshotsRepository(ctx.db).findByIds(
    scope,
    snapshotIds,
  );
  const frozenSelection = validateFrozenSnapshotSelection(
    manifestSnaps,
    actualSnapshots,
    diagRun.site_id,
  );

  const site = await new SitesRepository(ctx.db).findById(
    scope,
    diagRun.site_id,
  );
  const normalizedSite = site ? normalizeSiteOrigin(site.origin) : null;
  if (
    !site ||
    !normalizedSite ||
    normalizedSite.origin !== site.origin ||
    normalizedSite.host !== site.host
  ) {
    throw new Error("frozen diagnostic Site identity is unavailable");
  }

  const icpRow = await new IcpProfilesRepository(ctx.db).findById(
    scope,
    diagRun.icp_profile_id,
  );
  if (
    !icpRow ||
    icpRow.status !== "complete" ||
    icpRow.version !== frozenManifest.icp.version ||
    icpRow.content_hash !== frozenManifest.icp.contentHash
  ) {
    throw new Error("frozen ICP profile does not match its manifest");
  }
  const icp = parseIcp(icpRow.profile);

  const observationRows = await new ObservationsRepository(
    ctx.db,
  ).listBySnapshotIds(scope, snapshotIds);
  validateFrozenObservations(
    observationRows,
    frozenSelection,
    normalizedSite.origin,
  );
  const observations = await loadObservationViews(
    ctx,
    scope,
    diagRun.site_id,
    normalizedSite.origin,
    observationRows,
    frozenSelection,
  );
  const discrepancyRows = await new ProviderDiscrepanciesRepository(
    ctx.db,
  ).listUnresolvedBySnapshotIds(scope, snapshotIds);

  const { coverage, capturedAt, availabilityByProvider } =
    buildCoverage(manifestSnaps);
  const diagCtx = DiagnosticContext.build({
    icp,
    deliveryLocale: diagRun.output_locale,
    observations,
    coverage,
    availabilityByProvider,
    capturedAt,
  });

  const summaryGenerator = createFindingSummaryGeneratorForRun(
    ctx,
    scope,
    diagRun.id,
  );
  const pipeline = await runPipeline({
    projectId: scope.projectId,
    ctx: diagCtx,
    rules: ALL_RULES,
    deliveryLocale: diagRun.output_locale,
    discrepancySubjectRefs: [
      ...new Set(discrepancyRows.map((row) => row.subject_ref)),
    ],
    ...(summaryGenerator ? { summaryGenerator } : {}),
  });
  // The engine deliberately contains optional generator failures. Invocation
  // persistence is different: losing an immutable audit row is fatal and must
  // be surfaced before the canonical persistence transaction can complete.
  summaryGenerator?.assertHealthy();
  warnOnSlowRules(ctx.logger, diagRun.id, pipeline.ruleResults);
  for (const finding of pipeline.findings) {
    for (const evidence of finding.evidence) {
      lineageForEvidenceProvider(
        evidence.sourceProvider,
        frozenSelection.lineageByProvider,
      );
    }
  }

  // A run is `completed` (and may therefore auto-resolve stale findings, §8.6)
  // ONLY when every rule actually ran to pass/candidate — a single skipped
  // (missing dataset) or inconclusive rule makes the whole run `partial`, which
  // must NOT resolve anything.
  const allRulesRan = pipeline.ruleResults.every(
    (r) => r.status === "pass" || r.status === "candidate",
  );
  const runStatus: "completed" | "partial" = allRulesRan
    ? "completed"
    : "partial";
  const now = new Date().toISOString();

  const persisted = await ctx.db.transaction(async (tx) => {
    const asyncRunsRepo = new AsyncRunsRepository(tx);
    if (!(await asyncRunsRepo.lockAttemptForUpdate(attempt))) return false;
    // Match web mutation order after fencing the accepted attempt: project
    // before finding/action children. Archival freezes only the project stage;
    // diagnostic history, findings/evidence, and run terminalization converge.
    const projects = new ProjectsRepository(tx);
    const project = await projects.findByIdForUpdate(
      { workspaceId: scope.workspaceId },
      scope.projectId,
    );
    if (!project) {
      throw new Error("diagnostic project disappeared while terminalizing");
    }
    const projectionsMutable = project.archived_at === null;

    // Rule results (append-only ledger).
    await new DiagnosticRunsRepository(tx).insertRuleResults(
      {
        diagnosticRunId: diagRun.id,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
      },
      pipeline.ruleResults.map((r) => ({
        ruleId: r.ruleId,
        ruleVersion: r.ruleVersion,
        domain: r.domain,
        status: r.status,
        reason: r.reason,
        metrics: r.metrics,
        durationMs: r.durationMs,
      })),
    );

    const findingsRepo = new FindingsRepository(tx);
    const findingTargetsRepo = new FindingTargetsRepository(tx);
    const evidenceRepo = new EvidenceRepository(tx);
    const actionsRepo = new ActionsRepository(tx);

    for (const finding of pipeline.findings) {
      const { id: findingId, isRehit } = await upsertFinding(
        findingsRepo,
        scope,
        diagRun.id,
        finding,
        now,
      );
      await findingTargetsRepo.insertMany(
        scope,
        findingTargetInsertsForFinding(
          diagRun.site_id,
          findingId,
          diagRun.id,
          finding.target,
        ),
      );
      const evidenceIds = await persistEvidence(
        evidenceRepo,
        scope,
        diagRun.id,
        findingId,
        finding,
        frozenSelection.lineageByProvider,
      );
      // §9.2: a cross-run re-hit merges the new evidence into an existing,
      // non-dismissed Action without touching human priority/status.
      if (isRehit && evidenceIds.length > 0) {
        const action = await actionsRepo.findActiveByFinding(scope, findingId);
        if (action) {
          const merged = [
            ...new Set([...(action.evidence_refs as string[]), ...evidenceIds]),
          ];
          await actionsRepo.mergeEvidenceRefs(action.id, merged);
        }
      }
    }

    // Cross-run resolve: only a completed (non-partial) run resolves clean rules.
    if (runStatus === "completed") {
      const passedRuleIds = pipeline.ruleResults
        .filter((r) => r.status === "pass")
        .map((r) => r.ruleId);
      const keepKeys = pipeline.findings.map((f) => f.findingKey);
      await findingsRepo.resolveByKeysExcept(
        scope,
        passedRuleIds,
        keepKeys,
        now,
      );
    }

    await new DiagnosticRunsRepository(tx).setCoverage(
      diagRun.id,
      pipeline.coverage as unknown as Record<string, unknown>,
    );

    const terminalized = await asyncRunsRepo.setTerminal(attempt, {
      status: runStatus,
      resultType: "diagnostic_run",
      resultId: diagRun.id,
    });
    if (!terminalized) {
      throw new Error("diagnostic attempt ownership changed while locked");
    }
    if (projectionsMutable) {
      await projects.setStage(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        "planning",
      );
    }

    await new TelemetryRepository(tx).emit({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      eventName: "diagnostic_completed",
      actorId,
      properties: {
        status: runStatus,
        domainCoverage: pipeline.coverage.overall,
        findingCount: pipeline.findings.length,
        durationBucket: "under_10m",
      },
    });
    return true;
  });

  if (!persisted) return null;

  return { status: runStatus, findingCount: pipeline.findings.length };
}

/** Translate the engine's explicit target draft without consulting subjectRefs. */
export function findingTargetInsertsForFinding(
  siteId: string,
  findingId: string,
  diagnosticRunId: string,
  target: RunFinding["target"],
): FindingTargetInsert[] {
  const root = {
    siteId,
    findingId,
    diagnosticRunId,
    relation: target.relation,
    targetKind: target.targetKind,
    targetRef: target.targetRef,
  } as const;
  if (target.members.length === 0) {
    return [
      {
        ...root,
        resolutionState: "definition_only",
        basisKind: "target_definition",
        sitePageId: null,
        pageSnapshotId: null,
        sourceObservationId: null,
        memberRef: null,
        limitation: null,
      },
    ];
  }
  return target.members.map((member): FindingTargetInsert => {
    if (member.resolutionState === "resolved") {
      return {
        ...root,
        resolutionState: member.resolutionState,
        basisKind: member.basisKind,
        sitePageId: member.sitePageId,
        pageSnapshotId: member.pageSnapshotId,
        sourceObservationId: member.observationId,
        memberRef: member.memberRef,
        limitation: null,
      };
    }
    return {
      ...root,
      resolutionState: member.resolutionState,
      basisKind: member.basisKind,
      sitePageId: null,
      pageSnapshotId: null,
      sourceObservationId: member.observationId,
      memberRef: member.memberRef,
      limitation: member.limitation,
    };
  });
}

async function upsertFinding(
  repo: FindingsRepository,
  scope: ProjectScope,
  runId: string,
  finding: RunFinding,
  now: string,
): Promise<{ id: string; isRehit: boolean }> {
  // Preserve the subject-relevance flag for confirm-time priority (spec §9.3
  // step 4). It has no dedicated column, so it rides in title_args under a
  // reserved key the summary templates ignore.
  const titleArgs = {
    ...finding.titleArgs,
    __priorityRelevant: finding.priorityRelevant,
  };

  const existing = await repo.findByKey(scope, finding.findingKey);
  if (!existing) {
    const row = await repo.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      findingKey: finding.findingKey,
      ruleId: finding.ruleId,
      ruleVersion: finding.ruleVersion,
      ruleFamily: finding.ruleFamily,
      intent: finding.intent,
      domain: finding.domain,
      titleKey: finding.titleKey,
      titleArgs,
      summary: finding.summary,
      summaryLocale: finding.summaryLocale,
      summaryInvocationId: finding.summaryInvocationId,
      subjectRefs: [...finding.subjectRefs],
      severity: finding.severity,
      confidence: finding.confidence,
      reviewState: finding.reviewState,
      runId,
      seenAt: now,
    });
    return { id: row.id, isRehit: false };
  }
  // Re-hit: refresh + reactivate, preserve human review state; regressed if resolved.
  const regressed = existing.resolved_at !== null || existing.active === false;
  await repo.touchSeen(existing.id, {
    ruleVersion: finding.ruleVersion,
    severity: finding.severity,
    confidence: finding.confidence,
    titleArgs,
    summary: finding.summary,
    summaryLocale: finding.summaryLocale,
    summaryInvocationId: finding.summaryInvocationId,
    subjectRefs: [...finding.subjectRefs],
    runId,
    seenAt: now,
    regressed,
  });
  return { id: existing.id, isRehit: true };
}

/** Map an evidence support direction to a finding_observations.role (schema CHECK). */
function evidenceRole(support: string | undefined, index: number): string {
  if (support === "contradicts") return "contradicting";
  if (support === "context") return "context";
  return index === 0 ? "primary" : "supporting";
}

async function persistEvidence(
  repo: EvidenceRepository,
  scope: ProjectScope,
  runId: string,
  findingId: string,
  finding: RunFinding,
  lineageByProvider: ReadonlyMap<string, EvidenceLineage>,
): Promise<string[]> {
  const rows: EvidenceInsert[] = finding.evidence.map((e) => {
    const lineage = lineageForEvidenceProvider(
      e.sourceProvider,
      lineageByProvider,
    );
    return {
      sourceProvider: e.sourceProvider,
      origin: e.origin,
      method: e.method,
      grade: e.grade,
      availability: e.availability,
      support: e.support,
      subjectRefs: [...e.subjectRefs],
      claim: e.claim,
      observedAt: e.observedAt,
      limitation: e.limitation,
      ...(lineage
        ? {
            snapshotId: lineage.snapshotId,
            collectionRunId: lineage.collectionRunId,
          }
        : {}),
    };
  });
  const evidenceIds = await repo.insertMany(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: runId,
    },
    rows,
  );
  const links: FindingObservationInsert[] = evidenceIds.map(
    (evidenceId, i) => ({
      findingId,
      evidenceId,
      role: evidenceRole(finding.evidence[i]?.support, i),
    }),
  );
  await repo.linkObservations(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: runId,
    },
    links,
  );
  return evidenceIds;
}
