import { expect, test, type Page } from "@playwright/test";
import {
  E2E_ARTIFACT_ID,
  E2E_PROJECT_ID,
  installCriticalFlowApi,
} from "./mock-api.ts";

type StudioLocale = "en" | "zh-CN";

const ARTIFACT_H1: Readonly<Record<StudioLocale, string>> = {
  en: "Review and process deliverables directly",
  "zh-CN": "直接查看并处理交付物",
};

async function useUiLocale(page: Page, locale: StudioLocale): Promise<void> {
  await page
    .context()
    .addCookies([
      {
        name: "sf_ui_locale",
        value: locale,
        domain: "localhost",
        path: "/",
      },
    ]);
}

async function openStudio(
  page: Page,
  options: {
    readonly locale?: StudioLocale;
    readonly search?: string;
  } = {},
): Promise<void> {
  await installCriticalFlowApi(page);
  await useUiLocale(page, options.locale ?? "en");
  await page.goto(`/p/${E2E_PROJECT_ID}/studio${options.search ?? ""}`);
  await expect(page.locator("[data-studio-page-hero]")).toBeVisible();
  await expect(page.locator("[data-studio-editor]")).toBeVisible();
  // Exactly one `main` landmark — the shell's (`layout.tsx:187`). No axe scan
  // here can report a duplicate: the scans select WCAG tags and keep only
  // critical/serious, while `landmark-no-duplicate-main` is best-practice at
  // moderate (measured — stop gate §17.6c). Asserted in this spec because it
  // is one of the few with a fixture that renders the screen for real.
  await expect(page.getByRole("main")).toHaveCount(1);
}

async function expectArtifactHero(
  page: Page,
  locale: StudioLocale,
): Promise<void> {
  const hero = page.locator("[data-studio-page-hero]");
  await expect(
    hero.getByRole("heading", {
      name: ARTIFACT_H1[locale],
      exact: true,
      level: 1,
    }),
  ).toBeVisible();

  const growthMapLink = hero.getByRole("link", {
    name: locale === "en" ? /Growth Map/i : /增长地图/,
  });
  await expect(growthMapLink).toHaveCount(1);
  await expect(growthMapLink).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/growth-map`,
  );
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectDesktopWorkspace(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await openStudio(page);

  const workspace = page.locator("[data-studio-workspace]");
  const queue = workspace.locator(":scope > [data-studio-queue]");
  const document = workspace.locator(
    ":scope > [data-studio-editor-column]",
  );
  const rail = document.locator("[data-studio-evidence-rail]");
  const [workspaceBox, queueBox, documentBox, railBox] = await Promise.all([
    workspace.boundingBox(),
    queue.boundingBox(),
    document.boundingBox(),
    rail.boundingBox(),
  ]);

  expect(workspaceBox).not.toBeNull();
  expect(queueBox).not.toBeNull();
  expect(documentBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  await expect(workspace.locator(":scope > [data-studio-queue]")).toHaveCount(
    1,
  );
  await expect(
    workspace.locator(":scope > [data-studio-editor-column]"),
  ).toHaveCount(1);
  await expect(
    workspace.locator(":scope > [data-studio-evidence-rail]"),
  ).toHaveCount(0);
  await expect(rail).toHaveCount(1);

  const queueRange =
    viewport.width <= 1280
      ? { min: 250, max: 288 }
      : { min: 272, max: 316 };
  expect(queueBox!.width).toBeGreaterThanOrEqual(queueRange.min);
  expect(queueBox!.width).toBeLessThanOrEqual(queueRange.max);
  expect(documentBox!.x).toBeGreaterThan(queueBox!.x + queueBox!.width);
  expect(documentBox!.x + documentBox!.width).toBeLessThanOrEqual(
    workspaceBox!.x + workspaceBox!.width + 1,
  );
  expect(railBox!.x).toBeGreaterThanOrEqual(documentBox!.x);
  expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(
    documentBox!.x + documentBox!.width + 1,
  );
  await expect(queue).toHaveCSS("position", "sticky");
  await expectNoPageOverflow(page);
}

test("uses the Artifact heading and a real Growth Map return link in both locales", async ({
  page,
}) => {
  await openStudio(page);
  await expectArtifactHero(page, "en");

  await useUiLocale(page, "zh-CN");
  await page.reload();
  await expect(page.locator("[data-studio-editor]")).toBeVisible();
  await expectArtifactHero(page, "zh-CN");
});

test("1920px keeps queue and selected document as two columns with evidence inside the document", async ({
  page,
}) => {
  await expectDesktopWorkspace(page, { width: 1920, height: 1080 });
});

test("1440px keeps queue and selected document as two columns with evidence inside the document", async ({
  page,
}) => {
  await expectDesktopWorkspace(page, { width: 1440, height: 1000 });
});

test("1200px keeps the compact two-column workspace with evidence inside the document", async ({
  page,
}) => {
  await expectDesktopWorkspace(page, { width: 1200, height: 1000 });
});

test("queue rows are compact whole-row buttons that open a deliverable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openStudio(page, {
    search: "?artifactId=00000000-0000-4000-8000-000000000499",
  });

  const queue = page.locator("[data-studio-queue]");
  const artifactRow = queue.locator(
    `[data-studio-artifact-id="${E2E_ARTIFACT_ID}"]`,
  );
  const rowButton = artifactRow.locator(":scope > button[type='button']");
  await expect(artifactRow).toBeVisible();
  await expect(rowButton).toHaveCount(1);
  await expect(rowButton.locator("button")).toHaveCount(0);

  const [rowBox, buttonBox] = await Promise.all([
    artifactRow.boundingBox(),
    rowButton.boundingBox(),
  ]);
  expect(rowBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.height).toBeLessThanOrEqual(160);
  expect(Math.abs(buttonBox!.width - rowBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(buttonBox!.height - rowBox!.height)).toBeLessThanOrEqual(1);

  await rowButton.click();
  await expect(
    page.locator("[data-studio-markdown-preview]"),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`artifactId=${E2E_ARTIFACT_ID}(?:&|$)`),
  );
});

test("the selected document exposes governance metadata and formatted Markdown by default", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openStudio(page);

  const document = page.locator("[data-studio-editor-column]");
  const governance = document.getByRole("region", {
    name: "Delivery governance",
    exact: true,
  });
  await expect(governance).toBeVisible();
  expect(await governance.locator(":scope > *").count()).toBeGreaterThanOrEqual(
    3,
  );
  await expect(governance).toContainText("Fix the failing product page");

  const previewTab = document.getByRole("tab", {
    name: "Preview",
    exact: true,
  });
  const markdownPreview = document.locator(
    "[data-studio-markdown-preview]",
  );
  await expect(previewTab).toHaveAttribute("aria-selected", "true");
  await expect(markdownPreview).toBeVisible();
  await expect(markdownPreview.locator("p")).toHaveText(
    "Restore the product endpoint and add a regression test.",
  );
  await expect(document.locator("#sf-artifact-content")).toHaveCount(0);
});

async function expectSingleColumnWorkspace(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await openStudio(page);

  const workspace = page.locator("[data-studio-workspace]");
  const queue = workspace.locator(":scope > [data-studio-queue]");
  const document = workspace.locator(
    ":scope > [data-studio-editor-column]",
  );
  const rail = document.locator("[data-studio-evidence-rail]");
  const markdownPreview = document.locator(
    "[data-studio-markdown-preview]",
  );
  const [workspaceBox, queueBox, documentBox, railBox, previewBox] =
    await Promise.all([
      workspace.boundingBox(),
      queue.boundingBox(),
      document.boundingBox(),
      rail.boundingBox(),
      markdownPreview.boundingBox(),
    ]);

  expect(workspaceBox).not.toBeNull();
  expect(queueBox).not.toBeNull();
  expect(documentBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(documentBox!.y).toBeGreaterThan(queueBox!.y + queueBox!.height);
  expect(railBox!.y).toBeGreaterThanOrEqual(
    previewBox!.y + previewBox!.height - 1,
  );
  for (const box of [queueBox!, documentBox!]) {
    expect(Math.abs(box.x - workspaceBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - workspaceBox!.width)).toBeLessThanOrEqual(1);
  }
  expect(railBox!.x).toBeGreaterThanOrEqual(documentBox!.x);
  expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(
    documentBox!.x + documentBox!.width + 1,
  );
  await expect(queue).toHaveCSS("position", "static");
  await expect(rail).toHaveCSS("position", "static");
  await expectNoPageOverflow(page);
}

test("1024px switches to one column with a static evidence rail", async ({
  page,
}) => {
  await expectSingleColumnWorkspace(page, { width: 1024, height: 1000 });
});

test("390px stacks queue and document, including its evidence rail, without horizontal overflow", async ({
  page,
}) => {
  await expectSingleColumnWorkspace(page, { width: 390, height: 844 });
});
