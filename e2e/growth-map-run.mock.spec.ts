import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installGrowthVerticalApi,
  sourceSlot,
} from "./mock-api.ts";

/**
 * Growth Map Analysis Refresh mock E2E.
 *
 * The customer control starts one server-owned parent plan. The browser sends
 * the strict empty command, polls that parent, and refreshes the published
 * Growth Map generation only after a successful terminal state. Crawl, GSC,
 * GA4, and DataForSEO input selection belongs to the server; this suite
 * deliberately fails if the control brings back the old client-side Snapshot
 * enumeration or standalone diagnostic endpoint.
 */

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const GROWTH_MAP_URL = `/p/${E2E_PROJECT_ID}/growth-map`;
const RUN_ID = "3f8b0c1a-6f2e-4b6d-9d3a-000000000901";
const ACTIVE_RUN_ID = "3f8b0c1a-6f2e-4b6d-9d3a-000000000902";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_REGION_NAME_EN = "Diagnostic run status";

interface RecordedPost {
  readonly endpoint: string;
  readonly body: unknown;
  readonly idempotencyKey: string | undefined;
}

interface AnalysisRefreshPostFixture {
  readonly posts: RecordedPost[];
  readonly resourceRefs: {
    readonly type: "analysis_refresh_run";
    readonly id: string;
  }[];
}

function sourceSlots(options: { readonly crawlSnapshot?: boolean } = {}) {
  const crawlSnapshot = options.crawlSnapshot ?? true;
  return [
    sourceSlot(
      "crawl",
      crawlSnapshot
        ? {}
        : {
            state: "connected",
            latestSnapshot: null,
          },
    ),
    sourceSlot("gsc"),
    sourceSlot("ga4"),
    sourceSlot("csv"),
    sourceSlot("dataforseo"),
  ];
}

async function fulfillJson(
  route: Route,
  value: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

function problemBody(
  code: string,
  status: number,
  detail: string,
  current?: Readonly<Record<string, unknown>> | null,
) {
  return {
    type: "about:blank",
    title: "Problem",
    status,
    code,
    detail,
    requestId: "e2e-request",
    ...(current === undefined ? {} : { current }),
  };
}

function analysisRefreshRunDto(id: string, status: string) {
  return {
    id,
    projectId: E2E_PROJECT_ID,
    kind: "analysis_refresh",
    status,
    progress: {
      phase: status,
      current: status === "completed" || status === "partial" ? 5 : 2,
      total: 5,
      messageKey: "worker.analysis_refresh.raw_key",
    },
    lastError:
      status === "failed"
        ? { code: "ANALYSIS_REFRESH_FAILED", summary: "Refresh failed." }
        : null,
    resultRef:
      status === "completed" || status === "partial"
        ? { type: "analysis_refresh_run", id }
        : null,
    queuedAt: "2026-07-18T12:00:00.000Z",
    startedAt: status === "queued" ? null : "2026-07-18T12:00:00.000Z",
    completedAt:
      status === "completed" ||
      status === "partial" ||
      status === "failed" ||
      status === "cancelled"
        ? "2026-07-18T12:05:00.000Z"
        : null,
  };
}

type MockRunStep =
  | string
  | { readonly failRead: true }
  | {
      readonly status: string;
      readonly progressCurrent?: number;
      readonly progressTotal?: number;
    };

/**
 * Canonical 202 Analysis Refresh acceptance. The resourceRef identifies the
 * parent plan, never a standalone diagnostic run.
 */
async function routeAnalysisRefreshPost(
  page: Page,
  runId = RUN_ID,
  onPost?: () => void,
): Promise<AnalysisRefreshPostFixture> {
  const fixture: AnalysisRefreshPostFixture = {
    posts: [],
    resourceRefs: [],
  };
  await page.route(`**${BASE}/analysis-refresh-runs`, async (route) => {
    const resourceRef = {
      type: "analysis_refresh_run" as const,
      id: runId,
    };
    fixture.posts.push({
      endpoint: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()["idempotency-key"],
    });
    fixture.resourceRefs.push(resourceRef);
    onPost?.();
    await fulfillJson(
      route,
      {
        data: {
          run: analysisRefreshRunDto(runId, "queued"),
          statusUrl: `${BASE}/runs/${runId}`,
          resourceRef,
        },
      },
      202,
    );
  });
  return fixture;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

/**
 * Serve GET /runs/{parentId} from a scripted sequence (last step repeats).
 * The optional callback flips published fixtures only when the parent actually
 * reaches terminal; a 202 acknowledgment does not publish a generation.
 */
async function routeRunPoll(
  page: Page,
  runId: string,
  statuses: readonly MockRunStep[],
  onTerminal?: () => void,
): Promise<{ readonly calls: string[] }> {
  const state = { calls: [] as string[], terminalNotified: false };
  await page.route(`**${BASE}/runs/${runId}`, async (route) => {
    const step = statuses[Math.min(state.calls.length, statuses.length - 1)]!;
    state.calls.push(
      typeof step === "string"
        ? step
        : "failRead" in step
          ? "failRead"
          : step.status,
    );
    if (typeof step !== "string" && "failRead" in step) {
      await fulfillJson(
        route,
        problemBody("DEPENDENCY_UNAVAILABLE", 503, "Status read failed."),
        503,
      );
      return;
    }
    const status =
      typeof step === "string"
        ? step
        : "status" in step
          ? step.status
          : "queued";
    if (TERMINAL_STATUSES.has(status) && !state.terminalNotified) {
      state.terminalNotified = true;
      onTerminal?.();
    }
    const dto = analysisRefreshRunDto(runId, status);
    const payload =
      typeof step === "string" || !("status" in step)
        ? dto
        : {
            ...dto,
            progress: {
              ...dto.progress,
              ...(typeof step.progressCurrent === "number"
                ? { current: step.progressCurrent }
                : {}),
              ...(typeof step.progressTotal === "number"
                ? { total: step.progressTotal }
                : {}),
            },
          };
    await fulfillJson(route, {
      data: payload,
    });
  });
  return state;
}

function trackReads(page: Page) {
  const generationReads: string[] = [];
  const snapshotReads: string[] = [];
  const sourceReads: string[] = [];
  const runReads: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") return;
    const url = new URL(request.url());
    if (
      url.pathname === `${BASE}/audit/urls` &&
      url.searchParams.get("limit") === "1" &&
      url.searchParams.get("diagnosticRunId") === null
    ) {
      generationReads.push(url.href);
    }
    if (url.pathname === `${BASE}/snapshots`) snapshotReads.push(url.href);
    if (url.pathname === `${BASE}/sources`) sourceReads.push(url.href);
    if (url.pathname.startsWith(`${BASE}/runs/`)) {
      runReads.push(url.pathname);
    }
  });
  return { generationReads, snapshotReads, sourceReads, runReads };
}

async function useUi(page: Page, locale: "en" | "zh-CN"): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: locale, domain: "localhost", path: "/" },
    ]);
}

function runButton(
  page: Page,
  name = "Refresh all data and run diagnosis",
): ReturnType<Page["getByRole"]> {
  return page.locator("[data-run-diagnosis]").getByRole("button", { name });
}

function statusRegion(page: Page, name = STATUS_REGION_NAME_EN) {
  return page.getByRole("status", { name });
}

async function hasPageOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
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

test.describe("growth map Analysis Refresh trigger", () => {
  test("waits for Sources only, posts the strict empty parent command, and never enumerates Snapshots", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    const accepted = await routeAnalysisRefreshPost(page);
    await routeRunPoll(page, RUN_ID, ["completed"]);

    let releaseSources = () => {};
    const held = new Promise<void>((resolve) => {
      releaseSources = resolve;
    });
    await page.route(`**${BASE}/sources`, async (route) => {
      await held;
      await fulfillJson(route, { data: sourceSlots() });
    });

    await page.goto(GROWTH_MAP_URL);
    // Published content is independent of source-read readiness.
    await expect(
      page.getByLabel("Audit provenance for this page"),
    ).toBeVisible();
    const run = runButton(page);
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute(
      "aria-describedby",
      "sf-growth-map-run-scope-note sf-growth-map-run-gate-note",
    );
    await expect(page.locator("#sf-growth-map-run-gate-note")).toContainText(
      "Sources: Loading",
    );

    releaseSources();
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => accepted.posts.length).toBe(1);
    expect(accepted.posts[0]).toMatchObject({
      endpoint: `${BASE}/analysis-refresh-runs`,
      body: {},
    });
    expect(accepted.posts[0]?.idempotencyKey).toMatch(UUID_RE);
    expect(accepted.resourceRefs).toEqual([
      { type: "analysis_refresh_run", id: RUN_ID },
    ]);
    await expect.poll(() => reads.runReads.length).toBeGreaterThan(0);
    expect(reads.runReads).toContain(`${BASE}/runs/${RUN_ID}`);
    expect(reads.snapshotReads).toEqual([]);
  });

  test("a client Sources payload without a Crawl snapshot does not block the server-owned plan", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    const accepted = await routeAnalysisRefreshPost(page);
    await routeRunPoll(page, RUN_ID, ["completed"]);
    await page.route(`**${BASE}/sources`, async (route) => {
      await fulfillJson(route, {
        data: sourceSlots({ crawlSnapshot: false }),
      });
    });

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => accepted.posts.length).toBe(1);
    expect(accepted.posts[0]?.body).toEqual({});
    expect(accepted.posts[0]?.body).not.toHaveProperty("snapshotIds");
    expect(accepted.posts[0]?.body).not.toHaveProperty("outputLocale");
    expect(reads.snapshotReads).toEqual([]);
  });

  test("a failed Sources read is not a Crawl verdict: explicit retry recovers without a POST", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    const accepted = await routeAnalysisRefreshPost(page);

    let sourceFailures = 2; // initial request + TanStack Query's single retry
    await page.route(`**${BASE}/sources`, async (route) => {
      if (sourceFailures > 0) {
        sourceFailures -= 1;
        await fulfillJson(
          route,
          problemBody("DEPENDENCY_UNAVAILABLE", 503, "Sources read failed."),
          503,
        );
        return;
      }
      await fulfillJson(route, { data: sourceSlots() });
    });

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeDisabled();
    await expect(page.locator("#sf-growth-map-run-gate-note")).toContainText(
      "Sources: Something went wrong",
    );
    const retry = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(run).toBeEnabled();
    expect(accepted.posts).toHaveLength(0);
    expect(reads.snapshotReads).toEqual([]);
  });

  test("first refresh works over a 404 portfolio and publishes one readable generation at parent terminal", async ({
    page,
  }) => {
    await useUi(page, "en");
    const api = await installGrowthVerticalApi(page, {
      auditProjectionAvailable: false,
    });
    const reads = trackReads(page);
    const accepted = await routeAnalysisRefreshPost(page);
    await routeRunPoll(
      page,
      RUN_ID,
      ["running", "running", "completed"],
      () => {
        api.auditProjectionAvailable = true;
      },
    );

    await page.goto(GROWTH_MAP_URL);
    await expect(
      page.getByText("The URL portfolio could not be read. Try again."),
    ).toBeVisible();
    await expect(page.getByLabel("Audit provenance for this page")).toHaveCount(
      0,
    );
    expect(reads.generationReads).toHaveLength(1);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => accepted.posts.length).toBe(1);

    // The 202 acknowledgment and running polls cannot expose a generation.
    await expect(
      statusRegion(page).getByText("Running", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The URL portfolio could not be read. Try again."),
    ).toBeVisible();
    expect(reads.generationReads).toHaveLength(1);

    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Audit provenance for this page"),
    ).toBeVisible();
    await expect.poll(() => reads.generationReads.length).toBe(2);
    await page.waitForTimeout(500);
    expect(reads.generationReads).toHaveLength(2);
    await expect(
      runButton(page, "Refresh all data again and run diagnosis"),
    ).toBeEnabled();
    expect(accepted.posts[0]?.body).toEqual({});
    expect(reads.snapshotReads).toEqual([]);
  });

  test("202 happy path polls the parent and refreshes the published generation exactly once", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    const accepted = await routeAnalysisRefreshPost(page);
    await routeRunPoll(page, RUN_ID, ["running", "running", "completed"]);

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await expect.poll(() => reads.generationReads.length).toBe(1);

    await run.click();
    await expect.poll(() => accepted.posts.length).toBe(1);
    expect(accepted.posts[0]).toEqual({
      endpoint: `${BASE}/analysis-refresh-runs`,
      body: {},
      idempotencyKey: expect.stringMatching(UUID_RE),
    });
    expect(accepted.resourceRefs[0]).toEqual({
      type: "analysis_refresh_run",
      id: RUN_ID,
    });

    await expect(
      statusRegion(page).getByText("Running", { exact: true }),
    ).toBeVisible();
    await expect(
      runButton(page, "Refreshing all data across the site and running diagnosis…"),
    ).toBeDisabled();
    expect(reads.runReads.every((path) => path === `${BASE}/runs/${RUN_ID}`)).toBe(
      true,
    );
    expect(reads.generationReads).toHaveLength(1);

    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => reads.generationReads.length).toBe(2);
    await expect(
      runButton(page, "Refresh all data again and run diagnosis"),
    ).toBeEnabled();
    await page.waitForTimeout(500);
    expect(reads.generationReads).toHaveLength(2);
    expect(reads.snapshotReads).toEqual([]);
  });

  test("zh-CN UI still submits the same locale-free strict empty command", async ({
    page,
  }) => {
    await useUi(page, "zh-CN");
    await installGrowthVerticalApi(page);
    const accepted = await routeAnalysisRefreshPost(page);
    await routeRunPoll(page, RUN_ID, ["completed"]);

    await page.goto(GROWTH_MAP_URL);
    const run = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "刷新全部数据并运行诊断" });
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => accepted.posts.length).toBe(1);
    expect(accepted.posts[0]?.body).toEqual({});
    expect(accepted.posts[0]?.body).not.toHaveProperty("outputLocale");
  });

  test("zh-CN partial 6/6 terminal shows completed-with-limitations copy and whole-site scope", async ({
    page,
  }) => {
    await useUi(page, "zh-CN");
    await installGrowthVerticalApi(page);
    const accepted = await routeAnalysisRefreshPost(page);
    await routeRunPoll(page, RUN_ID, [
      "running",
      { status: "partial", progressCurrent: 6, progressTotal: 6 },
    ]);

    await page.goto(GROWTH_MAP_URL);
    const run = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "刷新全部数据并运行诊断" });
    await expect(run).toBeEnabled();
    await expect(page.locator("#sf-growth-map-run-scope-note")).toContainText(
      "会刷新全站 Crawl、GSC/GA4、DataForSEO 与 Growth Audit，不只当前选中竞品。",
    );

    await run.click();
    await expect.poll(() => accepted.posts.length).toBe(1);
    await expect(
      page.locator("[data-run-diagnosis-status]").getByText(
        "已完成（部分数据受限）",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page
        .locator("[data-run-diagnosis]")
        .getByRole("button", { name: "重新刷新全部数据并运行诊断" }),
    ).toBeEnabled();
    await expect(
      page.locator("[data-run-diagnosis]").getByText("部分完成", { exact: true }),
    ).toHaveCount(0);
  });

  test("a same-tick double click submits exactly one Analysis Refresh parent", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const accepted = await routeAnalysisRefreshPost(page);
    await routeRunPoll(page, RUN_ID, ["running"]);

    await page.goto(GROWTH_MAP_URL);
    await expect(runButton(page)).toBeEnabled();
    // Two synchronous DOM clicks land before React can paint disabled state;
    // the component's synchronous single-flight fence must reject the second.
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>(
        "[data-run-diagnosis] button",
      );
      if (!button) throw new Error("run button not found");
      button.click();
      button.click();
    });
    await expect.poll(() => accepted.posts.length).toBe(1);
    await page.waitForTimeout(400);
    expect(accepted.posts).toHaveLength(1);
  });

  for (const status of ["failed", "cancelled"] as const) {
    test(`${status} unlocks but never refreshes the published generation`, async ({
      page,
    }) => {
      await useUi(page, "en");
      await installGrowthVerticalApi(page);
      const reads = trackReads(page);
      const accepted = await routeAnalysisRefreshPost(page);
      await routeRunPoll(page, RUN_ID, ["running", status]);

      await page.goto(GROWTH_MAP_URL);
      const run = runButton(page);
      await expect(run).toBeEnabled();
      await expect.poll(() => reads.generationReads.length).toBe(1);
      await run.click();

      const pillLabel = status === "failed" ? "Failed" : "Cancelled";
      await expect(
        statusRegion(page).getByText(pillLabel, { exact: true }),
      ).toBeVisible();
      await expect(
        runButton(page, "Refresh all data again and run diagnosis"),
      ).toBeEnabled();
      if (status === "failed") {
        await expect(
          page.getByText("The diagnostic run did not finish", {
            exact: false,
          }),
        ).toBeVisible();
      }
      await page.waitForTimeout(500);
      expect(reads.generationReads).toHaveLength(1);
      expect(accepted.posts).toHaveLength(1);
    });
  }

  test("a parent status read error holds the lock until explicit retry succeeds", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const accepted = await routeAnalysisRefreshPost(page);
    const poll = await routeRunPoll(page, RUN_ID, [
      "running",
      { failRead: true },
      { failRead: true },
      "completed",
    ]);

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await run.click();

    await expect(
      page.getByText("Run status is temporarily unavailable", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      runButton(page, "Refreshing all data across the site and running diagnosis…"),
    ).toBeDisabled();
    const retry = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    expect(poll.calls.filter((call) => call === "failRead")).toHaveLength(2);
    await retry.click();
    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    await expect(
      runButton(page, "Refresh all data again and run diagnosis"),
    ).toBeEnabled();
    expect(accepted.posts).toHaveLength(1);
  });

  test("409 with a valid parent pointer adopts and polls the active Analysis Refresh", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    const conflictPosts: RecordedPost[] = [];
    await routeRunPoll(page, ACTIVE_RUN_ID, ["running", "completed"]);
    await page.route(`**${BASE}/analysis-refresh-runs`, async (route) => {
      conflictPosts.push({
        endpoint: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
        idempotencyKey: route.request().headers()["idempotency-key"],
      });
      await fulfillJson(
        route,
        problemBody(
          "RUN_ALREADY_ACTIVE",
          409,
          "An Analysis Refresh is already active.",
          {
            runId: ACTIVE_RUN_ID,
            statusUrl: `${BASE}/runs/${ACTIVE_RUN_ID}`,
          },
        ),
        409,
      );
    });

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => conflictPosts.length).toBe(1);
    expect(conflictPosts[0]?.body).toEqual({});

    await expect(
      page.getByText("A diagnostic run is already in progress", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      statusRegion(page).getByText("Running", { exact: true }),
    ).toBeVisible();
    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("A diagnostic run is already in progress", {
        exact: false,
      }),
    ).toHaveCount(0);
    await expect(
      runButton(page, "Refresh all data again and run diagnosis"),
    ).toBeEnabled();
    expect(
      reads.runReads.every(
        (path) => path === `${BASE}/runs/${ACTIVE_RUN_ID}`,
      ),
    ).toBe(true);
    await expect.poll(() => reads.generationReads.length).toBe(2);
  });

  for (const [label, current] of [
    ["missing", undefined],
    ["null", null],
    ["invalid", { runId: "analysis-refresh" }],
  ] as const) {
    test(`409 with a ${label} parent pointer never polls and requires explicit recovery`, async ({
      page,
    }) => {
      await useUi(page, "en");
      await installGrowthVerticalApi(page);
      const reads = trackReads(page);
      await page.route(`**${BASE}/analysis-refresh-runs`, async (route) => {
        await fulfillJson(
          route,
          problemBody(
            "RUN_ALREADY_ACTIVE",
            409,
            "An Analysis Refresh is already active.",
            current,
          ),
          409,
        );
      });

      await page.goto(GROWTH_MAP_URL);
      const run = runButton(page);
      await expect(run).toBeEnabled();
      await expect.poll(() => reads.generationReads.length).toBe(1);
      await run.click();

      await expect(
        page.getByText("A diagnostic run is already in progress", {
          exact: false,
        }),
      ).toBeVisible();
      // Unknown-winner recovery refreshes the generation once but never invents
      // a run endpoint from malformed data.
      await expect.poll(() => reads.generationReads.length).toBe(2);
      await expect(runButton(page)).toBeDisabled();
      const recover = page
        .locator("[data-run-diagnosis]")
        .getByRole("button", { name: "Retry" });
      await expect(recover).toBeVisible();
      await recover.click();
      await expect(runButton(page)).toBeEnabled();
      await page.waitForTimeout(300);
      expect(reads.runReads).toEqual([]);
    });
  }

  test("422 CONTEXT_INCOMPLETE is sticky and points to Product / ICP context", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await page.route(`**${BASE}/analysis-refresh-runs`, async (route) => {
      posts.push({
        endpoint: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
        idempotencyKey: route.request().headers()["idempotency-key"],
      });
      await fulfillJson(
        route,
        problemBody(
          "CONTEXT_INCOMPLETE",
          422,
          "A confirmed Product / ICP profile is required.",
        ),
        422,
      );
    });

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]?.body).toEqual({});

    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute(
      "aria-describedby",
      "sf-growth-map-run-scope-note sf-growth-map-run-gate-note",
    );
    const note = page.locator("#sf-growth-map-run-gate-note");
    await expect(note).toContainText("A complete ICP context is required");
    await expect(note.getByRole("link", { name: "Context" })).toHaveAttribute(
      "href",
      `/p/${E2E_PROJECT_ID}/context`,
    );
    await page.waitForTimeout(400);
    expect(posts).toHaveLength(1);

    const recheck = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "Check again" });
    await expect(recheck).toBeVisible();
    await recheck.click();
    await expect(run).toBeEnabled();
    expect(posts).toHaveLength(1);
  });

  test("422 SOURCE_NOT_CONNECTED is sticky, points to Sources, and rechecks Sources without Snapshots", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    const posts: RecordedPost[] = [];
    await page.route(`**${BASE}/analysis-refresh-runs`, async (route) => {
      posts.push({
        endpoint: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
        idempotencyKey: route.request().headers()["idempotency-key"],
      });
      await fulfillJson(
        route,
        problemBody(
          "SOURCE_NOT_CONNECTED",
          422,
          "The server-owned Analysis Refresh cannot access Crawl.",
        ),
        422,
      );
    });

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => posts.length).toBe(1);

    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute(
      "aria-describedby",
      "sf-growth-map-run-scope-note sf-growth-map-run-gate-note",
    );
    const note = page.locator("#sf-growth-map-run-gate-note");
    await expect(note).toContainText("Connect");
    await expect(note.getByRole("link", { name: "Sources" })).toHaveAttribute(
      "href",
      `/p/${E2E_PROJECT_ID}/sources`,
    );
    // Even forced DOM clicks cannot bypass the sticky server verdict.
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>(
        "[data-run-diagnosis] button",
      );
      if (!button) throw new Error("run button not found");
      button.disabled = false;
      button.click();
      button.click();
    });
    await page.waitForTimeout(400);
    expect(posts).toHaveLength(1);

    const sourceReadsBefore = reads.sourceReads.length;
    const recheck = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "Check again" });
    await expect(recheck).toBeVisible();
    await recheck.click();
    await expect.poll(() => reads.sourceReads.length).toBe(sourceReadsBefore + 1);
    await expect(run).toBeEnabled();
    expect(reads.snapshotReads).toEqual([]);
    expect(posts).toHaveLength(1);

    await run.click();
    await expect.poll(() => posts.length).toBe(2);
    await expect(run).toBeDisabled();
  });

  test("the control owns exactly one status live region in every phase", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    await routeAnalysisRefreshPost(page);
    await routeRunPoll(page, RUN_ID, ["running", "running", "completed"]);

    await page.goto(GROWTH_MAP_URL);
    const regions = page.locator("[data-run-diagnosis]").getByRole("status");
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await expect(regions).toHaveCount(1);

    await run.click();
    await expect(
      statusRegion(page).getByText("Running", { exact: true }),
    ).toBeVisible();
    await expect(
      runButton(page, "Refreshing all data across the site and running diagnosis…"),
    ).toBeDisabled();
    expect(await regions.count()).toBe(1);

    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    await expect(regions).toHaveCount(1);
  });

  test("partial terminal publishes one generation, shows completed-with-limitations, and unlocks re-run", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    const accepted = await routeAnalysisRefreshPost(page);
    await routeRunPoll(page, RUN_ID, ["running", "partial"]);

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await expect.poll(() => reads.generationReads.length).toBe(1);
    await run.click();

    await expect(
      statusRegion(page).getByText("Completed (limited data)", { exact: true }),
    ).toBeVisible();
    await expect(
      runButton(page, "Refresh all data again and run diagnosis"),
    ).toBeEnabled();
    await expect.poll(() => reads.generationReads.length).toBe(2);
    await page.waitForTimeout(500);
    expect(reads.generationReads).toHaveLength(2);
    expect(accepted.posts).toHaveLength(1);
    await expect(
      page.locator("[data-run-diagnosis] [data-run-diagnosis-notice]"),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-run-diagnosis]").getByText("Partial", { exact: true }),
    ).toHaveCount(0);
  });

  test("390px: parent poll error and terminal states fit without overflow or axe blockers", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    await routeAnalysisRefreshPost(page);
    await routeRunPoll(page, RUN_ID, [
      "running",
      { failRead: true },
      { failRead: true },
      "completed",
    ]);

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await run.click();

    await expect(
      page.getByText("Run status is temporarily unavailable", {
        exact: false,
      }),
    ).toBeVisible();
    expect(await hasPageOverflow(page)).toBe(false);
    expect(await blockingAxeViolations(page, "#main-content")).toEqual([]);

    await page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "Retry" })
      .click();
    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    expect(await hasPageOverflow(page)).toBe(false);
    expect(await blockingAxeViolations(page, "#main-content")).toEqual([]);
  });
});
