import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  E2E_ARTIFACT_ID,
  E2E_CANONICAL_ACTION_ID,
  E2E_CANONICAL_EVIDENCE_ID,
  E2E_CANONICAL_FINDING_ID,
  E2E_CONTENT_FINDING_ID,
  E2E_CTR_FINDING_ID,
  E2E_ONBOARDING_SITE_PAGE_ID,
  E2E_ONBOARDING_URL,
  E2E_PRIOR_AUDIT_RUN_ID,
  E2E_PROJECT_ID,
  E2E_RECHECK_RUN_ID,
  installGrowthVerticalApi,
  type GrowthVerticalApiState,
} from "./mock-api.ts";

/**
 * Task 9 vertical E2E. One stable-ID walk of the whole Slice 1 technical
 * opportunity, using mocks that mimic the real response contracts:
 *
 *   URL + ICP → createGrowthAuditRun → Overview freshness/status
 *   → Growth Map / Audit Evidence (canonical conflict + No Data limitation)
 *   → Growth Map / Opportunity Review (confirm the primary Finding only)
 *   → Execution / one technical ticket → mark work done
 *   → createActionRecheck → Results / prior-vs-new comparison
 *
 * The recheck POST and the artifact promotion have no dedicated on-page control
 * in Slice 1, so they are driven against the same endpoints the app hooks call.
 */

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const OVERVIEW_URL = `/p/${E2E_PROJECT_ID}/overview`;
const NAV_LABEL = "Project sections";
const auditEvidencePanel = '[data-detail-panel="audit-evidence"]';
const opportunityReviewPanel = '[data-detail-panel="opportunity-review"]';

async function useEnglishUi(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
}

function projectNav(page: Page): Locator {
  return page.getByRole("navigation", { name: NAV_LABEL });
}

function navLink(page: Page, index: number): Locator {
  return projectNav(page).getByRole("link").nth(index);
}

async function apiFetch(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: { data?: unknown } }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, {
        method,
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body === undefined ? null : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    },
    { method, path, body },
  );
}

async function selectOnboardingDetail(page: Page): Promise<void> {
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
  );
  await expect(page.locator("[data-growth-map-page]")).toBeVisible();
  await page.getByRole("tab", { name: /^By URL/ }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "/customer-onboarding" })
    .first()
    .click();
  await page
    .locator("[data-full-evidence-disclosure] > summary")
    .click();
  await expect(page.locator(auditEvidencePanel)).toBeVisible();
}

let api: GrowthVerticalApiState;

test.beforeEach(async ({ page }) => {
  await useEnglishUi(page);
  api = await installGrowthVerticalApi(page);
});

test("proves the technical opportunity vertical without any lift claim", async ({
  page,
}) => {
  // ---- URL + ICP: land Overview with a confirmed ICP and audit identity ----
  await page.goto(OVERVIEW_URL);

  const navLinks = projectNav(page).getByRole("link");
  await expect(navLinks).toHaveCount(4);
  await expect(navLinks.nth(0)).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/overview`,
  );
  await expect(navLinks.nth(1)).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/growth-map`,
  );
  await expect(navLinks.nth(2)).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/execution`,
  );
  await expect(navLinks.nth(3)).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/results`,
  );

  // ---- createGrowthAuditRun: the frozen URL + confirmed ICP start a run ----
  const runAudit = page.getByRole("button", { name: "Run growth audit" });
  await expect(runAudit).toBeVisible();
  await runAudit.click();
  await expect.poll(() => api.auditRunRequests.length).toBe(1);
  expect(api.auditRunRequests[0]).toMatchObject({
    scope: { kind: "site" },
    capabilityContractVersion: "growth-audit.0.3.0",
  });
  await expect(
    page.getByText("Growth audit queued — track it on the Diagnosis screen.", {
      exact: true,
    }),
  ).toBeVisible();

  // ---- Growth Map / Audit Evidence: inspect the canonical conflict ----------
  await selectOnboardingDetail(page);
  const evidence = page.locator(auditEvidencePanel);
  const evidenceCanonicalCard = evidence.locator(
    `[data-finding-card="${E2E_CANONICAL_FINDING_ID}"]`,
  );
  await expect(
    evidenceCanonicalCard.getByText("TECH-CANONICAL-002"),
  ).toBeVisible();
  // The audit evidence and opportunity review share one target + Evidence IDs.
  await expect(
    evidenceCanonicalCard.locator(`code[title="${E2E_ONBOARDING_URL}"]`),
  ).toHaveCount(1);
  await expect(
    evidenceCanonicalCard.locator(`code[title="${E2E_CANONICAL_EVIDENCE_ID}"]`),
  ).toHaveCount(1);
  // A No Data limitation is shown (no analytics coverage for this URL).
  await expect(
    evidence.getByText("No data", { exact: true }).first(),
  ).toBeVisible();
  // Audit Evidence performs no remediation mutation.
  await expect(evidence.getByRole("button", { name: "Confirm" })).toHaveCount(
    0,
  );

  // ---- Growth Map / Opportunity Review: confirm the primary Finding only ----
  await page.locator('[data-detail-state="opportunity-review"]').click();
  const review = page.locator(opportunityReviewPanel);
  await expect(review).toBeVisible();
  // Three related Opportunities are separate cards over the one shared target.
  await expect(review.locator("[data-finding-card]")).toHaveCount(3);
  const reviewCanonicalCard = review.locator(
    `[data-finding-card="${E2E_CANONICAL_FINDING_ID}"]`,
  );
  await expect(
    reviewCanonicalCard.locator(`code[title="${E2E_ONBOARDING_URL}"]`),
  ).toHaveCount(1);
  await expect(
    reviewCanonicalCard.locator(`code[title="${E2E_CANONICAL_EVIDENCE_ID}"]`),
  ).toHaveCount(1);

  await review
    .locator(`[data-finding-review="${E2E_CANONICAL_FINDING_ID}"]`)
    .getByRole("button", { name: "Confirm" })
    .click();
  await expect.poll(() => api.findingReviewRequests.length).toBe(1);
  expect(api.findingReviewRequests[0]?.findingId).toBe(
    E2E_CANONICAL_FINDING_ID,
  );

  // Only the canonical card is confirmed; CTR and content stay independent.
  await expect(
    reviewCanonicalCard.getByText("Confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    review
      .locator(`[data-finding-card="${E2E_CTR_FINDING_ID}"]`)
      .getByRole("button", { name: "Confirm" }),
  ).toBeVisible();
  await expect(
    review
      .locator(`[data-finding-card="${E2E_CONTENT_FINDING_ID}"]`)
      .getByRole("button", { name: "Confirm" }),
  ).toBeVisible();
  expect(api.confirmedFindingIds.has(E2E_CTR_FINDING_ID)).toBe(false);
  expect(api.confirmedFindingIds.has(E2E_CONTENT_FINDING_ID)).toBe(false);

  // ---- Execution: one Finding produced one Action + one fixed Artifact type -
  //
  // The anchor used to be the "Delivery chain" summary panel. That panel was
  // DELETED (Slice 2 Task 7), and the guarantee asserted here was not: its
  // eleven class names had no stylesheet behind them, and its <h2> was emitted
  // before the page's own <h1>, which is a heading order a screen reader user
  // pays for. Keeping the anchor would have meant keeping the defect.
  //
  // What is under test is unchanged and stays exact — the technical vertical
  // yields EXACTLY ONE Technical ticket deliverable and it is readable on
  // Execution.
  //
  // The scope moved with the surface. The queue is now ONE list, ordered by
  // type instead of sectioned by it, so the per-type `region` this used to
  // scope to no longer exists. The count is now taken over the WHOLE queue,
  // which is strictly stronger: a second Technical ticket filed under some
  // other section used to be invisible here, and now turns this red. The type
  // is still asserted, off each row's own `data-studio-artifact-type`.
  await navLink(page, 2).click();
  const queue = page.locator("[data-studio-queue]");
  const ticketRows = queue.locator(
    '[data-studio-artifact-id][data-studio-artifact-type="technical_ticket"]',
  );
  await expect(ticketRows).toHaveCount(1);
  await expect(queue.locator("[data-studio-artifact-id]")).toHaveCount(1);
  await expect(
    ticketRows.getByText("Fix the failing product page", { exact: true }),
  ).toBeVisible();
  // The type the row claims is the one the chip row can filter it down to.
  await expect(
    queue.getByText("Technical ticket", { exact: true }),
  ).toBeVisible();

  // ---- Mark work done: promote the existing Artifact to ready ----------------
  const markDone = await apiFetch(
    page,
    "PATCH",
    `${BASE}/artifacts/${E2E_ARTIFACT_ID}`,
    { baseRevision: 2, status: "ready" },
  );
  expect(markDone.status).toBe(200);
  expect(api.artifactStatusPatches).toEqual([
    { baseRevision: 2, status: "ready" },
  ]);

  // ---- createActionRecheck: a new immutable run that preserves the prior -----
  const recheck = await apiFetch(
    page,
    "POST",
    `${BASE}/actions/${E2E_CANONICAL_ACTION_ID}/recheck`,
    {
      actionId: E2E_CANONICAL_ACTION_ID,
      priorRunId: E2E_PRIOR_AUDIT_RUN_ID,
      targetScope: { kind: "url", ref: E2E_ONBOARDING_URL },
      capabilityContractVersion: "growth-audit.0.3.0",
    },
  );
  expect(recheck.status).toBe(202);
  const recheckData = recheck.body.data as { run: { id: string } };
  expect(recheckData.run.id).toBe(E2E_RECHECK_RUN_ID);
  expect(recheckData.run.id).not.toBe(E2E_PRIOR_AUDIT_RUN_ID);
  expect(api.recheckRequests).toHaveLength(1);
  expect(api.recheckRequests[0]?.body).toMatchObject({
    priorRunId: E2E_PRIOR_AUDIT_RUN_ID,
    capabilityContractVersion: "growth-audit.0.3.0",
  });

  // ---- Results: prior-vs-new comparison, technical condition only -----------
  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  const results = page.getByRole("region", {
    name: "Technical recheck record",
  });
  await expect(
    results.getByRole("heading", { name: "Technical recheck record" }),
  ).toBeVisible();
  await expect(results.getByText("Prior run observed")).toBeVisible();
  await expect(results.getByText("Recheck observed")).toBeVisible();
  await expect(results.getByText("Technical condition verified")).toBeVisible();

  // Results is the last shipped destination without a per-PR landmark check,
  // and this is the only mock spec that renders it for real: the `/results`
  // route lives in `installGrowthVerticalApi`, layered over the critical-flow
  // installer on purpose (`mock-api.ts:1060`), so specs on the base installer
  // get a 501 and an error state instead of the comparison.
  //
  // Exactly one `main` — the shell's (`layout.tsx:187`). No axe scan here can
  // report a duplicate: the scans select WCAG tags and keep only
  // critical/serious, while `landmark-no-duplicate-main` is best-practice at
  // moderate (measured — stop gate §17.6c).
  await expect(page.getByRole("main")).toHaveCount(1);

  // The recheck compared two immutable runs and preserved the prior run id.
  const resultsText = (await results.innerText()).toLowerCase();
  expect(resultsText).toContain("technical");
  // The customer-facing record names the metrics it deliberately excludes;
  // mentioning that boundary is not itself a lift claim. Keep the explicit
  // separation, then reject positive movement language and out-of-scope
  // commercial/AI claims.
  expect(resultsText).toContain("technical condition only");
  expect(resultsText).toContain(
    "traffic, rank, and conversion movement comes from the fixed-window observations above",
  );
  expect(resultsText).not.toMatch(
    /(traffic|rank(?:ing)?|revenue|citation).{0,32}(increased|improved|grew|lifted)/u,
  );
  for (const forbidden of ["revenue", "citation", "lift"]) {
    expect(resultsText, `results must not claim ${forbidden}`).not.toContain(
      forbidden,
    );
  }

  // ---- No Content Shadow control performed a production write ----------------
  // The only mutations that left the browser are the versioned audit run, the
  // single Finding confirmation, the artifact promotion, and the recheck.
  expect(api.critical.exportRequests).toEqual([]);
  expect(api.findingReviewRequests).toHaveLength(1);
  expect(api.auditRunRequests).toHaveLength(1);
  expect(api.recheckRequests).toHaveLength(1);
});
