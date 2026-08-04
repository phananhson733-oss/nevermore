import {
  GrowthMapUrlDetailResponse,
  GrowthMapUrlPortfolioResponse,
  type GrowthMapCoverage,
  type GrowthMapFindingTargetRelation,
  type GrowthMapUrlDetail,
  type GrowthMapUrlFinding,
  type GrowthMapUrlIdentitySource,
  type GrowthMapUrlPortfolioItem,
} from "@sf/contracts";
import type { UiLocale } from "@sf/i18n";
import {
  EvidenceRepository,
  GrowthMapReadRepository,
  isGrowthMapUrlCursorValid,
  MAX_GROWTH_MAP_ENTITY_LOOKUP,
  MAX_GROWTH_MAP_SEARCH_LENGTH as DB_MAX_GROWTH_MAP_SEARCH_LENGTH,
  MAX_GROWTH_MAP_URL_PAGE_SIZE,
  ProjectsRepository,
  sameTimestamptzInstant,
  sha256Hex,
  type ActionRow,
  type ArtifactRow,
  type Executor,
  type FindingRow,
  type FindingTargetRow,
  type GrowthMapReadableRunRow,
  type GrowthMapUrlInventoryRow,
  type ObservationRow,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import { canonicalizeUrl } from "@sf/sources";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import {
  assertGrowthMapFindingSummaryLocale,
  customerFacingGrowthMapFindingTitle,
  growthMapProjectionCopy,
  growthMapIsoInstant,
  projectGrowthMapUrlCoverage,
  projectGrowthMapMetricObservations,
  verifiedGrowthMapPageTitle,
  type FrozenGrowthMapRun,
} from "./growth-map-projection";
import { loadPublishedGrowthMapGeneration } from "./growth-map-generation";
import { isStale } from "./source-mappers";

export const MAX_GROWTH_MAP_SEARCH_LENGTH =
  DB_MAX_GROWTH_MAP_SEARCH_LENGTH;

const REQUIRED_URL_METRIC_PROVIDERS = ["crawl", "gsc", "ga4"] as const;
const SEVERITY_ORDER = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
} as const;
const REVIEWABLE_STATES = new Set(["unreviewed", "needs_more_data"]);
const TARGET_RELATION_KIND = {
  direct_url: "url",
  affected_by_template: "template",
  affected_by_site: "site",
  affected_by_page_set: "page_set",
  affected_by_http_status: "http_status",
  affected_by_canonical_issue: "canonical_issue",
  affected_by_keyword_cluster: "keyword_cluster",
  affected_by_user_agent: "user_agent",
} as const;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface GrowthMapUrlListOptions {
  readonly limit: number;
  readonly cursor: string | null;
  readonly search?: string | null;
  /** Exact published generation expected by the caller; null/absent means latest. */
  readonly diagnosticRunId?: string | null;
  /** Test/SSR clock seam; never serialized into the response. */
  readonly now?: Date;
}

export interface GrowthMapUrlDetailOptions {
  /** Exact published generation expected by the caller; null means latest. */
  readonly diagnosticRunId: string | null;
}

/** Request-bound workspace scope for customer-facing Growth Map copy. */
export interface GrowthMapReadScope extends WorkspaceScope {
  readonly uiLocale: UiLocale;
}

interface GrowthMapReadContext {
  readonly projectScope: ProjectScope;
  /** Request-scoped chrome locale; never used to reinterpret persisted content. */
  readonly uiLocale: UiLocale;
  readonly run: GrowthMapReadableRunRow;
  readonly frozen: FrozenGrowthMapRun;
}

interface ProjectionRows {
  readonly inventory: readonly GrowthMapUrlInventoryRow[];
  readonly observations: readonly ObservationRow[];
  readonly targets: readonly FindingTargetRow[];
  readonly findings: readonly FindingRow[];
}

function corruptGrowthMap(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The frozen Growth Map projection failed its provenance checks.",
  );
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function batches<T>(values: readonly T[], size: number): readonly T[][] {
  const output: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(values.slice(offset, offset + size));
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalDiagnosticRunId(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (!CANONICAL_UUID.test(value)) {
    throw new RangeError("diagnosticRunId must be a canonical UUID");
  }
  return value;
}

function validNow(now: Date): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("now must be a valid Date");
  }
  return now;
}

async function loadReadContext(
  exec: Executor,
  scope: GrowthMapReadScope,
  projectId: string,
  diagnosticRunId: string | null,
): Promise<GrowthMapReadContext> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const project = await new ProjectsRepository(exec).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const generation = await loadPublishedGrowthMapGeneration(
    exec,
    projectScope,
    diagnosticRunId,
  );
  if (
    diagnosticRunId !== null &&
    generation.run.id !== diagnosticRunId
  ) {
    return corruptGrowthMap();
  }
  // The selected published run is authoritative. The request UI locale
  // controls chrome only: it must neither reject this run nor query backward
  // for one whose output locale happens to match. Persisted Finding locale
  // integrity is checked against run.output_locale during projection.
  return {
    projectScope,
    uiLocale: scope.uiLocale,
    run: generation.run,
    frozen: generation.frozen,
  };
}

function supportedUrlObservation(row: ObservationRow): boolean {
  return (
    row.subject_type === "url" &&
    ((row.provider === "crawl" && row.metric_key === "crawl.page.v1") ||
      (row.provider === "gsc" && row.metric_key === "gsc.page.v1") ||
      (row.provider === "ga4" && row.metric_key === "ga4.landing.v1"))
  );
}

function exactAnalyticsCandidates(subjectRef: string): readonly string[] {
  const canonical = canonicalizeUrl(subjectRef);
  if (
    canonical === null ||
    canonical.subjectUrl !== subjectRef ||
    canonical.fetchUrl !== subjectRef
  ) {
    return [];
  }
  let parsed: URL;
  try {
    parsed = new URL(subjectRef);
  } catch {
    return [];
  }
  if (parsed.pathname === "/") return [subjectRef];
  const slash = new URL(subjectRef);
  slash.pathname = `${slash.pathname}/`;
  const slashCanonical = canonicalizeUrl(slash.href);
  if (
    slashCanonical === null ||
    slashCanonical.subjectUrl !== subjectRef ||
    slashCanonical.fetchUrl === subjectRef
  ) {
    return [];
  }
  return [subjectRef, slashCanonical.fetchUrl];
}

function validateObservationForUrl(
  observation: ObservationRow,
  inventory: GrowthMapUrlInventoryRow,
  frozen: FrozenGrowthMapRun,
): void {
  const snapshot = frozen.snapshotsById.get(observation.snapshot_id);
  if (
    !snapshot ||
    observation.workspace_id !== inventory.workspace_id ||
    observation.project_id !== inventory.project_id ||
    observation.site_page_id !== inventory.site_page_id ||
    snapshot.provider !== observation.provider ||
    !sameTimestamptzInstant(
      observation.observed_at,
      snapshot.captured_at,
    ) ||
    !supportedUrlObservation(observation)
  ) {
    corruptGrowthMap();
  }
  if (observation.provider === "crawl") {
    if (
      inventory.page_snapshot_id === null ||
      observation.snapshot_id !== frozen.crawlSnapshotId ||
      !isRecord(observation.value_json) ||
      observation.value_json["fetchUrl"] !== inventory.normalized_url
    ) {
      corruptGrowthMap();
    }
    return;
  }
  if (
    !exactAnalyticsCandidates(observation.subject_ref).includes(
      inventory.normalized_url,
    )
  ) {
    corruptGrowthMap();
  }
}

function validateInventoryRow(
  row: GrowthMapUrlInventoryRow,
  context: GrowthMapReadContext,
): void {
  const crawlValues = [
    row.page_snapshot_id,
    row.crawl_snapshot_id,
    row.page_snapshot_content_hash,
    row.page_snapshot_extract,
    row.page_snapshot_captured_at,
  ];
  const hasCrawl = row.page_snapshot_id !== null;
  if (
    row.workspace_id !== context.projectScope.workspaceId ||
    row.project_id !== context.projectScope.projectId ||
    row.site_id !== context.run.site_id ||
    row.normalized_url_hash !== sha256Hex(row.normalized_url) ||
    crawlValues.some((value) => (value !== null) !== hasCrawl) ||
    (hasCrawl &&
      (row.crawl_snapshot_id !== context.frozen.crawlSnapshotId ||
        !sameTimestamptzInstant(
          row.page_snapshot_captured_at ?? "",
          context.frozen.snapshotsById.get(context.frozen.crawlSnapshotId)
            ?.captured_at ?? "",
        )))
  ) {
    corruptGrowthMap();
  }
  if (row.template_key !== null) corruptGrowthMap();
}

function observationsBySitePage(
  inventory: readonly GrowthMapUrlInventoryRow[],
  observations: readonly ObservationRow[],
  frozen: FrozenGrowthMapRun,
): Map<string, ObservationRow[]> {
  const inventoryById = new Map(inventory.map((row) => [row.site_page_id, row]));
  const grouped = new Map<string, ObservationRow[]>();
  const tupleKeys = new Set<string>();
  for (const observation of observations) {
    if (!supportedUrlObservation(observation)) continue;
    if (observation.site_page_id === null) corruptGrowthMap();
    const row = inventoryById.get(observation.site_page_id);
    if (!row) corruptGrowthMap();
    validateObservationForUrl(observation, row, frozen);
    const tupleKey = `${observation.site_page_id}:${observation.provider}:${observation.metric_key}`;
    if (tupleKeys.has(tupleKey)) corruptGrowthMap();
    tupleKeys.add(tupleKey);
    const rows = grouped.get(observation.site_page_id) ?? [];
    rows.push(observation);
    grouped.set(observation.site_page_id, rows);
  }
  for (const row of inventory) {
    const rows = grouped.get(row.site_page_id) ?? [];
    const crawl = rows.find((observation) => observation.provider === "crawl");
    if ((row.page_snapshot_id !== null) !== (crawl !== undefined)) {
      corruptGrowthMap();
    }
    if (row.page_snapshot_id === null && rows.length === 0) {
      corruptGrowthMap();
    }
  }
  return grouped;
}

function targetsBySitePage(
  inventory: readonly GrowthMapUrlInventoryRow[],
  targets: readonly FindingTargetRow[],
  observations: readonly ObservationRow[],
  context: GrowthMapReadContext,
): Map<string, FindingTargetRow[]> {
  const inventoryById = new Map(inventory.map((row) => [row.site_page_id, row]));
  const observationById = new Map(observations.map((row) => [row.id, row]));
  const grouped = new Map<string, FindingTargetRow[]>();
  const membershipKeys = new Set<string>();
  for (const target of targets) {
    if (
      target.workspace_id !== context.projectScope.workspaceId ||
      target.project_id !== context.projectScope.projectId ||
      target.site_id !== context.run.site_id ||
      target.diagnostic_run_id !== context.run.id ||
      target.resolution_state !== "resolved" ||
      target.site_page_id === null ||
      target.source_observation_id === null ||
      target.member_ref === null ||
      target.limitation !== null ||
      TARGET_RELATION_KIND[target.relation] !== target.target_kind
    ) {
      corruptGrowthMap();
    }
    const inventoryRow = inventoryById.get(target.site_page_id);
    const observation = observationById.get(target.source_observation_id);
    if (!inventoryRow || !observation) corruptGrowthMap();
    validateObservationForUrl(observation, inventoryRow, context.frozen);
    if (
      target.page_snapshot_id !== null &&
      target.page_snapshot_id !== inventoryRow.page_snapshot_id
    ) {
      corruptGrowthMap();
    }
    if (target.basis_kind === "crawl_exact_fetch") {
      if (
        observation.provider !== "crawl" ||
        target.page_snapshot_id === null ||
        target.page_snapshot_id !== inventoryRow.page_snapshot_id ||
        target.member_ref !== inventoryRow.normalized_url
      ) {
        corruptGrowthMap();
      }
    } else if (target.basis_kind === "observation_site_page") {
      if (
        (observation.provider !== "gsc" && observation.provider !== "ga4") ||
        target.relation !== "direct_url" ||
        target.target_ref !== inventoryRow.normalized_url ||
        target.member_ref !== observation.subject_ref ||
        target.page_snapshot_id !== inventoryRow.page_snapshot_id
      ) {
        corruptGrowthMap();
      }
    } else {
      corruptGrowthMap();
    }
    if (
      target.relation === "direct_url" &&
      target.target_ref !== inventoryRow.normalized_url
    ) {
      corruptGrowthMap();
    }
    const membershipKey = `${target.site_page_id}:${target.finding_id}`;
    if (membershipKeys.has(membershipKey)) corruptGrowthMap();
    membershipKeys.add(membershipKey);
    const rows = grouped.get(target.site_page_id) ?? [];
    rows.push(target);
    grouped.set(target.site_page_id, rows);
  }
  return grouped;
}

async function loadFindings(
  repo: GrowthMapReadRepository,
  scope: ProjectScope,
  runId: string,
  findingIds: readonly string[],
): Promise<FindingRow[]> {
  const rows: FindingRow[] = [];
  for (const batch of batches(unique(findingIds).sort(), MAX_GROWTH_MAP_ENTITY_LOOKUP)) {
    rows.push(...(await repo.listFindings(scope, runId, batch)));
  }
  if (rows.length !== unique(findingIds).length) corruptGrowthMap();
  return rows;
}

async function loadProjectionRows(
  exec: Executor,
  context: GrowthMapReadContext,
  inventory: readonly GrowthMapUrlInventoryRow[],
): Promise<ProjectionRows> {
  for (const row of inventory) validateInventoryRow(row, context);
  const repo = new GrowthMapReadRepository(exec);
  const sitePageIds = inventory.map((row) => row.site_page_id);
  const observations = await repo.listObservations(context.projectScope, {
    snapshotIds: context.frozen.snapshotIds,
    sitePageIds,
  });
  const targets = await repo.listResolvedTargets(
    context.projectScope,
    context.run.id,
    sitePageIds,
  );
  const findingIds = unique(targets.map((row) => row.finding_id));
  const findings = await loadFindings(
    repo,
    context.projectScope,
    context.run.id,
    findingIds,
  );
  observationsBySitePage(inventory, observations, context.frozen);
  targetsBySitePage(inventory, targets, observations, context);
  return { inventory, observations, targets, findings };
}

function sourceCoverage(
  context: GrowthMapReadContext,
  now: Date,
): GrowthMapCoverage {
  const copy = growthMapProjectionCopy(context.uiLocale);
  const partial: string[] = [];
  const stale: string[] = [];
  if (context.run.run_status === "partial") {
    partial.push(copy.partialRun);
  }
  for (const provider of REQUIRED_URL_METRIC_PROVIDERS) {
    const snapshot = context.frozen.snapshotsByProvider.get(provider);
    if (!snapshot) {
      partial.push(copy.missingSnapshot(provider));
      continue;
    }
    if (snapshot.availability !== "available") {
      partial.push(
        copy.snapshotAvailability(
          provider,
          snapshot.availability as "available" | "partial" | "unavailable",
        ),
      );
    }
    if (isStale(provider, snapshot.captured_at, now.getTime())) {
      stale.push(copy.staleSnapshot(provider));
    }
  }
  const limitations = unique([...partial, ...stale]).slice(0, 100);
  if (partial.length > 0) return { availability: "partial", limitations };
  if (stale.length > 0) return { availability: "stale", limitations };
  return { availability: "available", limitations: [] };
}

function urlCoverage(
  base: GrowthMapCoverage,
  inventory: GrowthMapUrlInventoryRow,
  observations: readonly ObservationRow[],
  uiLocale: UiLocale,
): GrowthMapCoverage {
  const analyticsAvailability: Partial<
    Record<"gsc" | "ga4", "available" | "partial" | "unavailable">
  > = {};
  for (const provider of ["gsc", "ga4"] as const) {
    const observation = observations.find((row) => row.provider === provider);
    if (
      observation &&
      (observation.availability === "available" ||
        observation.availability === "partial" ||
        observation.availability === "unavailable")
    ) {
      analyticsAvailability[provider] = observation.availability;
    }
  }
  return projectGrowthMapUrlCoverage(base, {
    hasPageSnapshot: inventory.page_snapshot_id !== null,
    analyticsAvailability,
  }, uiLocale);
}

function findingById(
  findings: readonly FindingRow[],
  outputLocale: string,
): ReadonlyMap<string, FindingRow> {
  const result = new Map<string, FindingRow>();
  for (const finding of findings) {
    if (result.has(finding.id)) corruptGrowthMap();
    if (
      !Object.hasOwn(SEVERITY_ORDER, finding.severity) ||
      !Number.isSafeInteger(finding.review_revision) ||
      finding.review_revision < 0 ||
      !["unreviewed", "confirmed", "ignored", "needs_more_data"].includes(
        finding.review_state,
      )
    ) {
      corruptGrowthMap();
    }
    try {
      assertGrowthMapFindingSummaryLocale(
        finding.summary_locale,
        outputLocale,
        finding.summary_invocation_id ?? null,
      );
    } catch {
      corruptGrowthMap();
    }
    result.set(finding.id, finding);
  }
  return result;
}

function derivedTemplateKey(targets: readonly FindingTargetRow[]): string | null {
  const refs = unique(
    targets
      .filter((target) => target.relation === "affected_by_template")
      .map((target) => target.target_ref),
  );
  if (refs.length > 1) corruptGrowthMap();
  return refs[0] ?? null;
}

function priorityForUrl(
  context: GrowthMapReadContext,
  sitePageId: string,
  findingIds: readonly string[],
  findings: ReadonlyMap<string, FindingRow>,
): GrowthMapUrlPortfolioItem["priority"] {
  if (findingIds.length === 0) {
    return {
      availability: "unavailable",
      value: null,
      limitation: growthMapProjectionCopy(context.uiLocale)
        .priorityUnavailable,
    };
  }
  let selected: keyof typeof SEVERITY_ORDER | null = null;
  for (const findingId of findingIds) {
    const finding = findings.get(findingId);
    if (!finding) corruptGrowthMap();
    const severity = finding.severity as keyof typeof SEVERITY_ORDER;
    if (selected === null || SEVERITY_ORDER[severity] > SEVERITY_ORDER[selected]) {
      selected = severity;
    }
  }
  if (selected === null) corruptGrowthMap();
  return {
    availability: "available",
    value: selected,
    basis: {
      derivationVersion: "max_finding_severity.v1",
      projectId: context.projectScope.projectId,
      siteId: context.run.site_id,
      diagnosticRunId: context.run.id,
      sitePageId,
      findingIds: [...findingIds],
    },
    limitation: null,
  };
}

function findingTargetRelation(
  target: FindingTargetRow,
): GrowthMapFindingTargetRelation {
  if (target.relation === "direct_url") {
    if (target.site_page_id === null) corruptGrowthMap();
    return {
      relation: "direct_url",
      targetKind: "url",
      targetRef: target.target_ref,
      sitePageId: target.site_page_id,
      pageSnapshotId: target.page_snapshot_id,
    };
  }
  return {
    relation: target.relation,
    targetKind: target.target_kind,
    targetRef: target.target_ref,
  } as GrowthMapFindingTargetRelation;
}

function pageIdentitySources(
  inventory: GrowthMapUrlInventoryRow,
  observations: readonly ObservationRow[],
): GrowthMapUrlIdentitySource[] {
  const sources: GrowthMapUrlIdentitySource[] = [];
  if (
    inventory.page_snapshot_id !== null &&
    inventory.crawl_snapshot_id !== null &&
    inventory.page_snapshot_captured_at !== null
  ) {
    sources.push({
      kind: "page_snapshot",
      provider: "crawl",
      snapshotId: inventory.crawl_snapshot_id,
      pageSnapshotId: inventory.page_snapshot_id,
      observedAt: growthMapIsoInstant(inventory.page_snapshot_captured_at),
    });
  }
  for (const observation of observations) {
    if (
      observation.provider !== "crawl" &&
      observation.provider !== "gsc" &&
      observation.provider !== "ga4"
    ) {
      continue;
    }
    if (observation.site_page_id === null) corruptGrowthMap();
    sources.push({
      kind: "url_observation",
      provider: observation.provider,
      snapshotId: observation.snapshot_id,
      observationId: observation.id,
      sitePageId: observation.site_page_id,
      subjectRef: observation.subject_ref,
      observedAt: growthMapIsoInstant(observation.observed_at),
    });
  }
  return sources;
}

function portfolioItems(
  rows: ProjectionRows,
  context: GrowthMapReadContext,
  now: Date,
): GrowthMapUrlPortfolioItem[] {
  const observations = observationsBySitePage(
    rows.inventory,
    rows.observations,
    context.frozen,
  );
  const targets = targetsBySitePage(
    rows.inventory,
    rows.targets,
    rows.observations,
    context,
  );
  const findings = findingById(rows.findings, context.run.output_locale);
  const baseCoverage = sourceCoverage(context, now);
  return rows.inventory.map((inventory) => {
    const pageObservations = observations.get(inventory.site_page_id) ?? [];
    const pageTargets = targets.get(inventory.site_page_id) ?? [];
    const findingIds = pageTargets.map((target) => target.finding_id).sort();
    const reviewableFindingIds = findingIds.filter((findingId) => {
      const finding = findings.get(findingId);
      return (
        finding !== undefined &&
        finding.active &&
        REVIEWABLE_STATES.has(finding.review_state)
      );
    });
    let title: string | null = null;
    if (
      inventory.page_snapshot_id !== null &&
      inventory.page_snapshot_content_hash !== null &&
      inventory.page_snapshot_extract !== null
    ) {
      try {
        title = verifiedGrowthMapPageTitle({
          normalizedUrl: inventory.normalized_url,
          contentHash: inventory.page_snapshot_content_hash,
          canonicalExtract: inventory.page_snapshot_canonical_extract,
          extract: inventory.page_snapshot_extract,
        });
      } catch {
        corruptGrowthMap();
      }
    }
    let metricObservations;
    try {
      metricObservations = projectGrowthMapMetricObservations(
        pageObservations,
        context.frozen.snapshotsById,
        now,
      );
    } catch {
      return corruptGrowthMap();
    }
    return {
      projectId: context.projectScope.projectId,
      siteId: context.run.site_id,
      diagnosticRunId: context.run.id,
      crawlSnapshotId: context.frozen.crawlSnapshotId,
      sitePageId: inventory.site_page_id,
      pageSnapshotId: inventory.page_snapshot_id,
      pageSnapshotCapturedAt:
        inventory.page_snapshot_captured_at === null
          ? null
          : growthMapIsoInstant(inventory.page_snapshot_captured_at),
      identitySources: pageIdentitySources(inventory, pageObservations),
      normalizedUrl: inventory.normalized_url,
      title,
      pageType: null,
      templateKey: derivedTemplateKey(pageTargets),
      clusterKey: null,
      ownerId: null,
      coverage: urlCoverage(
        baseCoverage,
        inventory,
        pageObservations,
        context.uiLocale,
      ),
      metricObservations,
      findingIds,
      reviewableFindingIds,
      priority: priorityForUrl(
        context,
        inventory.site_page_id,
        findingIds,
        findings,
      ),
      delta: {
        availability: "unavailable",
        value: null,
        limitation:
          growthMapProjectionCopy(context.uiLocale).deltaUnavailable,
      },
    } satisfies GrowthMapUrlPortfolioItem;
  });
}

async function listProjectAuditUrlsInSnapshot(
  exec: Executor,
  scope: GrowthMapReadScope,
  projectId: string,
  opts: GrowthMapUrlListOptions,
): Promise<ReturnType<typeof GrowthMapUrlPortfolioResponse.parse>> {
  const now = validNow(opts.now ?? new Date());
  const context = await loadReadContext(
    exec,
    scope,
    projectId,
    opts.diagnosticRunId ?? null,
  );
  const page = await new GrowthMapReadRepository(exec).listCurrentRunUrls(
    context.projectScope,
    context.run.id,
    {
      limit: opts.limit,
      cursor: opts.cursor,
      opportunitiesOnly: true,
      ...(opts.search ? { search: opts.search } : {}),
    },
  );
  const rows = await loadProjectionRows(exec, context, page.rows);
  const result = {
    projectId,
    siteId: context.run.site_id,
    diagnosticRunId: context.run.id,
    crawlSnapshotId: context.frozen.crawlSnapshotId,
    data: portfolioItems(rows, context, now),
    meta: {
      limit: opts.limit,
      nextCursor: page.nextCursor,
      hasNext: page.nextCursor !== null,
      coverage: sourceCoverage(context, now),
    },
  };
  try {
    return GrowthMapUrlPortfolioResponse.parse(result);
  } catch {
    return corruptGrowthMap();
  }
}

export async function listProjectAuditUrls(
  scope: GrowthMapReadScope,
  projectId: string,
  opts: GrowthMapUrlListOptions,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapUrlPortfolioResponse.parse>> {
  if (opts.cursor !== null && !isGrowthMapUrlCursorValid(opts.cursor)) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Query parameter failed validation.",
      {
        errors: [
          {
            pointer: "/cursor",
            code: "invalid_query_value",
            message: "Invalid query parameter.",
          },
        ],
      },
    );
  }
  const diagnosticRunId = canonicalDiagnosticRunId(opts.diagnosticRunId);
  if (
    !Number.isSafeInteger(opts.limit) ||
    opts.limit < 1 ||
    opts.limit > MAX_GROWTH_MAP_URL_PAGE_SIZE ||
    (opts.search !== undefined &&
      opts.search !== null &&
      (opts.search.length < 1 ||
        opts.search.length > MAX_GROWTH_MAP_SEARCH_LENGTH ||
        opts.search !== opts.search.trim()))
  ) {
    throw new RangeError("Invalid Growth Map URL list options");
  }
  const normalizedOptions = { ...opts, diagnosticRunId };
  if (exec) {
    return listProjectAuditUrlsInSnapshot(
      exec,
      scope,
      projectId,
      normalizedOptions,
    );
  }
  return getDb().db.transaction(
    (tx) =>
      listProjectAuditUrlsInSnapshot(
        tx,
        scope,
        projectId,
        normalizedOptions,
      ),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function activeExecutionRefs(
  exec: Executor,
  scope: ProjectScope,
  findingIds: readonly string[],
): Promise<{
  readonly actions: ReadonlyMap<string, ActionRow>;
  readonly artifacts: ReadonlyMap<string, readonly ArtifactRow[]>;
}> {
  const repo = new GrowthMapReadRepository(exec);
  const actionRows: ActionRow[] = [];
  for (const batch of batches(findingIds, MAX_GROWTH_MAP_ENTITY_LOOKUP)) {
    actionRows.push(...(await repo.listActiveActions(scope, batch)));
  }
  const actions = new Map<string, ActionRow>();
  for (const action of actionRows) {
    if (actions.has(action.source_finding_id)) corruptGrowthMap();
    actions.set(action.source_finding_id, action);
  }
  const artifactRows: ArtifactRow[] = [];
  const actionIds = actionRows.map((row) => row.id);
  for (const batch of batches(actionIds, MAX_GROWTH_MAP_ENTITY_LOOKUP)) {
    artifactRows.push(...(await repo.listArtifacts(scope, batch)));
  }
  const artifacts = new Map<string, ArtifactRow[]>();
  const artifactIds = new Set<string>();
  for (const artifact of artifactRows) {
    if (artifactIds.has(artifact.id)) corruptGrowthMap();
    artifactIds.add(artifact.id);
    const rows = artifacts.get(artifact.action_id) ?? [];
    rows.push(artifact);
    artifacts.set(artifact.action_id, rows);
  }
  return { actions, artifacts };
}

async function findingDetails(
  exec: Executor,
  context: GrowthMapReadContext,
  portfolio: GrowthMapUrlPortfolioItem,
  targets: readonly FindingTargetRow[],
  findings: readonly FindingRow[],
): Promise<GrowthMapUrlFinding[]> {
  const findingIds = portfolio.findingIds;
  const findingRows = findingById(findings, context.run.output_locale);
  const targetByFinding = new Map<string, FindingTargetRow>();
  for (const target of targets) {
    if (targetByFinding.has(target.finding_id)) corruptGrowthMap();
    targetByFinding.set(target.finding_id, target);
  }
  const evidenceLinks = await new EvidenceRepository(exec).listForFindings(
    context.projectScope,
    findingIds,
    { diagnosticRunId: context.run.id, maxRows: findingIds.length * 200 + 1 },
  );
  if (evidenceLinks.length > findingIds.length * 200) corruptGrowthMap();
  const evidenceByFinding = new Map<string, string[]>();
  for (const link of evidenceLinks) {
    const ids = evidenceByFinding.get(link.finding_id) ?? [];
    if (ids.includes(link.evidence_id)) corruptGrowthMap();
    ids.push(link.evidence_id);
    evidenceByFinding.set(link.finding_id, ids);
  }
  const execution = await activeExecutionRefs(
    exec,
    context.projectScope,
    findingIds,
  );
  return findingIds.map((findingId) => {
    const finding = findingRows.get(findingId);
    const target = targetByFinding.get(findingId);
    const evidenceIds = (evidenceByFinding.get(findingId) ?? []).sort();
    if (!finding || !target || evidenceIds.length === 0) corruptGrowthMap();
    const action = execution.actions.get(findingId);
    const artifactIds = action
      ? (execution.artifacts.get(action.id) ?? []).map((row) => row.id).sort()
      : [];
    if (artifactIds.length > 100) corruptGrowthMap();
    let title: string;
    try {
      title = customerFacingGrowthMapFindingTitle(
        finding.summary,
        finding.summary_locale,
        context.run.output_locale,
        finding.summary_invocation_id ?? null,
      );
    } catch {
      return corruptGrowthMap();
    }
    return {
      projectId: context.projectScope.projectId,
      siteId: context.run.site_id,
      findingId,
      diagnosticRunId: context.run.id,
      ruleId: finding.rule_id,
      ruleVersion: finding.rule_version,
      title,
      severity: finding.severity as GrowthMapUrlFinding["severity"],
      reviewState: finding.review_state as GrowthMapUrlFinding["reviewState"],
      reviewRevision: finding.review_revision,
      active: finding.active,
      regressed: finding.regressed,
      evidenceIds,
      targetRelation: findingTargetRelation(target),
      executionRef: action
        ? { actionId: action.id, artifactIds }
        : null,
    } satisfies GrowthMapUrlFinding;
  });
}

async function getProjectAuditUrlInSnapshot(
  exec: Executor,
  scope: GrowthMapReadScope,
  projectId: string,
  sitePageId: string,
  diagnosticRunId: string | null,
  now: Date,
): Promise<ReturnType<typeof GrowthMapUrlDetailResponse.parse>> {
  const context = await loadReadContext(
    exec,
    scope,
    projectId,
    diagnosticRunId,
  );
  const inventory = await new GrowthMapReadRepository(exec).findCurrentRunUrl(
    context.projectScope,
    context.run.id,
    sitePageId,
  );
  if (!inventory) {
    throw new ProblemError(
      "NOT_FOUND",
      "The selected URL is not part of the requested published Growth Map generation.",
    );
  }
  const rows = await loadProjectionRows(exec, context, [inventory]);
  const portfolio = portfolioItems(rows, context, validNow(now))[0];
  if (!portfolio) corruptGrowthMap();
  const findings = await findingDetails(
    exec,
    context,
    portfolio,
    rows.targets,
    rows.findings,
  );
  const detail = { ...portfolio, findings } satisfies GrowthMapUrlDetail;
  try {
    return GrowthMapUrlDetailResponse.parse({
      projectId,
      siteId: context.run.site_id,
      diagnosticRunId: context.run.id,
      crawlSnapshotId: context.frozen.crawlSnapshotId,
      data: detail,
    });
  } catch {
    return corruptGrowthMap();
  }
}

function isGrowthMapUrlDetailOptions(
  value: GrowthMapUrlDetailOptions | Executor | undefined,
): value is GrowthMapUrlDetailOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "diagnosticRunId")
  );
}

/**
 * Legacy test/integration seam: an Executor may remain the fourth argument
 * when the caller wants the latest published generation.
 */
export function getProjectAuditUrl(
  scope: GrowthMapReadScope,
  projectId: string,
  sitePageId: string,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapUrlDetailResponse.parse>>;

/** Exact route signature: generation options precede the optional Executor. */
export function getProjectAuditUrl(
  scope: GrowthMapReadScope,
  projectId: string,
  sitePageId: string,
  options: GrowthMapUrlDetailOptions,
  exec?: Executor,
): Promise<ReturnType<typeof GrowthMapUrlDetailResponse.parse>>;

export async function getProjectAuditUrl(
  scope: GrowthMapReadScope,
  projectId: string,
  sitePageId: string,
  optionsOrExec?: GrowthMapUrlDetailOptions | Executor,
  trailingExec?: Executor,
): Promise<ReturnType<typeof GrowthMapUrlDetailResponse.parse>> {
  const hasOptions = isGrowthMapUrlDetailOptions(optionsOrExec);
  const diagnosticRunId = canonicalDiagnosticRunId(
    hasOptions ? optionsOrExec.diagnosticRunId : null,
  );
  const exec = hasOptions ? trailingExec : optionsOrExec;
  const now = new Date();
  if (exec) {
    return getProjectAuditUrlInSnapshot(
      exec,
      scope,
      projectId,
      sitePageId,
      diagnosticRunId,
      now,
    );
  }
  return getDb().db.transaction(
    (tx) =>
      getProjectAuditUrlInSnapshot(
        tx,
        scope,
        projectId,
        sitePageId,
        diagnosticRunId,
        now,
      ),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
