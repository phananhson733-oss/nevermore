import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  E2E_CANONICAL_FINDING_ID,
  E2E_CONTENT_FINDING_ID,
  E2E_CTR_FINDING_ID,
  E2E_ONBOARDING_SITE_PAGE_ID,
  E2E_PROJECT_ID,
  installGrowthVerticalApi,
  type GrowthVerticalApiState,
} from "./mock-api.ts";

/**
 * Task 6 Step 5 mock E2E. Drives the four-entry Growth Map shell over a stable
 * in-browser audit projection: land Overview, open Growth Map, inspect the
 * TECH-CANONICAL-002 Audit Evidence (which exposes no Confirm control), switch
 * to Opportunity Review, confirm only the canonical Finding, and prove that one
 * canonical Action with one template-fixed technical ticket appears in
 * Execution while the related CTR and content Opportunities stay unconfirmed.
 */

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

/** Nav links carry a review/artifact badge, so match by position, not text. */
function navLink(page: Page, index: number): Locator {
  return projectNav(page).getByRole("link").nth(index);
}

async function overflowDiagnostics(page: Page): Promise<string> {
  return page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const isClipped = (el: HTMLElement): boolean => {
      let node: HTMLElement | null = el.parentElement;
      while (node) {
        const ox = getComputedStyle(node).overflowX;
        if (ox !== "visible") return true;
        node = node.parentElement;
      }
      return false;
    };
    const wide = [...document.querySelectorAll<HTMLElement>("*")]
      .filter(
        (el) =>
          el.getBoundingClientRect().right > docWidth + 1 && !isClipped(el),
      )
      .sort(
        (a, b) =>
          b.getBoundingClientRect().right - a.getBoundingClientRect().right,
      )
      .slice(0, 5)
      .map((el) => {
        const cls = (el.className || "")
          .toString()
          .replace(/\s+/g, ".")
          .slice(0, 40);
        return `${el.tagName}.${cls} right=${Math.round(el.getBoundingClientRect().right)} "${(el.textContent || "").trim().slice(0, 40)}"`;
      });
    return `doc cw=${docWidth} sw=${document.documentElement.scrollWidth} :: ${wide.join(" || ")}`;
  });
}

async function hasPageOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
}

async function blockingAxeViolations(
  page: Page,
  selector: string,
): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    )
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}) @ ${violation.nodes
          .flatMap((node) => node.target)
          .join(", ")}`,
    );
}

async function openOnboardingDetail(page: Page): Promise<void> {
  await navLink(page, 1).click();
  await expect(page.locator("[data-growth-map-page]")).toBeVisible();
  await page
    .getByRole("button")
    .filter({ hasText: "/customer-onboarding" })
    .first()
    .click();
  await expect(page.locator(auditEvidencePanel)).toBeVisible();
}

let api: GrowthVerticalApiState;

test.beforeEach(async ({ page }) => {
  await useEnglishUi(page);
  api = await installGrowthVerticalApi(page);
});

test("reviews only the canonical Opportunity and delivers one technical ticket", async ({
  page,
}) => {
  await page.goto(OVERVIEW_URL);

  // Exactly four primary entries, in order, routing to the canonical segments.
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
  await expect(navLinks.nth(1)).toContainText("Growth Map");

  // Open Growth Map and select the multi-Finding onboarding URL.
  await openOnboardingDetail(page);

  // Audit Evidence: the canonical conflict is inspectable but read-only.
  const evidence = page.locator(auditEvidencePanel);
  await expect(evidence.getByText("TECH-CANONICAL-002").first()).toBeVisible();
  await expect(
    evidence
      .getByText(
        "Audit Evidence is read-only. Switch to Opportunity Review to decide this Finding.",
      )
      .first(),
  ).toBeVisible();
  await expect(evidence.getByRole("button", { name: "Confirm" })).toHaveCount(
    0,
  );

  // Opportunity Review: three separately reviewable cards for one URL.
  await page.locator('[data-detail-state="opportunity-review"]').click();
  const review = page.locator(opportunityReviewPanel);
  await expect(review).toBeVisible();
  await expect(review.locator("[data-finding-card]")).toHaveCount(3);

  const canonicalReview = review.locator(
    `[data-finding-review="${E2E_CANONICAL_FINDING_ID}"]`,
  );
  await expect(
    canonicalReview.getByRole("button", { name: "Confirm" }),
  ).toBeVisible();

  // Confirm only the canonical primary Finding.
  await canonicalReview.getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => api.findingReviewRequests.length).toBe(1);
  expect(api.findingReviewRequests[0]?.findingId).toBe(
    E2E_CANONICAL_FINDING_ID,
  );
  expect(api.findingReviewRequests[0]?.body).toMatchObject({
    reviewState: "confirmed",
  });

  // The canonical card is now confirmed and no longer offers Confirm; the
  // related CTR and content Opportunities remain independently unconfirmed.
  const canonicalCard = review.locator(
    `[data-finding-card="${E2E_CANONICAL_FINDING_ID}"]`,
  );
  await expect(
    canonicalCard.getByText("Confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    canonicalCard.getByRole("button", { name: "Confirm" }),
  ).toHaveCount(0);
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

  // Execution surfaces exactly one canonical Action with one technical ticket.
  //
  // The anchor used to be the "Delivery chain" summary panel and its own <h2>.
  // That panel was DELETED (Slice 2 Task 7) to an a11y spec, not weakened away:
  // its eleven class names had no stylesheet behind them, and its <h2> was
  // emitted BEFORE the page's own <h1>, a heading order a screen reader user
  // pays for. Keeping the anchor would have meant keeping the defect. The same
  // move was already made for `audit-technical-vertical.mock.spec.ts` (66ce9ce).
  //
  // What is under test is unchanged and stays exact — this walkthrough yields
  // EXACTLY ONE Technical ticket deliverable, readable on Execution — so it is
  // asserted where that deliverable now lives: the studio artifact queue. The
  // deleted panel's own heading has no successor to assert, so its role (proof
  // that a deliverable surface rendered at all) passes to the queue itself.
  //
  // The counts get STRONGER, not weaker. The old count was scoped to one panel,
  // so a second ticket rendered anywhere else on Execution stayed invisible to
  // it; the new one is taken over the WHOLE queue. The type is read off each
  // row's own `data-studio-artifact-type` rather than off a text label.
  await navLink(page, 2).click();
  const queue = page.locator("[data-studio-queue]");
  await expect(queue).toBeVisible();
  const ticketRows = queue.locator(
    '[data-studio-artifact-id][data-studio-artifact-type="technical_ticket"]',
  );
  await expect(ticketRows).toHaveCount(1);
  await expect(queue.locator("[data-studio-artifact-id]")).toHaveCount(1);
  await expect(
    ticketRows.getByText("Fix the failing product page", { exact: true }),
  ).toBeVisible();
  // The type the row claims is the one the queue reads out to a human.
  await expect(
    queue.getByText("Technical ticket", { exact: true }),
  ).toBeVisible();

  // The confirmation reused the existing Finding Review transaction only: no
  // recheck and no publish/Content-Shadow write left the browser.
  expect(api.recheckRequests).toEqual([]);
});

test("has no page overflow or blocking axe findings on desktop and 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
  );
  await expect(page.locator(auditEvidencePanel)).toBeVisible();
  expect(await hasPageOverflow(page), await overflowDiagnostics(page)).toBe(
    false,
  );
  expect(await blockingAxeViolations(page, "#main-content")).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(auditEvidencePanel)).toBeVisible();
  expect(await hasPageOverflow(page), await overflowDiagnostics(page)).toBe(
    false,
  );
  expect(await blockingAxeViolations(page, "#main-content")).toEqual([]);
});

/**
 * The retired Diagnosis screen owned a keyboard contract for reaching a
 * Finding's evidence: Enter opens a named dialog, the dialog takes focus,
 * Escape closes it, focus returns to the exact trigger, and the trigger's
 * aria-expanded tracks the open state. Growth Map replaced that screen, so the
 * same contract has to hold here or a keyboard-only reviewer cannot open and
 * leave the evidence disclosure.
 */
test("evidence disclosure opens on Enter, closes on Escape, and returns focus", async ({
  page,
}) => {
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
  );
  await expect(page.locator(auditEvidencePanel)).toBeVisible();

  const card = page.locator(
    `[data-finding-card="${E2E_CANONICAL_FINDING_ID}"]`,
  );
  await expect(card).toBeVisible();
  const trigger = card.locator("summary");
  await expect(trigger).toHaveCount(1);
  const dialog = card.getByRole("dialog", { name: "Inspect Evidence IDs" });

  // Closed: no dialog, and the trigger advertises the collapsed state.
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // Enter opens a named dialog and hands it focus.
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByText("Evidence ID", { exact: false })).toBeVisible();

  // Escape closes it and gives focus back to the exact trigger that opened it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // The restored contract is repeatable, not a one-shot.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
