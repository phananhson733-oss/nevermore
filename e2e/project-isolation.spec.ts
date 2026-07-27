import { expect, test, type Page } from "@playwright/test";
import { publicFixtureOrigin, seedProject } from "./fixtures.ts";

function projectApiRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/mvp/projects/")) urls.push(url.pathname);
  });
  return urls;
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

  // These two navigations were a Promise.all. Sequenced deliberately: probed
  // in isolation, the /report compat redirect resolves cleanly (307 ->
  // /results, goto settles), but racing it against the sources navigation in
  // a second tab of the same dev server aborts one navigation
  // deterministically (first-compile contention). Isolation is about state,
  // not simultaneity, so the claim is unchanged; the goto still tolerates
  // exactly the abort error with the URL assertion below as the arrival
  // signal.
  await pageA.goto(`/p/${projectA.projectId}/sources`);
  await pageB.goto(`/p/${projectB.projectId}/report`).catch((error) => {
    if (!String(error).includes("ERR_ABORTED")) throw error;
  });
  await pageB.waitForURL(`**/p/${projectB.projectId}/results`);
  await Promise.all([
    expect(pageA.locator("[data-source-grid]")).toBeVisible(),
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
