import type { Page, Route } from "@playwright/test";
import {
  E2E_CANONICAL_ACTION_ID,
  E2E_CANONICAL_FINDING_ID,
  E2E_CONTENT_FINDING_ID,
  E2E_ONBOARDING_URL,
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  installGrowthVerticalApi,
  type GrowthVerticalApiState,
} from "./mock-api.ts";
import {
  claimCounts,
  expectedVerdict,
  expectedAdoption,
  VERTICAL_CLAIMS,
} from "./content-shadow-claims-fixture.ts";

/**
 * Fixtures for the Slice 2 content vertical E2E (`content-shadow-vertical.mock.spec.ts`).
 *
 * Everything here is response shape and recording only — no assertion lives in
 * this file, so a reader of the spec can see the whole proof in one place.
 * The one exception is deliberate: the recorded write set is exposed as
 * `apiWrites`, because "which writes left the browser" is the fact the spec
 * asserts after every segment.
 */

export const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
export const OVERVIEW_URL = `/p/${E2E_PROJECT_ID}/overview`;
export const NAV_LABEL = "Project sections";
export const opportunityReviewPanel =
  '[data-detail-panel="opportunity-review"]';

/** Ids minted for the content vertical only; the 9xx block is unused elsewhere. */
export const CONTENT_ACTION_ID = "00000000-0000-4000-8000-000000000920";
export const BRIEF_ARTIFACT_ID = "00000000-0000-4000-8000-000000000921";
export const DRAFT_ARTIFACT_ID = "00000000-0000-4000-8000-000000000922";
export const RUN_ID = "00000000-0000-4000-8000-000000000923";
const ASYNC_RUN_ID = "00000000-0000-4000-8000-000000000924";
const PACK_ID = "00000000-0000-4000-8000-000000000925";
const GATE_ID = "00000000-0000-4000-8000-000000000926";
const KEYWORD_ENTITY_ID = "00000000-0000-4000-8000-000000000927";
const BRIEF_REVISION_ID = "00000000-0000-4000-8000-000000000928";
const DRAFT_REVISION_ID = "00000000-0000-4000-8000-000000000929";
const DIAGNOSTIC_RUN_ID = "00000000-0000-4000-8000-000000000802";
export const CONTENT_HASH =
  "b7c1d2e3f405162738495a6b7c8d9e0fb7c1d2e3f405162738495a6b7c8d9e0f";
const NOW = "2026-07-25T00:00:00.000Z";

export const CONTENT_ACTION_TITLE =
  "Close the onboarding analytics coverage gap";
export const BRIEF_REVISION = 3;

const BRIEF_BODY = [
  "## Objective",
  "",
  "Explain how onboarding analytics expose activation drop-off.",
  "",
  "## Target Topics & Queries",
  "",
  "- onboarding analytics",
  "- activation drop-off",
].join("\n");

const DRAFT_BODY = [
  "# How onboarding analytics reveal activation drop-off",
  "",
  "Activation stalls where the product stops explaining itself, and the",
  "onboarding funnel is where that first becomes measurable.",
  "",
  "## Evidence",
  "",
  "- Our own onboarding analytics show the same shape across cohorts.",
].join("\n");

interface Recorded {
  readonly method: string;
  readonly url: string;
}

/** The Action fields the vertical asserts on, as they appear on the wire. */
export interface ConfirmedAction {
  readonly id: string;
  readonly findingId: string;
  readonly title: string;
}

/**
 * The Actions a Finding Review response carried.
 *
 * Reads both shapes the contract could take — a single `action` and a plural
 * `actions` array — so a response that carried two would be COUNTED as two
 * rather than recorded as one flag.
 */
function actionsInResponse(body: unknown): readonly ConfirmedAction[] {
  const data = (body as { data?: Record<string, unknown> }).data ?? {};
  const many = data["actions"];
  if (Array.isArray(many)) return many as ConfirmedAction[];
  const one = data["action"];
  return one === undefined || one === null ? [] : [one as ConfirmedAction];
}

export interface ContentVerticalState {
  readonly growth: GrowthVerticalApiState;
  /** Every non-GET request the browser issued, in order. */
  readonly writes: Recorded[];
  /** Every request URL of any method, used to prove nothing left the origin. */
  readonly origins: string[];
  /**
   * Every Action object the confirmation RESPONSES actually carried.
   *
   * Read out of the response body rather than pushed as a constant beside it.
   * The list used to be `push({ findingId: E2E_CONTENT_FINDING_ID })`, so the
   * spec's "exactly one Action, bound to the confirmed Finding" assertions
   * compared the fixture to its own literal: a `reviewProjectFinding` that
   * created two Actions for one Finding would not have moved either number.
   */
  readonly contentActionsCreated: ConfirmedAction[];
  /** `{artifactId, revision}` of each revision-pinned artifact read. */
  readonly revisionReads: {
    readonly artifactId: string;
    readonly revision: string | null;
  }[];
  /** The review receipts the server handed back. */
  readonly reviewRequests: unknown[];
  /** The live deliverable, which the review moves. */
  draftRevision: number;
  draftStatus: "draft" | "ready";
}

function briefArtifact() {
  return {
    id: BRIEF_ARTIFACT_ID,
    actionId: CONTENT_ACTION_ID,
    artifactType: "content_brief",
    status: "ready",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: BRIEF_REVISION,
    validationState: "valid",
    current: {
      id: BRIEF_REVISION_ID,
      revision: BRIEF_REVISION,
      outputLocale: "en",
      contentFormat: "markdown",
      content: BRIEF_BODY,
      contentHash: CONTENT_HASH,
      validationErrors: [],
      note: null,
      createdAt: NOW,
    },
    activeRun: null,
    // No Content Shadow gate judges a content_brief; `null` is not "cleared".
    adoption: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function draftArtifact(state: ContentVerticalState) {
  return {
    id: DRAFT_ARTIFACT_ID,
    actionId: CONTENT_ACTION_ID,
    artifactType: "english_blog_draft",
    status: state.draftStatus,
    generationMode: "structured_llm",
    outputLocale: "en",
    currentRevision: state.draftRevision,
    validationState: "valid",
    current: {
      id: DRAFT_REVISION_ID,
      revision: state.draftRevision,
      outputLocale: "en",
      contentFormat: "markdown",
      content: DRAFT_BODY,
      contentHash: CONTENT_HASH,
      validationErrors: [],
      note: null,
      createdAt: NOW,
    },
    activeRun: null,
    // Derived from the run's own claims, exactly as the server derives it.
    adoption: expectedAdoption(VERTICAL_CLAIMS),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function contentAction() {
  return {
    id: CONTENT_ACTION_ID,
    findingId: E2E_CONTENT_FINDING_ID,
    templateId: "content_coverage_brief.v1",
    title: CONTENT_ACTION_TITLE,
    description:
      "Write the cluster's missing coverage against the frozen search cluster.",
    contentLocale: "en",
    priorityBand: "medium",
    roadmapLane: "now",
    status: "planned",
    effort: "medium",
    risk: "low",
    expectedOutcome:
      "The onboarding cluster has a deliverable a reviewer can read.",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** The pre-existing technical Action, so the content chain is not the only row. */
function technicalAction() {
  return {
    id: E2E_CANONICAL_ACTION_ID,
    findingId: E2E_CANONICAL_FINDING_ID,
    templateId: "fix_http_status.v1",
    title: "Fix the failing product page",
    description: "Restore a successful response for the product page.",
    contentLocale: "en",
    priorityBand: "high",
    roadmapLane: "now",
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: "Visitors and crawlers can load the product page.",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function runProjection(state: ContentVerticalState) {
  return {
    flowShadowRunId: RUN_ID,
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    asyncRunId: ASYNC_RUN_ID,
    status: "completed",
    phase: "complete",
    contentHash: CONTENT_HASH,
    projectionVersion: "content-shadow.0.3.2",
    flowAdapterVersion: "content-shadow-adapter.0.3.0",
    outputLocale: "en",
    createdAt: NOW,
    source: {
      findingId: E2E_CONTENT_FINDING_ID,
      actionId: CONTENT_ACTION_ID,
      contentBriefArtifactId: BRIEF_ARTIFACT_ID,
      contentBriefRevision: BRIEF_REVISION,
    },
    frozenInputs: {
      primaryFindingId: E2E_CONTENT_FINDING_ID,
      sourceDiagnosticRunId: DIAGNOSTIC_RUN_ID,
      competitorEntityIds: [],
      searchCluster: {
        clusterKey: "onboarding",
        keywordEntityIds: [KEYWORD_ENTITY_ID],
      },
      generativeQueryEntityIds: [],
      firstParty: {
        siteOrigin: "https://example.test",
        icpPrimaryConversionUrl: "https://example.test/signup",
      },
      contentBriefOutline: {
        briefSections: ["Objective", "Target Topics & Queries"],
        targetKeywords: ["onboarding analytics", "activation drop-off"],
        pageAssignment: "existing_page",
      },
    },
    research: {
      packId: PACK_ID,
      sources: [
        {
          kind: "content_brief",
          ref: BRIEF_ARTIFACT_ID,
          authorityTier: "A",
          limitation: "The confirmed content brief revision.",
        },
        {
          kind: "search_query",
          ref: KEYWORD_ENTITY_ID,
          authorityTier: "B",
          limitation: "Identity only; this pack carries no search metric.",
        },
        {
          kind: "first_party_site",
          ref: "https://example.test",
          authorityTier: "A",
          limitation: "First-party identity only.",
        },
      ],
      limitations: [
        "This pack carries only first-party frozen project records; no external source was retrieved or graded.",
      ],
      generatedAt: NOW,
    },
    draft: {
      artifactId: DRAFT_ARTIFACT_ID,
      status: state.draftStatus,
      currentRevision: state.draftRevision,
      contentText: DRAFT_BODY,
    },
    qa: {
      gateId: GATE_ID,
      // Derived, never declared: a verdict the gate could not return for these
      // claims would prove the surfaces against a state no run can produce.
      verdict: expectedVerdict(VERTICAL_CLAIMS),
      evaluatedArtifactId: DRAFT_ARTIFACT_ID,
      evaluatedRevision: 1,
      claims: VERTICAL_CLAIMS,
      evaluatedAt: NOW,
    },
  };
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function listEnvelope(data: readonly unknown[]) {
  return { data, meta: { nextCursor: null, hasNext: false, limit: 100 } };
}

/**
 * Install the content vertical over the Slice 1 growth vertical.
 *
 * Registered afterwards on purpose: Playwright consults the most recently added
 * route first, so these win over the shared handlers while everything they do
 * not name keeps working.
 */
export async function installContentVerticalApi(
  page: Page,
): Promise<ContentVerticalState> {
  const growth = await installGrowthVerticalApi(page);
  const state: ContentVerticalState = {
    growth,
    writes: [],
    origins: [],
    contentActionsCreated: [],
    revisionReads: [],
    reviewRequests: [],
    draftRevision: 1,
    draftStatus: "draft",
  };

  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      state.origins.push(new URL(url).origin);
    }
    if (request.method() === "GET") return;
    state.writes.push({ method: request.method(), url });
  });

  // Confirming the content Finding runs the SAME Finding Review transaction the
  // technical vertical uses, and returns exactly one Action (red line B).
  await page.route(
    `**${BASE}/findings/${E2E_CONTENT_FINDING_ID}`,
    async (route) => {
      if (route.request().method() !== "PATCH") {
        await fulfill(route, { data: null }, 501);
        return;
      }
      growth.findingReviewRequests.push({
        findingId: E2E_CONTENT_FINDING_ID,
        body: route.request().postDataJSON(),
      });
      growth.confirmedFindingIds.add(E2E_CONTENT_FINDING_ID);
      const body = {
        data: {
          finding: {
            id: E2E_CONTENT_FINDING_ID,
            ruleId: "CONTENT-COVERAGE-001",
            ruleVersion: 1,
            domain: "content_intent",
            titleKey: "finding.content.coverage_gap",
            titleArgs: {},
            summary: "The onboarding page has a measured content coverage gap.",
            summaryLocale: "en",
            severity: "medium",
            confidence: "high",
            reviewState: "confirmed",
            reviewRevision: 1,
            active: true,
            regressed: false,
            subjectRefs: [{ type: "url", value: E2E_ONBOARDING_URL }],
            evidence: [],
            firstSeenAt: NOW,
            lastSeenAt: NOW,
            resolvedAt: null,
          },
          action: contentAction(),
        },
      };
      state.contentActionsCreated.push(...actionsInResponse(body));
      await fulfill(route, body);
    },
  );

  await page.route(`**${BASE}/actions?**`, async (route) => {
    await fulfill(route, listEnvelope([technicalAction(), contentAction()]));
  });

  await page.route(`**${BASE}/artifacts?**`, async (route) => {
    await fulfill(route, listEnvelope([briefArtifact(), draftArtifact(state)]));
  });

  await page.route(
    `**${BASE}/artifacts/${BRIEF_ARTIFACT_ID}**`,
    async (route) => {
      state.revisionReads.push({
        artifactId: BRIEF_ARTIFACT_ID,
        revision: new URL(route.request().url()).searchParams.get("revision"),
      });
      await fulfill(route, { data: briefArtifact() });
    },
  );

  await page.route(
    `**${BASE}/artifacts/${DRAFT_ARTIFACT_ID}**`,
    async (route) => {
      await fulfill(route, { data: draftArtifact(state) });
    },
  );

  await page.route(
    `**${BASE}/content-shadow-runs/${RUN_ID}/review`,
    async (route) => {
      state.reviewRequests.push(route.request().postDataJSON());
      // The one write this stage performs: the deliverable becomes reviewed.
      state.draftStatus = "ready";
      await fulfill(route, {
        data: {
          flowShadowRunId: RUN_ID,
          artifactId: DRAFT_ARTIFACT_ID,
          reviewedRevision: state.draftRevision,
          artifactStatus: "ready",
          verdict: expectedVerdict(VERTICAL_CLAIMS),
          claimCounts: claimCounts(VERTICAL_CLAIMS),
          contentHash: CONTENT_HASH,
          reviewedAt: "2026-07-25T01:00:00.000Z",
          externalPublishingWrite: "none",
        },
      });
    },
  );

  await page.route(`**${BASE}/content-shadow-runs/${RUN_ID}`, async (route) => {
    await fulfill(route, { data: runProjection(state) });
  });

  await page.route(`**${BASE}/content-shadow-runs?**`, async (route) => {
    const projection = runProjection(state);
    await fulfill(
      route,
      listEnvelope([
        {
          flowShadowRunId: projection.flowShadowRunId,
          projectId: projection.projectId,
          siteId: projection.siteId,
          asyncRunId: projection.asyncRunId,
          contentHash: projection.contentHash,
          projectionVersion: projection.projectionVersion,
          flowAdapterVersion: projection.flowAdapterVersion,
          outputLocale: projection.outputLocale,
          createdAt: projection.createdAt,
          source: projection.source,
        },
      ]),
    );
  });

  return state;
}

/** `METHOD /path` for every product write, in the order the browser made them. */
export function apiWrites(state: ContentVerticalState): readonly string[] {
  return state.writes
    .filter((write) => write.url.includes("/api/mvp/"))
    .map((write) => `${write.method} ${new URL(write.url).pathname}`);
}
