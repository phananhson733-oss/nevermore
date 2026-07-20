import { expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;

test("Studio renders artifacts before actions and defers project metadata", async ({
  page,
}) => {
  await installCriticalFlowApi(page);

  let releaseActions: (() => void) | undefined;
  const actionsReleased = new Promise<void>((resolve) => {
    releaseActions = resolve;
  });
  let actionReads = 0;
  let projectReads = 0;

  await page.route(`**${API_BASE}/actions**`, async (route) => {
    actionReads += 1;
    await actionsReleased;
    await route.fallback();
  });
  await page.route(`**${API_BASE}`, async (route) => {
    projectReads += 1;
    await route.fallback();
  });

  try {
    await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
    await expect.poll(() => actionReads).toBe(1);

    // Artifact data is already usable, so an unrelated slow action lookup must
    // not replace the whole screen with a loading state.
    await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();
    await expect(
      page.getByText("Technical ticket", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Fix the failing product page", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Generate artifact" }),
    ).toBeDisabled();
    expect(projectReads).toBe(0);

    releaseActions?.();
    releaseActions = undefined;

    await expect(
      page.getByText("Fix the failing product page", { exact: true }),
    ).toBeVisible();
    const generate = page.getByRole("button", { name: "Generate artifact" });
    await expect(generate).toBeEnabled();
    expect(projectReads).toBe(0);

    // Project language recommendations are fetched only after an action is
    // chosen, not during Studio's first paint or while browsing the picker.
    await generate.click();
    await expect(
      page.getByRole("heading", { name: "Pick an action" }),
    ).toBeVisible();
    expect(projectReads).toBe(0);
    await page
      .getByRole("listitem")
      .filter({ hasText: "Fix the failing product page" })
      .getByRole("button", { name: /Generate|Regenerate/ })
      .click();
    await expect(page.getByLabel("Output language")).toHaveValue("en");
    await expect.poll(() => projectReads).toBe(1);
  } finally {
    releaseActions?.();
  }
});
