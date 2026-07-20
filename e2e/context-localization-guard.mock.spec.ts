import { expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;

const contextProfile = {
  id: "00000000-0000-4000-8000-000000000501",
  projectId: E2E_PROJECT_ID,
  version: 3,
  status: "draft",
  profile: {
    productName: "Customer-authored product name",
    oneLineDescription: "Customer-authored delivery copy",
    customerModel: "hybrid",
    businessProfile: "b2b_services",
    marketCodes: ["US"],
    siteLanguageCodes: ["en"],
    defaultDeliveryLocale: "en",
    segments: ["Customer-authored segment"],
    personas: [
      {
        name: "Customer-authored persona",
        roleOrContext: "Operations leader",
        jobs: ["Customer-authored job"],
        painPoints: ["Customer-authored pain"],
      },
    ],
    useCases: ["Customer-authored use case"],
    offers: ["Customer-authored offer"],
    differentiators: ["Customer-authored differentiator"],
    primaryConversion: { label: "Request a demo", type: "demo", targetUrl: null },
    priorityProductsOrServices: ["Customer-authored priority"],
    growthQuestions: ["Customer-authored question"],
    ninetyDayGoals: ["Customer-authored goal"],
  },
  contentHash: "sha256:e2e-context",
  createdAt: "2026-07-18T12:00:00.000Z",
};

let servedContext: typeof contextProfile | null = contextProfile;

test.beforeEach(async ({ page }) => {
  servedContext = contextProfile;
  await installCriticalFlowApi(page);
  await page.route(`**${BASE}/context`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: servedContext }),
    });
  });
});

test("zh-CN localizes Context controls and shell accessibility names without translating client content", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(page.getByText("版本 3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("目标市场")).toBeVisible();
  await expect(page.getByText("每行一项。", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("客户模式")).toHaveValue("hybrid");
  await expect(
    page.getByLabel("客户模式").getByRole("option", { name: "混合模式" }),
  ).toBeAttached();
  await expect(page.getByRole("navigation", { name: "项目分区" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "面包屑导航" })).toBeVisible();

  await expect(page.getByLabel("产品或服务名称")).toHaveValue(
    "Customer-authored product name",
  );
  await expect(page.getByLabel("一句话描述")).toHaveValue(
    "Customer-authored delivery copy",
  );
});

test("zh-CN localizes the new Context version label", async ({ page }) => {
  servedContext = null;
  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByText("新建", { exact: true })).toBeVisible();
});

test("dirty Context prevents unload and asks before internal project navigation", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await page.getByRole("button", { name: "简体中文" }).click();
  const productName = page.getByLabel("产品或服务名称");
  await productName.fill("Unsaved operator edit");
  await expect(page.getByText("有未保存的更改", { exact: true })).toBeVisible();

  await expect(
    page.evaluate(() => {
      // Chromium does not expose a constructible BeforeUnloadEvent. Dispatching
      // a cancelable Event exercises the registered beforeunload listener and
      // gives us its observable contract (`preventDefault`) deterministically.
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).resolves.toBe(true);

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("未保存");
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "数据源" }).click();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/context`);
  await expect(productName).toHaveValue("Unsaved operator edit");

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.accept();
  });
  await page.getByRole("link", { name: "数据源" }).click();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/sources`);
});

test("clean Context navigation proceeds without a confirmation", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await expect(
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).resolves.toBe(false);
  await page.getByRole("link", { name: "Sources" }).click();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/sources`);
});
