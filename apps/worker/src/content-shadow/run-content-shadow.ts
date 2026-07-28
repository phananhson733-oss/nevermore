import {
  ActionsRepository,
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
  canonicalUtcTimestamptz,
  CompetitorsRepository,
  contentHash,
  CONTENT_SHADOW_PROJECTION_VERSION,
  DiagnosticRunsRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  FlowShadowQaGateReplayConflictError,
  FlowShadowQaGatesRepository,
  FlowShadowResearchPacksRepository,
  FlowShadowRunsRepository,
  IcpProfilesRepository,
  KeywordsRepository,
  MAX_KEYWORD_ENTITY_BATCH,
  PageSnapshotsRepository,
  SitesRepository,
  toRunAttempt,
  type ArtifactRow,
  type CanonicalValue,
  type CompetitorEntityRow,
  type FlowShadowRunRow,
  type KeywordEntityRow,
  type PageSnapshotWithSitePageIdentityRow,
  type ProjectScope,
} from "@sf/db";
import {
  ARTIFACT_FORMAT,
  CONTENT_SHADOW_PROMPT_SET_VERSION,
  createOpenAIClient,
  extractContentBriefOutline,
  LLMError,
  validateArtifact,
  type AnalysisInvocationRecord,
  type ArtifactContent,
  type ContentBriefOutline,
} from "@sf/artifacts";
import {
  buildContentShadowInputManifest,
  buildResearchPack,
  CONTENT_SHADOW_ADAPTER_VERSION,
  ContentShadowFirstPartyIdentityError,
  ContentShadowFirstPartyPageOwnershipError,
  ContentShadowObservationSeparationError,
  CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS,
  ContentShadowResearchContextBoundsError,
  ContentShadowResearchContextConflictError,
  evaluateDraftQa,
  extractContentBriefExternalTargets,
  qaClaimsToJson,
  researchPackToJson,
  type BriefOutlineProjectionStats,
  type ContentShadowFirstPartyIdentity,
  type ContentShadowInputManifest,
  type ContentShadowResearchContext,
  type ResearchPack,
  type RetrievedResearchSnapshot,
} from "@sf/flow-shadow";
import { parseIcp } from "@sf/engine";
import {
  PUBLIC_WEB_RESEARCH_CONTENT_HASH_METHOD,
  retrievePublicWebResearch,
  type PublicWebResearchSnapshot,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import { parseCrawlPageExtract } from "../collection/materialize-crawl-pages.ts";
import {
  buildArtifactPromptInput,
  artifactContentHash,
} from "../artifact/run-artifact.ts";
import {
  isTransientInfrastructureError,
  transientFailureCode,
} from "../handlers/transient-errors.ts";

/**
 * SEO/GEO Content Shadow job (Slice 2 Task 4).
 *
 * The canonical `flow_shadow_runs` row was already created and frozen by the
 * accepting service; this worker only appends children:
 *
 *   claim → load shadow run → replay guard → RESEARCH → DRAFT → QA → terminal
 *
 * Three properties are load-bearing:
 *
 * - **Pinned immutable inputs (red line C).** Before doing any work the worker
 *   rebuilds the frozen tuple from live rows and re-hashes it. Anything that
 *   moved — the Finding, its frozen diagnosis, the confirmed brief revision, or
 *   the pinned adapter/prompt/projection version — changes the hash and fails
 *   the run with `CONTENT_SHADOW_INPUT_DRIFT` instead of silently re-rendering.
 * - **No second confirmation path (red line B).** The worker consumes the
 *   already confirmed brief revision. It never writes an Action, an approval, a
 *   checkpoint, an opportunity, or a Finding review state, and it never recasts
 *   the brief.
 * - **No external write (red line D).** The only writes are internal: a research
 *   pack, an `english_blog_draft` artifact revision, and a QA gate. Nothing is
 *   ever marked ready or published.
 *
 * Every child insert is idempotent, so a crash re-delivery converges instead of
 * duplicating (decision D2); the run phase is derived from which children exist
 * rather than from a mutable status column (decision R1).
 */

export interface ContentShadowJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export const CONTENT_SHADOW_DRAFT_TASK = "content_shadow_draft" as const;
export const CONTENT_SHADOW_ARTIFACT_TYPE = "english_blog_draft" as const;
export const CONTENT_SHADOW_INPUT_DRIFT = "CONTENT_SHADOW_INPUT_DRIFT";
export const CONTENT_SHADOW_RESEARCH_INTEGRITY =
  "CONTENT_SHADOW_RESEARCH_INTEGRITY";

/** A permanent failure whose stable code is surfaced on the canonical run. */
export class ContentShadowPermanentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ContentShadowPermanentError";
  }
}

/** The frozen brief-producing content rules (mirrors the database guard). */
const CONTENT_BRIEF_RULE_IDS: ReadonlySet<string> = new Set([
  "SEARCH-DECAY-002",
  "CONTENT-COVERAGE-001",
  "CONTENT-GAP-011",
  "CRO-LANDING-003",
]);

interface FrozenManifestProjection {
  readonly competitorEntityIds: readonly string[];
  readonly clusterKey: string;
  readonly keywordEntityIds: readonly string[];
  readonly generativeQueryEntityIds: readonly string[];
  readonly outputLocale: string;
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

/**
 * Read the operator-chosen half of the frozen manifest. Everything else in the
 * tuple is re-derived from canonical rows, so a tampered manifest cannot make
 * the recomputed hash agree with the stored one.
 */
function projectFrozenManifest(
  row: FlowShadowRunRow,
): FrozenManifestProjection {
  const manifest = row.frozen_input_manifest;
  const cluster = manifest["searchCluster"];
  if (
    typeof cluster !== "object" ||
    cluster === null ||
    Array.isArray(cluster)
  ) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "frozen manifest is missing its search cluster",
    );
  }
  const clusterRecord = cluster as Record<string, unknown>;
  const competitorEntityIds = stringArray(manifest["competitorEntityIds"]);
  const keywordEntityIds = stringArray(clusterRecord["keywordEntityIds"]);
  const generativeQueryEntityIds = stringArray(
    manifest["generativeQueryEntityIds"],
  );
  const clusterKey = clusterRecord["clusterKey"];
  const outputLocale = manifest["outputLocale"];
  if (
    competitorEntityIds === null ||
    keywordEntityIds === null ||
    generativeQueryEntityIds === null ||
    typeof clusterKey !== "string" ||
    typeof outputLocale !== "string"
  ) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "frozen manifest is not a well-formed Content Shadow tuple",
    );
  }
  return {
    competitorEntityIds,
    clusterKey,
    keywordEntityIds,
    generativeQueryEntityIds,
    outputLocale,
  };
}

interface LiveShadowInputs {
  readonly manifest: ContentShadowInputManifest;
  readonly outputLocale: string;
  readonly sourceDiagnosticRunId: string;
  readonly sourceIcpProfileId: string;
  /** Re-derived here; NEVER read back out of the frozen row (see below). */
  readonly contentBriefOutline: ContentBriefOutline;
  readonly briefOutlineStats: BriefOutlineProjectionStats;
  /**
   * The pinned brief revision's body. It never enters the draft prompt — only
   * the extracted coverage checklist does — but the QA gate reads it to detect
   * a draft that merely restates the brief.
   */
  readonly briefMarkdown: string;
  readonly pageSnapshots: readonly PageSnapshotWithSitePageIdentityRow[];
}

function profileStringArray(profile: unknown, key: string): readonly string[] {
  if (typeof profile !== "object" || profile === null) return [];
  const value = (profile as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function keywordFact(row: KeywordEntityRow) {
  return {
    id: row.id,
    display: row.display_keyword,
    market: row.market,
    language: row.language_tag,
    intent: row.intent,
    buyerStage: row.buyer_stage,
    cluster: row.cluster_key,
    mapping: {
      decision: row.mapping_decision,
      mappedSitePageId: row.mapped_site_page_id,
      reviewState: row.mapping_review_state,
      revision: row.mapping_revision,
    },
    lastSeen: canonicalUtcTimestamptz(row.last_seen_at),
    evidenceRefs: [],
  } as const;
}

function competitorFact(row: CompetitorEntityRow) {
  return {
    id: row.id,
    domain: row.domain,
    name: row.name,
    status: row.review_status,
    relationship: row.relationship,
    scopes: [...row.analysis_scope],
    revision: row.revision,
  } as const;
}

function competitorExternalTargets(
  competitors: readonly ReturnType<typeof competitorFact>[],
) {
  return competitors
    .filter((competitor) => competitor.status !== "excluded")
    .map((competitor) => ({
      ref: `competitor-root:${competitor.id}`,
      kind: "competitor_root",
      url: `https://${competitor.domain}/`,
      label: competitor.name ?? competitor.domain,
    }));
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function frozenExternalTargets(input: {
  readonly briefMarkdown: string;
  readonly firstParty: ContentShadowFirstPartyIdentity;
  readonly competitors: readonly ReturnType<typeof competitorFact>[];
}): ContentShadowResearchContext["externalTargets"] {
  const conversion = input.firstParty.icpPrimaryConversionUrl;
  const briefTargets = extractContentBriefExternalTargets({
    briefMarkdown: input.briefMarkdown,
    firstPartyOrigins: [input.firstParty.siteOrigin],
    maxTargets: CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.externalTargets,
  }).filter((target) => conversion === null || target.url !== conversion);
  const candidates = [
    ...briefTargets.map((target) => ({ priority: 0, target })),
    ...competitorExternalTargets(input.competitors).map((target) => ({
      priority: 1,
      target,
    })),
  ].sort(
    (left, right) =>
      left.priority - right.priority ||
      compareAscii(left.target.url, right.target.url) ||
      compareAscii(left.target.ref, right.target.ref),
  );
  const byUrl = new Map<string, (typeof candidates)[number]["target"]>();
  for (const candidate of candidates) {
    if (!byUrl.has(candidate.target.url)) {
      byUrl.set(candidate.target.url, candidate.target);
    }
  }
  return [...byUrl.values()].slice(
    0,
    CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.externalTargets,
  );
}

function frozenCrawlSnapshotId(manifest: Record<string, unknown>): string {
  const snapshots = manifest["snapshots"];
  if (!Array.isArray(snapshots)) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen diagnosis has no readable crawl snapshot lineage",
    );
  }
  const crawlIds = snapshots.flatMap((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      return [];
    }
    const snapshot = value as Record<string, unknown>;
    return snapshot["provider"] === "crawl" &&
      typeof snapshot["snapshotId"] === "string" &&
      snapshot["snapshotId"].length > 0
      ? [snapshot["snapshotId"]]
      : [];
  });
  if (crawlIds.length !== 1) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen diagnosis must identify exactly one crawl snapshot",
    );
  }
  return crawlIds[0]!;
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function firstPartySnapshot(
  page: PageSnapshotWithSitePageIdentityRow,
): RetrievedResearchSnapshot | null {
  if (page.canonical_extract === null) return null;
  try {
    const extract = parseCrawlPageExtract(JSON.parse(page.canonical_extract));
    if (extract.projection.fetchUrl !== page.normalized_url) return null;
    const sections = uniqueNonEmpty([
      extract.projection.title ?? "",
      extract.projection.metaDescription ?? "",
      ...extract.projection.h1,
      ...extract.projection.headings,
      extract.projection.bodyExcerpt ?? "",
      ...extract.projection.paragraphs,
    ]);
    const contentText = sections.length > 0 ? sections.join("\n\n") : null;
    return {
      ref: page.page_snapshot_id,
      kind: "first_party_page",
      label: extract.projection.title ?? page.normalized_url,
      requestedUrl: page.normalized_url,
      url: page.normalized_url,
      availability: "available",
      capturedAt: canonicalUtcTimestamptz(page.captured_at),
      urlHash: page.normalized_url_hash,
      contentHash: page.content_hash,
      contentHashMethod: "sha256_canonical_extract",
      contentText,
      excerpt: extract.projection.bodyExcerpt,
      contentTruncated: false,
      excerptTruncated: false,
      metrics: null,
      evidenceRefs: [
        `data-snapshot:${page.data_snapshot_id}`,
        `page-snapshot:${page.page_snapshot_id}`,
      ],
      limitation:
        "Content text is a bounded human-text projection of the frozen canonical extract; contentHash still identifies the full canonical extract bytes.",
    } as RetrievedResearchSnapshot;
  } catch {
    return null;
  }
}

function isReplayManifestValidationError(error: unknown): boolean {
  return (
    error instanceof ContentShadowFirstPartyIdentityError ||
    error instanceof ContentShadowFirstPartyPageOwnershipError ||
    error instanceof ContentShadowObservationSeparationError ||
    error instanceof ContentShadowResearchContextBoundsError ||
    error instanceof ContentShadowResearchContextConflictError
  );
}

function externalResearchSnapshot(
  targetRef: string,
  label: string,
  requestedUrl: string,
  snapshot: PublicWebResearchSnapshot,
): RetrievedResearchSnapshot {
  return {
    ref: targetRef,
    kind: "external_page",
    label,
    requestedUrl,
    url: snapshot.finalUrl,
    availability: snapshot.availability,
    capturedAt: snapshot.capturedAt,
    urlHash: snapshot.urlHash,
    contentHash: snapshot.contentHash,
    contentHashMethod:
      snapshot.contentHash === null
        ? null
        : PUBLIC_WEB_RESEARCH_CONTENT_HASH_METHOD,
    contentText: snapshot.contentText,
    contentTruncated: snapshot.contentTruncated,
    excerpt: snapshot.excerpt,
    excerptTruncated: snapshot.excerptTruncated,
    metrics: {
      status: snapshot.status,
      contentType: snapshot.contentType,
      bodyBytes: snapshot.bodyBytes,
      wordCount: snapshot.wordCount,
      responseMs: snapshot.responseMs,
      redirectChain: [...snapshot.redirectChain],
    },
    evidenceRefs: [`external-target:${targetRef}`],
    limitation: snapshot.limitation,
  } as RetrievedResearchSnapshot;
}

function promptResearchContext(pack: ResearchPack) {
  const usablePageSources = pack.sources
    .filter(
      (source) =>
        (source.kind === "first_party_page" || source.kind === "external_page") &&
        source.url !== null &&
        source.capturedAt !== null &&
        source.contentHash !== null &&
        (source.excerpt !== null || source.contentText !== null),
    );
  const externalSources = usablePageSources.filter(
    (source) => source.kind === "external_page",
  );
  const firstPartySources = usablePageSources.filter(
    (source) => source.kind === "first_party_page",
  );
  const sources = [...externalSources, ...firstPartySources]
    .slice(0, 8)
    .map((source) => ({
      sourceRef: source.ref,
      kind: source.kind,
      label: source.label,
      url: source.url!,
      availability: source.availability,
      authorityTier: source.authorityTier,
      capturedAt: source.capturedAt!,
      contentHash: source.contentHash!,
      excerpt: source.excerpt ?? source.contentText!,
      evidenceRefs: [...source.evidenceRefs],
      limitation: source.limitation ?? "No additional limitation recorded.",
    }));
  return {
    sources,
    policy: {
      brandConstraints: [...pack.policy.brandConstraints],
      complianceConstraints: [...pack.policy.complianceConstraints],
      prohibitedTerms: [...pack.policy.prohibitedTerms],
      claimRestrictions: [...pack.policy.claimRestrictions],
    },
  } as const;
}

function assertStoredResearchPackIntegrity(
  packRow: { readonly content_hash: string; readonly pack: Record<string, unknown> },
): ResearchPack {
  const derived = contentHash(packRow.pack as CanonicalValue);
  if (derived !== packRow.content_hash) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_RESEARCH_INTEGRITY,
      "the stored Content Shadow research pack no longer matches its canonical content hash",
    );
  }
  return packRow.pack as unknown as ResearchPack;
}

/**
 * Replay guard (red line C). Re-reads every canonical row the frozen tuple
 * names, rebuilds the manifest from those live values plus the currently pinned
 * versions, and rejects the run when the recomputed hash differs.
 */
async function loadLiveShadowInputs(
  ctx: WorkerContext,
  scope: ProjectScope,
  row: FlowShadowRunRow,
): Promise<LiveShadowInputs> {
  const frozen = projectFrozenManifest(row);

  const action = await new ActionsRepository(ctx.db).findById(
    scope,
    row.source_action_id,
  );
  if (!action || action.status === "dismissed") {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen Action is missing or was dismissed",
    );
  }
  if (action.source_finding_id !== row.source_finding_id) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen Action no longer belongs to the frozen Finding",
    );
  }

  const finding = await new FindingsRepository(ctx.db).findById(
    scope,
    row.source_finding_id,
  );
  if (!finding || finding.review_state !== "confirmed") {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the source Finding is missing or is no longer confirmed",
    );
  }
  if (!CONTENT_BRIEF_RULE_IDS.has(finding.rule_id)) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the source Finding is not a content-brief rule",
    );
  }
  if (finding.last_seen_run_id !== action.source_diagnostic_run_id) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the source Finding moved beyond its frozen diagnosis",
    );
  }

  const artifacts = new ExecutionArtifactsRepository(ctx.db);
  const brief = await artifacts.findById(scope, row.content_brief_artifact_id);
  if (
    !brief ||
    brief.artifact_type !== "content_brief" ||
    brief.action_id !== row.source_action_id
  ) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen content brief is missing or does not belong to the Action",
    );
  }
  const briefRevision = await artifacts.findRevision(
    scope,
    row.content_brief_artifact_id,
    row.content_brief_revision,
  );
  if (!briefRevision) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen content brief revision no longer exists",
    );
  }

  // The frozen keyword identities are re-read live so the outline can be
  // RE-DERIVED. Reading `contentBriefOutline` back out of the frozen row would
  // make its drift check tautologically true, exactly like the three pinned
  // versions below.
  if (frozen.keywordEntityIds.length > MAX_KEYWORD_ENTITY_BATCH) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen search cluster exceeds the keyword identity ceiling",
    );
  }
  const keywordRows =
    frozen.keywordEntityIds.length === 0
      ? []
      : await new KeywordsRepository(ctx.db).listByIds(scope, [
          ...new Set(frozen.keywordEntityIds),
        ]);
  if (keywordRows.length !== new Set(frozen.keywordEntityIds).size) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "a frozen search keyword is missing from this project",
    );
  }
  for (const row of keywordRows) {
    // Search observation must still be search observation (invariant 8) and a
    // keyword moved out of the frozen cluster is no longer this run's input.
    if (row.query_kind !== "search_query") {
      throw new ContentShadowPermanentError(
        CONTENT_SHADOW_INPUT_DRIFT,
        "a frozen search keyword is no longer a SearchQuery entity",
      );
    }
    if (row.cluster_key !== frozen.clusterKey) {
      throw new ContentShadowPermanentError(
        CONTENT_SHADOW_INPUT_DRIFT,
        "a frozen search keyword left the frozen cluster",
      );
    }
  }
  const extraction = extractContentBriefOutline({
    briefMarkdown: briefRevision.content_text,
    keywords: keywordRows.map((row) => ({
      id: row.id,
      displayKeyword: row.display_keyword,
      normalizedKeyword: row.normalized_keyword,
      mappingDecision: row.mapping_decision,
      mappingReviewState: row.mapping_review_state,
    })),
  });

  const diagnosticRun = await new DiagnosticRunsRepository(ctx.db).findById(
    scope,
    action.source_diagnostic_run_id,
  );
  if (!diagnosticRun) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen source diagnosis is missing",
    );
  }
  if (diagnosticRun.site_id !== row.site_id) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen source diagnosis no longer names this run's site",
    );
  }

  // The first-party identity is RE-DERIVED from the canonical rows the tuple
  // names, never read back out of `frozen_input_manifest`. Reading it back would
  // make its drift check tautologically true, exactly like the three pinned
  // versions below — and `sites.origin` is the one half of this identity that
  // really can move, so its guard has to be the live comparison, not a copy of
  // itself. Nothing downstream reads a live row: the pack and the QA gate see
  // only the rebuilt manifest, which the hash comparison has just proved equal
  // to the frozen one.
  const site = await new SitesRepository(ctx.db).findById(
    scope,
    diagnosticRun.site_id,
  );
  if (!site) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen site is missing from this project",
    );
  }
  const icpProfile = await new IcpProfilesRepository(ctx.db).findById(
    scope,
    diagnosticRun.icp_profile_id,
  );
  if (!icpProfile) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen diagnosis' ICP profile is missing",
    );
  }
  const generativeRows =
    frozen.generativeQueryEntityIds.length === 0
      ? []
      : await new KeywordsRepository(ctx.db).listByIds(scope, [
          ...new Set(frozen.generativeQueryEntityIds),
        ]);
  if (
    generativeRows.length !== new Set(frozen.generativeQueryEntityIds).size
  ) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "a frozen generative keyword is missing from this project",
    );
  }
  for (const keyword of generativeRows) {
    if (keyword.query_kind !== "generative_query") {
      throw new ContentShadowPermanentError(
        CONTENT_SHADOW_INPUT_DRIFT,
        "a frozen generative keyword is no longer a GenerativeQuery entity",
      );
    }
  }
  const competitorRows =
    frozen.competitorEntityIds.length === 0
      ? []
      : await new CompetitorsRepository(ctx.db).listByIds(scope, [
          ...new Set(frozen.competitorEntityIds),
        ]);
  if (competitorRows.length !== new Set(frozen.competitorEntityIds).size) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "a frozen competitor is missing from this project",
    );
  }
  const crawlSnapshotId = frozenCrawlSnapshotId(diagnosticRun.input_manifest);
  const pageSnapshots = await new PageSnapshotsRepository(
    ctx.db,
  ).listByDataSnapshotWithSitePageIdentity(scope, crawlSnapshotId);
  if (
    pageSnapshots.some(
      (page) =>
        page.site_id !== diagnosticRun.site_id ||
        page.data_snapshot_id !== crawlSnapshotId,
    )
  ) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen diagnosis' first-party page snapshot lineage is inconsistent",
    );
  }
  const firstParty: ContentShadowFirstPartyIdentity = {
    siteOrigin: site.origin,
    icpPrimaryConversionUrl:
      parseIcp(icpProfile.profile).primaryConversion?.targetUrl ?? null,
  };
  const competitorFacts = competitorRows.map(competitorFact);
  const researchContext: ContentShadowResearchContext = {
    firstPartyPageSnapshots: pageSnapshots
      .slice(0, CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.firstPartyPageSnapshots)
      .map((page) => ({
        pageSnapshotId: page.page_snapshot_id,
        dataSnapshotId: page.data_snapshot_id,
        url: page.normalized_url,
        urlHash: page.normalized_url_hash,
        contentHash: page.content_hash,
        capturedAt: canonicalUtcTimestamptz(page.captured_at),
      })),
    searchKeywordFacts: keywordRows.map(keywordFact),
    generativeKeywordFacts: generativeRows.map(keywordFact),
    competitorFacts,
    externalTargets: frozenExternalTargets({
      briefMarkdown: briefRevision.content_text ?? "",
      firstParty,
      competitors: competitorFacts,
    }),
    contentPolicy: {
      brandConstraints: profileStringArray(icpProfile.profile, "brandConstraints"),
      complianceConstraints: profileStringArray(
        icpProfile.profile,
        "complianceConstraints",
      ),
      prohibitedTerms: profileStringArray(icpProfile.profile, "prohibitedTerms"),
      claimRestrictions: [
        "no_guarantees",
        "no_unsupported_quantified_claims",
        "no_unverified_superlatives",
        ...profileStringArray(icpProfile.profile, "claimRestrictions"),
      ],
    },
  };

  // Rebuild from live values + currently pinned versions. An advanced adapter,
  // prompt set or projection version changes the hash by construction.
  let manifest: ContentShadowInputManifest;
  try {
    manifest = buildContentShadowInputManifest({
      primaryFindingId: finding.id,
      sourceActionId: action.id,
      sourceDiagnosticRunId: action.source_diagnostic_run_id,
      contentBriefArtifactId: brief.id,
      contentBriefRevision: row.content_brief_revision,
      competitorEntityIds: frozen.competitorEntityIds,
      searchCluster: {
        clusterKey: frozen.clusterKey,
        keywordEntityIds: frozen.keywordEntityIds,
      },
      generativeQueryEntityIds: frozen.generativeQueryEntityIds,
      firstParty,
      contentBriefOutline: extraction.outline,
      researchContext,
      // All three pinned versions come from the CURRENTLY pinned constants,
      // never from the row under audit: reading a version back out of the
      // frozen row would make its drift check tautologically true.
      flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
      promptSetVersion: CONTENT_SHADOW_PROMPT_SET_VERSION,
      projectionVersion: CONTENT_SHADOW_PROJECTION_VERSION,
      outputLocale: frozen.outputLocale,
    });
  } catch (error) {
    if (!isReplayManifestValidationError(error)) throw error;
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "live Content Shadow inputs no longer form the frozen canonical manifest",
    );
  }
  const recomputed = contentHash(manifest as unknown as CanonicalValue);
  if (recomputed !== row.content_hash) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the frozen Content Shadow inputs no longer hash to their pinned content_hash",
    );
  }
  if (row.flow_adapter_version !== CONTENT_SHADOW_ADAPTER_VERSION) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the pinned Flow adapter version advanced past this frozen run",
    );
  }
  if (row.projection_version !== CONTENT_SHADOW_PROJECTION_VERSION) {
    throw new ContentShadowPermanentError(
      CONTENT_SHADOW_INPUT_DRIFT,
      "the pinned Content Shadow projection version advanced past this frozen run",
    );
  }

  return {
    manifest,
    outputLocale: frozen.outputLocale,
    sourceDiagnosticRunId: action.source_diagnostic_run_id,
    sourceIcpProfileId: diagnosticRun.icp_profile_id,
    contentBriefOutline: extraction.outline,
    briefMarkdown: briefRevision.content_text ?? "",
    briefOutlineStats: {
      briefSectionCount: extraction.briefSectionCount,
      projectedSectionCount: extraction.projectedSectionCount,
      clusterKeywordCount: extraction.clusterKeywordCount,
      projectedKeywordCount: extraction.projectedKeywordCount,
      unconfirmedMappingCount: extraction.unconfirmedMappingCount,
    },
    pageSnapshots,
  };
}

/**
 * Find-or-create the shadow draft artifact (decision D2). A re-delivery reuses
 * the live artifact instead of minting a second one; a later shadow run for the
 * same Action claims it through the canonical regeneration edge.
 */
async function claimDraftArtifact(
  ctx: WorkerContext,
  scope: ProjectScope,
  row: FlowShadowRunRow,
  runId: string,
  outputLocale: string,
  createdBy: string,
): Promise<ArtifactRow> {
  const artifacts = new ExecutionArtifactsRepository(ctx.db);
  const existing = await artifacts.findLiveByActionType(
    scope,
    row.source_action_id,
    CONTENT_SHADOW_ARTIFACT_TYPE,
  );
  if (!existing) {
    return artifacts.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actionId: row.source_action_id,
      artifactType: CONTENT_SHADOW_ARTIFACT_TYPE,
      generationMode: "structured_llm",
      outputLocale,
      latestGenerationRunId: runId,
      createdBy,
    });
  }
  if (
    existing.latest_generation_run_id === runId &&
    existing.status === "generating"
  ) {
    return existing;
  }
  if (existing.latest_generation_run_id === runId) {
    // This run already installed its revision; the re-delivery converges.
    return existing;
  }
  const claimed = await artifacts.startRegenerationIfLive(
    scope,
    existing.id,
    runId,
    { generationMode: "structured_llm", outputLocale },
  );
  if (!claimed) {
    throw new ContentShadowPermanentError(
      "CONTENT_SHADOW_DRAFT_UNAVAILABLE",
      "the shadow draft artifact could not be claimed for this run",
    );
  }
  const reloaded = await artifacts.findById(scope, existing.id);
  if (!reloaded) {
    throw new ContentShadowPermanentError(
      "CONTENT_SHADOW_DRAFT_UNAVAILABLE",
      "the shadow draft artifact disappeared while being claimed",
    );
  }
  return reloaded;
}

async function persistDraftInvocation(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
  invocation: AnalysisInvocationRecord,
): Promise<string> {
  // The pinned markdown envelope reports the generic artifact task; the shadow
  // pipeline records its own closed task value so a Content Shadow model call
  // stays separately auditable from a first-class artifact generation.
  const invocationId = await new AnalysisInvocationsRepository(ctx.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    asyncRunId: runId,
    task: CONTENT_SHADOW_DRAFT_TASK,
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
  try {
    // Operational projection only: never prompt/output text or credentials.
    ctx.logger.info("llm_invocation_recorded", {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      runId,
      provider: invocation.provider,
      model: invocation.model,
      status: invocation.status,
      latencyMs: invocation.latencyMs,
    });
  } catch {
    // A telemetry sink failure cannot change the run outcome.
  }
  return invocationId;
}

function isTransientContentShadowError(error: unknown): boolean {
  return (
    (error instanceof LLMError &&
      (error.code === "RATE_LIMITED" ||
        error.code === "NETWORK_ERROR" ||
        error.code === "TIMEOUT" ||
        error.code === "SERVER_ERROR")) ||
    isTransientInfrastructureError(error)
  );
}

/**
 * The stable code a permanent failure is recorded under.
 *
 * `FlowShadowQaGateReplayConflictError` is listed FIRST and by name because it
 * is the one error here that exists solely to be identifiable. It means the
 * same frozen run produced a different judgement on re-delivery — an input that
 * must be immutable moved, or the gate is not the pure function red line C says
 * it is. Falling through to `UNAVAILABLE` filed that under the same code as a
 * dead database, and threw away the field naming WHICH half diverged, so the
 * one failure worth waking someone for became indistinguishable from the most
 * routine one.
 */
function permanentFailureCode(error: unknown): string {
  if (error instanceof FlowShadowQaGateReplayConflictError) return error.code;
  if (error instanceof ContentShadowPermanentError) return error.code;
  if (error instanceof LLMError) return error.code;
  return "UNAVAILABLE";
}

/** `verdict` or `claims` when a gate replay diverged, else `null`. */
function replayDivergedField(error: unknown): "verdict" | "claims" | null {
  return error instanceof FlowShadowQaGateReplayConflictError
    ? error.field
    : null;
}

export async function runContentShadow(
  ctx: WorkerContext,
  payload: ContentShadowJobPayload,
): Promise<void> {
  const { runId, workspaceId, projectId } = payload;
  const scope: ProjectScope = { workspaceId, projectId };
  const runs = new AsyncRunsRepository(ctx.db);
  const claimed = await runs.claim(scope, runId);
  if (!claimed) return;
  const attempt = toRunAttempt(claimed);

  if (
    claimed.workspace_id !== workspaceId ||
    claimed.project_id !== projectId
  ) {
    await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "RUN_SCOPE_MISMATCH",
      lastErrorSummary: "Content Shadow scope did not match its run.",
    });
    return;
  }

  const shadowRuns = new FlowShadowRunsRepository(ctx.db);
  const shadowRun = await shadowRuns.findByCapabilityRunId(scope, runId);
  if (!shadowRun) {
    await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "NOT_FOUND",
      lastErrorSummary: "content shadow run missing",
    });
    return;
  }

  try {
    const live = await loadLiveShadowInputs(ctx, scope, shadowRun);

    // --- RESEARCH: deterministic, idempotent ------------------------------
    const packs = new FlowShadowResearchPacksRepository(ctx.db);
    const existingPack = await packs.findByRun(scope, shadowRun.id);
    const pack =
      existingPack === null
        ? await (async (): Promise<ResearchPack> => {
            const firstPartySnapshots = live.pageSnapshots
              .map(firstPartySnapshot)
              .filter(
                (
                  snapshot,
                ): snapshot is NonNullable<typeof snapshot> => snapshot !== null,
              );
            const externalTargets = live.manifest.researchContext.externalTargets;
            const externalBatch =
              externalTargets.length === 0
                ? null
                : await retrievePublicWebResearch(
                    externalTargets.map((target) => target.url),
                    ctx.signal ? { signal: ctx.signal } : {},
                  );
            const retrieved = [
              ...firstPartySnapshots,
              ...(externalBatch?.sources ?? []).map((snapshot, index) => {
                const target = externalTargets[index];
                if (!target) {
                  throw new ContentShadowPermanentError(
                    "CONTENT_SHADOW_RESEARCH_UNAVAILABLE",
                    "retrieved research did not align with its frozen target list",
                  );
                }
                return externalResearchSnapshot(
                  target.ref,
                  target.label,
                  target.url,
                  snapshot,
                );
              }),
            ];
            const built = buildResearchPack(
              live.manifest,
              live.briefOutlineStats,
              retrieved,
            );
            const packJson = researchPackToJson(built);
            await packs.insert({
              workspaceId,
              projectId,
              flowShadowRunId: shadowRun.id,
              analysisInvocationId: null,
              contentHash: contentHash(packJson as CanonicalValue),
              pack: packJson,
            });
            return built;
          })()
        : assertStoredResearchPackIntegrity(existingPack);

    // --- DRAFT: pinned markdown LLM envelope ------------------------------
    const artifact = await claimDraftArtifact(
      ctx,
      scope,
      shadowRun,
      runId,
      live.outputLocale,
      claimed.initiated_by,
    );

    let evaluatedRevision = artifact.current_revision;
    if (artifact.status === "generating") {
      const expectedRevision = artifact.current_revision;
      const input = await buildArtifactPromptInput(ctx, scope, {
        actionId: shadowRun.source_action_id,
        artifactType: CONTENT_SHADOW_ARTIFACT_TYPE,
        outputLocale: live.outputLocale,
        operatorInstructions: null,
        sourceDiagnosticRunId: live.sourceDiagnosticRunId,
        sourceIcpProfileId: live.sourceIcpProfileId,
        contentBriefOutline: live.contentBriefOutline,
        researchContext: promptResearchContext(pack),
      });

      const client = createOpenAIClient({
        apiKey: ctx.openai.apiKey,
        model: ctx.openai.model,
        ...(ctx.openai.baseUrl ? { baseUrl: ctx.openai.baseUrl } : {}),
        ...(ctx.openai.authScheme ? { authScheme: ctx.openai.authScheme } : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      let content: ArtifactContent;
      let invocationId: string;
      try {
        const result = await client.generateArtifact(input);
        content = result.content;
        invocationId = await persistDraftInvocation(
          ctx,
          scope,
          runId,
          result.invocation,
        );
      } catch (error) {
        // A rejected/failed model call is still an immutable invocation.
        if (error instanceof LLMError && error.invocation) {
          await persistDraftInvocation(ctx, scope, runId, error.invocation);
        }
        throw error;
      }

      const validation = validateArtifact(
        CONTENT_SHADOW_ARTIFACT_TYPE,
        content,
      );
      const hash = artifactContentHash(content.content);
      const installedRevision = await ctx.db.transaction(async (tx) => {
        const repo = new ExecutionArtifactsRepository(tx);
        const locked = await repo.findByIdForUpdate(scope, artifact.id);
        if (
          !locked ||
          locked.status !== "generating" ||
          locked.latest_generation_run_id !== runId ||
          locked.current_revision !== expectedRevision
        ) {
          return null;
        }
        const nextRevision = locked.current_revision + 1;
        const installed = await repo.setGeneratedForGenerationRun(
          scope,
          artifact.id,
          runId,
          {
            // A shadow draft is only ever `draft`: nothing here marks it ready
            // or published (red line D).
            status: "draft",
            currentRevision: nextRevision,
            expectedRevision,
            validationState: validation.valid ? "valid" : "invalid",
            contentHash: hash,
          },
        );
        if (!installed) return null;
        await repo.insertRevision({
          workspaceId,
          projectId,
          artifactId: artifact.id,
          revision: nextRevision,
          outputLocale: live.outputLocale,
          contentFormat: ARTIFACT_FORMAT[CONTENT_SHADOW_ARTIFACT_TYPE],
          contentText:
            typeof content.content === "string" ? content.content : null,
          contentJson:
            typeof content.content === "string" ? null : content.content,
          contentHash: hash,
          generatedBy: "llm",
          editorId: null,
          analysisInvocationId: invocationId,
          note: null,
          validationErrors: [...validation.errors],
        });
        return nextRevision;
      });
      if (installedRevision === null) {
        throw new ContentShadowPermanentError(
          "CONTENT_SHADOW_DRAFT_SUPERSEDED",
          "the shadow draft was superseded while this run was generating",
        );
      }
      evaluatedRevision = installedRevision;
    }

    if (evaluatedRevision < 1) {
      throw new ContentShadowPermanentError(
        "CONTENT_SHADOW_DRAFT_UNAVAILABLE",
        "the shadow draft has no evaluable revision",
      );
    }

    // --- QA: the deterministic SEO/GEO + factual review gate --------------
    //
    // Every input here is frozen or immutable: the evaluated artifact revision
    // and the pinned brief revision are append-only rows, and the pack is a
    // pure projection of the hash-verified manifest. That is a correctness
    // requirement, not tidiness — the gate's replay comparison treats differing
    // claims for the same run as a data-integrity error, so an input that could
    // move between a run and its re-delivery would turn that guard into a flake.
    const revision = await new ExecutionArtifactsRepository(
      ctx.db,
    ).findRevision(scope, artifact.id, evaluatedRevision);
    const evaluation = evaluateDraftQa({
      draftMarkdown: revision?.content_text ?? "",
      briefMarkdown: live.briefMarkdown,
      pack,
      briefOutlineStats: live.briefOutlineStats,
    });
    await new FlowShadowQaGatesRepository(ctx.db).insert({
      workspaceId,
      projectId,
      flowShadowRunId: shadowRun.id,
      evaluatedArtifactId: artifact.id,
      evaluatedRevision,
      analysisInvocationId: null,
      verdict: evaluation.verdict,
      claims: qaClaimsToJson(evaluation.claims),
    });

    const terminalized = await ctx.db.transaction(async (tx) => {
      const txRuns = new AsyncRunsRepository(tx);
      if (!(await txRuns.lockAttemptForUpdate(attempt))) return false;
      return txRuns.setTerminal(attempt, {
        status: "completed",
        resultType: "flow_shadow_run",
        resultId: shadowRun.id,
      });
    });
    if (terminalized) {
      ctx.logger.info("content_shadow_done", {
        runId,
        flowShadowRunId: shadowRun.id,
        verdict: evaluation.verdict,
      });
    }
  } catch (error) {
    if (isTransientContentShadowError(error)) {
      const code =
        error instanceof LLMError ? error.code : transientFailureCode(error);
      if (!(await runs.resetToQueued(attempt))) {
        ctx.logger.info("content_shadow_skip_stale_attempt", { code });
        return;
      }
      ctx.logger.warn("content_shadow_transient_error", { code });
      throw error;
    }
    const code = permanentFailureCode(error);
    const divergedField = replayDivergedField(error);
    const failed = await ctx.db.transaction(async (tx) => {
      const txRuns = new AsyncRunsRepository(tx);
      if (!(await txRuns.lockAttemptForUpdate(attempt))) return false;
      const terminal = await txRuns.setTerminal(attempt, {
        status: "failed",
        lastErrorCode: code,
        lastErrorSummary:
          divergedField === null
            ? "content shadow run failed"
            : `content shadow qa gate replay produced a different ${divergedField} for the same frozen run`,
      });
      if (!terminal) return false;
      // Give back any draft artifact this run had already claimed. Without this
      // the row stays `generating` forever behind a terminal run, which reads to
      // the client as an artifact generating under no live run at all.
      await new ExecutionArtifactsRepository(tx).failGeneratingByGenerationRun(
        scope,
        runId,
      );
      return true;
    });
    if (failed) {
      ctx.logger.error("content_shadow_failed", {
        runId,
        code,
        ...(divergedField === null ? {} : { divergedField }),
      });
    }
  }
}
