import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { publicFixtureOrigin } from "./fixtures.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

interface ProductProfileRead {
  readonly data: {
    readonly currentProfile: {
      readonly version: number;
      readonly status: "draft" | "complete";
      readonly profile: {
        readonly productName: string | null;
        readonly targetMarkets: readonly {
          readonly marketCode: string;
          readonly priority: "primary" | "secondary";
        }[];
        readonly targetAudiences: readonly {
          readonly reviewStatus: string;
          readonly targetCompanyOrAudience: string | null;
        }[];
        readonly fieldProvenance: readonly {
          readonly path: string;
          readonly derivation: string;
        }[];
      };
    } | null;
  };
}

test("persists the customer-entered Product Profile and ICP before opening live data connections", async ({
  page,
  request,
}) => {
  const origin = publicFixtureOrigin(`product-profile-${randomUUID()}`);
  const productUrl = `${origin}/product`;
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "zh-CN",
      url: BASE_URL,
    },
  ]);

  await page.goto("/new-project");
  await expect(page.getByRole("heading", { name: "添加产品" })).toBeVisible();
  // The heading is server-rendered while the form is a hydrated client island.
  // Wait before editing so hydration cannot replace already-filled controls.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("产品 URL").fill(productUrl);
  await page
    .getByLabel("产品与客户背景（选填）")
    .fill("面向北美 B2B SaaS 客户运营团队的 onboarding automation 产品。");

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/mvp/projects",
  );
  await page
    .getByRole("button", { name: "创建产品并填写画像" })
    .click();
  const created = await createResponse;
  expect(
    created.status(),
    `URL-first product creation failed: ${await created.text()}`,
  ).toBe(201);
  expect(created.request().postDataJSON()).toEqual({
    mode: "product_profile",
    productUrl,
    businessHint:
      "面向北美 B2B SaaS 客户运营团队的 onboarding automation 产品。",
  });

  await page.waitForURL(/\/p\/[0-9a-f-]+\/context$/);
  const projectId = new URL(page.url()).pathname.split("/")[2];
  if (!projectId) throw new Error("URL-first creation did not expose a project id");
  expect(created.headers()["location"]).toBe(`/p/${projectId}/context`);

  await expect(
    page.getByRole("link", { name: "连接真实数据" }),
  ).toHaveCount(0);
  await page.goto(`/p/${projectId}/sources`);
  await page.waitForURL(`/p/${projectId}/context`);
  await expect(
    page.getByRole("button", { name: "编辑产品画像与 ICP" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "编辑产品画像与 ICP" }).click();
  const editor = page.getByRole("dialog", {
    name: "编辑产品画像与核心 ICP",
  });
  await editor.getByLabel("产品名称").fill("RelayOps");
  await editor
    .getByLabel("一句话定位")
    .fill("帮助海外 B2B 团队标准化客户 onboarding 的运营平台。");
  await editor.getByLabel("产品类别").fill("Customer Operations");
  await editor.getByLabel("产品类型").selectOption("B2B SaaS");
  await editor.getByRole("checkbox", { name: "订阅", exact: true }).check();
  await editor
    .getByLabel("价值主张")
    .fill("缩短客户价值实现时间，同时保持跨团队交接的一致性。");
  await editor
    .getByLabel("核心功能")
    .fill("Onboarding 工作流\n跨团队交接追踪");
  await editor.getByLabel("主要海外市场").selectOption("US");
  await editor.getByLabel("核心 ICP 候选").selectOption("__new__");
  await editor
    .getByLabel("目标企业 / 目标用户")
    .fill("拥有 50–500 名员工的 B2B SaaS 企业");
  await editor.getByLabel("采购决策角色").fill("VP Customer Success");
  await editor.getByLabel("实际使用角色").fill("Customer Operations Lead");
  await editor.getByLabel("使用场景").fill("标准化客户 onboarding");
  await editor.getByLabel("购买触发因素").fill("客户实施量快速增长");
  await editor.getByLabel("核心痛点").fill("跨团队交接不一致");
  await editor.getByLabel("JTBD").fill("让新客户可预测地完成上线");
  await editor.getByLabel("预期结果").fill("更短的 Time to Value");
  await editor.getByLabel("决策阻力").fill("现有工具分散");
  await editor
    .getByLabel("合格信号")
    .fill("设有专职 Customer Operations 团队");

  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname ===
        `/api/mvp/projects/${projectId}/product-profile`,
  );
  await editor.getByRole("button", { name: "保存为新版本" }).click();
  const saved = await saveResponse;
  expect(
    saved.status(),
    `manual Product Profile save failed: ${await saved.text()}`,
  ).toBe(200);
  await expect(editor).toBeHidden();

  const confirmButton = page.getByRole("button", {
    name: "确认产品画像",
    exact: true,
  });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  const confirmation = page.getByRole("dialog", {
    name: "确认这份产品画像？",
  });
  await expect(confirmation).toContainText("确认后会进入真实数据连接");

  const confirmResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/mvp/projects/${projectId}/product-profile/confirm`,
  );
  await confirmation
    .getByRole("button", { name: "确认并进入数据连接" })
    .click();
  const confirmed = await confirmResponse;
  expect(
    confirmed.status(),
    `Product Profile confirmation failed: ${await confirmed.text()}`,
  ).toBe(200);
  await page.waitForURL(`/p/${projectId}/sources`);

  await expect(page.getByRole("heading", { name: "数据来源" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "客户可管理连接" }),
  ).toBeVisible();
  await expect(page.getByText("Search Console", { exact: true })).toBeVisible();
  await expect(page.getByText("Google Analytics 4", { exact: true })).toBeVisible();
  await expect(page.getByText("GitHub", { exact: true })).toBeVisible();

  const staleRunId = randomUUID();
  const staleRunResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname ===
        `/api/mvp/projects/${projectId}/runs/${staleRunId}`,
  );
  await page.goto(
    `/p/${projectId}/sources?keep=customer-context&analysisRefreshRunId=${staleRunId}#source-readiness`,
  );
  expect((await staleRunResponse).status()).toBe(404);
  await expect(page).toHaveURL(
    new RegExp(
      `/p/${projectId}/sources\\?keep=customer-context#source-readiness$`,
    ),
  );
  await expect(
    page.getByText(
      "链接中的分析任务不存在或不属于当前产品，已清除该任务指针。你现在可以重新启动更新；若已有任务正在运行，系统会自动接管它。",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "更新分析数据" }),
  ).toBeEnabled();

  const persistedResponse = await request.get(
    `/api/mvp/projects/${projectId}/product-profile`,
  );
  expect(
    persistedResponse.status(),
    `Product Profile read-back failed: ${await persistedResponse.text()}`,
  ).toBe(200);
  const persisted = (await persistedResponse.json()) as ProductProfileRead;
  expect(persisted.data.currentProfile).toMatchObject({
    version: 3,
    status: "complete",
    profile: {
      productName: "RelayOps",
      targetMarkets: [{ marketCode: "US", priority: "primary" }],
      targetAudiences: [
        {
          reviewStatus: "primary",
          targetCompanyOrAudience: "拥有 50–500 名员工的 B2B SaaS 企业",
        },
      ],
    },
  });
  expect(
    persisted.data.currentProfile?.profile.fieldProvenance,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "/productName",
        derivation: "declared",
      }),
      expect.objectContaining({
        path: "/productType",
        derivation: "declared",
      }),
      expect.objectContaining({
        path: "/businessModels",
        derivation: "declared",
      }),
      expect.objectContaining({
        path: "/targetMarkets",
        derivation: "declared",
      }),
      expect.objectContaining({
        path: "/targetAudiences",
        derivation: "declared",
      }),
    ]),
  );
});
