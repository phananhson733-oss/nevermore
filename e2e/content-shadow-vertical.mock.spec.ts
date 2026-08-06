import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  E2E_CANONICAL_FINDING_ID,
  E2E_CONTENT_EVIDENCE_ID,
  E2E_CONTENT_FINDING_ID,
  E2E_CTR_FINDING_ID,
  E2E_ONBOARDING_URL,
  E2E_PROJECT_ID,
} from "./mock-api.ts";
import {
  apiWrites,
  BASE,
  BRIEF_ARTIFACT_ID,
  BRIEF_REVISION,
  CONTENT_ACTION_TITLE,
  CONTENT_HASH,
  DRAFT_ARTIFACT_ID,
  installContentVerticalApi,
  NAV_LABEL,
  opportunityReviewPanel,
  OVERVIEW_URL,
  RUN_ID,
  type ContentVerticalState,
} from "./content-shadow-vertical-fixture.ts";

/**
 * Slice 2 Task 9 — the content vertical, end to end, in one walk.
 *
 *   URL + ICP → createGrowthAuditRun
 *   → Growth Map / Opportunity Review: ONE measured content Finding
 *   → ONE Action
 *   → ONE content_brief
 *   → Flow Shadow research / draft / QA
 *   → side-by-side human review
 *   → a reviewed Revision
 *   with NO external write at any point in the chain.
 *
 * Two things about how this file is written, because they are the difference
 * between proving the chain and merely walking it:
 *
 * 1. **Every link carries its own assertion.** A segment that only navigates
 *    proves nothing; if a link were cut, a walk-only test still goes green
 *    because the next screen is reachable by URL. So each step below asserts the
 *    identity it received from the previous one — the same Finding id reaches
 *    the Action, the same Action id reaches the brief, the same brief id and
 *    revision reach the frozen run, and the run's own review names the revision
 *    the reviewer read.
 *
 * 2. **"Nothing was published" is asserted continuously, not once at the end.**
 *    Every non-GET request that leaves the browser is recorded, and the exact
 *    set is asserted after EACH segment — so a write introduced anywhere in the
 *    middle of the chain fails at the segment that made it, not silently nets
 *    out later. Every request of any method is also checked to have stayed on
 *    the app's own origin, which is what "no CMS, Git or third-party target"
 *    means at the network layer rather than in a sentence on screen.
 *
 * Scope, stated honestly: this is a mock-API E2E. It proves what the product's
 * SURFACES do with the contracts — that one confirmation yields one Action and
 * one brief on screen, and that the browser performs exactly three writes. The
 * transaction-level guarantee (`countActionsForFinding === 1`, replay
 * idempotence) is proven separately and against a real database by
 * `apps/web/src/lib/services/__tests__/content-opportunity-vertical.integration.test.ts`.
 */

function projectNav(page: Page): Locator {
  return page.getByRole("navigation", { name: NAV_LABEL });
}

function navLink(page: Page, index: number): Locator {
  return projectNav(page).getByRole("link").nth(index);
}

let api: ContentVerticalState;

test.beforeEach(async ({ page }) => {
  // DEFAULT_LOCALE is zh-CN; the English assertions below only hold with this
  // cookie set, which is exactly what studio-first-paint/studio-workspace miss.
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
  api = await installContentVerticalApi(page);
});

test("proves the content vertical from URL + ICP to a reviewed revision, publishing nothing", async ({
  page,
  baseURL,
}) => {
  // ================= 1. URL + ICP ==========================================
  await page.goto(OVERVIEW_URL);

  const navLinks = projectNav(page).getByRole("link");
  await expect(navLinks).toHaveCount(4);
  await expect(navLinks.nth(2)).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/execution`,
  );

  const runAudit = page.getByRole("button", { name: "Run growth audit" });
  await expect(runAudit).toBeVisible();
  await runAudit.click();
  await expect.poll(() => api.growth.auditRunRequests.length).toBe(1);
  // The audit is scoped to the confirmed site identity, not an ad-hoc URL.
  expect(api.growth.auditRunRequests[0]).toMatchObject({
    scope: { kind: "site" },
    capabilityContractVersion: "growth-audit.0.3.0",
  });
  expect(apiWrites(api)).toEqual([`POST ${BASE}/audit-runs`]);

  // ================= 2. ONE measured content Finding =======================
  await navLink(page, 1).click();
  await expect(page.locator("[data-growth-map-page]")).toBeVisible();
  await page
    .getByRole("button")
    .filter({ hasText: "/customer-onboarding" })
    .first()
    .click();
  await page.locator('[data-detail-state="opportunity-review"]').click();

  const review = page.locator(opportunityReviewPanel);
  await expect(review).toBeVisible();
  // Three separately reviewable Findings share one target; exactly one of them
  // is the measured content Finding this vertical follows.
  await expect(review.locator("[data-finding-card]")).toHaveCount(3);
  const contentCard = review.locator(
    `[data-finding-card="${E2E_CONTENT_FINDING_ID}"]`,
  );
  await expect(contentCard.getByText("CONTENT-COVERAGE-001")).toBeVisible();
  await expect(
    contentCard.locator(`code[title="${E2E_ONBOARDING_URL}"]`),
  ).toHaveCount(1);
  await expect(
    contentCard.locator(`code[title="${E2E_CONTENT_EVIDENCE_ID}"]`),
  ).toHaveCount(1);

  await review
    .locator(`[data-finding-review="${E2E_CONTENT_FINDING_ID}"]`)
    .getByRole("button", { name: "Confirm" })
    .click();

  await expect.poll(() => api.growth.findingReviewRequests.length).toBe(1);
  expect(api.growth.findingReviewRequests[0]?.findingId).toBe(
    E2E_CONTENT_FINDING_ID,
  );
  await expect(
    contentCard.getByText("Confirmed", { exact: true }),
  ).toBeVisible();
  // The two siblings on the same URL are untouched: confirming one measured
  // Finding is not confirming an opportunity theme.
  expect(api.growth.confirmedFindingIds.has(E2E_CANONICAL_FINDING_ID)).toBe(
    false,
  );
  expect(api.growth.confirmedFindingIds.has(E2E_CTR_FINDING_ID)).toBe(false);
  expect(apiWrites(api)).toEqual([
    `POST ${BASE}/audit-runs`,
    `PATCH ${BASE}/findings/${E2E_CONTENT_FINDING_ID}`,
  ]);

  // ================= 3. ONE Action ==========================================
  // Read out of the confirmation RESPONSE, not out of a flag the fixture set
  // beside it: `contentActionsCreated` is parsed from the body the route
  // returned, so a `reviewProjectFinding` that minted two Actions for one
  // Finding lands here as two.
  expect(api.contentActionsCreated).toHaveLength(1);
  const contentAction = api.contentActionsCreated[0];
  expect(contentAction?.findingId).toBe(E2E_CONTENT_FINDING_ID);
  // It is a real Action object, with the identity the next segment consumes —
  // not a bare marker that a confirmation happened.
  expect(contentAction?.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
  );
  expect(contentAction?.title).toBe(CONTENT_ACTION_TITLE);

  // ================= 4. ONE content_brief ===================================
  await navLink(page, 2).click();
  // Re-aimed for the unified queue, not loosened. The queue is one list ordered
  // by type rather than a stack of per-type `<section>`s, so the region this
  // used to scope to is gone. "Exactly one content_brief" is now counted across
  // the whole queue instead of inside one section of it — strictly stronger,
  // because a second brief outside that section used to be invisible here.
  const studioQueue = page.locator("[data-studio-queue]");
  const briefRows = studioQueue.locator(
    '[data-studio-artifact-id][data-studio-artifact-type="content_brief"]',
  );
  await expect(briefRows).toHaveCount(1);
  await expect(
    studioQueue.locator(`[data-studio-artifact-id="${BRIEF_ARTIFACT_ID}"]`),
  ).toHaveCount(1);
  // The single brief belongs to the single Action created above — asserted
  // against THAT Action's own title as the response carried it, so the link is
  // checked rather than two constants being compared to each other.
  await expect(
    briefRows.getByText(contentAction!.title, { exact: true }),
  ).toBeVisible();

  // ================= 5. Flow Shadow research / draft / QA ===================
  // Content Shadow is no longer a second queue. Selecting the English draft
  // from the one deliverable queue opens that draft's QA/review surface in the
  // same workbench.
  const draftRow = studioQueue.locator(
    `[data-studio-artifact-id="${DRAFT_ARTIFACT_ID}"][data-studio-artifact-type="english_blog_draft"]`,
  );
  await expect(draftRow).toHaveCount(1);
  await draftRow.getByRole("button", { name: "Open", exact: true }).click();

  const shadow = page.locator("[data-content-shadow]");
  await expect(shadow).toBeVisible();
  await expect(shadow.locator("[aria-current]")).toHaveCount(0);
  await expect(shadow.locator("[data-shadow-doc]")).toBeVisible();

  const rail = page.locator("[data-qa-rail]");

  // 5a. RESEARCH: the frozen records are counted, and the limitation that makes
  //     them frozen is printed rather than implied.
  await expect(rail).toContainText("Frozen records");
  await expect(rail).toContainText(
    "0 page source(s) can support an external claim",
  );
  await expect(rail).toContainText(
    "3 additional identity or metric records remain traceable",
  );
  await expect(rail).not.toContainText("SignalFrame");
  await expect(rail).not.toContainText(
    "no external source was retrieved or graded",
  );
  const limitationDisclosure = rail.getByRole("button", {
    name: "Full limitation (1)",
  });
  await expect(limitationDisclosure).toBeVisible();
  await limitationDisclosure.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "no external source was retrieved or graded",
  );
  await expect(rail).toContainText(CONTENT_HASH.slice(0, 12));

  // 5b. DRAFT: the deliverable's own body, not a field table about it.
  const body = page.locator("[data-shadow-body]");
  await expect(body).toBeVisible();
  await expect(
    body.getByText(/Activation stalls where the product stops explaining/),
  ).toBeVisible();
  await expect(page.locator("[data-shadow-revision]")).toHaveText(
    /Revision 1/u,
  );
  await expect(page.locator("[data-shadow-status='draft']")).toBeVisible();

  // 5c. QA: a three-way tally that rounds nothing up, bound to a revision.
  await expect(rail).toContainText("5 checks in this run");
  const counts = await rail.innerText();
  expect(counts).toMatch(/Passed\s*3/u);
  expect(counts).toMatch(/Not passed\s*1/u);
  expect(counts).toMatch(/Not judged\s*1/u);
  await expect(page.locator("[data-qa-verdict-revision]")).toContainText(
    "This conclusion covers revision 1.",
  );
  await expect(rail).toContainText("Needs human review");
  // The unjudged claim is reported as unjudged at the group head — "Passed ·
  // 1 not judged", never folded into the pass — and the reason a reviewer needs
  // is one click away, in the claim's own words.
  const redLines = rail.getByRole("button", { name: /Factual red lines/u });
  await expect(redLines).toContainText("Passed · 1 not judged");
  await redLines.click();
  await expect(rail).toContainText(
    "This name may be a product, a feature or a section title",
  );
  // Reading the run wrote nothing.
  expect(apiWrites(api)).toHaveLength(2);

  // ================= 6. Side-by-side human review ===========================
  await page.locator("[data-view-switch='compare']").click();
  const compare = page.locator("[data-compare]");
  await expect(compare).toBeVisible();

  const briefPane = page.locator("[data-compare-brief]");
  await expect(briefPane).toContainText(
    `Content brief · revision ${BRIEF_REVISION} (frozen)`,
  );
  await expect(briefPane).toContainText(
    "Explain how onboarding analytics expose activation drop-off",
  );
  // The pane read the revision the run FROZE, not the brief's current text.
  await expect
    .poll(() => api.revisionReads.filter((r) => r.revision !== null))
    .toContainEqual({
      artifactId: BRIEF_ARTIFACT_ID,
      revision: String(BRIEF_REVISION),
    });
  // The gate named exactly one uncovered committed topic; only that row is
  // marked, and the marking is a quotation of the gate rather than a re-run.
  await expect(briefPane.getByText("Not covered in draft")).toHaveCount(1);

  const draftPane = page.locator("[data-compare-draft]");
  await expect(draftPane).toContainText("English draft · revision 1");
  await expect(draftPane).toContainText(
    "Activation stalls where the product stops explaining",
  );
  expect(apiWrites(api)).toHaveLength(2);

  // ================= 7. A reviewed Revision =================================
  const pass = page.locator("[data-review-pass]");
  await expect(pass).toBeEnabled();
  await pass.click();

  const confirm = page.locator("[data-review-confirm]");
  await expect(confirm).toContainText("You are reviewing revision 1.");
  await expect(confirm).toContainText(CONTENT_ACTION_TITLE);
  // `needs_review` cannot pass on one click: the reviewer states they read the
  // findings the gate could not settle.
  const acknowledge = page.locator("[data-review-acknowledge]");
  await expect(acknowledge).toBeVisible();
  await expect(acknowledge).toHaveAttribute("required", "");
  await acknowledge.check();
  await confirm
    .getByRole("button", { name: "Pass review", exact: true })
    .click();

  const receipt = page.locator("[data-review-receipt]");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("Revision 1 is marked reviewed.");
  await expect(receipt).toContainText(CONTENT_ACTION_TITLE);
  // The receipt's claim about the outside world is a table row off the wire.
  await expect(receipt.locator("[data-receipt-external-write]")).toContainText(
    "None",
  );
  expect(api.reviewRequests).toEqual([
    { baseRevision: 1, acknowledgeFindings: true },
  ]);

  await page.getByRole("button", { name: "Done", exact: true }).click();
  // The deliverable's own state moved, and it says what `ready` means here.
  await expect(page.locator("[data-shadow-status='ready']")).toBeVisible();
  await expect(page.locator("[data-shadow-status='ready']")).toHaveText(
    "Reviewed · not published",
  );
  await expect(page.locator("[data-qa-human-review='passed']")).toBeVisible();

  // ================= 8. Nothing was published, anywhere =====================
  // 8a. The exact write set of the whole chain: three, and all three are the
  //     product's own endpoints.
  expect(apiWrites(api)).toEqual([
    `POST ${BASE}/audit-runs`,
    `PATCH ${BASE}/findings/${E2E_CONTENT_FINDING_ID}`,
    `POST ${BASE}/content-shadow-runs/${RUN_ID}/review`,
  ]);
  // 8b. No export bundle was requested at any point in the vertical.
  expect(api.growth.critical.exportRequests).toEqual([]);
  // 8c. Not one request of any method left the app's own origin. This is what
  //     "connects to no CMS, Git or third-party publishing target" means at the
  //     network layer, rather than as a sentence on a screen.
  const appOrigin = new URL(baseURL ?? "http://localhost").origin;
  expect([...new Set(api.origins)]).toEqual([appOrigin]);

  // 8d. The publish control is present, natively disabled, and inert: clicking
  //     it through the DOM adds no request and mints no URL.
  const publish = page.locator("[data-publish-button]");
  await expect(publish).toContainText("unavailable at this stage");
  await expect(publish).toBeDisabled();
  const writesBefore = api.writes.length;
  await publish.evaluate((element: HTMLButtonElement) => element.click());
  await page.waitForTimeout(300);
  expect(api.writes.length).toBe(writesBefore);
  await expect(page.locator("[data-publish-block] a")).toHaveCount(0);

  // 8e. No state on this screen ever claims publication. The deliverable's
  //     lifecycle words are exactly the two this stage can reach.
  const statusWords = await page
    .locator("[data-shadow-status]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-shadow-status")),
    );
  expect(statusWords.length).toBeGreaterThan(0);
  for (const word of statusWords) {
    expect(["draft", "ready"]).toContain(word);
  }
  const screenText = await shadow.innerText();
  // The capitalised state word would be a claim; "not published" is a denial.
  expect(screenText).not.toMatch(/(^|[\s·])Published\b/u);
  expect(screenText).not.toContain("Published to");
  expect(screenText).not.toContain("Live at");
});

test("one measured content Finding yields exactly one Action and exactly one content brief", async ({
  page,
}) => {
  // Red line B, asserted on the surfaces rather than inferred from the walk
  // above: no second confirmation path exists, and the confirmed Finding
  // reaches exactly one Action and exactly one brief.
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map`);
  await page
    .getByRole("button")
    .filter({ hasText: "/customer-onboarding" })
    .first()
    .click();
  await page.locator('[data-detail-state="opportunity-review"]').click();

  const review = page.locator(opportunityReviewPanel);
  // Confirm is offered exactly once per Finding — three cards, three controls.
  await expect(review.locator("[data-finding-card]")).toHaveCount(3);
  await expect(review.getByRole("button", { name: "Confirm" })).toHaveCount(3);

  await review
    .locator(`[data-finding-review="${E2E_CONTENT_FINDING_ID}"]`)
    .getByRole("button", { name: "Confirm" })
    .click();
  await expect.poll(() => api.growth.findingReviewRequests.length).toBe(1);

  // Clicking once produced ONE Action. The other two Findings are still
  // offering their own Confirm, so nothing was confirmed on their behalf.
  expect(api.contentActionsCreated).toHaveLength(1);
  await expect(review.getByRole("button", { name: "Confirm" })).toHaveCount(2);

  await page.goto(`/p/${E2E_PROJECT_ID}/execution`);

  // Exactly one content_brief exists in the whole queue, and exactly one
  // English draft — the Flow Shadow output, not a second brief.
  // Same re-aim as above: one queue, counted whole, type read off each row.
  const queue = page.locator("[data-studio-queue]");
  await expect(
    queue.locator(
      '[data-studio-artifact-id][data-studio-artifact-type="content_brief"]',
    ),
  ).toHaveCount(1);
  await expect(
    queue.locator(
      '[data-studio-artifact-id][data-studio-artifact-type="english_blog_draft"]',
    ),
  ).toHaveCount(1);
  // Both chips are offered, and the count beside them is read off the queue.
  await expect(
    page.locator('[data-studio-filter-bar] [data-studio-filter]'),
  ).toHaveCount(5);

  // Selecting the one English draft opens the run that consumed this brief;
  // Content Shadow contributes QA/review, not a parallel selectable queue.
  const draft = queue.locator(
    `[data-studio-artifact-id="${DRAFT_ARTIFACT_ID}"][data-studio-artifact-type="english_blog_draft"]`,
  );
  await draft.getByRole("button", { name: "Open", exact: true }).click();
  const shadow = page.locator("[data-content-shadow]");
  await expect(shadow).toBeVisible();
  await expect(shadow.locator("[aria-current]")).toHaveCount(0);
  await shadow.locator("[data-view-switch='compare']").click();
  await expect(shadow.locator("[data-compare-brief]:visible")).toContainText(
    `Content brief · revision ${BRIEF_REVISION} (frozen)`,
  );

  // Reading Execution wrote nothing beyond the single confirmation.
  expect(apiWrites(api)).toEqual([
    `PATCH ${BASE}/findings/${E2E_CONTENT_FINDING_ID}`,
  ]);
  expect(api.growth.critical.exportRequests).toEqual([]);
});
