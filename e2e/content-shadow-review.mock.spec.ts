import { expect, test, type Page, type Route } from "@playwright/test";
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
  /** When set, the review endpoint refuses with this conflict instead. */
  readonly reviewConflict?: { readonly currentRevision: number };
}

interface Recorded {
  readonly method: string;
  readonly url: string;
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
    validationState: "valid",
    current: {
      id: "00000000-0000-4000-8000-000000000910",
      revision: scenario.artifactRevision,
      outputLocale: "en",
      contentFormat: "markdown",
      content: DRAFT_BODY,
      contentHash: CONTENT_HASH,
      validationErrors: [],
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

function runProjection(scenario: Scenario) {
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
        keywordEntityIds: ["00000000-0000-4000-8000-000000000907"],
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
    },
    research: {
      packId: "00000000-0000-4000-8000-000000000908",
      sources: [
        {
          kind: "content_brief",
          ref: BRIEF_ARTIFACT_ID,
          authorityTier: "A",
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
    },
    qa: {
      gateId: "00000000-0000-4000-8000-000000000909",
      verdict: verdictOf(scenario),
      evaluatedArtifactId: DRAFT_ARTIFACT_ID,
      evaluatedRevision: scenario.evaluatedRevision,
      claims: scenario.claims,
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

/**
 * Resolve a CSS colour expression the way the page would, so a design token and
 * a computed style can be compared as the same bytes. Comparing a computed
 * `rgb(...)` against a raw token value can only ever be "not equal", which
 * makes a colour assertion pass without checking anything.
 */
async function resolveColor(page: Page, expression: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, expression);
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
      ],
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
      // An edit: a new immutable revision, and the deliverable returns to draft.
      scenario.artifactRevision += 1;
      scenario.artifactStatus = "draft";
      await fulfill(route, { data: draftArtifact(scenario) });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/execution`);
  await expect(page.locator("[data-content-shadow]")).toBeVisible();
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

/**
 * The OTHER door into `ready`, and the reason this test exists at all.
 *
 * The server already refuses a blocked draft through the generic artifact
 * status PATCH — that was the correctness fix. What it did not do was tell the
 * control: the artifacts list carried no verdict, so the Studio editor rendered
 * an enabled "Mark ready" and an operator discovered the refusal by being
 * refused. The list now carries the server's own answer, and this test asserts
 * the two doors reach the SAME conclusion about the same deliverable rather
 * than asserting each one separately — separate assertions stay green while the
 * two answers drift apart, which is the failure worth catching.
 */
test("both doors into ready refuse the same blocked draft, and both say so before they are used", async ({
  page,
}) => {
  const { writes } = await openExecution(
    page,
    scenario({ claims: REVIEW_BLOCKING_CLAIMS }),
  );

  // Door one: the review control on the reading surface.
  const pass = page.locator("[data-review-pass]");
  await expect(pass).toBeDisabled();

  // Door two: the workspace editor's own status control, one screen below.
  await page
    .locator(`[data-studio-artifact-id="${DRAFT_ARTIFACT_ID}"]`)
    .getByRole("button", { name: "打开", exact: true })
    .click();
  const editor = page.locator("[data-studio-editor]");
  const markReady = editor.getByRole("button", {
    name: "标记为就绪",
    exact: true,
  });
  await expect(markReady).toBeDisabled();

  // The reason is a sibling element the control points at — never a tooltip,
  // and never only in the rail above.
  const reason = editor.locator("[data-studio-ready-blocked]");
  await expect(reason).toBeVisible();
  expect(await markReady.getAttribute("aria-describedby")).toBe(
    await reason.getAttribute("id"),
  );
  expect(await markReady.getAttribute("title")).toBeNull();

  // It is the Execution blocked block's OWN sentence, not a paraphrase of it:
  // "cannot be verified here", and explicitly not a run failure.
  await expect(reason).toContainText("无法在本轮冻结的研究记录中核实");
  await expect(reason).toContainText("这不是运行失败");
  await expect(reason).toContainText("下一步：");
  const reasonText = (await reason.innerText()).trim();
  expect(reasonText).not.toContain("错误");
  expect(reasonText).not.toContain("重试");

  // Both causes are named, and each carries the state word, because a claim
  // label names a PROPERTY: `sc9b` reads as the property when SATISFIED, so a
  // bare label would sit under the refusal reading like a pass.
  const causes = reason.locator("[data-studio-ready-blocked-cause]");
  await expect(causes).toHaveCount(2);
  await expect(causes.filter({ hasText: "断言缺少可核实出处" })).toHaveCount(1);
  await expect(
    causes.filter({ hasText: "列出的来源与冻结记录一致 · 未通过" }),
  ).toHaveCount(1);

  // Never the danger family. A `blocked` verdict is the gate working, and the
  // Task 7/8 ruling is that it is never painted red wherever it is stated.
  const coralText = await resolveColor(page, "var(--sf-coral-text)");
  const mutedText = await resolveColor(page, "var(--sf-muted)");
  // Guard the comparison: if the two tokens resolved alike, "is not coral"
  // would pass for free.
  expect(mutedText).not.toBe(coralText);
  const painted = await reason.evaluate(
    (element) => getComputedStyle(element).color,
  );
  expect(painted).not.toBe(coralText);
  expect(painted).toBe(mutedText);

  // Natively disabled: a forced click reaches no handler, so nothing is
  // written and the operator never learns the refusal from a response.
  const before = writes.length;
  await markReady.evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.locator("[data-review-confirm]")).toHaveCount(0);
  expect(writes.length).toBe(before);
});

/**
 * The other side of the same judgement.
 *
 * A control that disabled itself on every draft would satisfy the test above
 * and take away a path the server would have accepted. Both doors have to open
 * on a deliverable the gate did not block, and they are asserted together for
 * the same reason they are asserted together above.
 */
test("both doors open on a draft the gate did not block", async ({ page }) => {
  await openExecution(page, scenario());

  await expect(page.locator("[data-review-pass]")).toBeEnabled();

  await page
    .locator(`[data-studio-artifact-id="${DRAFT_ARTIFACT_ID}"]`)
    .getByRole("button", { name: "打开", exact: true })
    .click();
  const editor = page.locator("[data-studio-editor]");
  await expect(
    editor.getByRole("button", { name: "标记为就绪", exact: true }),
  ).toBeEnabled();
  await expect(editor.locator("[data-studio-ready-blocked]")).toHaveCount(0);
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
  await openExecution(page, live);

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

  // Now an edit lands, through the product's own edit path: the workspace
  // editor below appends a new immutable revision on the same deliverable.
  await page
    .locator(`[data-studio-artifact-id="${DRAFT_ARTIFACT_ID}"]`)
    .getByRole("button", { name: "打开", exact: true })
    .click();
  const editor = page.locator("[data-studio-editor]");
  await editor
    .locator("#sf-artifact-content")
    .fill("# Edited\n\nA reviewer changed the body.");
  await editor.getByRole("button", { name: "保存版本", exact: true }).click();

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
