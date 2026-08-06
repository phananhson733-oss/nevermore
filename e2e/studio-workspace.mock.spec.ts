import { expect, test, type Page } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

async function useEnglishUi(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
}

async function openStudio(page: Page): Promise<void> {
  await installCriticalFlowApi(page);
  await useEnglishUi(page);
  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  await expect(
    page
      .locator("[data-studio-page-hero]")
      .getByRole("heading", { name: "Execution center", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("[data-studio-editor]")).toBeVisible();
  // Exactly one `main` landmark — the shell's (`layout.tsx:187`). No axe scan
  // here can report a duplicate: the scans select WCAG tags and keep only
  // critical/serious, while `landmark-no-duplicate-main` is best-practice at
  // moderate (measured — stop gate §17.6c). Asserted in this spec because it
  // is one of the few with a fixture that renders the screen for real.
  await expect(page.getByRole("main")).toHaveCount(1);
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
  const queue = page.locator("[data-studio-queue]");
  const editor = page.locator("[data-studio-editor-column]");
  const rail = page.locator("[data-studio-evidence-rail]");
  const markdownPreview = page.locator("[data-studio-markdown-preview]");
  const contentSurface = markdownPreview.or(
    page.locator("#sf-artifact-content"),
  );
  const [workspaceBox, queueBox, editorBox, railBox, contentBox] =
    await Promise.all([
      workspace.boundingBox(),
      queue.boundingBox(),
      editor.boundingBox(),
      rail.boundingBox(),
      contentSurface.boundingBox(),
    ]);

  expect(workspaceBox).not.toBeNull();
  expect(queueBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  const queueRange =
    viewport.width <= 1280
      ? { min: 250, max: 288 }
      : { min: 272, max: 316 };
  expect(queueBox!.width).toBeGreaterThanOrEqual(queueRange.min);
  expect(queueBox!.width).toBeLessThanOrEqual(queueRange.max);
  expect(editorBox!.x).toBeGreaterThan(queueBox!.x + queueBox!.width);

  const [editorPlacement, railPlacement] = await Promise.all(
    [editor, rail].map((locator) =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          column: style.gridColumnStart,
          row: style.gridRowStart,
        };
      }),
    ),
  );
  expect(editorPlacement).toEqual({ column: "2", row: "1" });
  expect(railPlacement).toEqual(editorPlacement);
  expect(Math.abs(railBox!.y - editorBox!.y)).toBeLessThanOrEqual(1);
  expect(railBox!.x).toBeGreaterThanOrEqual(editorBox!.x);
  expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(
    editorBox!.x + editorBox!.width + 1,
  );
  expect(editorBox!.height).toBeGreaterThanOrEqual(660);
  expect(contentBox!.height).toBeGreaterThanOrEqual(480);
  await expect(contentSurface).toHaveCSS(
    "font-size",
    (await markdownPreview.count()) > 0 ? "17px" : "14px",
  );
  await expect(queue).toHaveCSS("position", "sticky");
  await expect(rail).toHaveCSS("position", "sticky");
  await expectNoPageOverflow(page);
}

test("1920px keeps the two-column execution workspace and overlay rail readable", async ({
  page,
}) => {
  await expectDesktopWorkspace(page, { width: 1920, height: 1080 });
});

test("1440px keeps the two-column execution workspace and overlay rail readable", async ({
  page,
}) => {
  await expectDesktopWorkspace(page, { width: 1440, height: 1000 });
});

test("1200px keeps the compact two-column workspace and overlay rail readable", async ({
  page,
}) => {
  await expectDesktopWorkspace(page, { width: 1200, height: 1000 });
});

async function expectSingleColumnWorkspace(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await openStudio(page);

  const workspace = page.locator("[data-studio-workspace]");
  const queue = page.locator("[data-studio-queue]");
  const editor = page.locator("[data-studio-editor-column]");
  const rail = page.locator("[data-studio-evidence-rail]");
  const [workspaceBox, queueBox, editorBox, railBox] = await Promise.all([
    workspace.boundingBox(),
    queue.boundingBox(),
    editor.boundingBox(),
    rail.boundingBox(),
  ]);

  expect(workspaceBox).not.toBeNull();
  expect(queueBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(editorBox!.y).toBeGreaterThan(queueBox!.y + queueBox!.height);
  expect(railBox!.y).toBeGreaterThan(editorBox!.y + editorBox!.height);
  for (const box of [queueBox!, editorBox!, railBox!]) {
    expect(Math.abs(box.x - workspaceBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - workspaceBox!.width)).toBeLessThanOrEqual(1);
  }
  await expect(queue).toHaveCSS("position", "static");
  await expect(rail).toHaveCSS("position", "static");
  await expectNoPageOverflow(page);
}

test("1024px switches to one column with a static evidence rail", async ({
  page,
}) => {
  await expectSingleColumnWorkspace(page, { width: 1024, height: 1000 });
});

test("390px stacks queue, editor, and evidence rail without horizontal overflow", async ({
  page,
}) => {
  await expectSingleColumnWorkspace(page, { width: 390, height: 844 });
});
