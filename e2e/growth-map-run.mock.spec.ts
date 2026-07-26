import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  E2E_SNAPSHOT_PROVENANCE,
  installGrowthVerticalApi,
} from "./mock-api.ts";

/**
 * R1 mock E2E: the Growth Map diagnosis trigger. Covers the blueprint's §4
 * acceptance matrix — snapshot read gates, the crawl gate, first diagnosis
 * over a real-shape 404 portfolio, the 202 happy path (en and zh-CN), the
 * double-dispatch fence, all four terminal states, poll read errors, the four
 * 409 pointer shapes, the sticky context gate, and 390px overflow/axe checks.
 */

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const GROWTH_MAP_URL = `/p/${E2E_PROJECT_ID}/growth-map`;
const RUN_ID = "3f8b0c1a-6f2e-4b6d-9d3a-000000000901";
const ACTIVE_RUN_ID = "3f8b0c1a-6f2e-4b6d-9d3a-000000000902";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CRAWL_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000101";
const GSC_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000111";
const STATUS_REGION_NAME_EN = "Diagnostic run status";

interface RecordedPost {
  readonly body: {
    readonly snapshotIds: readonly string[];
    readonly outputLocale: string;
  };
  readonly idempotencyKey: string | undefined;
}

function snapshotDto(input: {
  readonly id: string;
  readonly provider: "crawl" | "gsc";
  readonly capturedAt?: string;
}) {
  const provenance = E2E_SNAPSHOT_PROVENANCE[input.provider];
  return {
    id: input.id,
    siteId: E2E_SITE_ID,
    provider: input.provider,
    datasetKey: provenance.datasetKey,
    schemaVersion: "0.2.0",
    methodVersion: provenance.methodVersion,
    capturedAt: input.capturedAt ?? "2026-07-18T12:00:00.000Z",
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Deterministic R1 fixture.",
    rowCount: 12,
    checksum: "c".repeat(64),
  };
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

function snapshotPage(
  data: readonly unknown[],
  nextCursor: string | null = null,
) {
  return {
    data,
    meta: { nextCursor, hasNext: nextCursor !== null, limit: 100 },
  };
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

function runDto(id: string, status: string) {
  return {
    id,
    projectId: E2E_PROJECT_ID,
    kind: "diagnostic",
    status,
    progress: {
      phase: status,
      current: status === "completed" ? 2 : 1,
      total: 2,
      messageKey: "worker.collection.raw_key",
    },
    lastError: null,
    resultRef: status === "completed" ? { type: "diagnostic_run", id } : null,
    queuedAt: "2026-07-18T12:00:00.000Z",
    startedAt: status === "queued" ? null : "2026-07-18T12:00:00.000Z",
    completedAt: status === "completed" ? "2026-07-18T12:00:00.000Z" : null,
  };
}

/** 202-accepts POST /diagnostic-runs and records body + Idempotency-Key. */
async function routeDiagnosticPost(
  page: Page,
  posts: RecordedPost[],
  runId = RUN_ID,
  onPost?: () => void,
): Promise<void> {
  await page.route(`**${BASE}/diagnostic-runs`, async (route) => {
    posts.push({
      body: route.request().postDataJSON() as RecordedPost["body"],
      idempotencyKey: route.request().headers()["idempotency-key"],
    });
    onPost?.();
    await fulfillJson(
      route,
      {
        data: {
          run: runDto(runId, "queued"),
          statusUrl: `${BASE}/runs/${runId}`,
          resourceRef: { type: "diagnostic_run", id: runId },
        },
      },
      202,
    );
  });
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

/**
 * Serves GET /runs/{runId} from a scripted status sequence (last repeats).
 * `onTerminal` fires once, immediately before the first terminal status is
 * fulfilled: fixture switches hang off the run actually finishing, never off
 * the POST acknowledgment (a 202 proves nothing about audit rows existing).
 */
async function routeRunPoll(
  page: Page,
  runId: string,
  statuses: readonly (string | { readonly failRead: true })[],
  onTerminal?: () => void,
): Promise<{ readonly calls: string[] }> {
  const state = { calls: [] as string[], terminalNotified: false };
  await page.route(`**${BASE}/runs/${runId}`, async (route) => {
    const step = statuses[Math.min(state.calls.length, statuses.length - 1)]!;
    state.calls.push(typeof step === "string" ? step : "failRead");
    if (typeof step !== "string") {
      await fulfillJson(
        route,
        problemBody("DEPENDENCY_UNAVAILABLE", 503, "Status read failed."),
        503,
      );
      return;
    }
    if (TERMINAL_STATUSES.has(step) && !state.terminalNotified) {
      state.terminalNotified = true;
      onTerminal?.();
    }
    await fulfillJson(route, { data: runDto(runId, step) });
  });
  return state;
}

function trackReads(page: Page) {
  const auditListReads: string[] = [];
  const runReads: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") return;
    const url = new URL(request.url());
    if (url.pathname === `${BASE}/audit/urls`) auditListReads.push(url.href);
    if (url.pathname.startsWith(`${BASE}/runs/`)) {
      runReads.push(url.pathname);
    }
  });
  return { auditListReads, runReads };
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
  name = "Run diagnosis",
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

test.describe("growth map diagnosis trigger", () => {
  test("gates on the snapshot read, without blocking the growth map body", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
    await routeRunPoll(page, RUN_ID, ["completed"]);

    let releaseSnapshots = () => {};
    const held = new Promise<void>((resolve) => {
      releaseSnapshots = resolve;
    });
    await page.route(`**${BASE}/snapshots**`, async (route) => {
      const url = new URL(route.request().url());
      await held;
      if (url.searchParams.get("cursor") === "page-2") {
        await fulfillJson(
          route,
          snapshotPage([
            snapshotDto({ id: CRAWL_SNAPSHOT_ID, provider: "crawl" }),
          ]),
        );
        return;
      }
      await fulfillJson(
        route,
        snapshotPage(
          [snapshotDto({ id: GSC_SNAPSHOT_ID, provider: "gsc" })],
          "page-2",
        ),
      );
    });

    await page.goto(GROWTH_MAP_URL);
    // The portfolio renders while the snapshot chain is still loading.
    await expect(
      page.getByLabel("Audit provenance for this page"),
    ).toBeVisible();
    const run = runButton(page);
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute(
      "aria-describedby",
      "sf-growth-map-run-note",
    );
    await expect(page.locator("#sf-growth-map-run-note")).toContainText(
      "Sources: Loading",
    );

    // Releasing the two-page cursor chain enables the button and the POST
    // freezes the complete selection from both pages.
    releaseSnapshots();
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]?.body.snapshotIds).toEqual([
      CRAWL_SNAPSHOT_ID,
      GSC_SNAPSHOT_ID,
    ]);
  });

  test("a failed snapshot read is not a crawl verdict: explicit retry recovers", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);

    let snapshotFailures = 2; // initial attempt + the query's single retry
    await page.route(`**${BASE}/snapshots**`, async (route) => {
      if (snapshotFailures > 0) {
        snapshotFailures -= 1;
        await fulfillJson(
          route,
          problemBody("DEPENDENCY_UNAVAILABLE", 503, "Snapshot read failed."),
          503,
        );
        return;
      }
      await fulfillJson(
        route,
        snapshotPage([
          snapshotDto({ id: CRAWL_SNAPSHOT_ID, provider: "crawl" }),
        ]),
      );
    });

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeDisabled();
    await expect(page.locator("#sf-growth-map-run-note")).toContainText(
      "Sources: Something went wrong",
    );
    const retry = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(run).toBeEnabled();
    expect(posts).toHaveLength(0);
  });

  test("no crawl snapshot disables the run with the sources pointer and zero POST", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
    await page.route(`**${BASE}/snapshots**`, async (route) => {
      await fulfillJson(
        route,
        snapshotPage([snapshotDto({ id: GSC_SNAPSHOT_ID, provider: "gsc" })]),
      );
    });

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeDisabled();
    const note = page.locator("#sf-growth-map-run-note");
    await expect(note).toContainText("A completed site crawl is required");
    await expect(note.getByRole("link", { name: "Sources" })).toHaveAttribute(
      "href",
      `/p/${E2E_PROJECT_ID}/sources`,
    );
    await page.waitForTimeout(300);
    expect(posts).toHaveLength(0);
  });

  test("first diagnosis: the button works over the 404 portfolio and restores it", async ({
    page,
  }) => {
    await useUi(page, "en");
    const api = await installGrowthVerticalApi(page, {
      auditProjectionAvailable: false,
    });
    const reads = trackReads(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
    // The projection becomes readable only when the run reaches its terminal
    // poll: nothing about the POST acknowledgment may unlock the fixture.
    await routeRunPoll(
      page,
      RUN_ID,
      ["running", "running", "completed"],
      () => {
        api.auditProjectionAvailable = true;
      },
    );

    await page.goto(GROWTH_MAP_URL);
    // The portfolio read is the server's real 404 error state, not an empty
    // list; the hero-mounted trigger stays visible and usable through it.
    await expect(
      page.getByText("The URL portfolio could not be read. Try again."),
    ).toBeVisible();
    await expect(page.getByLabel("Audit provenance for this page")).toHaveCount(
      0,
    );
    // The settled 404 costs exactly two list reads: the initial fetch plus
    // the QueryClient's single global retry.
    expect(reads.auditListReads).toHaveLength(2);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => posts.length).toBe(1);

    // While the run is merely running, nothing refreshes: the 404 error
    // state stays on screen and no additional portfolio read is issued.
    await expect(
      statusRegion(page).getByText("Running", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The URL portfolio could not be read. Try again."),
    ).toBeVisible();
    expect(reads.auditListReads).toHaveLength(2);

    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    // The terminal refresh re-reads the projection; the error state resolves
    // into the real portfolio without a reload.
    await expect(
      page.getByLabel("Audit provenance for this page"),
    ).toBeVisible();
    await expect(
      page.getByText("The URL portfolio could not be read. Try again."),
    ).toHaveCount(0);
    // Exactly one terminal refresh read, and it does not repeat.
    await expect.poll(() => reads.auditListReads.length).toBe(3);
    await page.waitForTimeout(500);
    expect(reads.auditListReads).toHaveLength(3);
    // Pill retained, control unlocked, session label flipped to re-run.
    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    await expect(runButton(page, "Re-run diagnosis")).toBeEnabled();
    expect(posts).toHaveLength(1);
  });

  test("202 happy path: exact command, live status, and exactly one refresh", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
    await routeRunPoll(page, RUN_ID, ["running", "running", "completed"]);

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    expect(reads.auditListReads).toHaveLength(1);

    await run.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]?.idempotencyKey).toMatch(UUID_RE);
    expect(posts[0]?.body).toEqual({
      snapshotIds: [CRAWL_SNAPSHOT_ID],
      outputLocale: "en",
    });

    // Named live region carries the run status; the control is locked.
    await expect(
      statusRegion(page).getByText("Running", { exact: true }),
    ).toBeVisible();
    await expect(runButton(page, "Diagnosis running…")).toBeDisabled();

    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    // Success refresh: exactly one additional portfolio read.
    await expect.poll(() => reads.auditListReads.length).toBe(2);
    await expect(runButton(page, "Re-run diagnosis")).toBeEnabled();
    await page.waitForTimeout(500);
    expect(reads.auditListReads).toHaveLength(2);
    // The pill survives until the next submission.
    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
  });

  test("zh-CN UI submits outputLocale zh-CN", async ({ page }) => {
    await useUi(page, "zh-CN");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
    await routeRunPoll(page, RUN_ID, ["completed"]);

    await page.goto(GROWTH_MAP_URL);
    const run = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "运行诊断" });
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]?.body.outputLocale).toBe("zh-CN");
  });

  test("a same-tick double dispatch still submits exactly one run", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
    await routeRunPoll(page, RUN_ID, ["running"]);

    await page.goto(GROWTH_MAP_URL);
    await expect(runButton(page)).toBeEnabled();
    // Two synchronous DOM clicks land before any React re-render can disable
    // the button; only the in-flight fence can stop the second command.
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>(
        "[data-run-diagnosis] button",
      );
      if (!button) throw new Error("run button not found");
      button.click();
      button.click();
    });
    await expect.poll(() => posts.length).toBe(1);
    await page.waitForTimeout(400);
    expect(posts).toHaveLength(1);
  });

  for (const status of ["failed", "cancelled"] as const) {
    test(`${status} unlocks with its pill and never triggers the success refresh`, async ({
      page,
    }) => {
      await useUi(page, "en");
      await installGrowthVerticalApi(page);
      const reads = trackReads(page);
      const posts: RecordedPost[] = [];
      await routeDiagnosticPost(page, posts);
      await routeRunPoll(page, RUN_ID, ["running", status]);

      await page.goto(GROWTH_MAP_URL);
      const run = runButton(page);
      await expect(run).toBeEnabled();
      expect(reads.auditListReads).toHaveLength(1);
      await run.click();

      const pillLabel = status === "failed" ? "Failed" : "Cancelled";
      await expect(
        statusRegion(page).getByText(pillLabel, { exact: true }),
      ).toBeVisible();
      await expect(runButton(page, "Re-run diagnosis")).toBeEnabled();
      if (status === "failed") {
        await expect(
          page.getByText("The diagnostic run did not finish", {
            exact: false,
          }),
        ).toBeVisible();
      }
      await page.waitForTimeout(500);
      // No success refresh: the portfolio was read exactly once.
      expect(reads.auditListReads).toHaveLength(1);
    });
  }

  test("a status read error holds the lock until an explicit retry succeeds", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
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
    // The lock does not release on an unproven run.
    await expect(runButton(page, "Diagnosis running…")).toBeDisabled();
    const retry = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    // The scripted poll consumed both failing reads before the retry.
    expect(poll.calls.filter((call) => call === "failRead").length).toBe(2);
    await retry.click();
    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    await expect(runButton(page, "Re-run diagnosis")).toBeEnabled();
  });

  test("409 with a valid pointer adopts the active run and clears the notice", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    await routeRunPoll(page, ACTIVE_RUN_ID, ["running", "completed"]);
    await page.route(`**${BASE}/diagnostic-runs`, async (route) => {
      await fulfillJson(
        route,
        problemBody(
          "RUN_ALREADY_ACTIVE",
          409,
          "A diagnostic run is already active.",
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
    // The takeover notice clears at terminal; no "in progress" beside a pill.
    await expect(
      page.getByText("A diagnostic run is already in progress", {
        exact: false,
      }),
    ).toHaveCount(0);
    await expect(runButton(page, "Re-run diagnosis")).toBeEnabled();
    // Only the adopted pointer was ever polled, and the refresh happened.
    expect(
      reads.runReads.every((path) => path === `${BASE}/runs/${ACTIVE_RUN_ID}`),
    ).toBe(true);
    await expect.poll(() => reads.auditListReads.length).toBe(2);
  });

  for (const [label, current] of [
    ["missing", undefined],
    ["null", null],
    ["invalid", { runId: "diagnostic" }],
  ] as const) {
    test(`409 with a ${label} pointer never polls and requires explicit recovery`, async ({
      page,
    }) => {
      await useUi(page, "en");
      await installGrowthVerticalApi(page);
      const reads = trackReads(page);
      await page.route(`**${BASE}/diagnostic-runs`, async (route) => {
        await fulfillJson(
          route,
          problemBody(
            "RUN_ALREADY_ACTIVE",
            409,
            "A diagnostic run is already active.",
            current,
          ),
          409,
        );
      });

      await page.goto(GROWTH_MAP_URL);
      const run = runButton(page);
      await expect(run).toBeEnabled();
      expect(reads.auditListReads).toHaveLength(1);
      await run.click();

      await expect(
        page.getByText("A diagnostic run is already in progress", {
          exact: false,
        }),
      ).toBeVisible();
      // The unlocatable conflict refreshes the portfolio exactly once.
      await expect.poll(() => reads.auditListReads.length).toBe(2);
      // Not re-clickable directly: recovery is the explicit action.
      await expect(runButton(page)).toBeDisabled();
      const recover = page
        .locator("[data-run-diagnosis]")
        .getByRole("button", { name: "Retry" });
      await expect(recover).toBeVisible();
      await recover.click();
      await expect(runButton(page)).toBeEnabled();
      await page.waitForTimeout(300);
      // No GET was ever issued against an unvalidated run pointer.
      expect(reads.runReads).toEqual([]);
    });
  }

  test("422 CONTEXT_INCOMPLETE sets a sticky gate released only by recheck", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await page.route(`**${BASE}/diagnostic-runs`, async (route) => {
      posts.push({
        body: route.request().postDataJSON() as RecordedPost["body"],
        idempotencyKey: route.request().headers()["idempotency-key"],
      });
      await fulfillJson(
        route,
        problemBody(
          "CONTEXT_INCOMPLETE",
          422,
          "A confirmed product profile is required to diagnose.",
        ),
        422,
      );
    });

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => posts.length).toBe(1);

    // Sticky: disabled with the context explanation and pointer.
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute(
      "aria-describedby",
      "sf-growth-map-run-note",
    );
    const note = page.locator("#sf-growth-map-run-note");
    await expect(note).toContainText("A complete ICP context is required");
    await expect(note.getByRole("link", { name: "Context" })).toHaveAttribute(
      "href",
      `/p/${E2E_PROJECT_ID}/context`,
    );
    // No silent re-POST while gated.
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

  test("422 CRAWL_SNAPSHOT_REQUIRED sets a sticky gate; recheck re-reads snapshots", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    const snapshotReads: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") return;
      const url = new URL(request.url());
      if (url.pathname === `${BASE}/snapshots`) snapshotReads.push(url.href);
    });
    await page.route(`**${BASE}/diagnostic-runs`, async (route) => {
      posts.push({
        body: route.request().postDataJSON() as RecordedPost["body"],
        idempotencyKey: route.request().headers()["idempotency-key"],
      });
      await fulfillJson(
        route,
        problemBody(
          "CRAWL_SNAPSHOT_REQUIRED",
          422,
          "A completed crawl snapshot is required to diagnose.",
        ),
        422,
      );
    });

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    // The local snapshot chain does contain a crawl snapshot: only the
    // server's 422 verdict gates this control.
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => posts.length).toBe(1);

    // Sticky: disabled with the crawl explanation and the Sources pointer.
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute(
      "aria-describedby",
      "sf-growth-map-run-note",
    );
    const note = page.locator("#sf-growth-map-run-note");
    await expect(note).toContainText("A completed site crawl is required");
    await expect(note.getByRole("link", { name: "Sources" })).toHaveAttribute(
      "href",
      `/p/${E2E_PROJECT_ID}/sources`,
    );
    // Raw DOM clicks past the disabled attribute must not re-POST into the
    // 20/15min rate limit: every attempt would mint a fresh Idempotency-Key,
    // so only the machine-level sticky gate can stop the command.
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

    // The explicit recheck re-reads the snapshot chain (never a POST) and
    // releases the gate only after that read succeeds.
    const snapshotReadsBefore = snapshotReads.length;
    const recheck = page
      .locator("[data-run-diagnosis]")
      .getByRole("button", { name: "Check again" });
    await expect(recheck).toBeVisible();
    await recheck.click();
    await expect.poll(() => snapshotReads.length).toBe(snapshotReadsBefore + 1);
    await expect(run).toBeEnabled();
    expect(posts).toHaveLength(1);

    // The released gate permits a genuinely new attempt, which the server
    // may gate again.
    await run.click();
    await expect.poll(() => posts.length).toBe(2);
    await expect(run).toBeDisabled();
  });

  test("the control owns exactly one status live region in every phase", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
    await routeRunPoll(page, RUN_ID, ["running", "running", "completed"]);

    await page.goto(GROWTH_MAP_URL);
    const regions = page.locator("[data-run-diagnosis]").getByRole("status");
    const run = runButton(page);
    await expect(run).toBeEnabled();
    // Idle: the stable named container is the only status region.
    await expect(regions).toHaveCount(1);

    await run.click();
    // Running: the button spinner is decorative. Were it a live region too,
    // two polite announcements would race for the same state change. The
    // count is taken WITHOUT retry while the running phase is pinned (the
    // spinner is mounted exactly while the in-progress button shows): a
    // retrying count would wait out the running phase and pass once the
    // spinner unmounts at terminal.
    await expect(
      statusRegion(page).getByText("Running", { exact: true }),
    ).toBeVisible();
    await expect(runButton(page, "Diagnosis running…")).toBeDisabled();
    expect(await regions.count()).toBe(1);

    // Terminal.
    await expect(
      statusRegion(page).getByText("Completed", { exact: true }),
    ).toBeVisible();
    await expect(regions).toHaveCount(1);
  });

  test("partial keeps its pill, unlocks re-run, and refreshes exactly once", async ({
    page,
  }) => {
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const reads = trackReads(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
    await routeRunPoll(page, RUN_ID, ["running", "partial"]);

    await page.goto(GROWTH_MAP_URL);
    const run = runButton(page);
    await expect(run).toBeEnabled();
    expect(reads.auditListReads).toHaveLength(1);
    await run.click();

    // Partial is a success terminal: named pill in the status region and an
    // unlocked Re-run control.
    await expect(
      statusRegion(page).getByText("Partial", { exact: true }),
    ).toBeVisible();
    await expect(runButton(page, "Re-run diagnosis")).toBeEnabled();
    // Exactly one success refresh, which then never repeats.
    await expect.poll(() => reads.auditListReads.length).toBe(2);
    await page.waitForTimeout(500);
    expect(reads.auditListReads).toHaveLength(2);
    // No notice of any kind: partial is not a takeover, not an error.
    await expect(
      page.locator("[data-run-diagnosis] [data-run-diagnosis-notice]"),
    ).toHaveCount(0);
    await expect(
      statusRegion(page).getByText("Partial", { exact: true }),
    ).toBeVisible();
  });

  test("390px: terminal and error copy fit without overflow or axe blockers", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await useUi(page, "en");
    await installGrowthVerticalApi(page);
    const posts: RecordedPost[] = [];
    await routeDiagnosticPost(page, posts);
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

    // Error copy state.
    await expect(
      page.getByText("Run status is temporarily unavailable", {
        exact: false,
      }),
    ).toBeVisible();
    expect(await hasPageOverflow(page)).toBe(false);
    expect(await blockingAxeViolations(page, "#main-content")).toEqual([]);

    // Terminal pill state.
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
