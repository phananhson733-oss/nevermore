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
  // H1. Project identity remains explicit in the hero kicker; scope the
  // isolation assertion there because the switcher intentionally lists every
  // project available to the operator.
  const heroA = pageA.locator("[data-overview-hero]");
  const heroB = pageB.locator("[data-overview-hero]");
  await expect(heroA.getByText("Isolation Project A", { exact: true })).toBeVisible();
  await expect(heroB.getByText("Isolation Project B", { exact: true })).toBeVisible();
  await expect(heroA.getByText("Isolation Project B", { exact: true })).toHaveCount(0);
  await expect(heroB.getByText("Isolation Project A", { exact: true })).toHaveCount(0);

  await Promise.all([
    pageA.goto(`/p/${projectA.projectId}/sources`),
    pageB.goto(`/p/${projectB.projectId}/report`),
  ]);
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
