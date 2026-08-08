import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Page,
  type Route,
} from "@playwright/test";
import {
  ConfirmedProductProfileRowDto as ConfirmedProductProfileRowSchema,
  ProductProfileDraft as ProductProfileDraftSchema,
  ProductProfileDraftRowDto as ProductProfileDraftRowSchema,
  type ConfirmedProductProfileRowDto,
  type ProductProfileDraft,
  type ProductProfileDraftRowDto,
  type ProductProfileRowDto,
  type ProductProfileTargetAudience,
} from "../packages/contracts/src/index.ts";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  type CriticalFlowApiState,
} from "./mock-api.ts";

const NOW = "2026-07-22T08:30:00.000Z";
const PROFILE_PATH =
  `/api/mvp/projects/${E2E_PROJECT_ID}/product-profile` as const;
const RUNS_PATH = `/api/mvp/projects/${E2E_PROJECT_ID}/runs` as const;
const SITE_ID = "00000000-0000-4000-8000-000000000043";
const PROFILE_ROW_ID = "00000000-0000-4000-8000-000000000601";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000602";
const INVOCATION_ID = "00000000-0000-4000-8000-000000000603";
const PRIMARY_AUDIENCE_ID = "00000000-0000-4000-8000-000000000610";
const SECONDARY_AUDIENCE_ID = "00000000-0000-4000-8000-000000000611";
const GUIDE_CX_ID = "00000000-0000-4000-8000-000000000620";
const USERPILOT_ID = "00000000-0000-4000-8000-000000000621";
const APPCUES_ID = "00000000-0000-4000-8000-000000000622";
const DECLARED_COMPETITOR_ID = "00000000-0000-4000-8000-000000000623";
const SYNTHESIS_RUN_ID = "00000000-0000-4000-8000-000000000630";

interface ProductProfileRun {
  readonly id: string;
  readonly projectId: string;
  readonly kind: string;
  readonly status:
    | "queued"
    | "running"
    | "completed"
    | "partial"
    | "failed"
    | "cancelled";
  readonly progress: {
    readonly phase: string;
    readonly current: number;
    readonly total: number | null;
    readonly messageKey: string;
  };
  readonly lastError: { readonly code: string; readonly summary: string } | null;
  readonly resultRef: { readonly type: string; readonly id: string } | null;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

interface ProductProfileWorkspace {
  readonly projectId: string;
  readonly currentProfile: ProductProfileRowDto | null;
  readonly confirmedProfile: ConfirmedProductProfileRowDto | null;
  readonly activeSynthesisRun:
    | (ProductProfileRun & {
        readonly kind: "product_profile_synthesis";
        readonly status: "queued" | "running";
        readonly resultRef: null;
      })
    | null;
  readonly activeCrawlRun:
    | (ProductProfileRun & {
        readonly kind: "collection";
        readonly status: "queued" | "running";
        readonly resultRef: null;
      })
    | null;
}

const PRIMARY_AUDIENCE = {
  candidateId: PRIMARY_AUDIENCE_ID,
  reviewStatus: "primary",
  targetCompanyOrAudience: "B2B SaaS companies with 50–500 employees",
  buyerRoles: ["VP Customer Success"],
  userRoles: ["Customer Operations Lead"],
  useCases: ["Standardize onboarding handoffs"],
  triggers: ["Rising implementation volume"],
  pains: ["Inconsistent handoffs"],
  jtbd: ["Launch customers predictably"],
  outcomes: ["Shorter time to value"],
  barriers: ["Fragmented tooling"],
  qualificationSignals: ["Dedicated customer operations team"],
  disqualifiers: ["No repeatable onboarding motion"],
} as const satisfies ProductProfileTargetAudience;

const SECONDARY_AUDIENCE = {
  candidateId: SECONDARY_AUDIENCE_ID,
  reviewStatus: "secondary",
  targetCompanyOrAudience: "Implementation agencies serving global SaaS teams",
  buyerRoles: ["Agency Principal"],
  userRoles: ["Implementation Manager"],
  useCases: ["Coordinate multi-client implementations"],
  triggers: ["Portfolio delivery is scaling"],
  pains: ["Cross-client work is hard to standardize"],
  jtbd: ["Deliver each implementation on schedule"],
  outcomes: ["More predictable delivery margin"],
  barriers: ["Client-specific process variance"],
  qualificationSignals: ["Runs five or more concurrent implementations"],
  disqualifiers: ["One-off consulting only"],
} as const satisfies ProductProfileTargetAudience;

const SEMANTIC_ROOTS = [
  "/businessHint",
  "/productName",
  "/customerModel",
  "/growthObjectives",
  "/oneLiner",
  "/category",
  "/productType",
  "/businessModels",
  "/valueProposition",
  "/coreFeatures",
  "/targetMarkets",
  "/targetAudiences",
  "/competitorCandidates",
] as const;

function productProfileFixture(): ProductProfileDraft {
  return ProductProfileDraftSchema.parse({
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: SITE_ID,
    sourcePageUrl: "https://relayops.com/product/",
    sourceSnapshotId: SNAPSHOT_ID,
    analysisInvocationId: INVOCATION_ID,
    generatedAt: NOW,
    businessHint: "Chinese B2B team serving an overseas market.",
    productName: "RelayOps API Canonical",
    customerModel: "b2b",
    growthObjectives: ["increase_signups", "increase_ai_visibility"],
    oneLiner: "Customer onboarding operations for global B2B teams.",
    category: "Customer Operations",
    productType: "B2B SaaS",
    businessModels: ["Subscription"],
    valueProposition:
      "Standardize complex onboarding without slowing customer-facing teams.",
    coreFeatures: ["Workflow orchestration", "Handoff visibility"],
    targetMarkets: [
      { marketCode: "US", priority: "primary" },
      { marketCode: "GB", priority: "secondary" },
    ],
    targetAudiences: [PRIMARY_AUDIENCE, SECONDARY_AUDIENCE],
    competitorCandidates: [
      {
        candidateId: GUIDE_CX_ID,
        name: "GuideCX",
        domain: "guidecx.com",
        relationship: "direct",
        analysisScope: ["positioning", "keyword_gap"],
        similarity: 0.88,
        reason: "Overlapping customer onboarding workflow category.",
        reviewStatus: "approved",
        confidence: "high",
      },
      {
        candidateId: USERPILOT_ID,
        name: "Userpilot",
        domain: "userpilot.com",
        relationship: null,
        analysisScope: [],
        similarity: 0.64,
        reason: "Discovered from the onboarding software SERP.",
        reviewStatus: "candidate",
        confidence: "medium",
      },
      {
        candidateId: APPCUES_ID,
        name: "Appcues",
        domain: "appcues.com",
        relationship: null,
        analysisScope: [],
        similarity: 0.42,
        reason: "Reviewed and excluded from the direct comparison set.",
        reviewStatus: "excluded",
        confidence: "medium",
      },
    ],
    fieldProvenance: SEMANTIC_ROOTS.map((path, index) => ({
      path,
      derivation: "declared",
      confidence: "high",
      evidenceRefs: [
        {
          evidenceRefId: `00000000-0000-4000-8000-${String(700 + index).padStart(12, "0")}`,
          kind: "userEdit",
        },
      ],
      limitation: null,
      observedAt: null,
    })),
    missingFields: [],
    conflictingFields: [],
  });
}

function contentHash(version: number): string {
  return (version % 16).toString(16).repeat(64);
}

function draftRow(
  profile: ProductProfileDraft = productProfileFixture(),
  version = 4,
): ProductProfileDraftRowDto {
  return ProductProfileDraftRowSchema.parse({
    id: PROFILE_ROW_ID,
    projectId: E2E_PROJECT_ID,
    version,
    status: "draft",
    profile,
    contentHash: contentHash(version),
    createdAt: NOW,
    isCurrent: true,
    isConfirmed: false,
  });
}

function draftWorkspace(
  activeSynthesisRun: ProductProfileWorkspace["activeSynthesisRun"] = null,
  activeCrawlRun: ProductProfileWorkspace["activeCrawlRun"] = null,
): ProductProfileWorkspace {
  return {
    projectId: E2E_PROJECT_ID,
    currentProfile: draftRow(),
    confirmedProfile: null,
    activeSynthesisRun,
    activeCrawlRun,
  };
}

function ungeneratedDraftWorkspace(
  activeCrawlRun: ProductProfileWorkspace["activeCrawlRun"] = null,
): ProductProfileWorkspace {
  const profile = ProductProfileDraftSchema.parse({
    ...productProfileFixture(),
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
  });
  return {
    projectId: E2E_PROJECT_ID,
    currentProfile: draftRow(profile),
    confirmedProfile: null,
    activeSynthesisRun: null,
    activeCrawlRun,
  };
}

function runningSynthesisRun(): ProductProfileRun & {
  readonly kind: "product_profile_synthesis";
  readonly status: "running";
  readonly resultRef: null;
} {
  return {
    id: SYNTHESIS_RUN_ID,
    projectId: E2E_PROJECT_ID,
    kind: "product_profile_synthesis",
    status: "running",
    progress: {
      phase: "analyzing_frozen_snapshot",
      current: 2,
      total: 5,
      messageKey: "worker.product_profile.running",
    },
    lastError: null,
    resultRef: null,
    queuedAt: NOW,
    startedAt: "2026-07-22T08:30:01.000Z",
    completedAt: null,
  };
}

function runningCrawlRun(): ProductProfileRun & {
  readonly kind: "collection";
  readonly status: "running";
  readonly resultRef: null;
} {
  return {
    id: "collection-run",
    projectId: E2E_PROJECT_ID,
    kind: "collection",
    status: "running",
    progress: {
      phase: "collecting",
      current: 1,
      total: 3,
      messageKey: "worker.collection.raw_key",
    },
    lastError: null,
    resultRef: null,
    queuedAt: NOW,
    startedAt: NOW,
    completedAt: null,
  };
}

interface ProductProfileApiState {
  workspace: ProductProfileWorkspace;
  readonly critical: CriticalFlowApiState;
  readonly reads: string[];
  readonly draftPatches: unknown[];
  readonly competitorReviews: unknown[];
  readonly competitorAdds: unknown[];
  readonly confirmations: unknown[];
  readonly synthesisStarts: unknown[];
  readonly auditStarts: string[];
  readonly runs: Map<string, ProductProfileRun>;
}

async function json(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });
}

function currentDraft(state: ProductProfileApiState): ProductProfileDraftRowDto {
  const current = state.workspace.currentProfile;
  if (!current || current.status !== "draft") {
    throw new Error("Product Profile mock expected a current draft row");
  }
  return current;
}

function replaceCurrentDraft(
  state: ProductProfileApiState,
  profile: ProductProfileDraft,
): ProductProfileDraftRowDto {
  const current = currentDraft(state);
  const next = draftRow(profile, current.version + 1);
  state.workspace = { ...state.workspace, currentProfile: next };
  return next;
}

async function installProductProfileApi(
  page: Page,
  initialWorkspace: ProductProfileWorkspace = draftWorkspace(),
  options: {
    readonly requireCrawlBeforeSynthesis?: boolean;
  } = {},
): Promise<ProductProfileApiState> {
  const critical = await installCriticalFlowApi(page);
  const state: ProductProfileApiState = {
    workspace: initialWorkspace,
    critical,
    reads: [],
    draftPatches: [],
    competitorReviews: [],
    competitorAdds: [],
    confirmations: [],
    synthesisStarts: [],
    auditStarts: [],
    runs: new Map(),
  };
  if (initialWorkspace.activeSynthesisRun) {
    state.runs.set(
      initialWorkspace.activeSynthesisRun.id,
      initialWorkspace.activeSynthesisRun,
    );
  }

  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path.includes("/diagnostic-runs") || path.includes("/audit")) {
      state.auditStarts.push(path);
    }
  });

  await page.route(`**${RUNS_PATH}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const runId = path.split("/").at(-1) ?? "";
    const run = state.runs.get(runId);
    if (request.method() === "GET" && run) {
      await json(route, run);
      return;
    }
    // Collection runs belong to the shared critical-flow mock installed
    // below this Product Profile-specific route.
    if (request.method() === "GET" && runId === "collection-run") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 501,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Product Profile mock route missing",
        status: 501,
        code: "E2E_PRODUCT_PROFILE_ROUTE_MISSING",
        detail: `${request.method()} ${path} is not mocked.`,
        requestId: "e2e-product-profile",
      }),
    });
  });

  await page.route(`**${PROFILE_PATH}**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (method === "GET" && path === PROFILE_PATH) {
      state.reads.push(path);
      await json(route, state.workspace);
      return;
    }

    if (method === "PATCH" && path === PROFILE_PATH) {
      const body = request.postDataJSON() as {
        readonly baseVersion: number;
        readonly patch: Partial<ProductProfileDraft>;
      };
      state.draftPatches.push(body);
      const nextProfile = ProductProfileDraftSchema.parse({
        ...currentDraft(state).profile,
        ...body.patch,
      });
      await json(route, replaceCurrentDraft(state, nextProfile));
      return;
    }

    if (method === "POST" && path === `${PROFILE_PATH}/synthesis-runs`) {
      const body = request.postDataJSON();
      state.synthesisStarts.push(body);
      if (
        options.requireCrawlBeforeSynthesis &&
        state.synthesisStarts.length === 1 &&
        state.critical.collectionRunPolls < 3
      ) {
        await route.fulfill({
          status: 422,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "about:blank",
            title: "A current Crawl snapshot is required.",
            status: 422,
            code: "CRAWL_SNAPSHOT_REQUIRED",
            detail: "The submitted Product URL is not present in a current Crawl snapshot.",
            requestId: "e2e-product-profile-needs-crawl",
          }),
        });
        return;
      }
      const run = runningSynthesisRun();
      state.runs.set(run.id, run);
      state.workspace = { ...state.workspace, activeSynthesisRun: run };
      await json(
        route,
        {
          run,
          statusUrl: `${RUNS_PATH}/${run.id}`,
          resourceRef: null,
        },
        202,
      );
      return;
    }

    if (
      method === "PATCH" &&
      path.startsWith(`${PROFILE_PATH}/competitors/`)
    ) {
      const candidateId = path.split("/").at(-1) ?? "";
      const body = request.postDataJSON() as {
        readonly baseVersion: number;
        readonly reviewStatus: "candidate" | "approved" | "excluded";
        readonly relationship?: "direct" | "indirect" | null;
        readonly analysisScope?: readonly (
          | "positioning"
          | "product_capability"
          | "keyword_gap"
          | "content"
          | "serp_visibility"
        )[];
        readonly reason?: string;
        readonly similarity?: number | null;
      };
      state.competitorReviews.push({ candidateId, body });
      const current = currentDraft(state);
      const nextProfile = ProductProfileDraftSchema.parse({
        ...current.profile,
        competitorCandidates: current.profile.competitorCandidates.map(
          (candidate) =>
            candidate.candidateId === candidateId
              ? {
                  ...candidate,
                  reviewStatus: body.reviewStatus,
                  relationship:
                    "relationship" in body
                      ? body.relationship
                      : candidate.relationship,
                  analysisScope:
                    body.analysisScope ?? candidate.analysisScope,
                  reason: body.reason ?? candidate.reason,
                  similarity:
                    "similarity" in body
                      ? body.similarity
                      : candidate.similarity,
                }
              : candidate,
        ),
      });
      await json(route, replaceCurrentDraft(state, nextProfile));
      return;
    }

    if (method === "POST" && path === `${PROFILE_PATH}/competitors`) {
      const body = request.postDataJSON() as {
        readonly baseVersion: number;
        readonly name: string;
        readonly domain: string;
        readonly relationship: "direct" | "indirect";
        readonly analysisScope: readonly (
          | "positioning"
          | "product_capability"
          | "keyword_gap"
          | "content"
          | "serp_visibility"
        )[];
        readonly reason?: string;
      };
      state.competitorAdds.push(body);
      const current = currentDraft(state);
      const nextProfile = ProductProfileDraftSchema.parse({
        ...current.profile,
        competitorCandidates: [
          ...current.profile.competitorCandidates,
          {
            candidateId: DECLARED_COMPETITOR_ID,
            name: body.name,
            domain: body.domain,
            relationship: body.relationship,
            analysisScope: body.analysisScope,
            similarity: null,
            reason: body.reason ?? "Customer-declared competitor.",
            reviewStatus: "approved",
            confidence: "high",
          },
        ],
      });
      await json(route, replaceCurrentDraft(state, nextProfile));
      return;
    }

    if (method === "POST" && path === `${PROFILE_PATH}/confirm`) {
      const body = request.postDataJSON();
      state.confirmations.push(body);
      const current = currentDraft(state);
      const confirmed: ConfirmedProductProfileRowDto =
        ConfirmedProductProfileRowSchema.parse({
          ...current,
          status: "complete",
          isConfirmed: true,
        });
      state.workspace = {
        ...state.workspace,
        currentProfile: confirmed,
        confirmedProfile: confirmed,
        activeSynthesisRun: null,
      };
      await json(route, confirmed);
      return;
    }

    await route.fulfill({
      status: 501,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Product Profile mock route missing",
        status: 501,
        code: "E2E_PRODUCT_PROFILE_ROUTE_MISSING",
        detail: `${method} ${path} is not mocked.`,
        requestId: "e2e-product-profile",
      }),
    });
  });

  return state;
}

async function useChineseUi(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "zh-CN",
      domain: "localhost",
      path: "/",
    },
  ]);
}

async function gotoProductProfile(page: Page): Promise<void> {
  await useChineseUi(page);
  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await expect(
    page.getByRole("heading", { name: "RelayOps API Canonical" }),
  ).toBeVisible();
  // Exactly one `main` landmark — the shell's (`layout.tsx:187`). No axe scan
  // here can report a duplicate: the scans select WCAG tags and keep only
  // critical/serious, while `landmark-no-duplicate-main` is best-practice at
  // moderate (measured — stop gate §17.6c). Asserted in this spec because it
  // is one of the few with a fixture that renders the screen for real.
  await expect(page.getByRole("main")).toHaveCount(1);
}

async function blockingAxeViolations(
  page: Page,
  selector: string,
): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    )
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}) @ ${violation.nodes
          .flatMap((node) => node.target)
          .join(", ")}`,
    );
}

async function hasPageOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
}

/**
 * Ported from the deleted `context-localization-guard.mock.spec.ts`, whose
 * surface (ContextForm) no longer renders anywhere. This is the half of that
 * spec's navigation guard that still exists: the editor arms a `beforeunload`
 * fence exactly while it is open AND dirty (_product-profile.tsx:312).
 *
 * Chromium does not expose a constructible BeforeUnloadEvent. Dispatching a
 * cancelable Event exercises the registered listener and gives us its
 * observable contract (`preventDefault`) deterministically — the same
 * technique the deleted spec used.
 */
async function unloadIsFenced(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test("creates a URL-first draft, supports a manual customer edit, confirms it, then opens data connections", async ({
  page,
}) => {
  const api = await installProductProfileApi(page);
  const createRequests: unknown[] = [];
  await page.route("**/api/mvp/projects", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    createRequests.push(route.request().postDataJSON());
    await json(
      route,
      {
        id: E2E_PROJECT_ID,
      },
      201,
    );
  });

  await useChineseUi(page);
  await page.goto("/new-project");
  await expect(page.getByRole("heading", { name: "添加产品" })).toBeVisible();
  const createButton = page.getByRole("button", {
    name: "创建并生成初始画像",
  });
  // The button is intentionally disabled in the server-rendered markup and
  // enabled only after React installs the form handlers. Unlike `networkidle`,
  // this remains a reliable hydration signal across Next Fast Refresh reloads.
  await expect(createButton).toBeEnabled();
  await page.getByLabel("产品名称").fill("RelayOps");
  await page.getByLabel("产品 URL").fill("https://relayops.com/product/");
  await page.getByLabel("客户模式").selectOption("b2b");
  await page.getByLabel("主要目标市场").selectOption("US");
  await page
    .getByRole("checkbox", { name: "提升注册", exact: true })
    .check();
  await createButton.click();

  await expect.poll(() => createRequests.length).toBe(1);
  expect(createRequests).toEqual([
    {
      mode: "product_profile",
      productName: "RelayOps",
      productUrl: "https://relayops.com/product/",
      customerModel: "b2b",
      primaryMarket: "US",
      growthObjectives: ["increase_signups"],
    },
  ]);
  await page.waitForURL(`/p/${E2E_PROJECT_ID}/context`);
  await expect(
    page.getByRole("button", { name: "编辑产品画像与 ICP" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "编辑产品画像与 ICP" }).click();
  const editor = page.getByRole("dialog", {
    name: "编辑产品与 ICP",
  });
  await editor.getByLabel("产品名称").fill("RelayOps Global");
  await editor.getByRole("button", { name: "保存为新版本" }).click();
  await expect.poll(() => api.draftPatches.length).toBe(1);
  expect(api.draftPatches[0]).toEqual({
    baseVersion: 4,
    patch: { productName: "RelayOps Global" },
  });

  await expect(
    page.getByRole("link", { name: "连接真实数据" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "确认产品画像", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "确认这份产品画像？",
  });
  await confirmation
    .getByRole("button", { name: "确认并进入数据连接", exact: true })
    .click();

  await expect.poll(() => api.confirmations.length).toBe(1);
  expect(api.confirmations).toEqual([{ baseVersion: 5 }]);
  expect(api.auditStarts).toEqual([]);
  expect(api.critical.diagnosticRequests).toEqual([]);
  await page.waitForURL(`/p/${E2E_PROJECT_ID}/sources`);
});

test("only a dirty open Product Profile editor fences the browser unload", async ({
  page,
}) => {
  await installProductProfileApi(page);
  await gotoProductProfile(page);
  expect(await unloadIsFenced(page)).toBe(false);

  await page.getByRole("button", { name: "编辑产品画像与 ICP" }).click();
  const editor = page.getByRole("dialog", {
    name: "编辑产品与 ICP",
  });
  await expect(editor).toBeVisible();
  await expect(editor.getByText("没有更改", { exact: true })).toBeVisible();
  expect(await unloadIsFenced(page)).toBe(false);

  await editor.getByLabel("产品名称").fill("RelayOps Global");
  await expect(editor.getByText("有未保存的更改", { exact: true })).toBeVisible();
  expect(await unloadIsFenced(page)).toBe(true);

  // Discarding disarms the fence; nothing is left holding the browser.
  await editor.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "放弃更改" }).click();
  await expect(editor).toBeHidden();
  expect(await unloadIsFenced(page)).toBe(false);
});

test("opens the Primary ICP editor directly from confirmation readiness", async ({
  page,
}) => {
  await installProductProfileApi(page);
  await gotoProductProfile(page);

  const trigger = page.getByRole("button", {
    name: "编辑核心 ICP",
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const editor = page.getByRole("dialog", {
    name: "编辑产品与 ICP",
  });
  await expect(editor).toBeVisible();
  const primaryIcpInput = editor.getByLabel("目标企业 / 目标用户");
  await expect(primaryIcpInput).toBeVisible();
  await expect(primaryIcpInput).toBeFocused();

  await editor.getByRole("button", { name: "关闭" }).click();
  await expect(editor).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("automatically collects website evidence and resumes initial profile generation", async ({
  page,
}) => {
  const api = await installProductProfileApi(
    page,
    ungeneratedDraftWorkspace(),
    { requireCrawlBeforeSynthesis: true },
  );

  await gotoProductProfile(page);

  await expect.poll(() => api.synthesisStarts.length).toBe(2);
  expect(api.synthesisStarts).toEqual([
    { baseVersion: 4 },
    { baseVersion: 4 },
  ]);
  expect(api.critical.collectionRequests).toEqual([{ provider: "crawl" }]);
  expect(api.critical.collectionRunPolls).toBeGreaterThanOrEqual(3);
  await expect(
    page.getByText("正在生成产品画像、ICP 与默认竞品集合", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("运行中", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "编辑产品画像与 ICP" }),
  ).toBeDisabled();
});

test("recovers an active Crawl after refresh without starting duplicate onboarding work", async ({
  page,
}) => {
  const api = await installProductProfileApi(
    page,
    ungeneratedDraftWorkspace(runningCrawlRun()),
    { requireCrawlBeforeSynthesis: true },
  );

  await gotoProductProfile(page);

  await expect.poll(() => api.critical.collectionRunPolls).toBeGreaterThanOrEqual(3);
  await expect.poll(() => api.synthesisStarts.length).toBe(1);
  expect(api.synthesisStarts).toEqual([{ baseVersion: 4 }]);
  expect(api.critical.collectionRequests).toEqual([]);
  await expect(
    page.getByText("正在生成产品画像、ICP 与默认竞品集合", {
      exact: true,
    }),
  ).toBeVisible();
});

/**
 * The other half of the same guard, and the hole the `beforeunload` fence never
 * covered: a client-side history pop. `inert` does not disable the back button,
 * the modal registered no `popstate` handler, and `beforeunload` does not fire
 * on a same-document traversal — so Back discarded a dirty editor with no
 * prompt at all (stop gate §14.8, R4).
 *
 * `history.pushState` supplies the second same-document entry a shell
 * navigation would otherwise have created, so Back is a pop rather than a
 * document unload. `history.back()` is dispatched from the page instead of
 * through `page.goBack()` because a refused traversal is undone by the guard,
 * which leaves Playwright's own navigation wait with nothing to settle on.
 *
 * Which half of the guard answers is browser-dependent, and this project runs
 * Chromium: the Navigation API `navigate` handler cancels the traversal before
 * `popstate` can fire, so THIS test never reaches the `popstate` branch. That
 * branch is what Firefox and Safari get, and it is covered separately below.
 */
test("browser Back asks before discarding a dirty Product Profile editor", async ({
  page,
}) => {
  await installProductProfileApi(page);
  await gotoProductProfile(page);
  await page.evaluate(() => {
    window.history.pushState({}, "", window.location.href);
  });

  await page.getByRole("button", { name: "编辑产品画像与 ICP" }).click();
  const editor = page.getByRole("dialog", {
    name: "编辑产品与 ICP",
  });
  await expect(editor).toBeVisible();
  const productName = editor.getByLabel("产品名称");
  await productName.fill("RelayOps Global");
  await expect(editor.getByText("有未保存的更改", { exact: true })).toBeVisible();

  const prompts: string[] = [];
  let answer = false;
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    void (answer ? dialog.accept() : dialog.dismiss());
  });

  // Refused: the traversal is undone, and both the editor and the edit survive.
  await page.evaluate(() => {
    window.history.back();
  });
  await expect(editor).toBeVisible();
  await expect(productName).toHaveValue("RelayOps Global");
  expect(prompts).toEqual([
    "产品画像与 ICP 的编辑尚未保存。要离开本页并丢弃这些更改吗？",
  ]);

  // Confirmed: the operator was asked first, which is the whole contract here.
  answer = true;
  await page.evaluate(() => {
    window.history.back();
  });
  await expect(editor).toBeHidden();
  expect(prompts).toHaveLength(2);
});

/**
 * The same contract without the Navigation API, which is what Firefox and
 * Safari run today. With `window.navigation` absent the guard registers no
 * `navigate` listener and no traversal index is available, so the decision
 * falls to `popstate` with an unknown delta — the branch that must never read
 * its own uncertainty as permission to discard, and that recreates the guarded
 * entry rather than reloading the document.
 *
 * Until this test existed, nothing in the repository exercised that branch:
 * the Studio editor ships the same guard and is only ever tested in Chromium.
 */
test("browser Back still asks when the Navigation API is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: undefined,
    });
  });
  await installProductProfileApi(page);
  await gotoProductProfile(page);
  // `navigation` is not in TypeScript's DOM lib; assert on it through a
  // local shape so the precondition is still checked rather than assumed.
  const navigationApiPresent = await page.evaluate(
    () => (window as { navigation?: unknown }).navigation !== undefined,
  );
  expect(navigationApiPresent).toBe(false);
  const guardedUrl = page.url();
  await page.evaluate(() => {
    window.history.pushState({}, "", window.location.href);
  });

  await page.getByRole("button", { name: "编辑产品画像与 ICP" }).click();
  const editor = page.getByRole("dialog", {
    name: "编辑产品与 ICP",
  });
  await expect(editor).toBeVisible();
  const productName = editor.getByLabel("产品名称");
  await productName.fill("RelayOps Global");
  await expect(editor.getByText("有未保存的更改", { exact: true })).toBeVisible();

  const prompts: string[] = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    void dialog.dismiss();
  });
  await page.evaluate(() => {
    window.history.back();
  });

  await expect(editor).toBeVisible();
  await expect(productName).toHaveValue("RelayOps Global");
  expect(prompts).toEqual([
    "产品画像与 ICP 的编辑尚未保存。要离开本页并丢弃这些更改吗？",
  ]);
  // The guarded entry is restored in place: same URL, same document, and the
  // editor was never remounted (the field above still holds the unsaved edit).
  expect(page.url()).toBe(guardedUrl);
});

test("does not substitute a client fixture when the canonical API is unavailable", async ({
  page,
}) => {
  await installCriticalFlowApi(page);
  await page.route(`**${PROFILE_PATH}`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Product Profile unavailable",
        status: 503,
        code: "PROFILE_SOURCE_UNAVAILABLE",
        detail: "The canonical Product Profile read model is unavailable.",
        requestId: "e2e-no-profile-fallback",
      }),
    });
  });
  await useChineseUi(page);
  await page.goto(`/p/${E2E_PROJECT_ID}/context`);

  const alert = page.locator("#main-content").getByRole("alert");
  await expect(
    alert.getByRole("heading", { name: "无法加载产品画像" }),
  ).toBeVisible();
  await expect(alert).toContainText(
    "暂时无法读取这份产品画像，请稍后重试。",
  );
  await expect(alert).not.toContainText(
    "The canonical Product Profile read model is unavailable.",
  );
  await expect(
    page.getByRole("heading", { name: "RelayOps API Canonical" }),
  ).toHaveCount(0);
  await expect(page.getByText("草稿 · v4", { exact: true })).toHaveCount(0);
});

test("loads an API-backed draft in the Chinese-first customer view and sends only changed roots", async ({
  page,
}) => {
  const api = await installProductProfileApi(page);
  await gotoProductProfile(page);

  await expect.poll(() => api.reads.length).toBeGreaterThan(0);
  await expect(page.getByText("草稿 · v4", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^产品身份$/ }),
  ).toBeVisible();
  await expect(page.getByText("采购决策角色", { exact: true })).toBeVisible();
  await expect(page.getByText("JTBD", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "SEO / GEO 分析使用的对比集合",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "编辑产品画像与 ICP" }).click();
  const editor = page.getByRole("dialog", {
    name: "编辑产品与 ICP",
  });
  await expect(editor).toBeVisible();

  await editor.getByLabel("产品名称").fill("RelayOps Global");
  await editor.getByLabel("产品类别").fill("Customer Success Operations");
  await editor.getByLabel("产品类型").selectOption("Developer Tool");
  await editor
    .getByRole("checkbox", { name: "服务收费", exact: true })
    .check();
  await editor.getByLabel("主要海外市场").selectOption("GB");
  await editor
    .getByRole("checkbox", { name: "美国 · US", exact: true })
    .check();
  await editor
    .getByLabel("目标企业 / 目标用户")
    .fill("Implementation agencies with a repeatable SaaS delivery motion");
  await editor.getByRole("button", { name: "保存为新版本" }).click();

  await expect.poll(() => api.draftPatches.length).toBe(1);
  expect(api.draftPatches[0]).toEqual({
    baseVersion: 4,
    patch: {
      productName: "RelayOps Global",
      category: "Customer Success Operations",
      productType: "Developer Tool",
      businessModels: ["Subscription", "Services"],
      targetMarkets: [
        { marketCode: "GB", priority: "primary" },
        { marketCode: "US", priority: "secondary" },
      ],
      targetAudiences: [
        {
          ...PRIMARY_AUDIENCE,
          targetCompanyOrAudience:
            "Implementation agencies with a repeatable SaaS delivery motion",
        },
      ],
    },
  });
  expect(
    Object.keys(
      (api.draftPatches[0] as { patch: Record<string, unknown> }).patch,
    ).sort(),
  ).toEqual([
    "businessModels",
    "category",
    "productName",
    "productType",
    "targetAudiences",
    "targetMarkets",
  ]);

  await expect(
    page.getByRole("heading", { name: "RelayOps Global" }),
  ).toBeVisible();
  await expect(page.getByText("开发者工具", { exact: true })).toBeVisible();
  await expect(page.getByText("服务收费", { exact: true })).toBeVisible();
  await expect(
    page.getByText("产品画像已保存", { exact: true }),
  ).toBeVisible();
});

test("enforces included/unclassified/excluded rules and records a declared competitor through the API", async ({
  page,
}) => {
  const api = await installProductProfileApi(page);
  await gotoProductProfile(page);

  const approved = page.locator("article").filter({ hasText: "GuideCX" });
  const candidate = page.locator("article").filter({ hasText: "Userpilot" });
  const excluded = page.locator("article").filter({ hasText: "Appcues" });
  await expect(approved.getByText("已纳入", { exact: true })).toBeVisible();
  await expect(candidate.getByText("待补充", { exact: true })).toBeVisible();
  await expect(excluded.getByText("已排除", { exact: true })).toBeVisible();

  await candidate.getByRole("button", { name: "审核 / 纠正" }).click();
  const reviewDialog = page.getByRole("dialog", { name: "Userpilot" });
  const applyReview = reviewDialog.getByRole("button", { name: "应用审核" });
  await expect(applyReview).toBeEnabled();

  await reviewDialog.getByLabel("审核状态").selectOption("approved");
  await expect(applyReview).toBeDisabled();
  await reviewDialog.getByLabel("审核状态").selectOption("excluded");
  await expect(applyReview).toBeEnabled();
  await applyReview.click();

  await expect.poll(() => api.competitorReviews.length).toBe(1);
  expect(api.competitorReviews[0]).toEqual({
    candidateId: USERPILOT_ID,
    body: {
      baseVersion: 4,
      reviewStatus: "excluded",
      relationship: null,
      analysisScope: [],
      reason: "Discovered from the onboarding software SERP.",
    },
  });

  await page.getByRole("button", { name: "添加竞品" }).click();
  const addDialog = page.getByRole("dialog", { name: "添加并纳入竞品" });
  await addDialog.getByLabel("竞品名称").fill("ChurnZero");
  await addDialog
    .getByLabel("标准化域名")
    .fill("https://ChurnZero.com/platform");
  await addDialog.getByLabel("竞争关系").selectOption("indirect");
  await addDialog
    .getByRole("group", { name: "分析范围" })
    .getByRole("checkbox", { name: "关键词缺口" })
    .check();
  await addDialog
    .getByLabel("纳入竞品池的原因")
    .fill("Customer-declared alternative in enterprise evaluations.");
  await addDialog.getByRole("button", { name: "应用审核" }).click();

  await expect.poll(() => api.competitorAdds.length).toBe(1);
  expect(api.competitorAdds[0]).toEqual({
    baseVersion: 5,
    name: "ChurnZero",
    domain: "churnzero.com",
    relationship: "indirect",
    analysisScope: ["keyword_gap"],
    reason: "Customer-declared alternative in enterprise evaluations.",
  });
  const declared = page.locator("article").filter({ hasText: "ChurnZero" });
  await expect(declared.getByText("已纳入", { exact: true })).toBeVisible();
  await expect(declared.getByText("间接竞品", { exact: true })).toBeVisible();
});

test("confirmation stays independent from Audit, opens data connections, and keeps the profile read-only", async ({
  page,
}) => {
  const api = await installProductProfileApi(page);
  await gotoProductProfile(page);

  await page
    .getByRole("button", { name: "确认产品画像", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "确认这份产品画像？",
  });
  await expect(confirmation).toContainText("本操作不会启动审计");
  await confirmation
    .getByRole("button", { name: "确认并进入数据连接", exact: true })
    .click();

  await expect.poll(() => api.confirmations.length).toBe(1);
  expect(api.confirmations).toEqual([{ baseVersion: 4 }]);
  expect(api.auditStarts).toEqual([]);
  expect(api.critical.diagnosticRequests).toEqual([]);
  await page.waitForURL(`/p/${E2E_PROJECT_ID}/sources`);

  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await expect(page.getByText("客户已确认", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("此版本已由客户明确确认，可以作为后续工作的正式背景。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "编辑产品画像与 ICP" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "基于网站证据生成" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加竞品" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "审核 / 纠正" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "确认产品画像" }),
  ).toHaveCount(0);
});

test("renders the active synthesis as inline canonical run progress", async ({
  page,
}) => {
  const active = runningSynthesisRun();
  const api = await installProductProfileApi(page, draftWorkspace(active));
  await gotoProductProfile(page);

  await expect(
    page.getByText("正在生成产品画像、ICP 与默认竞品集合", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("运行中", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("2/5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成中…" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "编辑产品画像与 ICP" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "暂不能确认" }),
  ).toBeDisabled();
  expect(api.synthesisStarts).toEqual([]);
  expect(api.auditStarts).toEqual([]);
});

test("contains modal focus, closes with Escape, and restores the launch control", async ({
  page,
}) => {
  await installProductProfileApi(page);
  await gotoProductProfile(page);

  const trigger = page.getByRole("button", { name: "编辑产品画像与 ICP" });
  await trigger.click();
  const editor = page.getByRole("dialog", {
    name: "编辑产品与 ICP",
  });
  const close = editor.getByRole("button", { name: "关闭" });
  const cancel = editor.getByRole("button", { name: "取消" });
  await expect(editor).toBeVisible();
  await expect(close).toBeFocused();

  const backgroundState = await page.locator("#main-content").evaluate((main) => {
    let root: Element = main;
    while (root.parentElement && root.parentElement !== document.body) {
      root = root.parentElement;
    }
    return {
      inert: root.hasAttribute("inert"),
      ariaHidden: root.getAttribute("aria-hidden"),
    };
  });
  expect(backgroundState).toEqual({ inert: true, ariaHidden: "true" });

  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect(
    await blockingAxeViolations(
      page,
      "[data-product-profile-modal-backdrop]",
    ),
  ).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(trigger).toBeFocused();
  const restoredBackground = await page
    .locator("#main-content")
    .evaluate((main) => {
      let root: Element = main;
      while (root.parentElement && root.parentElement !== document.body) {
        root = root.parentElement;
      }
      return {
        inert: root.hasAttribute("inert"),
        ariaHidden: root.getAttribute("aria-hidden"),
      };
    });
  expect(restoredBackground).toEqual({ inert: false, ariaHidden: null });
});

test("matches the Artifact density and editor geometry across desktop and sheet layouts", async ({
  page,
}) => {
  await installProductProfileApi(page);
  await useChineseUi(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await expect(
    page.getByRole("heading", { name: "RelayOps API Canonical" }),
  ).toBeVisible();

  const identityCard = page.locator("[data-product-profile-identity-card]");
  const sectionTitle = identityCard.getByRole("heading", {
    name: "产品是什么，以及为什么值得购买",
  });
  const valueProposition = page
    .locator("[data-product-profile-value-proposition]")
    .locator("p");
  expect(
    await identityCard.evaluate((element) => getComputedStyle(element).paddingTop),
  ).toBe("24px");
  expect(
    await sectionTitle.evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("22px");
  expect(
    await valueProposition.evaluate(
      (element) => getComputedStyle(element).fontSize,
    ),
  ).toBe("17px");

  await page.getByRole("button", { name: "编辑产品画像与 ICP" }).click();
  const editor = page.getByRole("dialog", {
    name: "编辑产品与 ICP",
  });
  await expect(editor).toBeVisible();
  await editor.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  expect(
    await editor.getByRole("group").evaluateAll((groups) =>
      groups.map((group) => group.querySelector("legend")?.textContent?.trim()),
    ),
  ).toEqual(["产品身份与价值", "目标市场", "核心 ICP", "补充产品信息"]);
  expect(
    await editor
      .getByRole("group", { name: "产品身份与价值" })
      .locator(":scope > label > span")
      .allTextContents(),
  ).toEqual(["一句话定位", "价值主张", "其他商业模式", "核心功能"]);
  const editorBox = await editor.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(editorBox!.width).toBeCloseTo(900, 0);
  expect(editorBox!.x + editorBox!.width / 2).toBeCloseTo(720, 0);
  expect(editorBox!.y).toBeGreaterThanOrEqual(21);
  expect(editorBox!.height).toBeLessThanOrEqual(856);
  expect(
    await editor.evaluate((element) => getComputedStyle(element).borderRadius),
  ).toBe("20px");
  expect(
    await editor
      .getByRole("heading", { name: "编辑产品与 ICP" })
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("28px");
  expect(
    await editor
      .getByText("产品名称", { exact: true })
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("12px");
  expect(
    await editor
      .getByLabel("产品名称")
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("14px");
  expect(
    await editor
      .getByRole("group", { name: "产品身份与价值" })
      .evaluate((element) => getComputedStyle(element).paddingTop),
  ).toBe("14px");
  const scrollRegion = editor.locator(
    "[data-product-profile-editor-scroll-region]",
  );
  expect(
    await scrollRegion.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  ).toMatchObject({ overflowY: "auto" });
  const scrollMetrics = await scrollRegion.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  const footerBox = await editor.locator("footer").boundingBox();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(
    editorBox!.y + editorBox!.height + 1,
  );
  await editor.getByRole("button", { name: "取消" }).click();

  await page.setViewportSize({ width: 1024, height: 900 });
  const story = page.locator("[data-product-profile-identity-card]");
  const rail = page.locator("[data-product-profile-review-rail]");
  const [storyBox, railBox] = await Promise.all([
    story.boundingBox(),
    rail.boundingBox(),
  ]);
  expect(storyBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(storyBox!.y).toBeLessThan(railBox!.y);

  await page.setViewportSize({ width: 760, height: 900 });
  await page.getByRole("button", { name: "编辑产品画像与 ICP" }).click();
  await expect(editor).toBeVisible();
  await editor.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const sheetBox = await editor.boundingBox();
  expect(sheetBox).not.toBeNull();
  expect(sheetBox!.x).toBeCloseTo(0, 0);
  expect(sheetBox!.width).toBeCloseTo(760, 0);
  expect(sheetBox!.height).toBeLessThanOrEqual(828);
  expect(sheetBox!.y + sheetBox!.height).toBeCloseTo(900, 0);
  expect(
    await editor.evaluate((element) => getComputedStyle(element).borderRadius),
  ).toBe("20px 20px 0px 0px");
  expect(await hasPageOverflow(page), "760px editor overflow").toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileSheetBox = await editor.boundingBox();
  expect(mobileSheetBox).not.toBeNull();
  expect(mobileSheetBox!.x).toBeCloseTo(0, 0);
  expect(mobileSheetBox!.width).toBeCloseTo(390, 0);
  expect(mobileSheetBox!.height).toBeLessThanOrEqual(777);
  expect(mobileSheetBox!.y + mobileSheetBox!.height).toBeCloseTo(844, 0);
  expect(
    await editor
      .locator("footer")
      .evaluate((element) => getComputedStyle(element).flexDirection),
  ).toBe("column-reverse");
  expect(
    await editor
      .getByRole("checkbox", { name: "提升注册", exact: true })
      .evaluate(
        (element) =>
          getComputedStyle(element.parentElement!.parentElement!)
            .gridTemplateColumns.split(" ").length,
      ),
  ).toBe(1);
  const [cancelBox, saveBox] = await Promise.all([
    editor.getByRole("button", { name: "取消" }).boundingBox(),
    editor.getByRole("button", { name: "保存为新版本" }).boundingBox(),
  ]);
  expect(cancelBox).not.toBeNull();
  expect(saveBox).not.toBeNull();
  expect(cancelBox!.width).toBeGreaterThanOrEqual(350);
  expect(saveBox!.width).toBeCloseTo(cancelBox!.width, 0);
  expect(await hasPageOverflow(page), "390px editor overflow").toBe(false);
  expect(
    await blockingAxeViolations(
      page,
      "[data-product-profile-modal-backdrop]",
    ),
  ).toEqual([]);
  await page
    .locator("[data-product-profile-modal-backdrop]")
    .click({ position: { x: 5, y: 5 } });
  await expect(editor).toBeHidden();
  expect(
    await sectionTitle.evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("22px");
});

test("has no page-level overflow or blocking axe findings on desktop and 390px", async ({
  page,
}) => {
  await installProductProfileApi(page);
  await useChineseUi(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${E2E_PROJECT_ID}/context`);
  await expect(
    page.getByRole("heading", { name: "RelayOps API Canonical" }),
  ).toBeVisible();
  expect(await hasPageOverflow(page), "desktop Product Profile overflow").toBe(
    false,
  );
  expect(await blockingAxeViolations(page, "#main-content")).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^产品身份$/ }),
  ).toBeVisible();
  expect(await hasPageOverflow(page), "390px Product Profile overflow").toBe(
    false,
  );
  expect(await blockingAxeViolations(page, "#main-content")).toEqual([]);
});
