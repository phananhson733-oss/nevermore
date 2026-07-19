import { expect, test, type Page } from "@playwright/test";
import { seedProject } from "./fixtures.ts";

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
      clientName: "Isolation Client A",
      projectName: "Isolation Project A",
      siteUrl: "https://example.com",
    }),
    seedProject(request, {
      clientName: "Isolation Client B",
      projectName: "Isolation Project B",
      siteUrl: "https://www.iana.org",
    }),
  ]);

  const [pageA, pageB] = await Promise.all([context.newPage(), context.newPage()]);
  const requestsA = projectApiRequests(pageA);
  const requestsB = projectApiRequests(pageB);

  await Promise.all([
    pageA.goto(`/p/${projectA.projectId}/overview`),
    pageB.goto(`/p/${projectB.projectId}/overview`),
  ]);

  await expect(pageA.getByRole("heading", { name: "Isolation Project A" })).toBeVisible();
  await expect(pageB.getByRole("heading", { name: "Isolation Project B" })).toBeVisible();
  await expect(pageA.getByText("Isolation Project B", { exact: true })).toHaveCount(0);
  await expect(pageB.getByText("Isolation Project A", { exact: true })).toHaveCount(0);

  await Promise.all([
    pageA.goto(`/p/${projectA.projectId}/sources`),
    pageB.goto(`/p/${projectB.projectId}/report`),
  ]);
  await Promise.all([
    expect(pageA.getByRole("main")).toBeVisible(),
    expect(pageB.getByRole("main")).toBeVisible(),
  ]);

  expect(pageA.url()).toContain(`/p/${projectA.projectId}/sources`);
  expect(pageB.url()).toContain(`/p/${projectB.projectId}/report`);
  expect(requestsA.length).toBeGreaterThan(0);
  expect(requestsB.length).toBeGreaterThan(0);
  expect(requestsA.every((path) => path.includes(projectA.projectId))).toBe(true);
  expect(requestsB.every((path) => path.includes(projectB.projectId))).toBe(true);

  await Promise.all([pageA.close(), pageB.close()]);
});
