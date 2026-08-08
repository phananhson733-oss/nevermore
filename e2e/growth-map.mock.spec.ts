import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  E2E_CANONICAL_FINDING_ID,
  E2E_CONTENT_FINDING_ID,
  E2E_COVERAGE_GAP_FINDING_ID,
  E2E_CTR_FINDING_ID,
  E2E_ONBOARDING_SITE_PAGE_ID,
  E2E_PROJECT_ID,
  installGrowthVerticalApi,
  type GrowthVerticalApiState,
} from "./mock-api.ts";

/**
 * Growth Map mock E2E. Pages and opportunities has exactly one presentation:
 * the complete frozen Opportunity projection, ranked by the primary Finding
 * severity, with an exact-URL evidence drill-down in the same rail. The
 * canonical review walkthrough still proves one Finding -> one Action -> one
 * template-fixed technical ticket.
 */

const OVERVIEW_URL = `/p/${E2E_PROJECT_ID}/overview`;
const NAV_LABEL = "Project sections";
const fullEvidencePanel = '[data-detail-panel="full-evidence-and-review"]';

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
    .locator(
      `[data-growth-map-opportunity-row="${E2E_CANONICAL_FINDING_ID}"]`,
    )
    .getByRole("button")
    .first()
    .click();
  await page
    .locator(`[data-opportunity-detail="${E2E_CANONICAL_FINDING_ID}"]`)
    .getByRole("button", { name: "/customer-onboarding" })
    .first()
    .click();
  await expect(
    page.getByRole("complementary", { name: "Selected URL detail" }),
  ).toBeVisible();
}

let api: GrowthVerticalApiState;

test.beforeEach(async ({ page }) => {
  await useEnglishUi(page);
  api = await installGrowthVerticalApi(page);
});

test("defaults to the Opportunity ledger with severity-based priorities and no view switcher", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map`);

  const rows = page.locator("[data-growth-map-opportunity-row]");
  await expect(rows).toHaveCount(4);
  // The removed view switcher must not come back, and the address stays free
  // of the legacy `view` parameter.
  await expect(
    page.getByRole("tablist", { name: "Pages and opportunities view" }),
  ).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("view"))
    .toBeNull();

  // The ledger reads the complete frozen projections through every cursor page.
  await expect
    .poll(() => [...new Set(api.completeUrlPageReads)])
    .toEqual([null, "urls-opaque-page-2"]);
  await expect
    .poll(() => [...new Set(api.completeOpportunityPageReads)])
    .toEqual([null, "opportunities-opaque-page-2"]);

  // Priority is the primary Finding severity, so every reviewable row ranks:
  // both high-severity Findings lead as P1 (the zero-target coverage gap
  // sorts first by title), the medium rows are P2, and nothing reads
  // "Not independently assessed".
  await expect(rows.first()).toHaveAttribute(
    "data-growth-map-opportunity-row",
    E2E_COVERAGE_GAP_FINDING_ID,
  );
  await expect(
    page
      .locator(`[data-growth-map-opportunity-row="${E2E_CANONICAL_FINDING_ID}"]`)
      .getByText("P1 · High"),
  ).toBeVisible();
  await expect(
    page
      .locator(`[data-growth-map-opportunity-row="${E2E_CTR_FINDING_ID}"]`)
      .getByText("P2 · Medium"),
  ).toBeVisible();
  await expect(page.getByText("Not independently assessed")).toHaveCount(0);

  const opportunityDetail = page.getByRole("complementary", {
    name: "Selected growth-opportunity detail",
  });
  await expect(opportunityDetail).toBeVisible();
  await expect(
    opportunityDetail.getByText("Growth opportunity · P1", { exact: false }),
  ).toBeVisible();
  // The default selection is the zero-target coverage gap, whose only review
  // surface is the inline control on this rail.
  await expect(
    opportunityDetail.locator(
      `[data-opportunity-inline-review="${E2E_COVERAGE_GAP_FINDING_ID}"]`,
    ),
  ).toBeVisible();
  for (const section of [
    "Primary Finding",
    "Supporting evidence",
    "Target pages",
    "Coverage and limitations",
    "Execution output",
    "Next decision",
  ]) {
    await expect(
      opportunityDetail
        .locator("section span")
        .filter({ hasText: section })
        .first(),
    ).toBeVisible();
  }
  // The Primary Finding section names its severity, the evidence section its
  // record count, and the target section its item count.
  await expect(opportunityDetail.getByText("High", { exact: true })).toBeVisible();
  await expect(
    opportunityDetail.getByText("1 records", { exact: true }),
  ).toBeVisible();
  await expect(
    opportunityDetail.getByText("0 items", { exact: true }),
  ).toBeVisible();
  // Coverage and limitations render as visible list items, never as a
  // collapsed icon that reads as an empty section.
  await expect(
    opportunityDetail
      .locator("section")
      .filter({ hasText: "Coverage and limitations" })
      .locator("li")
      .first(),
  ).toBeVisible();
  await expect(opportunityDetail.locator("[data-finding-card]")).toHaveCount(0);
});

test("matches the Artifact opportunity ledger density at desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map`);

  const firstRow = page.locator("[data-growth-map-opportunity-row]").first();
  await expect(firstRow).toBeVisible();
  const measurements = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>(
      "[data-growth-map-opportunity-workspace]",
    );
    const ledger = document.querySelector<HTMLElement>(
      "[data-growth-map-opportunity-ledger]",
    );
    const header = document.querySelector<HTMLElement>(
      "[data-growth-map-opportunity-ledger-header]",
    );
    const row = document.querySelector<HTMLElement>(
      "[data-growth-map-opportunity-row]",
    );
    const detail = document.querySelector<HTMLElement>(
      "aside[data-opportunity-detail]",
    );
    const title = row?.querySelector<HTMLElement>(":scope > span strong");
    const cells = [
      ...(row?.querySelectorAll<HTMLElement>(":scope > span") ?? []),
    ];
    const detailTitle = detail?.querySelector<HTMLElement>("h2");
    const detailSubtitle = detail?.querySelector<HTMLElement>("header p");
    if (
      workspace == null ||
      ledger == null ||
      header == null ||
      row == null ||
      detail == null ||
      title == null ||
      cells.length !== 6 ||
      detailTitle == null ||
      detailSubtitle == null
    ) {
      throw new Error("Opportunity master-detail structure is incomplete");
    }
    const rowStyle = getComputedStyle(row);
    const headerStyle = getComputedStyle(header);
    const workspaceStyle = getComputedStyle(workspace);
    const titleStyle = getComputedStyle(title);
    const typeStyle = getComputedStyle(cells[1]!.querySelector("strong")!);
    const urlCountStyle = getComputedStyle(cells[3]!.querySelector("strong")!);
    const outputStyle = getComputedStyle(cells[4]!.querySelector("strong")!);
    const detailTitleStyle = getComputedStyle(detailTitle);
    const detailSubtitleStyle = getComputedStyle(detailSubtitle);
    const gridTracks = rowStyle.gridTemplateColumns
      .split(" ")
      .map((track) => Number.parseFloat(track));
    const trackTotal = gridTracks.reduce((sum, track) => sum + track, 0);

    return {
      workspaceGap: workspaceStyle.columnGap,
      detailWidth: detail.getBoundingClientRect().width,
      headerHeight: header.getBoundingClientRect().height,
      headerFontSize: headerStyle.fontSize,
      rowHeight: row.getBoundingClientRect().height,
      titleFontSize: titleStyle.fontSize,
      titleFontWeight: titleStyle.fontWeight,
      typeFontSize: typeStyle.fontSize,
      urlCountFontSize: urlCountStyle.fontSize,
      outputFontSize: outputStyle.fontSize,
      selectedMarkerWidth: getComputedStyle(row, "::before").width,
      firstTrackRatio: gridTracks[0]! / trackTotal,
      detailTitleFontSize: detailTitleStyle.fontSize,
      detailTitleFontWeight: detailTitleStyle.fontWeight,
      detailSubtitleFontSize: detailSubtitleStyle.fontSize,
    };
  });

  expect(measurements.workspaceGap).toBe("14px");
  expect(measurements.detailWidth).toBeCloseTo(360, 0);
  expect(measurements.headerHeight).toBeCloseTo(50, 0);
  expect(measurements.headerFontSize).toBe("12px");
  expect(measurements.rowHeight).toBeCloseTo(80, 0);
  expect(measurements.titleFontSize).toBe("14px");
  expect(measurements.titleFontWeight).toBe("700");
  expect(measurements.typeFontSize).toBe("13px");
  expect(measurements.urlCountFontSize).toBe("13px");
  expect(measurements.outputFontSize).toBe("13px");
  expect(measurements.selectedMarkerWidth).toBe("3px");
  expect(measurements.firstTrackRatio).toBeCloseTo(0.39, 1);
  expect(measurements.detailTitleFontSize).toBe("23px");
  expect(measurements.detailTitleFontWeight).toBe("600");
  expect(measurements.detailSubtitleFontSize).toBe("12px");
});

test("keeps the Opportunity layout usable across Artifact breakpoints", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map`);

  const workspace = page.locator("[data-growth-map-opportunity-workspace]");
  const master = page.locator("[data-growth-map-opportunity-master]");
  const detail = page.locator("aside[data-opportunity-detail]");
  await expect(workspace).toBeVisible();
  await expect(detail).toBeVisible();
  await expect
    .poll(() => detail.evaluate((node) => node.getBoundingClientRect().width))
    .toBeCloseTo(330, 0);

  await page.setViewportSize({ width: 1024, height: 900 });
  const stacked = await workspace.evaluate((node) => {
    const masterNode = node.querySelector<HTMLElement>(
      "[data-growth-map-opportunity-master]",
    );
    const detailNode = node.querySelector<HTMLElement>(
      "aside[data-opportunity-detail]",
    );
    if (masterNode == null || detailNode == null) {
      throw new Error("Opportunity master-detail structure is incomplete");
    }
    const masterRect = masterNode.getBoundingClientRect();
    const detailRect = detailNode.getBoundingClientRect();
    return {
      gridTrackCount: getComputedStyle(node).gridTemplateColumns.split(" ")
        .length,
      detailPosition: getComputedStyle(detailNode).position,
      detailFollowsMasterInDom:
        [...node.children].indexOf(detailNode) >
        [...node.children].indexOf(masterNode),
      detailTop: detailRect.top,
      masterBottom: masterRect.bottom,
    };
  });
  expect(stacked.gridTrackCount).toBe(1);
  expect(stacked.detailPosition).toBe("static");
  expect(stacked.detailFollowsMasterInDom).toBe(true);
  expect(stacked.detailTop).toBeGreaterThanOrEqual(stacked.masterBottom);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(master).toBeVisible();
  await expect(detail).toBeVisible();
  expect(await hasPageOverflow(page), await overflowDiagnostics(page)).toBe(
    false,
  );
  expect(await blockingAxeViolations(page, "#main-content")).toEqual([]);
});

test("keeps the Opportunity ledger independent of Topic reads and scrubs cluster addresses", async ({
  page,
}) => {
  api.topicModelReadsFail = true;
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?view=cluster&selectedClusterId=stale`,
  );

  await expect(page.locator("[data-growth-map-opportunity-row]")).toHaveCount(4);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("view"))
    .toBeNull();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedClusterId"))
    .toBeNull();
  await expect(page.locator("[data-growth-map-cluster-row]")).toHaveCount(0);
});

test("keeps the search while drilling to the exact URL and back", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map`);

  const search = page.getByRole("search");
  await search.getByRole("searchbox", { name: "Find a page" }).fill("canonical");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(
    page.locator("[data-growth-map-opportunity-row]"),
  ).toHaveCount(1);

  const detail = page.locator(
    `[data-opportunity-detail="${E2E_CANONICAL_FINDING_ID}"]`,
  );
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "/customer-onboarding" }).click();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedSitePageId"))
    .toBe(E2E_ONBOARDING_SITE_PAGE_ID);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("findingId"))
    .toBe(E2E_CANONICAL_FINDING_ID);
  // The drill-down keeps the ledger search: leaving and returning must not
  // silently reset the filtered scope.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("canonical");
  await expect(
    page.locator(`[data-finding-card="${E2E_CANONICAL_FINDING_ID}"]`),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to opportunities" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedSitePageId"))
    .toBeNull();
  await expect(
    page.locator("[data-growth-map-opportunity-row]"),
  ).toHaveCount(1);
  await expect(detail).toBeVisible();
});

test("scrubs legacy view addresses and repairs stale Opportunity selections", async ({
  page,
}) => {
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?view=legacy&selectedOpportunityId=stale`,
  );

  await expect
    .poll(() => new URL(page.url()).searchParams.get("view"))
    .toBeNull();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedOpportunityId"))
    .not.toBe("stale");
  const repairedOpportunityId = new URL(page.url()).searchParams.get(
    "selectedOpportunityId",
  );
  expect(repairedOpportunityId).not.toBeNull();
  await expect(
    page.locator(`[data-opportunity-detail="${repairedOpportunityId}"]`),
  ).toBeVisible();

  // A stale Opportunity next to a still-valid page selection: repairing the
  // Opportunity id must not close the URL drill-down the link points at.
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedOpportunityId=stale&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
  );
  await expect(
    page.getByRole("heading", { name: "/customer-onboarding" }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedOpportunityId"))
    .not.toBe("stale");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedSitePageId"))
    .toBe(E2E_ONBOARDING_SITE_PAGE_ID);

  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
  );
  await expect(
    page.getByRole("heading", { name: "/customer-onboarding" }),
  ).toBeVisible();
  const backButton = page.getByRole("button", {
    name: "Back to opportunities",
  });
  await expect(backButton).toBeVisible();
  await backButton.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedSitePageId"))
    .toBeNull();
  await expect(
    page.getByRole("complementary", {
      name: "Selected growth-opportunity detail",
    }),
  ).toBeVisible();
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

  // Open Growth Map and drill from the canonical Opportunity into the exact
  // multi-Finding onboarding URL. The drill-down pins the primary Finding, so
  // the full evidence-and-review surface opens directly.
  await openOnboardingDetail(page);

  const urlDetail = page.getByRole("complementary", {
    name: "Selected URL detail",
  });
  await expect(urlDetail.locator("[data-compact-finding]")).toHaveCount(3);
  await expect(urlDetail.locator(fullEvidencePanel)).toBeVisible();
  await urlDetail.locator('[data-detail-state="opportunity-review"]').click();

  // Full review still exposes three separately reviewable cards for one URL.
  const review = urlDetail.locator('[data-detail-panel="opportunity-review"]');
  await expect(review).toBeVisible();
  await expect(review.locator("[data-finding-card]")).toHaveCount(3);
  await expect(review.getByText("TECH-CANONICAL-002").first()).toBeVisible();

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

test("reviews a zero-target Opportunity inline without leaving the ledger", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map`);

  const inline = page.locator(
    `[data-opportunity-inline-review="${E2E_COVERAGE_GAP_FINDING_ID}"]`,
  );
  await expect(inline).toBeVisible();
  await inline.getByRole("button", { name: "Confirm" }).click();

  await expect.poll(() => api.findingReviewRequests.length).toBe(1);
  expect(api.findingReviewRequests[0]).toMatchObject({
    findingId: E2E_COVERAGE_GAP_FINDING_ID,
    body: { reviewState: "confirmed", baseRevision: 0 },
  });

  // Confirmation re-ranks the row, but the rail must stay pinned to the
  // Opportunity that was just reviewed: one click, one visible state flip.
  // Jumping to the next near-identical row would read as "nothing happened".
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedOpportunityId"))
    .toBe(E2E_COVERAGE_GAP_FINDING_ID);
  const row = page.locator(
    `[data-growth-map-opportunity-row="${E2E_COVERAGE_GAP_FINDING_ID}"]`,
  );
  await expect(row.getByText("Confirmed", { exact: true })).toBeVisible();
  const detail = page.locator(
    `[data-opportunity-detail="${E2E_COVERAGE_GAP_FINDING_ID}"]`,
  );
  await expect(detail).toBeVisible();
  await expect(
    detail.getByRole("link", { name: "Open execution" }),
  ).toBeVisible();
  await expect(detail.locator("[data-opportunity-inline-review]")).toHaveCount(0);
});

test("has no page overflow or blocking axe findings on desktop and 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
  );
  const urlDetail = page.getByRole("complementary", {
    name: "Selected URL detail",
  });
  await expect(urlDetail).toBeVisible();
  await expect(urlDetail.locator(fullEvidencePanel)).toHaveCount(0);
  // The document must expose exactly one `main` — the shell's
  // (`layout.tsx:187`). `blockingAxeViolations` below cannot check this: it is
  // `.include`-scoped, and even unscoped it would not report a duplicate,
  // because this repository's scans select WCAG tags and keep only
  // critical/serious while `landmark-no-duplicate-main` is best-practice at
  // moderate (measured — stop gate §17.6c). Overview shipped with two `main`
  // elements for an entire slice and every axe scan stayed green.
  await expect(page.getByRole("main")).toHaveCount(1);
  expect(await hasPageOverflow(page), await overflowDiagnostics(page)).toBe(
    false,
  );
  expect(await blockingAxeViolations(page, "#main-content")).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(urlDetail).toBeVisible();
  await expect(urlDetail.locator(fullEvidencePanel)).toHaveCount(0);
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
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}&findingId=${E2E_CANONICAL_FINDING_ID}`,
  );
  await expect(page.locator(fullEvidencePanel)).toBeVisible();

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
