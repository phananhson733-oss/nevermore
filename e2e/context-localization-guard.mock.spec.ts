import { expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const CAPTURE_DIR = process.env["SF_CAPTURE_DIR"];

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

test("Profile Lens never substitutes product instructions for a missing client description", async ({
  page,
}) => {
  servedContext = {
    ...contextProfile,
    profile: { ...contextProfile.profile, oneLineDescription: "" },
  };

  await page.goto(`/p/${E2E_PROJECT_ID}/context`);

  const lens = page.locator("[data-context-rail]");
  await expect(
    lens.getByText("Nothing to show yet", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    lens.getByText(
      "Define the ideal customer profile that grounds every diagnosis.",
      { exact: true },
    ),
  ).toHaveCount(0);
});

test("Context preserves its editorial form and dark Profile Lens at desktop and mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await expect(page.locator("[data-context-rail]")).toBeVisible();
  if (CAPTURE_DIR !== undefined) {
    await page.screenshot({
      path: `${CAPTURE_DIR}/context-page-1920.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-context-rail]")).toBeVisible();
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  if (CAPTURE_DIR !== undefined) {
    await page.screenshot({
      path: `${CAPTURE_DIR}/context-page-390.png`,
      fullPage: true,
    });
  }
});

test("numbered goals expose help and server validation to every editable row", async ({
  page,
}) => {
  await page.route(`**${BASE}/context`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "https://example.test/problems/validation",
        title: "Validation failed",
        status: 422,
        code: "VALIDATION_ERROR",
        detail: "The profile is incomplete.",
        requestId: "req-context-goals",
        errors: [
          {
            pointer: "/profile/ninetyDayGoals",
            code: "too_small",
            message: "At least one qualified goal is required.",
          },
        ],
      }),
    });
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/context`);

  const goals = page.getByRole("group", { name: "90-day goals" });
  await goals.getByRole("button", { name: "90-day goals", exact: true }).click();
  const inputs = goals.getByRole("textbox");
  await expect(inputs).toHaveCount(2);

  const helpWiring = await inputs.evaluateAll((elements) =>
    elements.map((element) => {
      const ids = (element.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean);
      return {
        id: element.id,
        descriptions: ids.map((id) => document.getElementById(id)?.textContent ?? null),
      };
    }),
  );
  expect(helpWiring.every(({ id }) => id.length > 0)).toBe(true);
  expect(
    helpWiring.every(({ descriptions }) => descriptions.includes("One item per line.")),
  ).toBe(true);

  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(inputs.first()).toHaveAttribute("aria-invalid", "true");

  const errorWiring = await inputs.evaluateAll((elements) =>
    elements.map((element) => {
      const errorId = element.getAttribute("aria-errormessage");
      const describedBy = (element.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean);
      return {
        errorId,
        errorExists: errorId !== null && document.getElementById(errorId) !== null,
        describedByError: errorId !== null && describedBy.includes(errorId),
      };
    }),
  );
  expect(
    errorWiring.every(
      ({ errorId, errorExists, describedByError }) =>
        errorId !== null && errorExists && describedByError,
    ),
  ).toBe(true);
});

test("an aggregate personas error is exposed by the group and every row control", async ({
  page,
}) => {
  await page.route(`**${BASE}/context`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "https://example.test/problems/validation",
        title: "Validation failed",
        status: 422,
        code: "VALIDATION_ERROR",
        detail: "The profile is incomplete.",
        requestId: "req-context-personas",
        errors: [
          {
            pointer: "/profile/personas",
            code: "too_small",
            message: "At least one qualified persona is required.",
          },
        ],
      }),
    });
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await page.getByRole("button", { name: "Mark complete" }).click();

  const personas = page.getByRole("group", { name: "Personas" });
  await expect(personas).toHaveAttribute("aria-invalid", "true");
  const controls = personas.getByRole("textbox");
  await expect(controls).toHaveCount(4);

  const groupWiring = await personas.evaluate((element) => {
    const errorId = element.getAttribute("aria-errormessage");
    const describedBy = (element.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    return {
      errorId,
      errorExists: errorId !== null && document.getElementById(errorId) !== null,
      describedByError: errorId !== null && describedBy.includes(errorId),
    };
  });
  expect(groupWiring).toMatchObject({
    errorExists: true,
    describedByError: true,
  });

  const controlWiring = await controls.evaluateAll((elements) =>
    elements.map((element) => {
      const errorId = element.getAttribute("aria-errormessage");
      const describedBy = (element.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean);
      return {
        id: element.id,
        invalid: element.getAttribute("aria-invalid"),
        errorId,
        errorExists: errorId !== null && document.getElementById(errorId) !== null,
        describedByError: errorId !== null && describedBy.includes(errorId),
      };
    }),
  );
  expect(
    controlWiring.every(
      ({ id, invalid, errorId, errorExists, describedByError }) =>
        id.length > 0 &&
        invalid === "true" &&
        errorId !== null &&
        errorExists &&
        describedByError,
    ),
  ).toBe(true);
});

test("a successful draft save removes an unpersisted empty goal row", async ({
  page,
}) => {
  let patchCount = 0;
  await page.route(`**${BASE}/context`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    patchCount += 1;
    const body = route.request().postDataJSON() as {
      readonly profile: { readonly ninetyDayGoals?: readonly string[] };
    };
    const persistedGoals = [...(body.profile.ninetyDayGoals ?? [])];
    expect(persistedGoals).toEqual(["Customer-authored goal"]);
    servedContext = {
      ...contextProfile,
      version: 4,
      profile: {
        ...contextProfile.profile,
        ninetyDayGoals: persistedGoals,
      },
      contentHash: "sha256:e2e-context-v4",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: servedContext }),
    });
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  const goals = page.getByRole("group", { name: "90-day goals" });
  await goals.getByRole("button", { name: "90-day goals", exact: true }).click();
  await expect(goals.getByRole("textbox")).toHaveCount(2);

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect.poll(() => patchCount).toBe(1);
  await expect(page.getByText("Saved just now", { exact: true })).toBeVisible();
  await expect(goals.getByRole("textbox")).toHaveCount(1);
  await expect(goals.getByRole("textbox")).toHaveValue(
    "Customer-authored goal",
  );

  await page.reload();
  const reloadedGoals = page.getByRole("group", { name: "90-day goals" });
  await expect(reloadedGoals.getByRole("textbox")).toHaveCount(1);
  await expect(reloadedGoals.getByRole("textbox")).toHaveValue(
    "Customer-authored goal",
  );
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
