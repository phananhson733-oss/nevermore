import { expect, test, type Page } from "@playwright/test";
import {
  E2E_CANONICAL_ACTION_ID,
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  installCriticalFlowApi,
} from "./mock-api.ts";
import {
  EXECUTION_CLAIMS,
  expectedVerdict,
} from "./content-shadow-claims-fixture.ts";

/**
 * The Execution screen's Content Shadow surface, against fixed fixtures.
 *
 * The assertions are deliberately about honesty rather than layout: what the
 * screen may NOT say is the part that is expensive to get wrong. A `blocked`
 * verdict is the ordinary outcome of this stage — the research records hold no
 * outside source to check a citation against — so if the screen ever renders it
 * as a failure, every reviewer learns to read a working product as a broken one.
 */

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const RUN_ID = "00000000-0000-4000-8000-000000000901";
const ASYNC_RUN_ID = "00000000-0000-4000-8000-000000000902";
const DRAFT_ARTIFACT_ID = "00000000-0000-4000-8000-000000000903";
const FINDING_ID = "00000000-0000-4000-8000-000000000904";
const BRIEF_ARTIFACT_ID = "00000000-0000-4000-8000-000000000905";
const CONTENT_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const RESEARCH_LIMITATIONS = [
  "This pack carries only first-party frozen project records; no external source was retrieved or graded.",
  "No search demand or generative citation metric was read for this run.",
  "The automated checks do not include external fact-checking or brand-tone review.",
] as const;

const DRAFT_BODY = [
  "# How onboarding analytics reveal activation drop-off",
  "",
  "Activation stalls where the product stops explaining itself, and the",
  "onboarding funnel is where that first becomes measurable.",
  "",
  "## Evidence",
  "",
  "- A 2024 industry study reports a 38% activation gap.",
  "- Internal telemetry shows the same shape.",
  "",
  "## Sources",
  "",
  "- Forrester, State of Onboarding 2024",
].join("\n");

function runProjection() {
  return {
    flowShadowRunId: RUN_ID,
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    asyncRunId: ASYNC_RUN_ID,
    status: "completed",
    phase: "complete",
    contentHash: CONTENT_HASH,
    projectionVersion: "content-shadow.0.3.2",
    flowAdapterVersion: "content-shadow-adapter.0.3.0",
    outputLocale: "en",
    createdAt: "2026-07-25T00:00:00.000Z",
    source: {
      findingId: FINDING_ID,
      actionId: E2E_CANONICAL_ACTION_ID,
      contentBriefArtifactId: BRIEF_ARTIFACT_ID,
      contentBriefRevision: 3,
    },
    frozenInputs: {
      primaryFindingId: FINDING_ID,
      sourceDiagnosticRunId: "00000000-0000-4000-8000-000000000906",
      competitorEntityIds: [],
      searchCluster: {
        clusterKey: "onboarding",
        keywordEntityIds: ["00000000-0000-4000-8000-000000000907"],
      },
      generativeQueryEntityIds: [],
      firstParty: {
        siteOrigin: "https://example.test",
        icpPrimaryConversionUrl: "https://example.test/signup",
      },
      contentBriefOutline: {
        briefSections: ["Objective", "Evidence"],
        targetKeywords: ["onboarding analytics"],
        pageAssignment: "existing_page",
      },
    },
    research: {
      packId: "00000000-0000-4000-8000-000000000908",
      sources: [
        {
          kind: "content_brief",
          ref: BRIEF_ARTIFACT_ID,
          authorityTier: "A",
          limitation: "The confirmed content brief revision.",
        },
        {
          kind: "first_party_site",
          ref: "https://example.test",
          authorityTier: "A",
          limitation: "First-party identity only.",
        },
      ],
      limitations: [...RESEARCH_LIMITATIONS],
      generatedAt: "2026-07-25T00:01:00.000Z",
    },
    draft: {
      artifactId: DRAFT_ARTIFACT_ID,
      status: "draft",
      currentRevision: 1,
      contentText: DRAFT_BODY,
    },
    qa: {
      gateId: "00000000-0000-4000-8000-000000000909",
      // Derived from the claims, so this fixture cannot pin a verdict the gate
      // would never return for them.
      verdict: expectedVerdict(EXECUTION_CLAIMS),
      evaluatedArtifactId: DRAFT_ARTIFACT_ID,
      evaluatedRevision: 1,
      claims: EXECUTION_CLAIMS,
      evaluatedAt: "2026-07-25T00:02:00.000Z",
    },
  };
}

/** Layer the Content Shadow reads over the shared in-browser API. */
async function openExecution(page: Page): Promise<void> {
  await installCriticalFlowApi(page);
  // Registered after the shared catch-all, so these win.
  await page.route(
    `**${BASE}/content-shadow-runs/${RUN_ID}`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: runProjection() }),
      });
    },
  );
  await page.route(`**${BASE}/content-shadow-runs?**`, async (route) => {
    const summary = runProjection();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            flowShadowRunId: summary.flowShadowRunId,
            projectId: summary.projectId,
            siteId: summary.siteId,
            asyncRunId: summary.asyncRunId,
            contentHash: summary.contentHash,
            projectionVersion: summary.projectionVersion,
            flowAdapterVersion: summary.flowAdapterVersion,
            outputLocale: summary.outputLocale,
            createdAt: summary.createdAt,
            source: summary.source,
          },
        ],
        meta: { nextCursor: null, hasNext: false, limit: 100 },
      }),
    });
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/execution`);
  await expect(page.locator("[data-content-shadow]")).toBeVisible();
}

/**
 * Resolve a CSS colour expression the way the page itself would, so a token and
 * a computed style can be compared as the same bytes. Comparing a computed
 * `rgb(...)` against a raw `#rrggbb` token value can only ever be "not equal",
 * which would make a colour assertion pass without checking anything.
 */
async function resolveColor(page: Page, expression: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, expression);
}

test("renders the deliverable body itself, at reading size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openExecution(page);

  const body = page.locator("[data-shadow-body]");
  await expect(body).toBeVisible();
  // The draft body is English by design and is never translated: it is the
  // artefact under review, not chrome.
  await expect(
    body.getByText(/Activation stalls where the product stops explaining/),
  ).toBeVisible();
  const fontSize = await body.evaluate(
    (element) => getComputedStyle(element).fontSize,
  );
  expect(Number.parseFloat(fontSize)).toBeGreaterThanOrEqual(16);

  // The page itself never scrolls sideways, whatever the body contains.
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("localizes draft metadata as chrome without translating the English body", async ({
  page,
}) => {
  await openExecution(page);

  const draftBody = page.locator("[data-shadow-body]");
  await expect(
    draftBody.getByText("英文草稿 · 目标市场：en", { exact: true }),
  ).toBeVisible();
  await expect(
    draftBody.getByText(/Activation stalls where the product stops explaining/),
  ).toBeVisible();

  await page.locator("[data-view-switch='compare']").click();
  const compareDraft = page.locator("[data-compare-draft]");
  await expect(
    compareDraft.getByText("英文草稿 · 目标市场：en", { exact: true }),
  ).toBeVisible();
  await expect(
    compareDraft.getByText(
      /Activation stalls where the product stops explaining/,
    ),
  ).toBeVisible();
});

test("keeps draft metadata English when the workbench locale is English", async ({
  page,
}) => {
  await page.context().addCookies([
    { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
  ]);
  await openExecution(page);

  await expect(
    page
      .locator("[data-shadow-body]")
      .getByText("English draft · Target market: en", { exact: true }),
  ).toBeVisible();

  await page.locator("[data-view-switch='compare']").click();
  await expect(
    page
      .locator("[data-compare-draft]")
      .getByText("English draft · Target market: en", { exact: true }),
  ).toBeVisible();
});

test("shows every declared research limitation as a semantic list", async ({
  page,
}) => {
  await openExecution(page);

  const rail = page.locator("[data-qa-rail]");
  const list = rail.locator("[data-research-limitations]");
  const items = list.getByRole("listitem");
  await expect(list).toHaveCount(1);
  await expect(items).toHaveCount(RESEARCH_LIMITATIONS.length);
  for (const [index, limitation] of RESEARCH_LIMITATIONS.entries()) {
    await expect(items.nth(index)).toHaveText(limitation);
  }
  await expect(rail).not.toContainText("SignalFrame");
});

test("a blocked verdict reads as a held-back citation, never as a failure", async ({
  page,
}) => {
  await openExecution(page);

  // 1. The body is still there in full: it is the evidence a reviewer judges.
  await expect(page.locator("[data-shadow-body] p").first()).toBeVisible();

  // 2. The block states what it is, names the reasons, and gives a next step.
  const blocker = page.locator("[data-qa-blocker]");
  await expect(blocker).toBeVisible();
  await expect(blocker).toContainText("当前不能通过评审");
  await expect(blocker).toContainText("这不是运行失败");
  await expect(blocker).toContainText("断言缺少可核实出处");
  await expect(blocker).toContainText("下一步：");

  // 3. The ONLY place the screen says "failed" is the sentence denying it.
  //    Anything else would teach a reviewer to read a normal outcome as a
  //    fault and to stop reading the reason under it.
  const screen = page.locator("[data-content-shadow]");
  const text = await screen.innerText();
  expect(
    text.split("失败").length - 1,
    "every mention of failure must be the one that denies it",
  ).toBe(text.split("这不是运行失败").length - 1);
  expect(text).not.toContain("错误");
  expect(text).not.toContain("重试");
  expect(text).not.toContain("请稍后");

  // 4. The block is painted amber, not the product's red.
  //    Wording alone is not enough: colour is read before text, and coral is
  //    this palette's danger family. The verdict-level surface, its border and
  //    its text take the amber family the verdict pill already uses; the
  //    item-level state word beside a single failed claim keeps the status
  //    matrix's own coral, because "this one claim failed" is a fact about the
  //    claim, not the verdict on the deliverable.
  const surface = await blocker.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      text: style.color,
      border: style.borderTopColor,
    };
  });
  const amberSoft = await resolveColor(page, "var(--sf-amber-soft)");
  const amberText = await resolveColor(page, "var(--sf-amber-text)");
  const amberBorder = await resolveColor(
    page,
    "color-mix(in srgb, var(--sf-amber) 32%, var(--sf-border))",
  );
  const coralSoft = await resolveColor(page, "var(--sf-coral-soft)");
  const coralText = await resolveColor(page, "var(--sf-coral-text)");
  const coralBorder = await resolveColor(
    page,
    "color-mix(in srgb, var(--sf-coral) 32%, var(--sf-border))",
  );
  // Guard the comparison itself: if the two families ever resolved to the same
  // bytes, every "is not coral" assertion below would pass for free.
  expect(amberSoft).not.toBe(coralSoft);
  expect(amberText).not.toBe(coralText);
  expect(amberBorder).not.toBe(coralBorder);
  expect(surface.background).toBe(amberSoft);
  expect(surface.text).toBe(amberText);
  expect(surface.border).toBe(amberBorder);

  // 5. The failed-claim state word inside it is still coral, and is proven to
  //    be so rather than assumed: the layered ruling only holds if both halves
  //    are true at once.
  const states = await blocker
    .locator("[data-qa-blocker-claim] span:last-child")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent ?? "",
        color: getComputedStyle(element).color,
      })),
    );
  const failedStates = states.filter((state) => state.text.includes("未通过"));
  expect(failedStates.length).toBeGreaterThan(0);
  for (const state of failedStates) expect(state.color).toBe(coralText);

  // 6. The deliverable is still listed; a blocked draft is not hidden away.
  await expect(
    page.locator("[data-content-shadow] [aria-current='true']"),
  ).toBeVisible();
});

test("the quality rail counts three states and never rounds one up", async ({
  page,
}) => {
  await openExecution(page);
  const rail = page.locator("[data-qa-rail]");

  // 7 claims: 3 recorded passed, 2 not passed, 2 not judged. Three columns,
  // never two — folding "not judged" into either side is the lie the gate's
  // third state exists to prevent.
  await expect(rail).toContainText("本轮共 7 项检查");
  await expect(rail).toContainText("已通过");
  await expect(rail).toContainText("未通过");
  await expect(rail).toContainText("未判定");
  const counts = await rail.innerText();
  expect(counts).toMatch(/已通过\s*3/u);
  expect(counts).toMatch(/未通过\s*2/u);
  expect(counts).toMatch(/未判定\s*2/u);

  // The advisory disclosure: a pass tally that hides them overstates itself.
  await expect(rail).toContainText("本轮 7 项检查里有 3 项为提示级");

  // Zero outside sources, said out loud rather than left blank.
  await expect(rail).toContainText("0 条 —— 本轮未做外部检索");
});

test("the quality rail shows no identifier a customer cannot act on", async ({
  page,
}) => {
  await openExecution(page);
  const rail = page.locator("[data-qa-rail]");
  const chrome = (await rail.innerText())
    // The English claim details are verbatim evidence a reviewer checks, so
    // they are excluded here: this assertion is about the screen's own words.
    .replace(/判定依据：[^\n]*/gu, "");

  // No UUIDs. The truncated content hash is the one identifier that earns its
  // place, and it is 12 characters, not a UUID shape.
  expect(chrome).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/u);
  // No rule identifiers, and no abstract vocabulary standing in for a finding.
  expect(chrome.toLowerCase()).not.toMatch(/\brl\d+|\bsc\d+b?\b/u);
  expect(chrome.toLowerCase()).not.toMatch(/\bgate\b/u);
  expect(chrome).not.toContain("门禁");
  // No enum literals from the wire.
  expect(chrome).not.toContain("english_blog_draft");
  expect(chrome).not.toContain("content_brief");
  expect(chrome).not.toContain("needs_review");
  expect(chrome).not.toContain("unevaluated");

  // What it does say instead: written names.
  await expect(rail).toContainText("事实红线");
  await expect(rail).toContainText("断言缺少可核实出处");
});

test("an unjudged check is shown as unjudged, with the reason a reviewer needs", async ({
  page,
}) => {
  await openExecution(page);
  const rail = page.locator("[data-qa-rail]");

  // Task 6's low-confidence calibration: a named reference with no second
  // signal is reported as undecided, never guessed into a pass or a failure.
  await expect(rail).toContainText(
    "This name may be a product, a feature or a section title",
  );
  await expect(rail).toContainText(
    "locale not supported by deterministic segmentation",
  );
  await expect(rail).toContainText("主题覆盖");
  // Its group reads "not judged", not a tick.
  await expect(rail).toContainText("是否覆盖了冻结 cluster 的目标关键词");
});

test("this stage says plainly that it publishes nothing", async ({ page }) => {
  await openExecution(page);
  const rail = page.locator("[data-qa-rail]");
  await expect(rail).toContainText("本阶段不做任何发布");
  await expect(rail).toContainText(
    "不写入任何内容管理系统、Git 或第三方发布目标",
  );
  // And it never claims an effect it does not measure.
  await expect(rail).toContainText("不推断流量、排名或转化");
});
