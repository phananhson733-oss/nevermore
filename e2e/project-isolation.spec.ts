import { expect, test, type Page, type Route } from "@playwright/test";
import { publicFixtureOrigin, seedProject } from "./fixtures.ts";

function projectApiRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/mvp/projects/")) urls.push(url.pathname);
  });
  return urls;
}

interface HeldProjectGrowthMapNavigations {
  waitForRequest(): Promise<void>;
  release(): Promise<void>;
}

async function holdProjectGrowthMapNavigations(
  page: Page,
  projectId: string,
): Promise<HeldProjectGrowthMapNavigations> {
  const pattern = new RegExp(`/p/${projectId}/growth-map(?:\\?|$)`);
  let intercepted = 0;
  let active = 0;
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const handler = async (route: Route): Promise<void> => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("_rsc")) {
      await route.continue();
      return;
    }
    intercepted += 1;
    active += 1;
    try {
      await gate;
      try {
        await route.continue();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Route is already handled")) throw error;
      }
    } finally {
      active -= 1;
    }
  };
  await page.route(pattern, handler);

  return {
    async waitForRequest(): Promise<void> {
      await expect
        .poll(() => intercepted, {
          message:
            "project switch did not overlap a held Growth Map RSC request",
        })
        .toBeGreaterThan(0);
    },
    async release(): Promise<void> {
      releaseGate?.();
      await expect
        .poll(() => active, {
          message:
            "held project Growth Map RSC routes did not finish after release",
        })
        .toBe(0);
      await page.unroute(pattern, handler);
    },
  };
}

test("two project tabs keep URLs, queries, and rendered aggregates isolated (AC-010)", async ({
  context,
  request,
}) => {
  const [projectA, projectB] = await Promise.all([
    seedProject(request, {
      clientName: "Shared Isolation Client",
      projectName: "Isolation Project A",
      siteUrl: publicFixtureOrigin("isolation-a"),
    }),
    seedProject(request, {
      clientName: "Shared Isolation Client",
      projectName: "Isolation Project B",
      siteUrl: publicFixtureOrigin("isolation-b"),
    }),
  ]);

  /** Every anchor below is English chrome, and the app's default UI locale is
   *  zh-CN (`packages/i18n/src/config.ts:6`), so the locale has to be selected
   *  rather than inherited — the same `sf_ui_locale` cookie the mock specs set
   *  after `939129a`. Test-side only: no surface is touched, and the cookie is
   *  set on the shared context so both tabs agree. */
  await context.addCookies([
    { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
  ]);

  const [pageA, pageB] = await Promise.all([context.newPage(), context.newPage()]);
  const requestsA = projectApiRequests(pageA);
  const requestsB = projectApiRequests(pageB);

  await Promise.all([
    pageA.goto(`/p/${projectA.projectId}/overview`),
    pageB.goto(`/p/${projectB.projectId}/overview`),
  ]);

  const switcherA = pageA.getByRole("combobox", { name: "Switch project" });
  const switcherB = pageB.getByRole("combobox", { name: "Switch project" });
  await expect(switcherA).toHaveValue(projectA.projectId);
  await expect(switcherB).toHaveValue(projectB.projectId);
  await expect
    .poll(() =>
      switcherA.evaluate(
        (element) =>
          (element as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ??
          "",
      ),
    )
    .toContain("Shared Isolation Client — Isolation Project A");
  await expect
    .poll(() =>
      switcherB.evaluate(
        (element) =>
          (element as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ??
          "",
      ),
    )
    .toContain("Shared Isolation Client — Isolation Project B");

  // The compact visible identity must lead with the project—not the shared
  // client—so sibling engagements cannot look like the same project. Client
  // and primary site remain on the supporting line.
  const identityA = pageA.locator("[data-project-identity]");
  const identityB = pageB.locator("[data-project-identity]");
  await expect(identityA.locator("strong")).toHaveText("Isolation Project A");
  await expect(identityB.locator("strong")).toHaveText("Isolation Project B");
  await expect(identityA.locator("span")).toHaveText(
    `Shared Isolation Client · ${new URL(projectA.siteUrl).host}`,
  );
  await expect(identityB.locator("span")).toHaveText(
    `Shared Isolation Client · ${new URL(projectB.siteUrl).host}`,
  );

  // The artifact-aligned Overview uses an editorial action statement as its
  // H1. Project identity remains explicit in the hero; scope the isolation
  // assertion there because the switcher intentionally lists every project
  // available to the operator.
  //
  // The `[data-overview-hero]` anchor was deleted with Slice 1's Overview
  // rewrite; the identity it guarded did not move off the surface, it moved
  // into the hero subtitle (`_overview.tsx:938`, `overview.customer.subtitle`
  // = "… {project} …"). The assertion follows it to the shipped surface rather
  // than the surface being trimmed to the assertion. `toContainText` replaces
  // an exact `getByText` because the name is now inside a sentence — for the
  // two negative assertions that is a STRICTLY STRONGER claim (no substring
  // anywhere in the hero, not merely no element whose whole text matches).
  const heroA = pageA.locator("[data-overview-page] > header");
  const heroB = pageB.locator("[data-overview-page] > header");
  await expect(heroA).toContainText("Isolation Project A");
  await expect(heroB).toContainText("Isolation Project B");
  await expect(heroA).not.toContainText("Isolation Project B");
  await expect(heroB).not.toContainText("Isolation Project A");

  // These two navigations were a Promise.all. Sequence both navigation AND
  // client-readiness deliberately: `goto()` settles after the Sources document
  // load, while its project-scoped React Query read can still be in flight.
  // Starting the Results navigation at that point makes the two projections
  // compete even though the first page has not become observable yet. Establish
  // Sources readiness before navigating the sibling tab, then assert it remains
  // visible after Results arrives. This keeps the isolation claim cross-tab
  // without coupling it to unrelated request timing.
  const sourceGridA = pageA.locator("[data-source-grid]");
  await pageA.goto(`/p/${projectA.projectId}/sources`);
  await expect(sourceGridA).toBeVisible();

  // Probed in isolation, the /report compat redirect resolves cleanly (307 ->
  // /results, goto settles), but an aborted compatibility navigation is still
  // tolerated exactly when the canonical URL below proves arrival.
  await pageB.goto(`/p/${projectB.projectId}/report`).catch((error) => {
    if (!String(error).includes("ERR_ABORTED")) throw error;
  });
  await pageB.waitForURL(`**/p/${projectB.projectId}/results`);
  await Promise.all([
    expect(sourceGridA).toBeVisible(),
    expect(pageB.locator("[data-report-page]")).toBeVisible(),
  ]);

  expect(pageA.url()).toContain(`/p/${projectA.projectId}/sources`);
  expect(pageB.url()).toContain(`/p/${projectB.projectId}/results`);

  // `<main>` belongs to the server-rendered shell and is visible before the
  // client queries begin. Wait for the page-specific projections above, then
  // prove each tab requested the expected project-scoped read models. This
  // retains AC-010's negative check below while avoiding a hydration race.
  await expect.poll(() => requestsA).toEqual(
    expect.arrayContaining([
      `/api/mvp/projects/${projectA.projectId}/sources`,
      `/api/mvp/projects/${projectA.projectId}/snapshots`,
    ]),
  );
  await expect.poll(() => requestsB).toEqual(
    expect.arrayContaining([
      `/api/mvp/projects/${projectB.projectId}/report`,
    ]),
  );
  expect(requestsA.length).toBeGreaterThan(0);
  expect(requestsB.length).toBeGreaterThan(0);
  expect(requestsA.every((path) => path.includes(projectA.projectId))).toBe(true);
  expect(requestsB.every((path) => path.includes(projectB.projectId))).toBe(true);

  await Promise.all([pageA.close(), pageB.close()]);
});

test("switching projects cannot replay a pending Growth Map query into the next project", async ({
  context,
  page,
  request,
}) => {
  const [projectA, projectB] = await Promise.all([
    seedProject(request, {
      clientName: "Pending Navigation Client",
      projectName: "Pending Navigation A",
      siteUrl: publicFixtureOrigin("pending-navigation-a"),
    }),
    seedProject(request, {
      clientName: "Pending Navigation Client",
      projectName: "Pending Navigation B",
      siteUrl: publicFixtureOrigin("pending-navigation-b"),
    }),
  ]);
  await context.addCookies([
    { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
  ]);

  const projectAUrl = `/p/${projectA.projectId}/growth-map`;
  const projectBUrl = `/p/${projectB.projectId}/growth-map`;
  await page.goto(projectAUrl);
  const growthMap = page.locator("[data-growth-map-page]");
  await expect(growthMap).toBeVisible();
  await growthMap.evaluate((element, projectId) => {
    element.setAttribute("data-project-instance-probe", projectId);
  }, projectA.projectId);
  const held = await holdProjectGrowthMapNavigations(page, projectA.projectId);

  try {
    await page
      .getByRole("navigation", { name: "Growth Map objects" })
      .getByRole("button", { name: /^Keyword library/ })
      .click({ noWaitAfter: true });
    await held.waitForRequest();
    await expect(growthMap).toHaveAttribute("data-navigation-pending", "");

    await page
      .getByRole("combobox", { name: "Switch project" })
      .selectOption(projectB.projectId, { noWaitAfter: true });
    await page.waitForURL(`**${projectBUrl}`);
  } finally {
    await held.release();
  }

  await expect(page.locator("[data-growth-map-page]")).not.toHaveAttribute(
    "data-navigation-pending",
    "",
  );
  await expect(page.locator("[data-growth-map-page]")).not.toHaveAttribute(
    "data-project-instance-probe",
    projectA.projectId,
  );
  await expect(
    page.getByRole("combobox", { name: "Switch project" }),
  ).toHaveValue(projectB.projectId);
  await expect(page).toHaveURL(projectBUrl);
  expect(new URL(page.url()).search).toBe("");
});
