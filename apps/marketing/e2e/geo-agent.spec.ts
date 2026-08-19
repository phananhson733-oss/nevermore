import { expect, test, type Page, type Request } from "@playwright/test";

import { deriveGeoRunCoverage } from "../src/lib/agents/geo-report-derive";
import {
  assembleQuestion,
  observeToSample,
} from "../src/lib/agents/geo-sampling";
import type { GeoQuerySetV1 } from "../src/lib/agents/geo-query-contract";
import type { GeoContextSnapshotV1 } from "../src/lib/agents/geo-context";

/**
 * The GEO Agent, driven the way a visitor drives it.
 *
 * The report is built from whatever the browser actually posted, not from a
 * stored blob: the context hash, the query-set fingerprint and the eight frozen
 * strings are computed in the page, and a fixture that carried its own copies
 * would pass while the real pairing was broken. Deterministic and free — the
 * provider is never reached.
 */

const RUN_ENDPOINT = "**/api/agents/geo/run";

interface RunRequestBody {
  readonly schemaVersion: string;
  readonly context: GeoContextSnapshotV1;
  readonly querySet: GeoQuerySetV1;
}

/** A report for exactly the questions this request confirmed. */
function reportFor(body: RunRequestBody, citedHost = "rival.test") {
  const questions = body.querySet.queries.map((unit, index) =>
    assembleQuestion(
      unit,
      Array.from({ length: unit.samplesPlanned }, (_ignored, sample) =>
        observeToSample(
          {
            queryIndex: index,
            sampleIndex: sample + 1,
            sampleId: `${unit.queryId}-s${sample + 1}`,
          },
          unit,
          {
            observedAt: "2026-08-19T09:05:00.000Z",
            webSearchPerformed: true,
            answerText: "Several tools cover this.",
            citations: [
              {
                url: `https://${citedHost}/guide`,
                title: "A third-party page",
                annotationText: `([${citedHost}](https://${citedHost}/guide))`,
                providerOutputItemIndex: 1,
                sectionIndex: 0,
                annotationOrdinal: 0,
                startIndex: null,
                endIndex: null,
                spanBasis: "provider_message_section_text",
              },
            ],
            citationsComplete: true,
            costUsd: 0.0457,
            model: "gpt-5-2025-08-07",
          },
          {
            targetHost: body.context.targetHost,
            brandAliases: body.context.brandAliases,
            aliasScope: "supported",
          },
        ),
      ),
    ),
  );

  return {
    data: {
      run: {
        agent: "geo",
        mode: "authenticated_agent",
        persistence: "report_contents_not_persisted",
        schemaVersion: "agent_geo_report.v3",
        runId: "run-e2e",
        sampledAt: "2026-08-19T09:05:00.000Z",
        targetHost: body.context.targetHost,
        contextHash: body.context.contextHash,
        querySetContentHash: body.querySet.querySetContentHash,
        reportContentHash: `sha256:${"c".repeat(64)}`,
        provenance: {
          collector: "dataforseo",
          upstream: "openai",
          surface: "dataforseo_chat_gpt_llm_responses_api",
          searchModeRequested: "web_search_permitted",
          modelRequested: "gpt-5-2025-08-07",
          modelObserved: ["gpt-5-2025-08-07"],
          maxOutputTokensRequested: 4_096,
          webSearchCountryIsoCodeRequested: body.context.marketCode,
          calibrationMarket: "US",
          triggerCalibrationScope: "calibrated_market",
          queryLanguageTag: "en",
          retrievalSamplesPerProbe: 3,
          naturalDemandSamplesPerQuery: 1,
          knownCostUsdMicros: 822_600,
          costComplete: true,
          unknownCostSamples: 0,
        },
      },
      coverage: deriveGeoRunCoverage(questions),
      questions,
      limitations: [],
    },
  };
}

interface Harness {
  readonly runRequests: RunRequestBody[];
  readonly copied: () => Promise<string | null>;
}

async function install(
  page: Page,
  options: { readonly clipboardFails?: boolean } = {},
): Promise<Harness> {
  const runRequests: RunRequestBody[] = [];

  // Reading the real clipboard needs a permission grant that headless Chromium
  // does not give reliably. Recording what the page handed to the clipboard is
  // the same assertion without the flake.
  await page.addInitScript(
    ({ fails }) => {
      const store = { value: null as string | null };
      (window as unknown as { __copied: typeof store }).__copied = store;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            if (fails) throw new Error("denied");
            store.value = text;
          },
        },
      });
    },
    { fails: options.clipboardFails === true },
  );

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ signedIn: true }),
    });
  });
  await page.route("**/api/auth/one-tap/nonce", async (route) => {
    await route.fulfill({ status: 503, body: "" });
  });
  await page.route(RUN_ENDPOINT, async (route) => {
    const body = route.request().postDataJSON() as RunRequestBody;
    runRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reportFor(body)),
    });
  });

  return {
    runRequests,
    copied: () =>
      page.evaluate(
        () =>
          (window as unknown as { __copied: { value: string | null } }).__copied
            .value,
      ),
  };
}

/** Context, alias confirmation, query review, run. The whole paid flow. */
async function runToReport(page: Page, path = "/agents/geo"): Promise<void> {
  await page.goto(path);
  await page.fill("#geo-url", "acme.test");
  await page.fill("#geo-product", "Acme Analytics");
  await page.fill("#geo-category", "seo reporting");
  await page.fill("#geo-buyer", "head of growth");
  await page.fill("#geo-jtbd", "know whether assistants cite us");
  await page.selectOption("#geo-market", "US");
  await page.getByRole("button", { name: "Review the facts" }).click();

  await page.locator('input[id^="geo-alias-"]').first().check();
  await page.locator("#geo-category-confirm").check();
  await page
    .getByRole("button", { name: "Confirm and generate the questions" })
    .click();

  await page.getByRole("button", { name: /Run 18 provider calls/ }).click();
  await expect(page.getByText("What this run observed")).toBeVisible();
}

test("posts exactly the facts the visitor confirmed, and the real plan size", async ({
  page,
}) => {
  const harness = await install(page);
  await runToReport(page);

  expect(harness.runRequests).toHaveLength(1);
  const body = harness.runRequests[0]!;
  expect(body.schemaVersion).toBe("agent_geo_report.v3");
  expect(body.context.targetHost).toBe("acme.test");
  expect(body.context.category).toBe("seo reporting");
  expect(body.querySet.queries).toHaveLength(8);
  // Five retrieval probes asked three times, three natural-demand questions
  // asked once. Not the mock's twenty-four.
  const planned = body.querySet.queries.reduce(
    (total, query) => total + query.samplesPlanned,
    0,
  );
  expect(planned).toBe(18);
  expect(body.querySet.queries.every((query) => query.userConfirmed)).toBe(
    true,
  );
});

test("shows evidence, sources and solutions on one page with one copy action", async ({
  page,
}) => {
  await install(page);
  await runToReport(page);

  await expect(
    page.getByRole("heading", { name: "Who these answers actually cited" }),
  ).toBeVisible();
  await expect(page.getByTestId("geo-sources-retrieval_probe")).toBeVisible();
  await expect(page.getByTestId("geo-sources-natural_demand")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Question by question" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What this run found" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What to do about it" }),
  ).toBeVisible();
  expect(await page.getByTestId("geo-solution-card").count()).toBeGreaterThan(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Copy report for AI" }),
  ).toHaveCount(1);
});

test("offers no selection step, no packet choice and no target selector", async ({
  page,
}) => {
  await install(page);
  await runToReport(page);

  // The report page is the last page. Nothing here asks the visitor to pick
  // items, pick a format, or pick who the packet is for.
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.getByText("Copy the packet")).toHaveCount(0);
  await expect(page.getByText("Copy the readable version")).toHaveCount(0);
  await expect(page.locator("select")).toHaveCount(0);
});

test("copies a brief carrying every question, count, host, solution and limit", async ({
  page,
}) => {
  const harness = await install(page);
  await runToReport(page);
  await page.getByRole("button", { name: "Copy report for AI" }).click();

  const copied = await harness.copied();
  expect(copied).not.toBeNull();
  const markdown = copied ?? "";

  for (const question of harness.runRequests[0]!.querySet.queries) {
    expect(markdown, `missing ${question.queryId}`).toContain(
      JSON.stringify(question.text).slice(1, -1),
    );
  }
  expect(markdown).toContain('"plannedProviderCalls": 18');
  expect(markdown).toContain('"domain": "rival.test"');
  expect(markdown).toContain('"actionId": "act-page-inventory"');
  expect(markdown).toContain("unavailable_is_not_zero");
  expect(markdown).toContain("recommendation_not_evaluated");
  expect(markdown).toContain("## What to do");
  expect(markdown).toContain(
    "Prefer improving a page that already exists over creating a new one.",
  );
  // The two halves stay apart. Ordering alone would be satisfied by a document
  // that interpolated a question into its instructions, so the check is that no
  // observed value appears outside a fence at all.
  const outside = markdown
    .split("\n")
    .reduce<{ open: boolean; kept: string[] }>(
      (acc, line) =>
        line.startsWith("```")
          ? { open: !acc.open, kept: acc.kept }
          : { open: acc.open, kept: acc.open ? acc.kept : [...acc.kept, line] },
      { open: false, kept: [] },
    ).kept.join("\n");
  for (const question of harness.runRequests[0]!.querySet.queries) {
    expect(outside).not.toContain(question.text);
  }
  expect(outside).not.toContain("rival.test");
  expect(outside).not.toContain("acme.test");
  expect(outside).toContain("## What to do");
});

test("keeps the report through a language switch without paying again", async ({
  page,
}) => {
  const harness = await install(page);
  await runToReport(page);
  // Captured from the FIRST brief, so the comparison after the switch is
  // against something the page produced rather than against itself.
  await page.getByRole("button", { name: "Copy report for AI" }).click();
  const before = (await harness.copied()) ?? "";
  expect(before).toContain("# GEO detection report");

  await page.getByRole("button", { name: "切换到中文" }).click();
  await expect(page).toHaveURL(/\/zh\/agents\/geo$/);

  // The report survived the remount, in Chinese chrome...
  await expect(
    page.getByRole("heading", { name: "对应解决方案" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "复制报告给 AI" })).toHaveCount(
    1,
  );
  // ...and nothing was re-run.
  expect(harness.runRequests).toHaveLength(1);

  // The frozen questions did not translate, and the identity is unchanged.
  await page.getByRole("button", { name: "复制报告给 AI" }).click();
  const markdown = (await harness.copied()) ?? "";
  expect(markdown).toContain("# GEO 检测报告（交给 AI 实施）");
  for (const question of harness.runRequests[0]!.querySet.queries) {
    expect(markdown).toContain(JSON.stringify(question.text).slice(1, -1));
  }
  // Byte-for-byte the same data in both locales; only the chrome moved. The
  // build stamp is the one field that legitimately differs between two builds
  // of the same report, so it is normalized rather than compared.
  const dataOf = (document: string) =>
    document
      .replace(/"generatedAt": "[^"]*"/u, '"generatedAt": "<stamp>"')
      .split("\n")
      .reduce<{ open: boolean; kept: string[] }>(
        (acc, line) =>
          line.startsWith("```")
            ? { open: !acc.open, kept: acc.kept }
            : { open: acc.open, kept: acc.open ? [...acc.kept, line] : acc.kept },
        { open: false, kept: [] },
      ).kept.join("\n");
  expect(dataOf(markdown)).toBe(dataOf(before));
});

test("going back does not drop the visitor onto an empty form", async ({
  page,
}) => {
  const harness = await install(page);
  const provider: Request[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/agents/geo/run")) provider.push(request);
  });
  await runToReport(page);

  await page.getByRole("button", { name: "切换到中文" }).click();
  await expect(page).toHaveURL(/\/zh\/agents\/geo$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/agents\/geo$/);

  await expect(
    page.getByRole("button", { name: "Copy report for AI" }),
  ).toHaveCount(1);
  expect(provider).toHaveLength(1);
  expect(harness.runRequests).toHaveLength(1);
});

test("puts the brief on the page when the clipboard refuses it", async ({
  page,
}) => {
  await install(page, { clipboardFails: true });
  await runToReport(page);
  await page.getByRole("button", { name: "Copy report for AI" }).click();

  await expect(page.getByText("Could not reach the clipboard")).toBeVisible();
  const textarea = page.locator("textarea");
  await expect(textarea).toHaveCount(1);
  expect(await textarea.inputValue()).toContain("# GEO detection report");
});

test("the report never scrolls the page sideways", async ({ page }) => {
  await install(page);
  await runToReport(page);
  // The preview is the widest thing on the page; open it so the check is real.
  await page.locator("details").first().click();

  for (const width of [1440, 1280, 1024, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `page scrolls sideways at ${width}px`).toBeLessThanOrEqual(
      0,
    );
  }
});
