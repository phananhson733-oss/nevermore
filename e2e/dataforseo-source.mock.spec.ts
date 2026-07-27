import { expect, test, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  sourceSlot,
} from "./mock-api.ts";

/** This spec asserts BOTH locales. The default UI locale is zh-CN
 *  (`packages/i18n/src/config.ts:6`), so its English assertions would otherwise
 *  be reading a Chinese page. The base locale is selected explicitly here; the
 *  tests that assert Chinese chrome still click the in-app locale switch, so
 *  neither half rides on the default. */
test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
});

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("enabled DataForSEO stays internal while its collection service remains available", async ({
  page,
}) => {
  const api = await installCriticalFlowApi(page);
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/sources`,
    (route) =>
      json(route, {
        data: [
          sourceSlot("crawl"),
          sourceSlot("gsc"),
          sourceSlot("ga4"),
          sourceSlot("csv"),
          sourceSlot("dataforseo", {
            id: null,
            state: "disconnected",
            featureEnabled: true,
            limitation:
              "DataForSEO ranked-keyword collection is enabled for the primary site. No snapshot has been collected yet.",
          }),
        ],
      }),
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  await expect(page.getByRole("main")).not.toContainText("DataForSEO");
  await expect(
    page.locator(
      '[data-customer-connector-card][data-provider="dataforseo"]',
    ),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByRole("main")).not.toContainText("DataForSEO");

  const status = await page.evaluate(async (projectId) => {
    const response = await fetch(
      `/api/mvp/projects/${projectId}/collection-runs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "dataforseo-internal-collection",
        },
        body: JSON.stringify({ provider: "dataforseo" }),
      },
    );
    return response.status;
  }, E2E_PROJECT_ID);

  expect(status).toBe(202);
  await expect.poll(() => api.collectionRequests.length).toBe(1);
  expect(api.collectionRequests[0]).toEqual({ provider: "dataforseo" });
});

test("a provisioned DataForSEO connection has no customer control while its service contract remains intact", async ({
  page,
}) => {
  await installCriticalFlowApi(page);
  const sourceConnectionId = "00000000-0000-4000-8000-000000000109";
  let connected = true;
  let disconnectRequests = 0;
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/sources`,
    (route) =>
      json(route, {
        data: [
          sourceSlot("crawl"),
          sourceSlot("gsc"),
          sourceSlot("ga4"),
          sourceSlot("csv"),
          sourceSlot("dataforseo", {
            id: connected ? sourceConnectionId : null,
            state: connected ? "available" : "disconnected",
            featureEnabled: true,
            connectedAt: connected ? "2026-07-20T00:00:00.000Z" : null,
            limitation: connected
              ? "DataForSEO is connected for ranked-keyword collection."
              : "DataForSEO is ready to reconnect on the next collection.",
          }),
        ],
      }),
  );
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/sources/${sourceConnectionId}`,
    async (route) => {
      expect(route.request().method()).toBe("DELETE");
      disconnectRequests += 1;
      connected = false;
      await route.fulfill({ status: 204 });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  await expect(page.getByRole("main")).not.toContainText("DataForSEO");
  await expect(
    page.getByRole("button", { name: "Disconnect — DataForSEO" }),
  ).toHaveCount(0);

  const status = await page.evaluate(
    async ({ projectId, sourceConnectionId }) => {
      const response = await fetch(
        `/api/mvp/projects/${projectId}/sources/${sourceConnectionId}`,
        { method: "DELETE" },
      );
      return response.status;
    },
    { projectId: E2E_PROJECT_ID, sourceConnectionId },
  );

  expect(status).toBe(204);
  await expect.poll(() => disconnectRequests).toBe(1);
  await page.reload();
  await expect(page.getByRole("main")).not.toContainText("DataForSEO");
});
