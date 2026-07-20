import { expect, test, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  sourceSlot,
} from "./mock-api.ts";

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("enabled DataForSEO slot collects without inventing a client-side connection", async ({
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

  const dataForSeo = page.getByRole("region", { name: "DataForSEO" });
  await expect(dataForSeo).toContainText("Live");
  await expect(dataForSeo).toContainText("Disconnected");
  await expect(dataForSeo).toContainText(
    "This is not complete competitor-gap coverage.",
  );
  await expect(
    dataForSeo.getByRole("button", { name: "Collect ranking keywords" }),
  ).toBeEnabled();
  await expect(dataForSeo).not.toContainText("Not available in this MVP.");

  await page.getByRole("button", { name: "简体中文" }).click();
  const collect = dataForSeo.getByRole("button", { name: "采集排名关键词" });
  await expect(dataForSeo).toContainText("这并不代表完整的竞品差距覆盖");
  await collect.click();

  await expect.poll(() => api.collectionRequests.length).toBe(1);
  expect(api.collectionRequests[0]).toEqual({ provider: "dataforseo" });
});

test("a provisioned DataForSEO connection can be disconnected from the card", async ({
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

  const dataForSeo = page.getByRole("region", { name: "DataForSEO" });
  await dataForSeo
    .getByRole("button", { name: "Disconnect — DataForSEO" })
    .click();
  await expect.poll(() => disconnectRequests).toBe(1);
  await expect(dataForSeo).toContainText("Disconnected");
});
