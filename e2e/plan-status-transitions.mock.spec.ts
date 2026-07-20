import { expect, test, type Page } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
} from "./mock-api.ts";

const STATUSES = [
  "candidate",
  "planned",
  "in_progress",
  "blocked",
  "done",
  "dismissed",
] as const;
type ActionStatus = (typeof STATUSES)[number];

const TARGETS: Readonly<Record<ActionStatus, readonly ActionStatus[]>> = {
  candidate: ["planned", "dismissed"],
  planned: ["in_progress", "blocked", "dismissed"],
  in_progress: ["done"],
  blocked: ["in_progress"],
  done: ["planned"],
  dismissed: ["planned"],
};

const EN_STATUS: Readonly<Record<ActionStatus, string>> = {
  candidate: "Candidate",
  planned: "Planned",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  dismissed: "Dismissed",
};

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const NOW = "2026-07-20T00:00:00.000Z";

interface PatchRequest {
  readonly actionId: string;
  readonly body: Readonly<Record<string, unknown>>;
}

let patchRequests: PatchRequest[];

function actionFixture(status: ActionStatus, index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(400 + index).padStart(12, "0")}`,
    findingId: `00000000-0000-4000-8000-${String(500 + index).padStart(12, "0")}`,
    templateId: `plan_${status}.v1`,
    title: `Action currently ${status}`,
    description: `Fixture for the ${status} status transition menu.`,
    contentLocale: "en",
    priorityBand: "medium",
    roadmapLane: "now",
    status,
    effort: "small",
    risk: "low",
    expectedOutcome: "The status menu exposes only frozen transitions.",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function installPlanActionsApi(page: Page): Promise<void> {
  await installCriticalFlowApi(page);
  const actions = STATUSES.map(actionFixture);
  patchRequests = [];

  // Registered after the broad critical-flow mock, so this focused handler gets
  // first refusal for Action list/update requests and falls back for all others.
  await page.route("**/api/mvp/projects/*/actions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === `${API_BASE}/actions`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: actions,
          meta: { nextCursor: null, hasNext: false, limit: 100 },
        }),
      });
      return;
    }

    if (
      request.method() === "PATCH" &&
      url.pathname.startsWith(`${API_BASE}/actions/`)
    ) {
      const actionId = url.pathname.slice(`${API_BASE}/actions/`.length);
      const body = request.postDataJSON() as Readonly<Record<string, unknown>>;
      patchRequests.push({ actionId, body });
      const action = actions.find((candidate) => candidate.id === actionId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            ...action,
            ...("status" in body ? { status: body["status"] } : {}),
            revision: 2,
          },
        }),
      });
      return;
    }

    await route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await installPlanActionsApi(page);
});

test("each Action status exposes only its frozen transition targets", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);
  await expect(
    page.getByRole("heading", {
      name: "A 90-day plan with receipts, not hunches.",
      exact: true,
    }),
  ).toBeVisible();

  for (const [index, status] of STATUSES.entries()) {
    await page
      .getByRole("button", { name: /^Open action details —/ })
      .nth(index)
      .click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: "Adjust plan" }).click();
    const form = drawer.getByRole("form", {
      name: `Manual override — Action currently ${status}`,
    });
    const select = form.getByLabel("New status");
    const optionValues = await select.locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
    const optionLabels = await select.locator("option").allTextContents();

    expect(optionValues).toEqual(["", ...TARGETS[status]]);
    expect(optionLabels).toEqual([
      `Keep current — ${EN_STATUS[status]}`,
      ...TARGETS[status].map((target) => EN_STATUS[target]),
    ]);
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(form).toHaveCount(0);
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toHaveCount(0);
  }
});

test("current state is a no-op, reason remains required, and keyboard selection submits one legal target", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);
  await page
    .getByRole("button", { name: /^Open action details —/ })
    .first()
    .click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Adjust plan" }).click();
  const form = drawer.getByRole("form", {
    name: "Manual override — Action currently candidate",
  });
  const select = form.getByLabel("New status");
  const reason = form.getByLabel("Reason");

  await select.focus();
  await expect(select).toBeFocused();
  await select.press("p");
  await expect(select).toHaveValue("planned");
  await expect(reason).toHaveAttribute("required", "");
  await form.getByRole("button", { name: "Apply override" }).click();
  expect(
    await reason.evaluate(
      (element) => (element as HTMLTextAreaElement).validity.valueMissing,
    ),
  ).toBe(true);
  expect(patchRequests).toHaveLength(0);

  await reason.fill("No");
  await form.getByRole("button", { name: "Apply override" }).click();
  await expect(form.getByRole("alert")).toContainText(
    "Enter a reason of at least 3 characters.",
  );
  expect(patchRequests).toHaveLength(0);

  await select.selectOption("");
  await reason.fill("Keep the candidate unchanged.");
  await form.getByRole("button", { name: "Apply override" }).click();
  await expect(form.getByRole("alert")).toContainText("Choose a new status");
  expect(patchRequests).toHaveLength(0);

  await select.focus();
  await select.press("p");
  await expect(select).toHaveValue("planned");
  await reason.fill("Move through the approved planning gate.");
  await form.getByRole("button", { name: "Apply override" }).click();
  await expect.poll(() => patchRequests.length).toBe(1);
  expect(patchRequests[0]).toMatchObject({
    body: {
      baseRevision: 1,
      status: "planned",
      reason: "Move through the approved planning gate.",
    },
  });
});

test("a stale revision keeps the drawer open, refetches, and exposes the stable conflict", async ({
  page,
}) => {
  const candidate = actionFixture("candidate", 0);
  let staleBody: Readonly<Record<string, unknown>> | null = null;
  await page.route(
    `**${API_BASE}/actions/${candidate.id}`,
    async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.fallback();
        return;
      }
      staleBody = route.request().postDataJSON() as Readonly<
        Record<string, unknown>
      >;
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "VERSION_CONFLICT",
          detail: "Action was modified; refetch and retry.",
          requestId: "plan-conflict-request",
        }),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);
  await page
    .getByRole("button", {
      name: `Open action details — ${candidate.title}`,
    })
    .click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Adjust plan" }).click();
  const form = drawer.getByRole("form", {
    name: `Manual override — ${candidate.title}`,
  });
  await form.getByLabel("New status").selectOption("planned");
  await form.getByLabel("Reason").fill("The operator has newer evidence.");
  await form.getByRole("button", { name: "Apply override" }).click();

  await expect(form.getByRole("alert")).toContainText(
    "This action was changed elsewhere",
  );
  await expect(drawer).toBeVisible();
  expect(staleBody).toMatchObject({
    baseRevision: 1,
    status: "planned",
    reason: "The operator has newer evidence.",
  });
});

test("done and dismissed recovery targets stay localized in zh-CN", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(
    page.getByRole("heading", {
      name: "一份有理有据、拒绝拍脑袋的 90 天计划。",
    }),
  ).toBeVisible();

  for (const [index, currentLabel] of [
    [4, "已完成"],
    [5, "已放弃"],
  ] as const) {
    await page
      .getByRole("button", { name: /^打开行动详情 —/ })
      .nth(index)
      .click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: "调整计划" }).click();
    const select = drawer.getByLabel("新状态");
    await expect(select.locator("option")).toHaveText([
      `保持不变 — ${currentLabel}`,
      "已计划",
    ]);
    await drawer.getByRole("button", { name: "取消" }).click();
    await drawer.getByRole("button", { name: "关闭" }).click();
  }
});
