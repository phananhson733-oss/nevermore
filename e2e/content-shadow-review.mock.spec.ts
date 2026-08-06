import { expect, test, type Page, type Route } from "@playwright/test";
import {
  CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION,
  CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
  ContentShadowRunResponse,
  type ContentShadowRunResponse as ContentShadowRunResponseDto,
} from "../packages/contracts/src/zod/content-shadow.ts";
import {
  E2E_CANONICAL_ACTION_ID,
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  installCriticalFlowApi,
} from "./mock-api.ts";
import {
  claimCounts,
  expectedVerdict,
  expectedAdoption,
  REVIEW_BLOCKING_CLAIMS,
  REVIEW_COVERAGE_GAP_CLAIMS,
  REVIEW_PASSING_CLAIMS,
  type QaClaimFixture,
  type QaVerdictFixture,
} from "./content-shadow-claims-fixture.ts";

/**
 * Human review of a Content Shadow revision, and the publishing that does not
 * happen (Slice 2 Task 8).
 *
 * The assertions are about the two things that would be expensive to get wrong:
 *
 * 1. **A review is of a revision.** If an edit lands, four things must move
 *    together — the revision number, the deliverable's status, the human-review
 *    row and the "earlier review no longer applies" banner. One test asserts all
 *    four, so wiring any one of them independently still turns it red.
 * 2. **Nothing is published, and nothing pretends to be.** The six things this
 *    stage must never do are asserted one by one against the running screen and
 *    against the network, rather than trusted to a sentence in the interface.
 */

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const RUN_ID = "00000000-0000-4000-8000-000000000901";
const ASYNC_RUN_ID = "00000000-0000-4000-8000-000000000902";
const DRAFT_ARTIFACT_ID = "00000000-0000-4000-8000-000000000903";
const FINDING_ID = "00000000-0000-4000-8000-000000000904";
const BRIEF_ARTIFACT_ID = "00000000-0000-4000-8000-000000000905";
const KEYWORD_ENTITY_ID = "00000000-0000-4000-8000-000000000907";
const CONTENT_HASH =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const NOW = "2026-07-25T00:00:00.000Z";

const DRAFT_BODY = [
  "# How onboarding analytics reveal activation drop-off",
  "",
  "Activation stalls where the product stops explaining itself.",
  "",
  "## Evidence",
  "",
  "- Internal telemetry shows the same shape.",
].join("\n");

const BRIEF_BODY = [
  "## Objective",
  "",
  "Explain how onboarding analytics expose activation drop-off.",
  "",
  "## Evidence",
  "",
  "Use only records confirmed inside the project.",
].join("\n");

interface Scenario {
  readonly evaluatedRevision: number;
  readonly claims: readonly QaClaimFixture[];
  /** The live deliverable, which an edit moves independently of the run. */
  artifactRevision: number;
  artifactStatus: "draft" | "ready";
  readonly validationState: "valid" | "invalid";
  /** A legacy or incomplete projection may have the draft but no matching run. */
  readonly shadowRunAvailable?: boolean;
  /** When set, the review endpoint refuses with this conflict instead. */
  readonly reviewConflict?: { readonly currentRevision: number };
}

interface Recorded {
  readonly method: string;
  readonly url: string;
}

function draftHistory(scenario: Scenario) {
  return Array.from({ length: scenario.artifactRevision }, (_, index) => {
    const revision = scenario.artifactRevision - index;
    return {
      revision,
      contentHash: `${CONTENT_HASH.slice(0, 56)}${String(revision).padStart(8, "0")}`,
      createdAt: `2026-07-25T00:0${Math.min(revision, 9)}:00.000Z`,
    };
  });
}

function draftArtifact(scenario: Scenario) {
  return {
    id: DRAFT_ARTIFACT_ID,
    actionId: E2E_CANONICAL_ACTION_ID,
    artifactType: "english_blog_draft",
    status: scenario.artifactStatus,
    generationMode: "structured_llm",
    outputLocale: "en",
    currentRevision: scenario.artifactRevision,
    validationState: scenario.validationState,
    current: {
      id: "00000000-0000-4000-8000-000000000910",
      revision: scenario.artifactRevision,
      outputLocale: "en",
      contentFormat: "markdown",
      content: DRAFT_BODY,
      contentHash: CONTENT_HASH,
      validationErrors:
        scenario.validationState === "invalid"
          ? ["missing required section: ## Evidence"]
          : [],
      note: null,
      createdAt: NOW,
    },
    activeRun: null,
    // The server derives this from the same gate the review endpoint reads, so
    // the fixture derives it from the same claims rather than declaring it.
    adoption: expectedAdoption(scenario.claims),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function briefArtifact() {
  return {
    id: BRIEF_ARTIFACT_ID,
    actionId: E2E_CANONICAL_ACTION_ID,
    artifactType: "content_brief",
    status: "ready",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 3,
    validationState: "valid",
    current: {
      id: "00000000-0000-4000-8000-000000000911",
      revision: 3,
      outputLocale: "en",
      contentFormat: "markdown",
      content: BRIEF_BODY,
      contentHash: CONTENT_HASH,
      validationErrors: [],
      note: null,
      createdAt: NOW,
    },
    activeRun: null,
    // No Content Shadow gate ever judges a content_brief. `null` says that,
    // and it is deliberately not the same statement as "adoption is allowed".
    adoption: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function runProjection(scenario: Scenario): ContentShadowRunResponseDto {
  return ContentShadowRunResponse.parse({
    flowShadowRunId: RUN_ID,
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    asyncRunId: ASYNC_RUN_ID,
    status: "completed",
    phase: "complete",
    contentHash: CONTENT_HASH,
    projectionVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
    flowAdapterVersion: CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION,
    outputLocale: "en",
    createdAt: NOW,
    source: {
      findingId: FINDING_ID,
      actionId: E2E_CANONICAL_ACTION_ID,
      contentBriefArtifactId: BRIEF_ARTIFACT_ID,
      contentBriefRevision: 3,
    },
    frozenInputs: {
      primaryFindingId: FINDING_ID,
      sourceDiagnosticRunId: "00000000-0000-4000-8000-000000000906",
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
        briefSections: ["Objective", "Evidence"],
        targetKeywords: ["onboarding analytics", "activation drop-off"],
        pageAssignment: "existing_page",
      },
      researchContext: {
        firstPartyPageSnapshots: [],
        searchKeywordFacts: [
          {
            id: KEYWORD_ENTITY_ID,
            display: "onboarding analytics",
            market: "US",
            language: "en",
            intent: "informational",
            buyerStage: "consideration",
            cluster: "onboarding",
            mapping: {
              decision: "existing_page",
              mappedSitePageId: null,
              reviewState: "confirmed",
              revision: 1,
            },
            lastSeen: NOW,
            evidenceRefs: [],
          },
        ],
        generativeKeywordFacts: [],
        competitorFacts: [],
        externalTargets: [],
        contentPolicy: {
          brandConstraints: [],
          complianceConstraints: [],
          prohibitedTerms: [],
          claimRestrictions: [],
        },
      },
    },
    research: {
      packId: "00000000-0000-4000-8000-000000000908",
      sources: [
        {
          kind: "content_brief",
          ref: BRIEF_ARTIFACT_ID,
          label: "Q3 onboarding brief",
          url: "https://example.test/briefs/onboarding",
          availability: "available",
          authorityTier: "A",
          capturedAt: NOW,
          contentHash: CONTENT_HASH,
          contentHashMethod: "sha256_normalized_text",
          contentTruncated: false,
          excerpt: "Defines the audience and allowed evidence boundaries.",
          excerptTruncated: false,
          metrics: null,
          evidenceRefs: ["brief-revision:3"],
          limitation: "The confirmed content brief revision.",
        },
      ],
      limitations: [
        "This pack carries only first-party frozen project records; no external source was retrieved or graded.",
      ],
      generatedAt: NOW,
    },
    draft: {
      artifactId: DRAFT_ARTIFACT_ID,
      status: scenario.artifactStatus,
      currentRevision: scenario.evaluatedRevision,
      contentText: DRAFT_BODY,
      revisionHistory: draftHistory(scenario).map((entry) => ({
        revision: entry.revision,
        contentHash: entry.contentHash,
        generatedBy: "structured_llm",
        editorId: null,
        note: null,
        validationErrorCount: 0,
        createdAt: entry.createdAt,
      })),
    },
    qa: {
      gateId: "00000000-0000-4000-8000-000000000909",
      verdict: verdictOf(scenario),
      evaluatedArtifactId: DRAFT_ARTIFACT_ID,
      evaluatedRevision: scenario.evaluatedRevision,
      claims: scenario.claims,
      evaluatedAt: NOW,
    },
  });
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** Layer the review fixtures over the shared in-browser API. */
async function openExecution(
  page: Page,
  scenario: Scenario,
): Promise<{ readonly writes: Recorded[] }> {
  await installCriticalFlowApi(page);
  const writes: Recorded[] = [];

  page.on("request", (request) => {
    if (request.method() === "GET") return;
    writes.push({ method: request.method(), url: request.url() });
  });

  await page.route(
    `**${BASE}/content-shadow-runs/${RUN_ID}/review`,
    async (route) => {
      if (scenario.reviewConflict !== undefined) {
        await fulfill(
          route,
          {
            type: "about:blank",
            title: "Stale revision",
            status: 409,
            code: "STALE_REVISION",
            detail:
              "This deliverable has a newer revision; the review was not recorded and nothing changed.",
            requestId: "e2e-request",
            current: {
              currentRevision: scenario.reviewConflict.currentRevision,
            },
          },
          409,
        );
        return;
      }
      // The only write this stage performs: the deliverable becomes reviewed.
      scenario.artifactStatus = "ready";
      await fulfill(route, {
        data: {
          flowShadowRunId: RUN_ID,
          artifactId: DRAFT_ARTIFACT_ID,
          reviewedRevision: scenario.artifactRevision,
          artifactStatus: "ready",
          verdict: verdictOf(scenario),
          claimCounts: claimCounts(scenario.claims),
          contentHash: CONTENT_HASH,
          reviewedAt: "2026-07-25T01:00:00.000Z",
          externalPublishingWrite: "none",
        },
      });
    },
  );

  await page.route(`**${BASE}/content-shadow-runs/${RUN_ID}`, async (route) => {
    await fulfill(route, { data: runProjection(scenario) });
  });

  await page.route(`**${BASE}/content-shadow-runs?**`, async (route) => {
    const projection = runProjection(scenario);
    await fulfill(route, {
      data: [
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
      ].filter(() => scenario.shadowRunAvailable !== false),
      meta: { nextCursor: null, hasNext: false, limit: 100 },
    });
  });

  // Registered least-specific first: Playwright tries the most recently added
  // route first, so the per-artifact handlers must come after the list.
  await page.route(`**${BASE}/artifacts?**`, async (route) => {
    await fulfill(route, {
      data: [draftArtifact(scenario), briefArtifact()],
      meta: { nextCursor: null, hasNext: false, limit: 100 },
    });
  });

  await page.route(
    `**${BASE}/artifacts/${BRIEF_ARTIFACT_ID}**`,
    async (route) => {
      await fulfill(route, { data: briefArtifact() });
    },
  );

  await page.route(
    `**${BASE}/artifacts/${DRAFT_ARTIFACT_ID}**`,
    async (route) => {
      if (route.request().method() !== "PATCH") {
        await fulfill(route, { data: draftArtifact(scenario) });
        return;
      }
      const body = route.request().postDataJSON() as {
        readonly status?: string;
      };
      if (body.status === "ready") {
        scenario.artifactStatus = "ready";
        await fulfill(route, { data: draftArtifact(scenario) });
        return;
      }
      // An edit: a new immutable revision, and the deliverable returns to draft.
      scenario.artifactRevision += 1;
      scenario.artifactStatus = "draft";
      await fulfill(route, { data: draftArtifact(scenario) });
    },
  );

  await page.goto(
    `/p/${E2E_PROJECT_ID}/execution?actionId=${E2E_CANONICAL_ACTION_ID}&artifactId=${DRAFT_ARTIFACT_ID}`,
  );
  if (scenario.validationState === "invalid") {
    await expect(page.locator("[data-content-shadow]")).toHaveCount(0);
    await expect(page.getByLabel("内容", { exact: true })).toBeVisible();
  } else {
    await expect(page.locator("[data-content-shadow]")).toBeVisible();
  }
  await expect(
    page.locator(
      `[data-studio-artifact-id="${DRAFT_ARTIFACT_ID}"][data-studio-artifact-type="english_blog_draft"]`,
    ),
  ).toBeVisible();
  await expect(
    page.locator("[data-content-shadow] [aria-current]"),
  ).toHaveCount(0);
  return { writes };
}

/**
 * A scenario states its CLAIMS; the verdict follows from them.
 *
 * The default used to declare `passed` beside a `failed` coverage claim, which
 * `clampVerdictToFailedClaims` makes unreachable — so the one-click pass path,
 * the receipt and the comparison panel were only ever proven on a state no run
 * can produce. `verdictOf` removes the choice.
 */
function verdictOf(scenario: Scenario): QaVerdictFixture {
  return expectedVerdict(scenario.claims);
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    evaluatedRevision: 1,
    claims: REVIEW_PASSING_CLAIMS,
    artifactRevision: 1,
    artifactStatus: "draft",
    validationState: "valid",
    ...overrides,
  };
}

test("a review names the revision it applies to, in three places", async ({
  page,
}) => {
  await openExecution(page, scenario());

  const doc = page.locator("[data-shadow-doc]");
  await expect(page.locator("[data-content-shadow]")).not.toContainText(
    "SignalFrame",
  );
  await expect(doc.locator("[data-shadow-revision]")).toHaveText(/Revision 1/u);
  await expect(page.locator("[data-qa-verdict-revision]")).toContainText(
    "该结论对应 Revision 1",
  );
  await page.locator("[data-review-pass]").click();
  await expect(page.locator("[data-review-confirm]")).toContainText(
    "你正在评审 Revision 1",
  );
});

test("revision history lists every returned revision with ledger fields and honest badges", async ({
  page,
}) => {
  await openExecution(
    page,
    scenario({ artifactRevision: 3, artifactStatus: "draft" }),
  );

  await page.locator("[data-review-history]").click();
  const items = page.locator("[data-review-history-item]");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("Revision 3");
  await expect(items.nth(0)).toContainText("structured_llm");
  await expect(items.nth(0)).toContainText("0 条校验错误");
  await expect(items.nth(1)).toContainText("Revision 2");
  await expect(items.nth(2)).toContainText("Revision 1");
  await expect(page.locator("[data-review-history-overlay]")).toContainText(
    "生成方式",
  );
  await expect(page.locator("[data-review-history-overlay]")).toContainText(
    "冻结 Hash",
  );
  await expect(page.locator("[data-review-history-overlay]")).toContainText(
    "创建时间",
  );
  await expect(page.locator("[data-review-history-overlay]")).toContainText(
    "版本备注",
  );
});

test("a blocked verdict disables passing and says why, right next to the control", async ({
  page,
}) => {
  await openExecution(
    page,
    scenario({ claims: REVIEW_BLOCKING_CLAIMS }),
  );

  const pass = page.locator("[data-review-pass]");
  await expect(pass).toBeDisabled();
  // Not in a tooltip, not only in the side rail: the reason is a sibling
  // element, and the disabled control points at it.
  const reason = page.locator("[data-review-reason]");
  await expect(reason).toBeVisible();
  await expect(reason).toContainText("无法在冻结记录中核实");
  const describedBy = await pass.getAttribute("aria-describedby");
  expect(describedBy).toBe(await reason.getAttribute("id"));

  // Natively disabled, so a click cannot reach a handler at all.
  await pass.evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.locator("[data-review-confirm]")).toHaveCount(0);

  // Every row of the blocker list states a STATE, because the labels do not.
  // `sc9b` is phrased as the property when it is satisfied — "列出的来源与冻结
  // 记录一致" — so listing it bare under "当前不能通过评审" put a sentence that
  // reads like a pass among the reasons the draft is held back.
  const blocker = page.locator("[data-qa-blocker]");
  await expect(blocker).toContainText("当前不能通过评审");
  const rows = blocker.locator("[data-qa-blocker-claim]");
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await expect(row).toContainText("未通过");
  }
  await expect(
    blocker.getByText("列出的来源与冻结记录一致 · 未通过"),
  ).toHaveCount(1);
});

test("the unified English-draft review refuses a blocked draft before any write", async ({
  page,
}) => {
  const { writes } = await openExecution(
    page,
    scenario({ claims: REVIEW_BLOCKING_CLAIMS }),
  );

  // English drafts have one canonical readiness decision in the unified
  // Content Shadow surface. The generic artifact editor/status door must not
  // be duplicated beside it.
  const pass = page.locator("[data-review-pass]");
  await expect(pass).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "标记为就绪", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("[data-studio-ready-blocked]:visible"),
  ).toHaveCount(0);

  // Natively disabled: a forced click reaches no handler, so nothing is
  // written and the operator never learns the refusal from a response.
  const before = writes.length;
  await pass.evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.locator("[data-review-confirm]")).toHaveCount(0);
  expect(writes.length).toBe(before);
});

test("the unified English-draft review opens when the gate does not block", async ({
  page,
}) => {
  await openExecution(page, scenario());

  await expect(page.locator("[data-review-pass]")).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "标记为就绪", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("[data-studio-ready-blocked]:visible"),
  ).toHaveCount(0);

  const shadow = page.locator("[data-content-shadow]");
  const reviewTab = shadow.getByRole("tab", {
    name: "审阅文档",
    exact: true,
  });
  const editTab = shadow.getByRole("tab", {
    name: "编辑 Markdown",
    exact: true,
  });
  await editTab.click();
  const content = page.getByLabel("内容", { exact: true });
  await expect(content).toBeVisible();
  await expect(
    page.getByRole("button", { name: "标记为就绪", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("[aria-labelledby^='sf-markdown-']"),
  ).toHaveCount(0);

  await content.fill(`${DRAFT_BODY}\n\nUnsaved keyboard guard.`);
  await editTab.focus();
  await editTab.press("ArrowLeft");
  await expect(editTab).toHaveAttribute("aria-selected", "true");
  await expect(reviewTab).toBeDisabled();
  await expect(content).toBeVisible();
});

test("a valid English draft without a matching Shadow run keeps the generic ready path", async ({
  page,
}) => {
  const { writes } = await openExecution(
    page,
    scenario({ shadowRunAvailable: false }),
  );

  const ready = page.getByRole("button", {
    name: "标记为就绪",
    exact: true,
  });
  await expect(ready).toBeVisible();
  await expect(ready).toBeEnabled();

  const readyRequest = page.waitForRequest((request) => {
    if (
      request.method() !== "PATCH" ||
      new URL(request.url()).pathname !==
        `${BASE}/artifacts/${DRAFT_ARTIFACT_ID}`
    ) {
      return false;
    }
    return (
      request.postDataJSON() as { readonly status?: string } | null
    )?.status === "ready";
  });
  await ready.click();
  expect((await readyRequest).postDataJSON()).toEqual({
    baseRevision: 1,
    status: "ready",
  });
  await expect(page.locator("[data-studio-ready-path]")).toBeVisible();
  await expect(ready).toHaveCount(0);
  expect(
    writes.filter(
      (write) =>
        write.method === "PATCH" &&
        new URL(write.url).pathname ===
          `${BASE}/artifacts/${DRAFT_ARTIFACT_ID}`,
    ),
  ).toHaveLength(1);
});

test("an invalid English draft opens the Markdown repair editor without waiting for review detail", async ({
  page,
}) => {
  await openExecution(page, scenario({ validationState: "invalid" }));

  await expect(page.getByLabel("内容", { exact: true })).toBeVisible();
  await expect(page.getByText("校验错误", { exact: true })).toBeVisible();
  await expect(page.getByText("加载中", { exact: true })).toHaveCount(0);
});

test("a verdict for an older revision is marked stale and refuses to carry a review", async ({
  page,
}) => {
  await openExecution(
    page,
    scenario({ evaluatedRevision: 1, artifactRevision: 2 }),
  );

  await expect(page.locator("[data-qa-rail]")).toContainText("结论已过期");
  const pass = page.locator("[data-review-pass]");
  await expect(pass).toBeDisabled();
  await expect(page.locator("[data-review-reason]")).toContainText(
    "还没有跑过自动检查",
  );

  // The comparison shows the revision this run FROZE, labelled as that
  // revision. It used to carry the live number over the frozen bytes, so a
  // reviewer read revision 1 under the heading "Revision 2".
  await page.locator("[data-view-switch='compare']").click();
  const draftPane = page.locator("[data-compare-draft]");
  await expect(draftPane).toContainText("English draft · Revision 1");
  await expect(draftPane).not.toContainText("English draft · Revision 2");
  // And it says the deliverable has moved on, rather than leaving the reader to
  // notice the two numbers disagree.
  await expect(
    draftPane.locator("[data-compare-draft-frozen]"),
  ).toContainText("Revision 2");
});

test("passing a needs_review verdict requires the reviewer to say they read the findings", async ({
  page,
}) => {
  await openExecution(page, scenario({ claims: REVIEW_COVERAGE_GAP_CLAIMS }));

  await page.locator("[data-review-pass]").click();
  const checkbox = page.locator("[data-review-acknowledge]");
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toHaveAttribute("required", "");

  // Submitting without it is stopped by the form, and no receipt appears.
  await page
    .getByRole("button", { name: "通过评审", exact: true })
    .last()
    .click();
  await expect(page.locator("[data-review-receipt]")).toHaveCount(0);
});

test("a recorded review produces a receipt whose table states that nothing was published", async ({
  page,
}) => {
  const { writes } = await openExecution(page, scenario());

  await page.locator("[data-review-pass]").click();
  await page
    .locator("[data-review-confirm]")
    .getByRole("button", { name: "通过评审", exact: true })
    .click();

  const receipt = page.locator("[data-review-receipt]");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("已标记为已评审");
  // The negative as a row of the table, straight off the wire.
  await expect(receipt.locator("[data-receipt-external-write]")).toContainText(
    "未发生",
  );

  // Exactly one write left the browser, and it was the review.
  const apiWrites = writes.filter((write) => write.url.includes("/api/mvp/"));
  expect(apiWrites).toHaveLength(1);
  expect(apiWrites[0]?.method).toBe("POST");
  expect(apiWrites[0]?.url).toContain(`/content-shadow-runs/${RUN_ID}/review`);

  // No success toast. The receipt is the entire feedback this screen gives.
  const shadow = page.locator("[data-content-shadow]");
  await expect(shadow.locator("[role='alert']")).toHaveCount(0);
  await expect(shadow.locator("[role='status']")).toHaveCount(0);
});

test("a 409 is shown as a refusal that changed nothing, never retried against the newer text", async ({
  page,
}) => {
  const { writes } = await openExecution(
    page,
    scenario({ reviewConflict: { currentRevision: 2 } }),
  );

  await page.locator("[data-review-pass]").click();
  await page
    .locator("[data-review-confirm]")
    .getByRole("button", { name: "通过评审", exact: true })
    .click();

  const blocked = page.locator("[data-review-blocked-receipt]");
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText("已经产生了新的 Revision");
  await expect(blocked.locator("[data-receipt-changes-made]")).toContainText(
    "无",
  );
  // No success receipt hiding under it, and no silent replay against revision 2.
  await expect(page.locator("[data-review-receipt]")).toHaveCount(0);
  const apiWrites = writes.filter((write) => write.url.includes("/api/mvp/"));
  expect(apiWrites).toHaveLength(1);
  // The deliverable's status on screen is untouched.
  await expect(page.locator("[data-shadow-status='draft']")).toBeVisible();
});

test("an edit invalidates the earlier review: four things move together", async ({
  page,
}) => {
  const live = scenario();
  const { writes } = await openExecution(page, live);

  // Start from a reviewed revision 1.
  await page.locator("[data-review-pass]").click();
  await page
    .locator("[data-review-confirm]")
    .getByRole("button", { name: "通过评审", exact: true })
    .click();
  await expect(page.locator("[data-review-receipt]")).toBeVisible();
  await page.getByRole("button", { name: "完成", exact: true }).click();

  const doc = page.locator("[data-shadow-doc]");
  await expect(doc.locator("[data-shadow-revision]")).toHaveText(/Revision 1/u);
  await expect(page.locator("[data-shadow-status='ready']")).toBeVisible();
  await expect(page.locator("[data-qa-human-review='passed']")).toBeVisible();
  await expect(page.locator("[data-review-stale]")).toHaveCount(0);

  // Edit the same deliverable through the unified workbench. The outer tab
  // reveals the canonical Artifact editor, whose save appends revision 2.
  const shadow = page.locator("[data-content-shadow]");
  await shadow
    .getByRole("tab", { name: "编辑 Markdown", exact: true })
    .click();
  const content = page.getByLabel("内容", { exact: true });
  await expect(content).toBeVisible();
  await content.fill(`${DRAFT_BODY}\n\nA reviewer changed the body.`);

  const patchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname ===
        `${BASE}/artifacts/${DRAFT_ARTIFACT_ID}`,
  );
  await page
    .getByRole("button", { name: "保存版本", exact: true })
    .click();
  expect((await patchResponse).status()).toBe(200);
  await expect
    .poll(
      () =>
        writes.filter(
          (write) =>
            write.method === "PATCH" &&
            new URL(write.url).pathname ===
              `${BASE}/artifacts/${DRAFT_ARTIFACT_ID}`,
        ).length,
    )
    .toBe(1);

  // A refresh re-enters the review surface from canonical server projections.
  await page.reload();
  await expect(page.locator("[data-content-shadow]")).toBeVisible();

  // ALL FOUR, in one assertion block. Wiring any one of them on its own — the
  // revision number, the status, the human-review row, the banner — still
  // leaves this red, which is the point: a review that survives an edit is a
  // review of text nobody read.
  await expect
    .poll(
      async () => {
        const revision = await doc
          .locator("[data-shadow-revision]")
          .textContent();
        return {
          revision: (revision ?? "").trim(),
          status: await page.locator("[data-shadow-status='draft']").count(),
          humanReview: await page
            .locator("[data-qa-human-review='awaiting']")
            .count(),
          staleBanner: await page.locator("[data-review-stale]").count(),
        };
      },
      { timeout: 15_000 },
    )
    .toEqual({
      revision: "Revision 2",
      status: 1,
      humanReview: 1,
      staleBanner: 1,
    });
});

test("side by side reads the frozen brief against the draft, and never tints the draft green", async ({
  page,
}) => {
  // A coverage gap is what makes this pane worth reading, and `needs_review` is
  // the state the gate actually returns for one.
  await openExecution(page, scenario({ claims: REVIEW_COVERAGE_GAP_CLAIMS }));

  await page.locator("[data-view-switch='compare']").click();
  const compare = page.locator("[data-compare]");
  await expect(compare).toBeVisible();

  const brief = page.locator("[data-compare-brief]");
  await expect(brief).toContainText("冻结版");
  await expect(brief).toContainText("Explain how onboarding analytics");
  // The gate named exactly one uncovered topic; only that row is marked.
  await expect(brief.getByText("草稿未覆盖")).toHaveCount(1);

  const draft = page.locator("[data-compare-draft]");
  await expect(draft).toContainText("Activation stalls where the product");
  // Green means passed in this product. An unreviewed draft is not green.
  const draftBackground = await draft.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const mint = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--sf-mint-soft")
      .trim(),
  );
  expect(mint.length).toBeGreaterThan(0);
  expect(draftBackground).not.toBe(mint);

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

/**
 * The whole comparison reachable without a mouse.
 *
 * The switch is a `tablist` with roving `tabIndex`, so the unselected tab is
 * deliberately out of the Tab sequence — and there was no key handler, which
 * meant the unselected tab was reachable by NO key. The entire brief-versus-
 * draft feature had no keyboard path into it.
 */
test("the view switch is operable from the keyboard, in both directions", async ({
  page,
}) => {
  await openExecution(page, scenario({ claims: REVIEW_COVERAGE_GAP_CLAIMS }));

  const draftTab = page.locator("[data-view-switch='draft']");
  const compareTab = page.locator("[data-view-switch='compare']");
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  // Roving tabIndex: only the selected tab is in the Tab sequence, which is why
  // the arrow keys have to work.
  await expect(compareTab).toHaveAttribute("tabindex", "-1");

  await draftTab.focus();
  await draftTab.press("ArrowRight");
  await expect(page.locator("[data-compare]")).toBeVisible();
  await expect(compareTab).toHaveAttribute("aria-selected", "true");
  // Focus followed the selection, or the next arrow press starts from the tab
  // the reader has already left.
  await expect(compareTab).toBeFocused();

  await compareTab.press("ArrowLeft");
  await expect(page.locator("[data-shadow-body]")).toBeVisible();
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await expect(draftTab).toBeFocused();

  // Home/End land on the ends rather than wrapping past them.
  await draftTab.press("End");
  await expect(compareTab).toHaveAttribute("aria-selected", "true");
  await compareTab.press("Home");
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
});

test("publishing is present, permanently unavailable, and does nothing at all", async ({
  page,
}) => {
  const { writes } = await openExecution(page, scenario());

  const block = page.locator("[data-publish-block]");
  const button = page.locator("[data-publish-button]");

  // 1. The limit is in the label, so it is known before anyone reaches for it.
  await expect(button).toContainText("本阶段不可用");
  await expect(button).toBeDisabled();
  const describedBy = await button.getAttribute("aria-describedby");
  expect(describedBy).toBe("sf-publish-note");
  await expect(page.locator("#sf-publish-note")).toContainText(
    "不连接任何内容管理系统、Git 或第三方发布目标",
  );

  // 2. Natively disabled: not focusable, so there is no keyboard path either.
  const focused = await button.evaluate((element: HTMLButtonElement) => {
    element.focus();
    return document.activeElement === element;
  });
  expect(focused).toBe(false);

  // 3. Clicking is a no-op: no request, no overlay, no state.
  const before = writes.length;
  await button.evaluate((element: HTMLButtonElement) => element.click());
  await page.waitForTimeout(300);
  expect(writes.length).toBe(before);
  await expect(page.locator("[data-review-receipt]")).toHaveCount(0);
  await expect(
    page.locator("[data-content-shadow] [role='alert']"),
  ).toHaveCount(0);

  // 4. No URL is minted — not even an unresolvable one to look convincing.
  await expect(block.locator("a")).toHaveCount(0);

  // 5. The deliverable is never described as published, in any state word.
  const screen = await page.locator("[data-content-shadow]").innerText();
  expect(screen).not.toContain("已发布");
  expect(screen).not.toContain("已上线");
  expect(screen).not.toContain("published");

  // 6. And the state word it does use carries the limit itself.
  await expect(page.locator("[data-shadow-status='draft']")).toBeVisible();
});
