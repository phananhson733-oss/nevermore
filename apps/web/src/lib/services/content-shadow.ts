import {
  ActionsRepository,
  AsyncRunsRepository,
  CapabilityRunsRepository,
  canonicalUtcTimestamptz,
  CompetitorsRepository,
  contentHash,
  DiagnosticRunsRepository,
  enqueueRunInTx,
  ExecutionArtifactsRepository,
  FindingsRepository,
  FlowShadowQaGatesRepository,
  FlowShadowResearchPacksRepository,
  FlowShadowRunsRepository,
  CONTENT_SHADOW_PROJECTION_VERSION,
  IcpProfilesRepository,
  IdempotencyRepository,
  KeywordsRepository,
  PageSnapshotsRepository,
  ProjectsRepository,
  SitesRepository,
  type ArtifactRow,
  type ArtifactRevisionRow,
  type CanonicalValue,
  type CompetitorEntityRow,
  type Executor,
  type FlowShadowQaGateRow,
  type FlowShadowRunRow,
  type KeywordEntityRow,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import {
  CONTENT_SHADOW_PROMPT_SET_VERSION,
  extractContentBriefOutline,
  type ContentBriefOutline,
} from "@sf/artifacts";
import {
  buildContentShadowInputManifest,
  CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS,
  extractContentBriefExternalTargets,
  qaSeverityForClaimId,
  CONTENT_SHADOW_ADAPTER_VERSION,
  type ContentShadowFirstPartyIdentity,
  type ContentShadowInputManifest,
  type ContentShadowResearchContext,
} from "@sf/flow-shadow";
import { parseIcp } from "@sf/engine";
import {
  CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
  ContentShadowAuthoritySource,
  ContentShadowDraft,
  ContentShadowFrozenInputs as ContentShadowFrozenInputsSchema,
  ContentShadowQaClaim,
  ContentShadowResearch,
  ContentShadowResearchContext as ContentShadowResearchContextSchema,
  CONTRACT_VERSION,
  type ContentShadowRunResponse,
  type ContentShadowRunSummary,
  type CreateContentShadowRunRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { isPostgresUniqueViolation } from "./db-errors";
import { assertValidTimestampUuidListCursor } from "./list-cursor";
import { runStatusUrl, toAsyncRunDto, type AsyncRunDto } from "./runs";

/**
 * SEO/GEO Content Shadow commands (Slice 2 Task 4).
 *
 * `createContentShadowRun` freezes an already confirmed content Finding, its
 * single canonical Action, the confirmed `content_brief` revision, and the
 * explicit competitor / SearchQuery cluster / GenerativeQuery identity sets into
 * one content-addressed tuple, then queues a shadow-mode capability run.
 *
 * It is deliberately a NON-confirming command (Slice 2 red line B): it requires
 * a Finding the canonical Finding Review transaction already confirmed and
 * refuses otherwise. It writes no Action, approval, checkpoint or opportunity
 * row, never touches a Finding's review state, and never recasts the brief — it
 * only freezes and consumes the revision that already exists. The lineage
 * assertions below are deliberately redundant with the `flow_shadow_runs`
 * provenance trigger: the service returns an actionable 4xx, the trigger is the
 * last-resort 23514 backstop.
 *
 * Not every assertion has a trigger behind it, and this docstring used to imply
 * otherwise. The `query_kind` checks on the two identity sets are the clearest
 * case: `keyword_entities.query_kind` is a row-level CHECK (`0018:242-244`), so
 * one entity row is a SearchQuery or a GenerativeQuery and never both. Once
 * this function has required `search_query` of every id in the search cluster
 * and `generative_query` of every id in the generative set, the two sets cannot
 * intersect, which makes `assertObservationSeparation`'s overlap error
 * unreachable from here. The catch that translated it was removed rather than
 * left to read as a live guard; if either `query_kind` check above is ever
 * relaxed, restore a translation for
 * `ContentShadowObservationSeparationError` with it.
 */

const IDEMPOTENCY_SCOPE = "createContentShadowRun";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CAPABILITY_ID = "content-shadow";
const CAPABILITY_VERSION = "0.4.0";
const CONTENT_BRIEF_ARTIFACT_TYPE = "content_brief";
const DEFAULT_CLAIM_RESTRICTIONS = [
  "no_guarantees",
  "no_unsupported_quantified_claims",
  "no_unverified_superlatives",
] as const;

/** The frozen content rules whose Action template mints a `content_brief`. */
const CONTENT_BRIEF_RULE_IDS: ReadonlySet<string> = new Set([
  "SEARCH-DECAY-002",
  "CONTENT-COVERAGE-001",
  "CONTENT-GAP-011",
  "CRO-LANDING-003",
]);

/**
 * Brief statuses a shadow run may freeze. `archived` and `failed` are operator
 * or generator outcomes that say "this is not the brief anymore"; `generating`
 * means a rewrite is in flight and the revision under it is about to be
 * superseded. The `flow_shadow_runs` provenance trigger deliberately does NOT
 * look at `status` or `validation_state` — those are human state-machine
 * concepts, not lineage — so this is the only layer that can refuse them.
 */
const FREEZABLE_BRIEF_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "ready",
]);

/** Verbatim from `createActionArtifact`: one drift, one sentence, everywhere. */
const FINDING_DRIFT_DETAIL =
  "Finding changed after this Action was created; review the current opportunity before generating an artifact.";

function briefRejected(code: string, detail: string): ProblemError {
  return new ProblemError("VALIDATION_ERROR", detail, {
    errors: [{ pointer: "/actionId", code, message: detail }],
  });
}

function contentShadowActiveKey(actionId: string): string {
  return `content_shadow:${actionId}`;
}

export interface ContentShadowAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "flow_shadow_run"; id: string };
  readonly location: string;
  readonly replayed: boolean;
}

export interface ContentShadowInputs {
  readonly siteId: string;
  readonly actionId: string;
  readonly findingId: string;
  readonly sourceDiagnosticRunId: string;
  readonly contentBriefArtifactId: string;
  readonly contentBriefRevision: number;
  readonly competitorEntityIds: readonly string[];
  readonly clusterKey: string;
  readonly keywordEntityIds: readonly string[];
  readonly generativeQueryEntityIds: readonly string[];
  /**
   * The project's own web identity, frozen at accept time (Slice 2 Task 6b).
   * Both halves come from rows this run already pins: the site the frozen
   * diagnosis ran against, and the immutable `icp_profiles` version that
   * diagnosis froze.
   */
  readonly firstParty: ContentShadowFirstPartyIdentity;
  /**
   * Deterministically extracted from the SAME brief revision and keyword rows
   * this function already read — no extra query. Freezing it is what makes the
   * draft a child of the brief rather than its sibling (Slice 2 Task 4b).
   */
  readonly contentBriefOutline: ContentBriefOutline;
  /**
   * Canonical research facts and immutable first-party snapshot identities.
   * The accepting service and the worker independently rebuild this complete
   * value from repositories; neither side is allowed to copy it from the
   * previously frozen manifest when checking replay drift.
   */
  readonly researchContext: ContentShadowResearchContext;
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

function frozenCrawlSnapshotId(
  diagnosticManifest: Record<string, unknown>,
): string {
  const snapshots = diagnosticManifest["snapshots"];
  if (!Array.isArray(snapshots)) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The frozen diagnosis has no readable crawl snapshot lineage.",
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
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The frozen diagnosis must identify exactly one crawl snapshot.",
    );
  }
  return crawlIds[0]!;
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
    // Keyword identities currently carry no claim-level evidence ledger. An
    // empty array is explicit absence; no synthetic evidence id is invented.
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
  // Explicit links the confirmed brief names outrank derived competitor roots;
  // sorting happens before the cap so request/repository row order cannot
  // change which bounded targets enter the frozen address.
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

/**
 * Read-only admission checks. Runs once before the transaction as a fast
 * pre-flight and again inside it under the project row lock, so a concurrent
 * dismissal/review cannot slip between the check and the freeze.
 */
export async function loadContentShadowInputs(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  body: CreateContentShadowRunRequest,
): Promise<ContentShadowInputs> {
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };

  const actions = new ActionsRepository(exec);
  const action = await actions.findById(projectScope, body.actionId);
  if (!action) throw new ProblemError("NOT_FOUND", "Action not found.");
  if (action.status === "dismissed") {
    throw new ProblemError(
      "ACTION_NOT_EXECUTABLE",
      "A dismissed Action cannot start a Content Shadow run.",
    );
  }

  const finding = await new FindingsRepository(exec).findById(
    projectScope,
    action.source_finding_id,
  );
  if (!finding) {
    throw new ProblemError("NOT_FOUND", "Source Finding not found.");
  }
  // Requires — never performs — confirmation (red line B).
  if (finding.review_state !== "confirmed") {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The source Finding must already be confirmed before a Content Shadow run.",
    );
  }
  if (!CONTENT_BRIEF_RULE_IDS.has(finding.rule_id)) {
    throw briefRejected(
      "rule_not_content",
      `Rule ${finding.rule_id} does not produce a content brief, so it cannot start a Content Shadow run.`,
    );
  }
  if (finding.last_seen_run_id !== action.source_diagnostic_run_id) {
    throw new ProblemError("VERSION_CONFLICT", FINDING_DRIFT_DETAIL);
  }

  // Exactly one canonical Action per confirmed Finding: a second live Action
  // would mean a second confirmation path exists (red line B).
  const actionCount = await actions.countActionsForFinding(
    projectScope,
    finding.id,
  );
  if (actionCount === 0) {
    // Defence in depth: unreachable from here, because the admission path above
    // already holds a non-dismissed Action whose `source_finding_id` is this
    // Finding. The state itself IS reachable — dismissing the only Action of a
    // confirmed Finding leaves "confirmed with nothing to execute" — and it is
    // the operator's to fix (restore the Action), so it stays a 422 and matches
    // the code the dismissed-Action branch already answers.
    throw new ProblemError(
      "ACTION_NOT_EXECUTABLE",
      "The confirmed Finding has no live Action to execute; restore the dismissed Action first.",
    );
  }
  if (actionCount > 1) {
    // NOT a 5xx, and deliberately so. `UNIQUE (source_finding_id, template_id)`
    // only makes "one Finding + one template" unique; when a rule set version
    // maps the same rule_id to a NEW template_id, that Finding can legitimately
    // acquire a second Action under the new template. So this is a reachable
    // product state, not data corruption, and 503's "retry later" would be a
    // lie — retrying never converges. It needs a human to pick which Action is
    // canonical, which is exactly what 409 means here.
    throw new ProblemError(
      "FINDING_ACTION_ACTIVE",
      `The confirmed Finding owns ${actionCount} live Actions; dismiss all but the canonical one before running a Content Shadow.`,
    );
  }

  const artifacts = new ExecutionArtifactsRepository(exec);
  const brief = await artifacts.findLiveByActionType(
    projectScope,
    action.id,
    CONTENT_BRIEF_ARTIFACT_TYPE,
  );
  if (!brief) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "A confirmed content brief is required to start a Content Shadow run.",
    );
  }
  if (!FREEZABLE_BRIEF_STATUSES.has(brief.status)) {
    throw briefRejected(
      "brief_not_live",
      `The content brief is ${brief.status}; only a draft or ready brief can be frozen into a Content Shadow run.`,
    );
  }
  if (brief.validation_state === "invalid") {
    throw briefRejected(
      "brief_invalid",
      "The content brief failed its last validation; fix it before freezing it into a Content Shadow run.",
    );
  }
  if (brief.current_revision < 1) {
    throw briefRejected(
      "brief_missing_revision",
      "The content brief has no generated revision to freeze.",
    );
  }
  const requestedRevision = body.contentBriefRevision ?? brief.current_revision;
  if (requestedRevision < 1 || requestedRevision > brief.current_revision) {
    throw new ProblemError(
      "STALE_REVISION",
      "The requested content brief revision is not available.",
    );
  }
  const briefRevision = await artifacts.findRevision(
    projectScope,
    brief.id,
    requestedRevision,
  );
  if (!briefRevision) {
    throw new ProblemError(
      "STALE_REVISION",
      "The requested content brief revision is not available.",
    );
  }

  const diagnosticRun = await new DiagnosticRunsRepository(exec).findById(
    projectScope,
    action.source_diagnostic_run_id,
  );
  if (!diagnosticRun) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The Action's frozen source diagnosis is unavailable.",
    );
  }

  // The project's own web identity, frozen so the QA gate can tell a first-party
  // link apart from an outside citation. `sites.origin` is a MUTABLE row, which
  // is precisely why it is frozen here rather than read at judgement time: an
  // origin that moves inside the accept -> claim window changes the content
  // address and fails the run as input drift (red line C). The conversion target
  // comes from the immutable `icp_profiles` version this diagnosis already
  // pinned, so it cannot move at all.
  const site = await new SitesRepository(exec).findById(
    projectScope,
    diagnosticRun.site_id,
  );
  if (!site) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The frozen diagnosis' site is unavailable.",
    );
  }
  const icpProfile = await new IcpProfilesRepository(exec).findById(
    projectScope,
    diagnosticRun.icp_profile_id,
  );
  if (!icpProfile) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The frozen diagnosis' ICP profile is unavailable.",
    );
  }
  const firstParty: ContentShadowFirstPartyIdentity = {
    siteOrigin: site.origin,
    // `parseIcp` is the one shared reader of the profile jsonb, so the worker's
    // replay guard cannot disagree with this side about what the value is.
    icpPrimaryConversionUrl:
      parseIcp(icpProfile.profile).primaryConversion?.targetUrl ?? null,
  };

  // Every frozen identity must belong to this live project (decision R4).
  const competitorEntityIds = [...new Set(body.competitorEntityIds)];
  let competitorRows: CompetitorEntityRow[] = [];
  if (competitorEntityIds.length > 0) {
    competitorRows = await new CompetitorsRepository(exec).listByIds(
      projectScope,
      competitorEntityIds,
    );
    if (competitorRows.length !== competitorEntityIds.length) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "Every frozen competitor must belong to this project.",
      );
    }
  }

  const keywords = new KeywordsRepository(exec);
  const keywordEntityIds = [...new Set(body.searchCluster.keywordEntityIds)];
  const keywordRows = await keywords.listByIds(projectScope, keywordEntityIds);
  if (keywordRows.length !== keywordEntityIds.length) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Every frozen search keyword must belong to this project.",
    );
  }
  for (const row of keywordRows) {
    // Search observation must be search observation (invariant 8).
    if (row.query_kind !== "search_query") {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "The frozen search cluster may only contain SearchQuery entities.",
      );
    }
    if (row.cluster_key !== body.searchCluster.clusterKey) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "Every frozen search keyword must belong to the frozen cluster.",
      );
    }
  }

  const generativeQueryEntityIds = [...new Set(body.generativeQueryEntityIds)];
  let generativeRows: KeywordEntityRow[] = [];
  if (generativeQueryEntityIds.length > 0) {
    generativeRows = await keywords.listByIds(
      projectScope,
      generativeQueryEntityIds,
    );
    if (generativeRows.length !== generativeQueryEntityIds.length) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "Every frozen generative query must belong to this project.",
      );
    }
    for (const row of generativeRows) {
      if (row.query_kind !== "generative_query") {
        throw new ProblemError(
          "VALIDATION_ERROR",
          "The frozen generative set may only contain GenerativeQuery entities.",
        );
      }
    }
  }

  // Structured extraction over data already in hand (Slice 2 Task 4b). Only the
  // brief's STRUCTURE crosses into the prompt allowlist; its prose never does.
  const { outline } = extractContentBriefOutline({
    briefMarkdown: briefRevision.content_text,
    keywords: keywordRows.map((row) => ({
      id: row.id,
      displayKeyword: row.display_keyword,
      normalizedKeyword: row.normalized_keyword,
      mappingDecision: row.mapping_decision,
      mappingReviewState: row.mapping_review_state,
    })),
  });
  const crawlSnapshotId = frozenCrawlSnapshotId(
    diagnosticRun.input_manifest,
  );
  const pageRows = await new PageSnapshotsRepository(
    exec,
  ).listByDataSnapshotWithSitePageIdentity(projectScope, crawlSnapshotId);
  if (
    pageRows.some(
      (page) =>
        page.site_id !== diagnosticRun.site_id ||
        page.data_snapshot_id !== crawlSnapshotId,
    )
  ) {
    throw new ProblemError(
      "CONTEXT_INCOMPLETE",
      "The frozen diagnosis' first-party page snapshot lineage is inconsistent.",
    );
  }
  const competitorFacts = competitorRows.map(competitorFact);
  const researchContext: ContentShadowResearchContext = {
    // The repository returns URL-ascending immutable snapshots. Keep the first
    // bounded set deterministically; the full bodies stay in PageSnapshots and
    // are re-read by id only inside the controlled worker.
    firstPartyPageSnapshots: pageRows
      .slice(
        0,
        CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.firstPartyPageSnapshots,
      )
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
      brandConstraints: profileStringArray(
        icpProfile.profile,
        "brandConstraints",
      ),
      complianceConstraints: profileStringArray(
        icpProfile.profile,
        "complianceConstraints",
      ),
      prohibitedTerms: profileStringArray(
        icpProfile.profile,
        "prohibitedTerms",
      ),
      claimRestrictions: [
        ...DEFAULT_CLAIM_RESTRICTIONS,
        ...profileStringArray(icpProfile.profile, "claimRestrictions"),
      ],
    },
  };

  return {
    siteId: diagnosticRun.site_id,
    actionId: action.id,
    findingId: finding.id,
    sourceDiagnosticRunId: action.source_diagnostic_run_id,
    contentBriefArtifactId: brief.id,
    contentBriefRevision: requestedRevision,
    competitorEntityIds,
    clusterKey: body.searchCluster.clusterKey,
    keywordEntityIds,
    generativeQueryEntityIds,
    firstParty,
    contentBriefOutline: outline,
    researchContext,
  };
}

/**
 * Freeze the pinned input tuple and its content address (red line C). Mirrors
 * `buildDiagnosticFrozenInput`: the hash is computed here, never in SQL, and
 * the adapter/prompt/projection versions are server-fixed (decision R3).
 */
export function buildContentShadowFrozenInput(input: {
  readonly inputs: ContentShadowInputs;
  readonly outputLocale: string;
}): {
  readonly manifest: ContentShadowInputManifest;
  readonly contentHash: string;
} {
  const { inputs } = input;
  const manifest = buildContentShadowInputManifest({
    primaryFindingId: inputs.findingId,
    sourceActionId: inputs.actionId,
    sourceDiagnosticRunId: inputs.sourceDiagnosticRunId,
    contentBriefArtifactId: inputs.contentBriefArtifactId,
    contentBriefRevision: inputs.contentBriefRevision,
    competitorEntityIds: inputs.competitorEntityIds,
    searchCluster: {
      clusterKey: inputs.clusterKey,
      keywordEntityIds: inputs.keywordEntityIds,
    },
    generativeQueryEntityIds: inputs.generativeQueryEntityIds,
    firstParty: inputs.firstParty,
    contentBriefOutline: inputs.contentBriefOutline,
    researchContext: inputs.researchContext,
    flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    // One constant, one source. The service used to read `PROMPT_SET_VERSION`
    // from `@sf/engine` while the worker read a same-valued but INDEPENDENT
    // constant from `@sf/artifacts`; advancing either alone would have made
    // every Content Shadow run drift.
    promptSetVersion: CONTENT_SHADOW_PROMPT_SET_VERSION,
    projectionVersion: CONTENT_SHADOW_PROJECTION_VERSION,
    outputLocale: input.outputLocale,
  });
  return {
    manifest,
    contentHash: contentHash(manifest as unknown as CanonicalValue),
  };
}

function replay(
  row: {
    readonly request_hash: string;
    readonly status: string;
    readonly resource_id: string | null;
    readonly response_body: unknown;
  },
  requestHash: string,
): ContentShadowAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key reused with a different body.",
    );
  }
  if (row.status !== "completed" || row.resource_id === null) return null;
  const body = row.response_body as {
    readonly run: AsyncRunDto;
    readonly statusUrl: string;
    readonly resourceRef: { type: "flow_shadow_run"; id: string };
  } | null;
  if (!body?.run || body.resourceRef?.type !== "flow_shadow_run") return null;
  return {
    status: 202,
    run: body.run,
    statusUrl: body.statusUrl,
    resourceRef: body.resourceRef,
    location: body.statusUrl,
    replayed: true,
  };
}

function activeConflict(projectId: string, runId: string): ProblemError {
  const statusUrl = runStatusUrl(projectId, runId);
  return new ProblemError(
    "RUN_ALREADY_ACTIVE",
    "A Content Shadow run is already active for this Action.",
    {
      headers: { Location: statusUrl },
      // Same pointer in the body as in the header, because a client that
      // only reads the response body would otherwise get a conflict it
      // cannot locate. `collection.ts` and `product-profile-synthesis.ts`
      // already answer this shape; these three did not.
      current: { runId, statusUrl },
    },
  );
}

/**
 * One content address, one shadow run (red line C), enforced by the
 * `flow_shadow_runs` UNIQUE (project_id, content_hash) index. Re-submitting a
 * byte-identical frozen tuple is therefore a request for a run that already
 * exists — including after the first one reached a terminal state and released
 * its active key — so the operator is pointed at it instead of silently getting
 * a second, differently drafted run under the same content address.
 *
 * The forward path decision D2 approves stays open: everything the tuple names
 * — the brief revision, the competitor set, cluster membership, the generative
 * set, the output locale, and the pinned adapter/prompt/projection versions —
 * changes the address when it changes, so a genuinely different shadow run for
 * the same Action is accepted.
 */
function contentAddressConflict(
  projectId: string,
  existing: FlowShadowRunRow,
): ProblemError {
  return new ProblemError(
    "VERSION_CONFLICT",
    "A Content Shadow run with exactly these frozen inputs already exists. Read it, or vary the frozen inputs (brief revision, competitor set, cluster, generative set or output locale) to run a different shadow.",
    {
      headers: {
        Location: runStatusUrl(projectId, existing.capability_run_id),
      },
    },
  );
}

function assertProjectShadowable(
  project: { readonly archived_at: string | null } | null,
): void {
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) {
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
  }
}

export async function createContentShadowRun(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateContentShadowRunRequest,
): Promise<ContentShadowAcceptedResult> {
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const { db } = getDb();
  const activeKey = contentShadowActiveKey(body.actionId);
  const requestHash = contentHash({
    projectId,
    actionId: body.actionId,
    contentBriefRevision: body.contentBriefRevision ?? null,
    competitorEntityIds: [...body.competitorEntityIds].sort(),
    searchCluster: {
      clusterKey: body.searchCluster.clusterKey,
      keywordEntityIds: [...body.searchCluster.keywordEntityIds].sort(),
    },
    generativeQueryEntityIds: [...body.generativeQueryEntityIds].sort(),
    outputLocale: body.outputLocale,
  });

  const idem = new IdempotencyRepository(db);
  const existing = await idem.find(
    scope.workspaceId,
    IDEMPOTENCY_SCOPE,
    idempotencyKey,
  );
  if (existing) {
    const replayed = replay(existing, requestHash);
    if (replayed) return replayed;
  }

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  assertProjectShadowable(project);
  await loadContentShadowInputs(db, scope, projectId, body);

  const active = await new AsyncRunsRepository(db).findActive(
    projectScope,
    activeKey,
  );
  if (active) {
    const now = await idem.find(
      scope.workspaceId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
    );
    const replayed = now ? replay(now, requestHash) : null;
    if (replayed) return replayed;
    throw activeConflict(projectId, active.id);
  }

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  const boss = await getBoss();
  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
      const reserved = await txIdem.begin({
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        expiresAt,
      });
      if (!reserved) {
        const now = await txIdem.find(
          scope.workspaceId,
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
        );
        const replayed = now ? replay(now, requestHash) : null;
        if (replayed) return replayed;
        throw new ProblemError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key is being processed.",
        );
      }

      const currentProject = await new ProjectsRepository(tx).findByIdForUpdate(
        scope,
        projectId,
      );
      assertProjectShadowable(currentProject);
      const inputs = await loadContentShadowInputs(tx, scope, projectId, body);
      const frozen = buildContentShadowFrozenInput({
        inputs,
        outputLocale: body.outputLocale,
      });
      // Checked under the project row lock taken above, so a concurrent
      // duplicate cannot slip between this read and the insert. It converts what
      // the unique index would otherwise raise as an unreadable repository fault
      // into an actionable conflict that names the existing run.
      const duplicate = await new FlowShadowRunsRepository(
        tx,
      ).findByContentHash(projectScope, frozen.contentHash);
      if (duplicate) throw contentAddressConflict(projectId, duplicate);
      const capabilityManifestHash = contentHash({
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        capabilityContractVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
        projectId,
        contentHash: frozen.contentHash,
      });

      // Provenance order is load-bearing: the flow_shadow_runs guard requires
      // the canonical run and its capability projection to exist first
      // (async_run -> capability_run -> flow_shadow_run).
      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "content_shadow",
        activeKey,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          actionId: body.actionId,
          outputLocale: body.outputLocale,
          capabilityContractVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
        },
      });
      await new CapabilityRunsRepository(tx).create({
        workspaceId: scope.workspaceId,
        projectId,
        asyncRunId: run.id,
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        inputManifestHash: capabilityManifestHash,
        // Shadow mode with internal writes only: no external CMS/publish write
        // exists anywhere in this capability (red line D).
        mode: "shadow",
        sideEffectClass: "internal_write",
      });
      const shadowRun = await new FlowShadowRunsRepository(tx).create({
        workspaceId: scope.workspaceId,
        projectId,
        siteId: inputs.siteId,
        capabilityRunId: run.id,
        sourceFindingId: inputs.findingId,
        sourceActionId: body.actionId,
        contentBriefArtifactId: inputs.contentBriefArtifactId,
        contentBriefRevision: inputs.contentBriefRevision,
        flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
        frozenInputManifest: frozen.manifest as unknown as Record<
          string,
          unknown
        >,
        contentHash: frozen.contentHash,
        projectionVersion: CONTENT_SHADOW_PROJECTION_VERSION,
      });
      await enqueueRunInTx(boss, tx, "content-shadow", {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });

      const dto = toAsyncRunDto(run);
      const statusUrl = runStatusUrl(projectId, run.id);
      const resourceRef = {
        type: "flow_shadow_run" as const,
        id: shadowRun.id,
      };
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody: { run: dto, statusUrl, resourceRef },
        resourceType: "flow_shadow_run",
        resourceId: shadowRun.id,
      });
      return {
        status: 202 as const,
        run: dto,
        statusUrl,
        resourceRef,
        location: statusUrl,
        replayed: false,
      };
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error, "async_runs_one_active_key_idx")) {
      const winnerKey = await idem.find(
        scope.workspaceId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
      );
      const replayed = winnerKey ? replay(winnerKey, requestHash) : null;
      if (replayed) return replayed;
      const winner = await new AsyncRunsRepository(db).findActive(
        projectScope,
        activeKey,
      );
      if (winner) throw activeConflict(projectId, winner.id);
      // No winner to point at. The unique index only aborts when a run
      // WAS active and `findActive` only sees `queued`/`running`, so the
      // winner left both states between the abort and this read. Neither
      // a `Location` nor a runId can be invented, and the detail must
      // stop asserting an active run it cannot observe. `activeKey` is
      // the one locatable fact that survives; `Problem.current` is
      // `additionalProperties: true`, so this costs no contract change.
      // Same disposition as `collection.ts` for the same reason.
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A Content Shadow run held this Action and is no longer active; retry the request.",
        { current: { runId: null, statusUrl: null, activeKey } },
      );
    }
    throw error;
  }
}

function frozenStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return [...value];
}

/**
 * The frozen manifest is written by this service and is append-only, so a
 * missing field is a real integrity fault rather than something to paper over
 * with a plausible-looking default.
 */
function requiredManifestString(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return value;
}

function manifestRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return value as Record<string, unknown>;
}

type ContentShadowFrozenInputsDto = ContentShadowRunResponse["frozenInputs"];

/**
 * The project's frozen web identity, as the read API reports it.
 *
 * It is surfaced because the QA gate's link judgement now hinges on it: a
 * reviewer reading "this link resolves" has to be able to see WHAT it resolved
 * against, and the research pack that also carries it does not exist until the
 * run reaches its research phase.
 */
function projectFirstParty(
  manifest: Record<string, unknown>,
): ContentShadowFrozenInputsDto["firstParty"] {
  const record = manifestRecord(manifest, "firstParty");
  const conversion = record["icpPrimaryConversionUrl"];
  if (typeof conversion !== "string" && conversion !== null) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return {
    siteOrigin: requiredManifestString(record, "siteOrigin"),
    icpPrimaryConversionUrl: conversion,
  };
}

const OUTLINE_PAGE_ASSIGNMENTS: ReadonlySet<string> = new Set([
  "existing_page",
  "new_asset",
  "mixed",
  "unassigned",
]);

/**
 * The brief-derived COVERAGE CHECKLIST (Task 4b decision O-6), which Task 4b
 * deliberately left out of this `.strict()` projection. The side-by-side review
 * has to render the checklist itself — "which committed topics did this draft
 * promise to cover?" is the reviewer's first question — so it is added here
 * rather than leaving the UI to re-derive it from a brief it does not hold.
 */
function projectBriefOutline(
  manifest: Record<string, unknown>,
): ContentShadowFrozenInputsDto["contentBriefOutline"] {
  const record = manifestRecord(manifest, "contentBriefOutline");
  const pageAssignment = record["pageAssignment"];
  if (
    typeof pageAssignment !== "string" ||
    !OUTLINE_PAGE_ASSIGNMENTS.has(pageAssignment)
  ) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return {
    briefSections: frozenStringArray(record["briefSections"]),
    targetKeywords: frozenStringArray(record["targetKeywords"]),
    pageAssignment:
      pageAssignment as ContentShadowFrozenInputsDto["contentBriefOutline"]["pageAssignment"],
  };
}

/**
 * Read the append-only manifest as one strict contract value. Individual
 * helpers make the failure actionable, while the final schema parse catches
 * invalid UUIDs, URLs, duplicates, bounds and identity-set drift. No damaged
 * member is filtered into a plausible-looking smaller frozen context.
 */
export function projectContentShadowFrozenInputs(
  manifest: Record<string, unknown>,
  primaryFindingId: string,
): ContentShadowFrozenInputsDto {
  const clusterRecord = manifestRecord(manifest, "searchCluster");
  const candidate = {
    primaryFindingId,
    sourceDiagnosticRunId: requiredManifestString(
      manifest,
      "sourceDiagnosticRunId",
    ),
    competitorEntityIds: frozenStringArray(manifest["competitorEntityIds"]),
    searchCluster: {
      clusterKey: requiredManifestString(clusterRecord, "clusterKey"),
      keywordEntityIds: frozenStringArray(clusterRecord["keywordEntityIds"]),
    },
    generativeQueryEntityIds: frozenStringArray(
      manifest["generativeQueryEntityIds"],
    ),
    firstParty: projectFirstParty(manifest),
    contentBriefOutline: projectBriefOutline(manifest),
    researchContext: projectFrozenResearchContext(manifest),
  };
  const parsed = ContentShadowFrozenInputsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow manifest is unreadable.",
    );
  }
  return parsed.data;
}

type ContentShadowSources = NonNullable<
  ContentShadowRunResponse["research"]
>["sources"];

/**
 * Project the stored pack into the deliberately narrower customer wire shape.
 *
 * `contentText`, URL-hash internals and hash-method machinery remain in the
 * append-only pack for QA/replay, but never cross this boundary. An unreadable
 * source fails the read: "we could not parse research" must not become an empty
 * source list that looks like "no research was needed".
 */
export function projectContentShadowPackSources(
  pack: Record<string, unknown>,
): ContentShadowSources {
  const sources = pack["sources"];
  if (!Array.isArray(sources)) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The stored Content Shadow research sources are unreadable.",
    );
  }
  const projected = sources.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const source = value as Record<string, unknown>;
    const rawMetrics = source["metrics"];
    const metrics =
      rawMetrics === null
        ? null
        : typeof rawMetrics === "object" && !Array.isArray(rawMetrics)
          ? (() => {
              const record = rawMetrics as Record<string, unknown>;
              return {
                status: record["status"],
                contentType: record["contentType"],
                bodyBytes: record["bodyBytes"],
                wordCount: record["wordCount"],
                responseMs: record["responseMs"],
                redirectChain: record["redirectChain"],
              };
            })()
          : rawMetrics;
    return {
      kind: source["kind"],
      ref: source["ref"],
      label: source["label"],
      url: source["url"],
      availability: source["availability"],
      authorityTier: source["authorityTier"],
      capturedAt: source["capturedAt"],
      contentHash: source["contentHash"],
      contentHashMethod: source["contentHashMethod"],
      contentTruncated: source["contentTruncated"],
      excerpt: source["excerpt"],
      excerptTruncated: source["excerptTruncated"],
      metrics,
      evidenceRefs: source["evidenceRefs"],
      limitation: source["limitation"],
    };
  });
  const parsed = ContentShadowAuthoritySource.array().safeParse(projected);
  if (!parsed.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The stored Content Shadow research sources are unreadable.",
    );
  }
  return parsed.data;
}

function projectResearchLimitations(pack: Record<string, unknown>): string[] {
  const parsed = ContentShadowResearch.shape.limitations.safeParse(
    pack["limitations"],
  );
  if (!parsed.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The stored Content Shadow research limitations are unreadable.",
    );
  }
  return parsed.data;
}

function projectFrozenResearchContext(
  manifest: Record<string, unknown>,
): ContentShadowRunResponse["frozenInputs"]["researchContext"] {
  const parsed = ContentShadowResearchContextSchema.safeParse(
    manifest["researchContext"],
  );
  if (!parsed.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The frozen Content Shadow research context is unreadable.",
    );
  }
  return parsed.data;
}

type ContentShadowQaClaimsDto = NonNullable<
  ContentShadowRunResponse["qa"]
>["claims"];

/** The claim shape the gate row actually stores — severity is not persisted. */
const StoredContentShadowQaClaim = ContentShadowQaClaim.omit({
  severity: true,
});

/**
 * Widen the stored claims with the severity the gate package owns.
 *
 * The severity is looked up from `@sf/flow-shadow`'s own table rather than
 * restated here: a second literal list of "which checks block" living in this
 * mapper would drift from the rules it describes, and the direction that drift
 * takes is the expensive one — a claim shown as advisory while the gate treats
 * it as blocking reads to a reviewer as safe to accept.
 *
 * An unreadable claim array fails the read instead of degrading to an empty
 * list. A gate row exists precisely because a judgement was made; answering
 * "no findings" when the findings cannot be parsed would be the "we did not
 * look" -> "we found nothing" substitution the gate itself exists to prevent.
 */
function projectQaClaims(stored: unknown): ContentShadowQaClaimsDto {
  const parsed = StoredContentShadowQaClaim.array().safeParse(stored);
  if (!parsed.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The stored Content Shadow quality findings are unreadable.",
    );
  }
  return parsed.data.map((claim) => ({
    ...claim,
    severity: qaSeverityForClaimId(claim.claimId),
  }));
}

type ContentShadowDraftDto = NonNullable<ContentShadowRunResponse["draft"]>;

type RevisionHistoryDto = ContentShadowDraftDto["revisionHistory"];

/**
 * Convert the complete repository ledger without synthesising current/judged
 * milestones. `listRevisions` promises newest-first; an out-of-order or
 * duplicate result is an integrity failure, not something this reader sorts
 * into a plausible story.
 */
export function projectContentShadowRevisionHistory(
  rows: readonly Pick<
    ArtifactRevisionRow,
    | "revision"
    | "content_hash"
    | "generated_by"
    | "editor_id"
    | "note"
    | "validation_errors"
    | "created_at"
  >[],
): RevisionHistoryDto {
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.revision !== rows[index]!.revision + 1) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "The Content Shadow revision ledger is not complete and newest-first.",
      );
    }
  }
  if (rows.length > 0 && rows.at(-1)!.revision !== 1) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The Content Shadow revision ledger is incomplete.",
    );
  }
  const projected = rows.map((row) => {
    let createdAt: string;
    try {
      createdAt = canonicalUtcTimestamptz(row.created_at);
    } catch {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "The Content Shadow revision ledger is unreadable.",
      );
    }
    if (!Array.isArray(row.validation_errors)) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "The Content Shadow revision ledger is unreadable.",
      );
    }
    return {
      revision: row.revision,
      contentHash: row.content_hash,
      generatedBy: row.generated_by,
      editorId: row.editor_id,
      note: row.note,
      validationErrorCount: row.validation_errors.length,
      createdAt,
    };
  });
  const parsed = ContentShadowDraft.shape.revisionHistory.safeParse(projected);
  if (!parsed.success) {
    throw new ProblemError(
      "DEPENDENCY_UNAVAILABLE",
      "The Content Shadow revision ledger is unreadable.",
    );
  }
  return parsed.data;
}

/**
 * Resolve the draft THIS run owns, never the Action's currently live artifact.
 *
 * `findLiveByActionType` is deliberately not used here. Decision D2 allows a
 * later shadow run for the same Action, and that run legitimately installs a
 * new revision on the same artifact row; answering with it would make a
 * finished run report a body its own frozen QA verdict never saw, and would
 * make a still-queued run claim a predecessor's draft. Two run-scoped bindings
 * are tried in order of durability, and when neither resolves the honest answer
 * is `null` rather than a plausible-looking fallback:
 *
 * 1. this run's QA gate, which pinned (artifact, revision) append-only;
 * 2. this run's own invocation lineage (revision -> invocation -> run);
 * 3. the artifact still claimed by this run, which has produced no revision yet
 *    — reported with revision 0 so the phase cannot read as `draft`.
 */
async function resolveRunScopedDraft(
  artifacts: ExecutionArtifactsRepository,
  scope: ProjectScope,
  asyncRunId: string,
  gate: FlowShadowQaGateRow | null,
): Promise<ContentShadowDraftDto | null> {
  const project = (
    artifact: ArtifactRow,
    revision: number,
    contentText: string | null,
  ): Promise<ContentShadowDraftDto> =>
    artifacts.listRevisions(scope, artifact.id).then((revisions) => {
      const candidate = {
        artifactId: artifact.id,
        status: artifact.status as ContentShadowDraftDto["status"],
        currentRevision: revision,
        contentText,
        revisionHistory: projectContentShadowRevisionHistory(revisions),
      };
      const parsed = ContentShadowDraft.safeParse(candidate);
      if (!parsed.success) {
        throw new ProblemError(
          "DEPENDENCY_UNAVAILABLE",
          "The Content Shadow draft projection is unreadable.",
        );
      }
      return parsed.data;
    });

  if (gate) {
    const artifact = await artifacts.findById(
      scope,
      gate.evaluated_artifact_id,
    );
    if (artifact) {
      const revision = await artifacts.findRevision(
        scope,
        artifact.id,
        gate.evaluated_revision,
      );
      return await project(
        artifact,
        gate.evaluated_revision,
        revision?.content_text ?? null,
      );
    }
  }

  const generated = await artifacts.findRevisionByGenerationRun(
    scope,
    asyncRunId,
  );
  if (generated) {
    const artifact = await artifacts.findById(scope, generated.artifact_id);
    if (artifact) {
      return await project(artifact, generated.revision, generated.content_text);
    }
  }

  const claimed = await artifacts.findByGenerationRun(scope, asyncRunId);
  return claimed ? await project(claimed, 0, null) : null;
}

/**
 * Phase is DERIVED from which append-only RUN-SCOPED child rows exist (decision
 * R1); the shadow rows own no mutable status column of their own, and no input
 * here may come from a row another run could have moved.
 */
function deriveContentShadowPhase(
  runStatus: string,
  hasResearch: boolean,
  hasDraftRevision: boolean,
  hasQa: boolean,
): ContentShadowRunResponse["phase"] {
  if (runStatus === "failed" || runStatus === "cancelled") return "failed";
  if (hasQa) return runStatus === "completed" ? "complete" : "qa";
  if (hasDraftRevision) return "draft";
  if (hasResearch) return "research";
  return "queued";
}

/**
 * `GET /projects/{projectId}/content-shadow-runs` — the run index.
 *
 * The index answers exactly one question: which Content Shadow runs does this
 * project have? Before it existed a run id was handed out once, in the 202 that
 * created the run, so a page reload left the research pack, the QA verdict and
 * every honesty disclosure unreachable — what a customer could read depended on
 * whether they had refreshed.
 *
 * Each row is assembled from the run's own immutable record alone: no child row
 * is read, no async run is joined, and no phase is derived. That is a contract
 * property, not an optimisation — a list that reported state would have to
 * guess at it per page, and the detail projection already reads the append-only
 * rows that own it.
 */
export async function listContentShadowRuns(
  scope: WorkspaceScope,
  projectId: string,
  opts: { limit: number; cursor: string | null },
): Promise<{
  data: ContentShadowRunSummary[];
  nextCursor: string | null;
  limit: number;
}> {
  assertValidTimestampUuidListCursor(opts.cursor);
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const { db } = getDb();

  // A project in another workspace is reported absent, never forbidden.
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const page = await new FlowShadowRunsRepository(db).listByProject(
    projectScope,
    opts,
  );
  return {
    data: page.rows.map((row) => toContentShadowRunSummary(row)),
    nextCursor: page.nextCursor,
    limit: opts.limit,
  };
}

function toContentShadowRunSummary(
  row: FlowShadowRunRow,
): ContentShadowRunSummary {
  return {
    flowShadowRunId: row.id,
    projectId: row.project_id,
    siteId: row.site_id,
    asyncRunId: row.capability_run_id,
    contentHash: row.content_hash,
    projectionVersion: row.projection_version,
    flowAdapterVersion: row.flow_adapter_version,
    outputLocale: requiredManifestString(
      row.frozen_input_manifest,
      "outputLocale",
    ),
    createdAt: row.created_at,
    source: {
      findingId: row.source_finding_id,
      actionId: row.source_action_id,
      contentBriefArtifactId: row.content_brief_artifact_id,
      contentBriefRevision: row.content_brief_revision,
    },
  };
}

/** `GET /projects/{projectId}/content-shadow-runs/{flowShadowRunId}`. */
export async function getContentShadowRun(
  scope: WorkspaceScope,
  projectId: string,
  flowShadowRunId: string,
): Promise<ContentShadowRunResponse> {
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const { db } = getDb();

  // A run in another workspace or project is reported absent, never forbidden.
  const shadowRun: FlowShadowRunRow | null = await new FlowShadowRunsRepository(
    db,
  ).findById(projectScope, flowShadowRunId);
  if (!shadowRun) {
    throw new ProblemError("NOT_FOUND", "Content Shadow run not found.");
  }

  const run = await new AsyncRunsRepository(db).findById(
    projectScope,
    shadowRun.capability_run_id,
  );
  if (!run) {
    throw new ProblemError("NOT_FOUND", "Content Shadow run not found.");
  }

  const manifest = shadowRun.frozen_input_manifest;
  const outputLocale = requiredManifestString(manifest, "outputLocale");
  const frozenInputs = projectContentShadowFrozenInputs(
    manifest,
    shadowRun.source_finding_id,
  );

  const pack = await new FlowShadowResearchPacksRepository(db).findByRun(
    projectScope,
    shadowRun.id,
  );
  const gates = await new FlowShadowQaGatesRepository(db).findByRun(
    projectScope,
    shadowRun.id,
  );
  const gate = gates[0] ?? null;

  const draft = await resolveRunScopedDraft(
    new ExecutionArtifactsRepository(db),
    projectScope,
    shadowRun.capability_run_id,
    gate,
  );

  const research: ContentShadowRunResponse["research"] =
    pack === null
      ? null
      : {
          packId: pack.id,
          sources: projectContentShadowPackSources(pack.pack),
          limitations: projectResearchLimitations(pack.pack),
          generatedAt: pack.created_at,
        };

  return {
    flowShadowRunId: shadowRun.id,
    projectId: shadowRun.project_id,
    siteId: shadowRun.site_id,
    asyncRunId: run.id,
    status: run.status as ContentShadowRunResponse["status"],
    phase: deriveContentShadowPhase(
      run.status,
      pack !== null,
      draft !== null && draft.currentRevision >= 1,
      gate !== null,
    ),
    contentHash: shadowRun.content_hash,
    projectionVersion: shadowRun.projection_version,
    flowAdapterVersion: shadowRun.flow_adapter_version,
    outputLocale,
    createdAt: shadowRun.created_at,
    source: {
      findingId: shadowRun.source_finding_id,
      actionId: shadowRun.source_action_id,
      contentBriefArtifactId: shadowRun.content_brief_artifact_id,
      contentBriefRevision: shadowRun.content_brief_revision,
    },
    frozenInputs,
    research,
    draft,
    qa: gate
      ? {
          gateId: gate.id,
          verdict: gate.verdict,
          evaluatedArtifactId: gate.evaluated_artifact_id,
          evaluatedRevision: gate.evaluated_revision,
          claims: projectQaClaims(gate.claims),
          evaluatedAt: gate.created_at,
        }
      : null,
  };
}
