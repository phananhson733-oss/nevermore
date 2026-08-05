import {
  GrowthMapInternalLinkMap as GrowthMapInternalLinkMapSchema,
  MAX_INTERNAL_LINK_MAP_EDGES,
  MAX_INTERNAL_LINK_MAP_RECOMMENDATIONS,
  type GrowthMapInternalLinkMap,
  type InternalLinkMapEdge,
  type InternalLinkMapExecutionRef,
  type InternalLinkMapNode,
  type InternalLinkRecommendation,
  type InternalLinkSelectedPage,
} from "@sf/contracts";
import {
  DataSnapshotsRepository,
  GrowthMapReadRepository,
  InternalLinkMapIntegrityError,
  InternalLinkMapRepository,
  ProjectsRepository,
  SitesRepository,
  canonicalUtcTimestamptz,
  canonicalize,
  contentHash,
  isTimestamptzInstant,
  sameTimestamptzInstant,
  type CanonicalValue,
  type DataSnapshotRow,
  type Executor,
  type GrowthMapReadableRunRow,
  type InternalLinkCrawlObservationRow,
  type InternalLinkPageTopicAuthority,
  type ProjectScope,
  type SiteRow,
  type WorkspaceScope,
} from "@sf/db";
import {
  GOVERNED_LEGACY_RULE_SET_VERSION,
  LEGACY_RULE_SET_VERSION,
  RULE_SET_VERSION,
  parseGovernanceProjectionV1,
} from "@sf/engine";
import { ProblemError } from "@sf/observability";
import {
  CRAWL_BUDGET,
  CRAWL_PROJECTION_LIMITS,
  canonicalizeUrl,
  type CrawlPageProjection,
} from "@sf/sources";
import { z } from "zod";
import { getDb } from "@/lib/db";

const MAX_FROZEN_SNAPSHOTS = 20;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256 = /^[0-9a-f]{64}$/u;
const LEGACY_MANIFEST_KEYS = [
  "deliveryLocale",
  "icp",
  "projectId",
  "promptSetVersion",
  "ruleSetVersion",
  "siteId",
  "snapshots",
] as const;
const CURRENT_MANIFEST_KEYS = [...LEGACY_MANIFEST_KEYS, "governance"] as const;
const ICP_KEYS = ["contentHash", "id", "version"] as const;
const SNAPSHOT_KEYS = [
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
const SNAPSHOT_AVAILABILITIES = new Set([
  "available",
  "partial",
  "unavailable",
]);

const NO_READABLE_DIAGNOSTIC = "当前项目没有可读取的已完成诊断。";
const NO_FROZEN_CRAWL = "本次诊断未冻结 Crawl 数据快照。";
const UNRESOLVED_LINK_TARGET =
  "部分冻结内链指向本次 Crawl 未收录目标页，因此未用于孤立页判断。";
const TRUNCATED_EDGES = "内链边超过读取上限；当前仅返回稳定排序后的前一部分。";
const NO_CONFIRMED_TOPIC = "尚无已确认的 Topic Model，无法生成内链推荐。";
const NO_SELECTED_TOPIC =
  "目标页没有已确认的 Topic/Keyword 映射，无法生成内链推荐。";
const PARTIAL_RECOMMENDATIONS =
  "Crawl 覆盖不完整；推荐仅表示冻结数据中尚未观察到该内链。";
const MISSING_SITE_PAGE_LINEAGE =
  "部分冻结 Crawl Observation 缺少可验证的 SitePage 血缘，未纳入节点与孤立页判断。";

const BoundedUrl = z.string().url().max(CRAWL_PROJECTION_LIMITS.maxUrlChars);
const HttpStatus = z.number().int().min(100).max(999).nullable();
const BoundedNullableString = (maximum: number) =>
  z.string().max(maximum).nullable();

const CrawlLinkProjectionSchema = z
  .object({
    targetSubjectUrl: BoundedUrl,
    rel: BoundedNullableString(CRAWL_PROJECTION_LIMITS.maxRelChars),
    anchorText: BoundedNullableString(
      CRAWL_PROJECTION_LIMITS.maxAnchorTextChars,
    ),
  })
  .strict();

const CrawlPageProjectionSchema: z.ZodType<CrawlPageProjection> = z
  .object({
    fetchUrl: BoundedUrl,
    status: HttpStatus,
    finalStatus: HttpStatus,
    redirectChain: z.array(BoundedUrl).max(CRAWL_BUDGET.maxRedirects + 1),
    canonicalTarget: BoundedUrl.nullable(),
    robotsIndexable: z.boolean(),
    robotsDirectives: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars))
      .max(CRAWL_PROJECTION_LIMITS.maxRobotsDirectives),
    title: BoundedNullableString(CRAWL_PROJECTION_LIMITS.maxTitleChars),
    metaDescription: BoundedNullableString(
      CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars,
    ),
    h1: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxH1Chars))
      .max(CRAWL_PROJECTION_LIMITS.maxH1),
    headings: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxHeadingChars))
      .max(CRAWL_PROJECTION_LIMITS.maxHeadings),
    wordCount: z.number().int().nonnegative().max(20_000_000).nullable(),
    internalOutlinks: z
      .array(CrawlLinkProjectionSchema)
      .max(CRAWL_PROJECTION_LIMITS.maxInternalOutlinks)
      .superRefine((links, ctx) => {
        const targets = new Set<string>();
        links.forEach((link, index) => {
          if (targets.has(link.targetSubjectUrl)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "targetSubjectUrl"],
              message:
                "One exact crawl page may contribute one fact per canonical target.",
            });
          }
          targets.add(link.targetSubjectUrl);
        });
      }),
    jsonLd: z
      .object({
        types: z
          .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxJsonLdTypeChars))
          .max(CRAWL_PROJECTION_LIMITS.maxJsonLdTypes),
        errorCount: z.number().int().nonnegative().max(100_000),
      })
      .strict(),
    sitemapMember: z.boolean(),
    bodyExcerpt: BoundedNullableString(
      CRAWL_PROJECTION_LIMITS.maxBodyExcerptChars,
    ),
    paragraphs: z
      .array(z.string().max(CRAWL_PROJECTION_LIMITS.maxParagraphChars))
      .max(CRAWL_PROJECTION_LIMITS.maxParagraphs),
    responseMs: z.number().nonnegative().finite().nullable(),
    contentType: BoundedNullableString(
      CRAWL_PROJECTION_LIMITS.maxContentTypeChars,
    ),
  })
  .strict();

interface FrozenSnapshotManifest {
  readonly snapshotId: string;
  readonly provider: string;
  readonly datasetKey: string;
  readonly schemaVersion: string;
  readonly methodVersion: string;
  readonly capturedAt: string;
  readonly sourceWindow: Record<string, unknown>;
  readonly availability: "available" | "partial" | "unavailable";
  readonly checksum: string;
}

interface FrozenManifest {
  readonly snapshotEntries: readonly FrozenSnapshotManifest[];
  readonly snapshotIds: readonly string[];
}

interface ValidatedFrozenRun {
  readonly run: GrowthMapReadableRunRow;
  readonly site: SiteRow;
  readonly crawlSnapshot: DataSnapshotRow | null;
}

interface ExactPageObservation {
  readonly row: InternalLinkCrawlObservationRow & {
    readonly site_page_id: string;
    readonly normalized_url: string;
  };
  readonly projection: CrawlPageProjection | null;
}

interface WorkingNode {
  readonly canonicalUrl: string;
  readonly variants: readonly ExactPageObservation[];
  readonly sitePageIds: readonly string[];
  readonly title: string | null;
}

class InternalLinkMapReadIntegrityError extends Error {
  override readonly name = "InternalLinkMapReadIntegrityError";
}

function integrityFailure(): never {
  throw new InternalLinkMapReadIntegrityError(
    "Internal Link Map read authority failed integrity validation.",
  );
}

function dependencyUnavailable(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "Internal Link Map 的冻结数据权威链未通过完整性校验。",
  );
}

function projectNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Project not found.");
}

function selectedPageNotFound(): never {
  throw new ProblemError("NOT_FOUND", "所选页面不在当前冻结增长地图中。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    return integrityFailure();
  }
  return value;
}

/**
 * Frozen manifests gained a `governance` key when Keyword/Topic governance
 * shipped: governed rule sets (mvp.rules.0.2.2+) must carry it, the legacy
 * rule set (mvp.rules.0.2.1) must not. Mirrors growth-map-projection.
 */
function manifestShapeValid(
  manifest: Record<string, unknown>,
  ruleSetVersion: string,
): boolean {
  if (
    ruleSetVersion === RULE_SET_VERSION ||
    ruleSetVersion === GOVERNED_LEGACY_RULE_SET_VERSION
  ) {
    if (!hasExactKeys(manifest, CURRENT_MANIFEST_KEYS)) return false;
    try {
      parseGovernanceProjectionV1(manifest["governance"]);
    } catch {
      return false;
    }
    return true;
  }
  return (
    ruleSetVersion === LEGACY_RULE_SET_VERSION &&
    hasExactKeys(manifest, LEGACY_MANIFEST_KEYS)
  );
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  try {
    return (
      canonicalize(left as CanonicalValue) ===
      canonicalize(right as CanonicalValue)
    );
  } catch {
    return false;
  }
}

function canonicalNow(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return dependencyUnavailable();
  }
  return now.toISOString();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueLimitations(values: readonly string[]): string[] {
  return uniqueSorted(
    values.map((value) => value.trim()).filter((value) => value.length > 0),
  ).slice(0, 100);
}

function assertUuid(value: string): void {
  if (!UUID.test(value)) integrityFailure();
}

function readFrozenManifest(
  run: GrowthMapReadableRunRow,
  scope: ProjectScope,
): FrozenManifest {
  const manifest = run.input_manifest;
  if (
    run.workspace_id !== scope.workspaceId ||
    run.project_id !== scope.projectId ||
    (run.run_status !== "completed" && run.run_status !== "partial") ||
    run.run_completed_at === null ||
    !isTimestamptzInstant(run.run_completed_at) ||
    !isRecord(manifest) ||
    !manifestShapeValid(manifest, run.rule_set_version) ||
    !SHA_256.test(run.input_hash) ||
    contentHash(manifest as CanonicalValue) !== run.input_hash ||
    manifest["projectId"] !== run.project_id ||
    manifest["siteId"] !== run.site_id ||
    manifest["ruleSetVersion"] !== run.rule_set_version ||
    manifest["promptSetVersion"] !== run.prompt_set_version ||
    manifest["deliveryLocale"] !== run.output_locale
  ) {
    return integrityFailure();
  }
  assertUuid(run.id);
  assertUuid(run.site_id);

  const icp = manifest["icp"];
  if (!isRecord(icp) || !hasExactKeys(icp, ICP_KEYS)) {
    return integrityFailure();
  }
  const icpVersion = icp["version"];
  if (
    requiredString(icp, "id") !== run.icp_profile_id ||
    !Number.isInteger(icpVersion) ||
    (icpVersion as number) < 1 ||
    icpVersion !== run.icp_profile_version ||
    !SHA_256.test(requiredString(icp, "contentHash"))
  ) {
    return integrityFailure();
  }

  const snapshots = manifest["snapshots"];
  if (
    !Array.isArray(snapshots) ||
    snapshots.length === 0 ||
    snapshots.length > MAX_FROZEN_SNAPSHOTS
  ) {
    return integrityFailure();
  }
  const entries: FrozenSnapshotManifest[] = [];
  const ids = new Set<string>();
  const providers = new Set<string>();
  for (const raw of snapshots) {
    if (!isRecord(raw) || !hasExactKeys(raw, SNAPSHOT_KEYS)) {
      return integrityFailure();
    }
    const snapshotId = requiredString(raw, "snapshotId");
    const provider = requiredString(raw, "provider");
    const availability = requiredString(raw, "availability");
    const sourceWindow = raw["sourceWindow"];
    const capturedAt = requiredString(raw, "capturedAt");
    const checksum = requiredString(raw, "checksum");
    if (
      !UUID.test(snapshotId) ||
      ids.has(snapshotId) ||
      providers.has(provider) ||
      !SNAPSHOT_AVAILABILITIES.has(availability) ||
      !isRecord(sourceWindow) ||
      !isTimestamptzInstant(capturedAt) ||
      !SHA_256.test(checksum)
    ) {
      return integrityFailure();
    }
    ids.add(snapshotId);
    providers.add(provider);
    entries.push({
      snapshotId,
      provider,
      datasetKey: requiredString(raw, "datasetKey"),
      schemaVersion: requiredString(raw, "schemaVersion"),
      methodVersion: requiredString(raw, "methodVersion"),
      capturedAt,
      sourceWindow,
      availability: availability as FrozenSnapshotManifest["availability"],
      checksum,
    });
  }
  return {
    snapshotEntries: entries,
    snapshotIds: entries.map((entry) => entry.snapshotId),
  };
}

function validateFrozenSnapshots(
  run: GrowthMapReadableRunRow,
  frozen: FrozenManifest,
  actualSnapshots: readonly DataSnapshotRow[],
  site: SiteRow,
  scope: ProjectScope,
): ValidatedFrozenRun {
  if (
    site.id !== run.site_id ||
    site.workspace_id !== scope.workspaceId ||
    site.project_id !== scope.projectId
  ) {
    return integrityFailure();
  }
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(site.origin);
  } catch {
    return integrityFailure();
  }
  if (
    parsedOrigin.origin !== site.origin ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search !== "" ||
    parsedOrigin.hash !== ""
  ) {
    return integrityFailure();
  }

  const actualById = new Map(
    actualSnapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  if (
    actualById.size !== actualSnapshots.length ||
    actualSnapshots.length !== frozen.snapshotEntries.length
  ) {
    return integrityFailure();
  }
  let crawlSnapshot: DataSnapshotRow | null = null;
  for (const entry of frozen.snapshotEntries) {
    const actual = actualById.get(entry.snapshotId);
    if (
      !actual ||
      actual.workspace_id !== scope.workspaceId ||
      actual.project_id !== scope.projectId ||
      actual.site_id !== run.site_id ||
      actual.provider !== entry.provider ||
      actual.dataset_key !== entry.datasetKey ||
      actual.schema_version !== entry.schemaVersion ||
      actual.method_version !== entry.methodVersion ||
      actual.checksum !== entry.checksum ||
      actual.availability !== entry.availability ||
      !sameTimestamptzInstant(actual.captured_at, entry.capturedAt) ||
      !sameCanonicalValue(actual.source_window, entry.sourceWindow) ||
      typeof actual.limitation !== "string"
    ) {
      return integrityFailure();
    }
    if (entry.provider === "crawl") {
      if (crawlSnapshot !== null) return integrityFailure();
      crawlSnapshot = actual;
    }
  }
  return { run, site, crawlSnapshot };
}

async function frozenRunAuthority(
  exec: Executor,
  scope: ProjectScope,
): Promise<ValidatedFrozenRun | null> {
  const run = await new GrowthMapReadRepository(exec).findLatestReadableRun(
    scope,
  );
  if (run === null) return null;
  const frozen = readFrozenManifest(run, scope);
  const snapshots = await new DataSnapshotsRepository(exec).findByIds(
    scope,
    frozen.snapshotIds,
  );
  const site = await new SitesRepository(exec).findById(scope, run.site_id);
  if (site === null) return integrityFailure();
  return validateFrozenSnapshots(run, frozen, snapshots, site, scope);
}

function parseResponse(input: unknown): GrowthMapInternalLinkMap {
  const parsed = GrowthMapInternalLinkMapSchema.safeParse(input);
  if (!parsed.success) return integrityFailure();
  return parsed.data;
}

function unavailableResponse(
  projectId: string,
  generatedAt: string,
  limitation: string,
  authority: {
    readonly diagnosticRunId: string;
    readonly crawlSnapshot: DataSnapshotRow;
  } | null,
): GrowthMapInternalLinkMap {
  return parseResponse({
    projectId,
    diagnosticRunId: authority?.diagnosticRunId ?? null,
    crawlSnapshot: authority
      ? {
          snapshotId: authority.crawlSnapshot.id,
          capturedAt: canonicalUtcTimestamptz(
            authority.crawlSnapshot.captured_at,
          ),
          availability: "unavailable",
          limitation: authority.crawlSnapshot.limitation.trim(),
        }
      : null,
    coverage: {
      availability: "unavailable",
      crawlCompleteness: "unavailable",
      limitations: [limitation],
    },
    graph: {
      nodes: [],
      edges: [],
      totalEdgeCount: 0,
      edgesTruncated: false,
    },
    selectedPage: null,
    generatedAt,
  });
}

function normalizeTitle(title: string | null): string | null {
  if (title === null) return null;
  const normalized = title.trim();
  return normalized.length > 0 && normalized.length <= 500 ? normalized : null;
}

function validateObservation(
  row: InternalLinkCrawlObservationRow,
  authority: ValidatedFrozenRun,
  seenObservationIds: Set<string>,
  seenSitePageIds: Set<string>,
): ExactPageObservation | null {
  const snapshot = authority.crawlSnapshot;
  if (
    snapshot === null ||
    row.workspace_id !== authority.run.workspace_id ||
    row.project_id !== authority.run.project_id ||
    row.snapshot_id !== snapshot.id ||
    row.provider !== "crawl" ||
    row.metric_key !== "crawl.page.v1" ||
    row.subject_type !== "url" ||
    row.origin !== "direct_public" ||
    row.method !== "observed" ||
    row.grade !== "B" ||
    row.support !== "supports" ||
    !sameTimestamptzInstant(row.observed_at, snapshot.captured_at) ||
    seenObservationIds.has(row.observation_id)
  ) {
    return integrityFailure();
  }
  assertUuid(row.observation_id);
  seenObservationIds.add(row.observation_id);

  const subject = canonicalizeUrl(row.subject_ref);
  if (
    subject === null ||
    subject.subjectUrl !== row.subject_ref ||
    new URL(row.subject_ref).origin !== authority.site.origin
  ) {
    return integrityFailure();
  }

  if (
    row.availability !== "available" &&
    row.availability !== "partial" &&
    row.availability !== "unavailable"
  ) {
    return integrityFailure();
  }
  if (row.availability !== "available") {
    if (
      row.value_numeric !== null ||
      row.value_text !== null ||
      row.value_json !== null ||
      row.unit !== null ||
      row.limitation.trim().length === 0
    ) {
      return integrityFailure();
    }
  } else {
    if (
      row.value_numeric !== null ||
      row.value_text !== null ||
      row.unit !== null
    ) {
      return integrityFailure();
    }
    const parsed = CrawlPageProjectionSchema.safeParse(row.value_json);
    if (!parsed.success) return integrityFailure();
    const fetch = canonicalizeUrl(parsed.data.fetchUrl);
    if (
      fetch === null ||
      fetch.fetchUrl !== parsed.data.fetchUrl ||
      fetch.subjectUrl !== row.subject_ref ||
      new URL(parsed.data.fetchUrl).origin !== authority.site.origin
    ) {
      return integrityFailure();
    }
    for (const link of parsed.data.internalOutlinks) {
      const target = canonicalizeUrl(link.targetSubjectUrl);
      if (
        target === null ||
        target.subjectUrl !== link.targetSubjectUrl ||
        new URL(link.targetSubjectUrl).origin !== authority.site.origin
      ) {
        return integrityFailure();
      }
    }
  }

  if (row.site_page_id === null) {
    if (row.normalized_url !== null) return integrityFailure();
    return null;
  }
  if (row.normalized_url === null || seenSitePageIds.has(row.site_page_id)) {
    return integrityFailure();
  }
  assertUuid(row.site_page_id);
  seenSitePageIds.add(row.site_page_id);
  const normalized = canonicalizeUrl(row.normalized_url);
  if (
    normalized === null ||
    normalized.fetchUrl !== row.normalized_url ||
    normalized.subjectUrl !== row.subject_ref ||
    new URL(row.normalized_url).origin !== authority.site.origin
  ) {
    return integrityFailure();
  }
  if (row.availability !== "available") {
    return {
      row: row as ExactPageObservation["row"],
      projection: null,
    };
  }
  const projection = CrawlPageProjectionSchema.parse(row.value_json);
  if (projection.fetchUrl !== row.normalized_url) {
    return integrityFailure();
  }
  return {
    row: row as ExactPageObservation["row"],
    projection,
  };
}

function buildWorkingNodes(
  observations: readonly InternalLinkCrawlObservationRow[],
  authority: ValidatedFrozenRun,
): {
  readonly nodes: readonly WorkingNode[];
  readonly observationsPartial: boolean;
  readonly observationLimitations: readonly string[];
} {
  const seenObservationIds = new Set<string>();
  const seenSitePageIds = new Set<string>();
  const validated: ExactPageObservation[] = [];
  let unlineagedCount = 0;
  for (const row of observations) {
    const observation = validateObservation(
      row,
      authority,
      seenObservationIds,
      seenSitePageIds,
    );
    if (observation === null) unlineagedCount += 1;
    else validated.push(observation);
  }

  const variantsBySubject = new Map<string, ExactPageObservation[]>();
  for (const observation of validated) {
    const variants = variantsBySubject.get(observation.row.subject_ref) ?? [];
    variants.push(observation);
    variantsBySubject.set(observation.row.subject_ref, variants);
  }

  const nodes: WorkingNode[] = [];
  for (const [canonicalUrl, variants] of variantsBySubject) {
    variants.sort(
      (left, right) =>
        compareAscii(left.row.normalized_url, right.row.normalized_url) ||
        compareAscii(left.row.observation_id, right.row.observation_id),
    );
    if (variants.length > 2) return integrityFailure();
    const title =
      variants
        .map((variant) => normalizeTitle(variant.projection?.title ?? null))
        .find((candidate) => candidate !== null) ?? null;
    nodes.push({
      canonicalUrl,
      variants,
      sitePageIds: uniqueSorted(
        variants.map((variant) => variant.row.site_page_id),
      ),
      title,
    });
  }
  nodes.sort((left, right) =>
    left.canonicalUrl < right.canonicalUrl ? -1 : 1,
  );
  return {
    nodes,
    observationsPartial:
      unlineagedCount > 0 ||
      validated.some((observation) => observation.projection === null),
    observationLimitations: uniqueLimitations([
      ...(unlineagedCount > 0 ? [MISSING_SITE_PAGE_LINEAGE] : []),
      ...validated
        .filter((observation) => observation.projection === null)
        .map((observation) => observation.row.limitation),
    ]),
  };
}

function factKey(fact: InternalLinkMapEdge["facts"][number]): string {
  return [
    fact.sourceSitePageId,
    fact.anchorText ?? "",
    fact.rel ?? "",
    fact.observationId,
  ].join("\u0000");
}

function buildEdges(nodes: readonly WorkingNode[]): {
  readonly edges: readonly InternalLinkMapEdge[];
  readonly unresolvedTargetCount: number;
} {
  const nodeByUrl = new Map(nodes.map((node) => [node.canonicalUrl, node]));
  const factsByEdge = new Map<string, InternalLinkMapEdge["facts"][number][]>();
  const unresolvedTargets = new Set<string>();
  for (const source of nodes) {
    for (const variant of source.variants) {
      if (variant.projection === null) continue;
      for (const link of variant.projection.internalOutlinks) {
        const target = nodeByUrl.get(link.targetSubjectUrl);
        if (!target) {
          unresolvedTargets.add(link.targetSubjectUrl);
          continue;
        }
        const key = `${source.canonicalUrl}\u0000${target.canonicalUrl}`;
        const facts = factsByEdge.get(key) ?? [];
        facts.push({
          observationId: variant.row.observation_id,
          sourceSitePageId: variant.row.site_page_id,
          anchorText: link.anchorText,
          rel: link.rel,
        });
        factsByEdge.set(key, facts);
      }
    }
  }

  const edgeKeys = [...factsByEdge.keys()].sort();
  const edgeKeySet = new Set(edgeKeys);
  const edges = edgeKeys.map((key): InternalLinkMapEdge => {
    const separator = key.indexOf("\u0000");
    const sourceCanonicalUrl = key.slice(0, separator);
    const targetCanonicalUrl = key.slice(separator + 1);
    const source = nodeByUrl.get(sourceCanonicalUrl);
    const target = nodeByUrl.get(targetCanonicalUrl);
    if (!source || !target) return integrityFailure();
    const facts = factsByEdge.get(key);
    if (!facts) return integrityFailure();
    facts.sort((left, right) => (factKey(left) < factKey(right) ? -1 : 1));
    if (facts.length < 1 || facts.length > 2) return integrityFailure();
    return {
      sourceCanonicalUrl,
      targetCanonicalUrl,
      sourceSitePageIds: [...source.sitePageIds],
      targetSitePageIds: [...target.sitePageIds],
      facts,
      reciprocal: edgeKeySet.has(
        `${targetCanonicalUrl}\u0000${sourceCanonicalUrl}`,
      ),
    };
  });
  return { edges, unresolvedTargetCount: unresolvedTargets.size };
}

function executionRefsByPage(
  rows: Awaited<ReturnType<InternalLinkMapRepository["listExecutionRefs"]>>,
  sitePageIds: ReadonlySet<string>,
): ReadonlyMap<string, readonly InternalLinkMapExecutionRef[]> {
  const refs = new Map<string, InternalLinkMapExecutionRef[]>();
  for (const row of rows) {
    if (!sitePageIds.has(row.site_page_id)) return integrityFailure();
    assertUuid(row.finding_id);
    if (row.action_id !== null) assertUuid(row.action_id);
    const pageRefs = refs.get(row.site_page_id) ?? [];
    pageRefs.push({
      findingId: row.finding_id,
      actionId: row.action_id,
    });
    refs.set(row.site_page_id, pageRefs);
  }
  for (const [sitePageId, pageRefs] of refs) {
    const unique = new Map(
      pageRefs.map((ref) => [`${ref.findingId}:${ref.actionId ?? ""}`, ref]),
    );
    const sorted = [...unique.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([, ref]) => ref);
    if (sorted.length > 20) return integrityFailure();
    refs.set(sitePageId, sorted);
  }
  return refs;
}

function nodeStatus(
  inboundCount: number,
  outboundCount: number,
  complete: boolean,
): InternalLinkMapNode["status"] {
  if (complete && inboundCount === 0) return "orphan";
  if (inboundCount > 0 && outboundCount > 0) return "connected";
  if ((inboundCount === 0) !== (outboundCount === 0)) return "one_way";
  return "unknown";
}

function projectNodes(
  workingNodes: readonly WorkingNode[],
  edges: readonly InternalLinkMapEdge[],
  refsByPage: ReadonlyMap<string, readonly InternalLinkMapExecutionRef[]>,
  complete: boolean,
): InternalLinkMapNode[] {
  return workingNodes.map((node) => {
    const inboundCount = edges.filter(
      (edge) => edge.targetCanonicalUrl === node.canonicalUrl,
    ).length;
    const outboundCount = edges.filter(
      (edge) => edge.sourceCanonicalUrl === node.canonicalUrl,
    ).length;
    const executionRefs = new Map<string, InternalLinkMapExecutionRef>();
    for (const pageId of node.sitePageIds) {
      for (const ref of refsByPage.get(pageId) ?? []) {
        executionRefs.set(`${ref.findingId}:${ref.actionId ?? ""}`, ref);
      }
    }
    const sortedRefs = [...executionRefs.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([, ref]) => ref);
    if (sortedRefs.length > 20) return integrityFailure();
    return {
      canonicalUrl: node.canonicalUrl,
      sitePageIds: [...node.sitePageIds],
      title: node.title,
      inboundCount,
      outboundCount,
      status: nodeStatus(inboundCount, outboundCount, complete),
      executionRefs: sortedRefs,
    };
  });
}

function topicSetsByNode(
  authority: Extract<InternalLinkPageTopicAuthority, { state: "confirmed" }>,
  nodes: readonly WorkingNode[],
): ReadonlyMap<
  string,
  ReadonlyMap<
    string,
    { readonly topicModelRevision: number; readonly topicLabel: string }
  >
> {
  if (authority.projectId !== nodes[0]?.variants[0]?.row.project_id) {
    return integrityFailure();
  }
  const nodeByPage = new Map<string, string>();
  for (const node of nodes) {
    for (const sitePageId of node.sitePageIds) {
      nodeByPage.set(sitePageId, node.canonicalUrl);
    }
  }
  const topics = new Map<
    string,
    Map<
      string,
      { readonly topicModelRevision: number; readonly topicLabel: string }
    >
  >();
  for (const mapping of authority.mappings) {
    const canonicalUrl = nodeByPage.get(mapping.sitePageId);
    if (
      canonicalUrl === undefined ||
      mapping.topicModelRevision !== authority.topicModelRevision
    ) {
      return integrityFailure();
    }
    const nodeTopics = topics.get(canonicalUrl) ?? new Map();
    const existing = nodeTopics.get(mapping.topicNodeId);
    if (
      existing &&
      (existing.topicModelRevision !== mapping.topicModelRevision ||
        existing.topicLabel !== mapping.topicLabel)
    ) {
      return integrityFailure();
    }
    nodeTopics.set(mapping.topicNodeId, {
      topicModelRevision: mapping.topicModelRevision,
      topicLabel: mapping.topicLabel,
    });
    topics.set(canonicalUrl, nodeTopics);
  }
  return topics;
}

function selectedPageProjection(
  selectedSitePageId: string,
  selectedNode: WorkingNode,
  nodes: readonly WorkingNode[],
  edges: readonly InternalLinkMapEdge[],
  topicAuthority: InternalLinkPageTopicAuthority,
  graphComplete: boolean,
): InternalLinkSelectedPage {
  const inboundSources = edges.filter(
    (edge) => edge.targetCanonicalUrl === selectedNode.canonicalUrl,
  );
  if (topicAuthority.state !== "confirmed") {
    return {
      selectedSitePageId,
      canonicalUrl: selectedNode.canonicalUrl,
      inboundSources,
      recommendationCoverage: {
        availability: "unavailable",
        limitations: [NO_CONFIRMED_TOPIC],
      },
      recommendations: [],
      totalRecommendationCount: 0,
      recommendationsTruncated: false,
    };
  }

  const topicsByNode = topicSetsByNode(topicAuthority, nodes);
  const selectedTopicIds = new Set(
    topicAuthority.mappings
      .filter((mapping) => mapping.sitePageId === selectedSitePageId)
      .map((mapping) => mapping.topicNodeId),
  );
  if (selectedTopicIds.size === 0) {
    return {
      selectedSitePageId,
      canonicalUrl: selectedNode.canonicalUrl,
      inboundSources,
      recommendationCoverage: {
        availability: "unavailable",
        limitations: [NO_SELECTED_TOPIC],
      },
      recommendations: [],
      totalRecommendationCount: 0,
      recommendationsTruncated: false,
    };
  }

  const existingEdges = new Set(
    edges.map(
      (edge) => `${edge.sourceCanonicalUrl}\u0000${edge.targetCanonicalUrl}`,
    ),
  );
  const recommendations: InternalLinkRecommendation[] = [];
  for (const source of nodes) {
    if (
      source.canonicalUrl === selectedNode.canonicalUrl ||
      existingEdges.has(
        `${source.canonicalUrl}\u0000${selectedNode.canonicalUrl}`,
      )
    ) {
      continue;
    }
    const sourceTopics = topicsByNode.get(source.canonicalUrl);
    if (!sourceTopics) continue;
    const sharedTopicIds = [...sourceTopics.keys()]
      .filter((topicId) => selectedTopicIds.has(topicId))
      .sort();
    const topicNodeId = sharedTopicIds[0];
    if (!topicNodeId) continue;
    const basis = sourceTopics.get(topicNodeId);
    if (!basis) return integrityFailure();
    recommendations.push({
      sourceCanonicalUrl: source.canonicalUrl,
      sourceSitePageIds: [...source.sitePageIds],
      targetCanonicalUrl: selectedNode.canonicalUrl,
      targetSitePageIds: [...selectedNode.sitePageIds],
      basis: {
        kind: "same_confirmed_topic",
        topicNodeId,
        topicModelRevision: basis.topicModelRevision,
        topicLabel: basis.topicLabel,
      },
      explanation: `页面与目标页同属已确认 Topic「${basis.topicLabel}」，但冻结 Crawl 中尚未观察到指向目标页的内链。`,
    });
  }
  recommendations.sort((left, right) => {
    const leftKey = `${left.sourceCanonicalUrl}\u0000${left.basis.topicNodeId}`;
    const rightKey = `${right.sourceCanonicalUrl}\u0000${right.basis.topicNodeId}`;
    return leftKey < rightKey ? -1 : 1;
  });
  const projected = recommendations.slice(
    0,
    MAX_INTERNAL_LINK_MAP_RECOMMENDATIONS,
  );
  return {
    selectedSitePageId,
    canonicalUrl: selectedNode.canonicalUrl,
    inboundSources,
    recommendationCoverage: graphComplete
      ? { availability: "available", limitations: [] }
      : {
          availability: "partial",
          limitations: [PARTIAL_RECOMMENDATIONS],
        },
    recommendations: projected,
    totalRecommendationCount: recommendations.length,
    recommendationsTruncated: recommendations.length > projected.length,
  };
}

async function internalLinkMapInSnapshot(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  selectedSitePageId: string | null,
  generatedAt: string,
): Promise<GrowthMapInternalLinkMap> {
  const project = await new ProjectsRepository(exec).findById(scope, projectId);
  if (
    !project ||
    project.id !== projectId ||
    project.workspace_id !== scope.workspaceId ||
    project.archived_at !== null
  ) {
    return projectNotFound();
  }
  const projectScope = { ...scope, projectId };
  const authority = await frozenRunAuthority(exec, projectScope);
  if (authority === null) {
    return unavailableResponse(
      projectId,
      generatedAt,
      NO_READABLE_DIAGNOSTIC,
      null,
    );
  }
  const crawlSnapshot = authority.crawlSnapshot;
  if (crawlSnapshot === null) {
    return unavailableResponse(projectId, generatedAt, NO_FROZEN_CRAWL, null);
  }
  if (crawlSnapshot.availability === "unavailable") {
    if (crawlSnapshot.limitation.trim().length === 0) {
      return integrityFailure();
    }
    return unavailableResponse(
      projectId,
      generatedAt,
      crawlSnapshot.limitation,
      { diagnosticRunId: authority.run.id, crawlSnapshot },
    );
  }

  const repository = new InternalLinkMapRepository(exec);
  const observationRows = await repository.listFrozenCrawlObservations(
    projectScope,
    {
      diagnosticRunId: authority.run.id,
      crawlSnapshotId: crawlSnapshot.id,
    },
  );
  const working = buildWorkingNodes(observationRows, authority);
  const builtEdges = buildEdges(working.nodes);
  const totalEdgeCount = builtEdges.edges.length;
  const projectedEdges = builtEdges.edges.slice(0, MAX_INTERNAL_LINK_MAP_EDGES);
  const edgesTruncated = totalEdgeCount > projectedEdges.length;

  const limitations = uniqueLimitations([
    ...(crawlSnapshot.availability === "partial" ||
    crawlSnapshot.limitation.trim().length > 0
      ? [crawlSnapshot.limitation]
      : []),
    ...working.observationLimitations,
    ...(builtEdges.unresolvedTargetCount > 0 ? [UNRESOLVED_LINK_TARGET] : []),
    ...(edgesTruncated ? [TRUNCATED_EDGES] : []),
  ]);
  const graphComplete =
    crawlSnapshot.availability === "available" &&
    !working.observationsPartial &&
    builtEdges.unresolvedTargetCount === 0 &&
    !edgesTruncated &&
    limitations.length === 0;
  const allSitePageIds = uniqueSorted(
    working.nodes.flatMap((node) => node.sitePageIds),
  );
  const executionRows = await repository.listExecutionRefs(
    projectScope,
    authority.run.id,
    allSitePageIds,
  );
  const refsByPage = executionRefsByPage(
    executionRows,
    new Set(allSitePageIds),
  );
  const nodes = projectNodes(
    working.nodes,
    builtEdges.edges,
    refsByPage,
    graphComplete,
  );

  let selectedPage: InternalLinkSelectedPage | null = null;
  if (selectedSitePageId !== null) {
    const selectedNode = working.nodes.find((node) =>
      node.sitePageIds.includes(selectedSitePageId),
    );
    if (!selectedNode) return selectedPageNotFound();
    const topicAuthority = await repository.readConfirmedPageTopics(
      projectScope,
      allSitePageIds,
    );
    selectedPage = selectedPageProjection(
      selectedSitePageId,
      selectedNode,
      working.nodes,
      builtEdges.edges,
      topicAuthority,
      graphComplete,
    );
  }

  return parseResponse({
    projectId,
    diagnosticRunId: authority.run.id,
    crawlSnapshot: {
      snapshotId: crawlSnapshot.id,
      capturedAt: canonicalUtcTimestamptz(crawlSnapshot.captured_at),
      availability: crawlSnapshot.availability,
      limitation: crawlSnapshot.limitation.trim() || null,
    },
    coverage: {
      availability: graphComplete ? "available" : "partial",
      crawlCompleteness: graphComplete ? "complete" : "partial",
      limitations: graphComplete
        ? []
        : limitations.length > 0
          ? limitations
          : [PARTIAL_RECOMMENDATIONS],
    },
    graph: {
      nodes,
      edges: projectedEdges,
      totalEdgeCount,
      edgesTruncated,
    },
    selectedPage,
    generatedAt,
  });
}

/**
 * Read the frozen Internal Link Map embedded in Growth Map. GET performs no
 * writes: every page and edge comes from one latest readable DiagnosticRun,
 * and optional recommendations require confirmed Topic/Keyword authority.
 */
export async function getProjectAuditInternalLinkMap(
  scope: WorkspaceScope,
  projectId: string,
  selectedSitePageId: string | null = null,
  exec?: Executor,
  now: Date = new Date(),
): Promise<GrowthMapInternalLinkMap> {
  const generatedAt = canonicalNow(now);
  try {
    if (exec) {
      return await internalLinkMapInSnapshot(
        exec,
        scope,
        projectId,
        selectedSitePageId,
        generatedAt,
      );
    }
    return await getDb().db.transaction(
      (tx) =>
        internalLinkMapInSnapshot(
          tx,
          scope,
          projectId,
          selectedSitePageId,
          generatedAt,
        ),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  } catch (error) {
    if (
      error instanceof InternalLinkMapIntegrityError ||
      error instanceof InternalLinkMapReadIntegrityError ||
      error instanceof RangeError
    ) {
      return dependencyUnavailable();
    }
    throw error;
  }
}
