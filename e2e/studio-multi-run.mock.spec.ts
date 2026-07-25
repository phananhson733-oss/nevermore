import { expect, test, type Route } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

/** The mock chrome assertions in this file are written in English; the app's
 *  default UI locale is zh-CN, so the locale cookie has to be set explicitly. */
test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
});

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const NOW = "2026-07-20T12:00:00.000Z";

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function listEnvelope(data: readonly unknown[]) {
  return {
    data,
    meta: { nextCursor: null, hasNext: false, limit: 100 },
  };
}

function runProjection(
  id: string,
  status: "running" | "completed" | "failed",
  artifactId: string,
) {
  return {
    id,
    projectId: E2E_PROJECT_ID,
    kind: "artifact_generation",
    status,
    progress: {
      phase: status,
      current: status === "running" ? 1 : 2,
      total: 2,
      messageKey: "worker.artifact_generation",
    },
    lastError:
      status === "failed"
        ? { code: "ARTIFACT_GENERATION_FAILED", summary: "Provider detail" }
        : null,
    resultRef:
      status === "completed" ? { type: "artifact", id: artifactId } : null,
    queuedAt: NOW,
    startedAt: NOW,
    completedAt: status === "running" ? null : NOW,
  };
}

function actionFixture(id: string, title: string, templateId: string) {
  return {
    id,
    findingId: `finding-${id}`,
    templateId,
    title,
    description: `${title} description`,
    contentLocale: "en",
    priorityBand: "high",
    roadmapLane: "now",
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: `${title} outcome`,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function generatingArtifact(
  id: string,
  actionId: string,
  artifactType: "technical_ticket" | "metadata_rewrite",
  activeRun: ReturnType<typeof runProjection>,
) {
  return {
    id,
    actionId,
    artifactType,
    status: "generating",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 0,
    validationState: "pending",
    current: null,
    activeRun,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test("Studio monitors concurrent artifact runs and refreshes each terminal outcome", async ({
  page,
}) => {
  await installCriticalFlowApi(page);

  const actionA = actionFixture(
    "00000000-0000-4000-8000-000000000511",
    "Long-running artifact A",
    "fix_http_status.v1",
  );
  const actionB = actionFixture(
    "00000000-0000-4000-8000-000000000512",
    "Independently failing artifact B",
    "rewrite_search_metadata.v1",
  );
  const artifactAId = "00000000-0000-4000-8000-000000000611";
  const artifactBId = "00000000-0000-4000-8000-000000000612";
  const runAId = "artifact-run-a";
  const runBId = "artifact-run-b";
  const activeRunA = runProjection(runAId, "running", artifactAId);
  const activeRunB = runProjection(runBId, "running", artifactBId);
  let artifactReads = 0;
  let runAReads = 0;
  let runBReads = 0;
  let allowAComplete = false;

  await page.route(`**${API_BASE}/actions**`, async (route) => {
    await json(route, listEnvelope([actionA, actionB]));
  });
  await page.route(`**${API_BASE}/artifacts**`, async (route) => {
    artifactReads += 1;
    const artifactACompleted = allowAComplete && runAReads >= 2;
    const artifactBFailed = runBReads >= 1;
    await json(
      route,
      listEnvelope([
        artifactACompleted
          ? {
              ...generatingArtifact(
                artifactAId,
                actionA.id,
                "technical_ticket",
                activeRunA,
              ),
              status: "draft",
              currentRevision: 1,
              validationState: "valid",
              current: {
                id: "00000000-0000-4000-8000-000000000621",
                revision: 1,
                outputLocale: "en",
                contentFormat: "markdown",
                content: "Completed content for artifact A",
                contentHash: "sha256:artifact-a",
                validationErrors: [],
                note: null,
                createdAt: NOW,
              },
              activeRun: null,
            }
          : generatingArtifact(
              artifactAId,
              actionA.id,
              "technical_ticket",
              activeRunA,
            ),
        artifactBFailed
          ? {
              ...generatingArtifact(
                artifactBId,
                actionB.id,
                "metadata_rewrite",
                activeRunB,
              ),
              status: "failed",
              activeRun: null,
            }
          : generatingArtifact(
              artifactBId,
              actionB.id,
              "metadata_rewrite",
              activeRunB,
            ),
      ]),
    );
  });
  await page.route(`**${API_BASE}/runs/${runAId}`, async (route) => {
    runAReads += 1;
    await json(
      route,
      {
        data: runProjection(
          runAId,
          allowAComplete ? "completed" : "running",
          artifactAId,
        ),
      },
    );
  });
  await page.route(`**${API_BASE}/runs/${runBId}`, async (route) => {
    runBReads += 1;
    await json(route, {
      data: runProjection(runBId, "failed", artifactBId),
    });
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  const artifactA = page.locator(
    `[data-studio-artifact-id="${artifactAId}"]`,
  );
  const artifactB = page.locator(
    `[data-studio-artifact-id="${artifactBId}"]`,
  );
  await expect(artifactA).toBeVisible();
  await expect(artifactB).toBeVisible();

  // B must settle while A is deliberately kept running. A single-run tracker
  // would never request B here and this assertion would time out.
  await expect.poll(() => runAReads).toBeGreaterThanOrEqual(1);
  await expect.poll(() => runBReads).toBeGreaterThanOrEqual(1);
  await expect(artifactA).toContainText("Generating");
  await expect(artifactB).toContainText("Failed");
  await expect(
    page.getByText(
      "Artifact generation did not complete successfully. Review the artifact before trying again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.locator(`[data-studio-active-run="${runAId}"]`),
  ).toBeVisible();

  allowAComplete = true;
  await expect.poll(() => runAReads, { timeout: 8_000 }).toBeGreaterThanOrEqual(2);
  await expect(artifactA).toContainText("Draft");
  await expect(
    page.locator(`[data-studio-active-run="${runAId}"]`),
  ).toHaveCount(0);
  await expect.poll(() => artifactReads).toBeGreaterThanOrEqual(3);
  expect(runBReads).toBe(1);
});
