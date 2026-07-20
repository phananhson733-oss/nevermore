import { expect, test, type Page } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

async function openStudio(page: Page): Promise<void> {
  await installCriticalFlowApi(page);
  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  await expect(
    page
      .locator("[data-studio-page-hero]")
      .getByRole("heading", { name: "Turn actions into client-ready work." }),
  ).toBeVisible();
  await expect(page.locator("[data-studio-editor]" )).toBeVisible();
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
  const content = page.locator("#sf-artifact-content");
  const [workspaceBox, queueBox, editorBox, railBox, contentBox] =
    await Promise.all([
      workspace.boundingBox(),
      queue.boundingBox(),
      editor.boundingBox(),
      rail.boundingBox(),
      content.boundingBox(),
    ]);

  expect(workspaceBox).not.toBeNull();
  expect(queueBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(Math.abs(queueBox!.width - 238)).toBeLessThanOrEqual(1);
  expect(Math.abs(railBox!.width - 238)).toBeLessThanOrEqual(1);
  expect(Math.abs(editorBox!.x - (queueBox!.x + queueBox!.width) - 14)).toBeLessThanOrEqual(1);
  expect(Math.abs(railBox!.x - (editorBox!.x + editorBox!.width) - 14)).toBeLessThanOrEqual(1);
  expect(editorBox!.height).toBeGreaterThanOrEqual(660);
  expect(contentBox!.height).toBeGreaterThanOrEqual(480);
  await expect(content).toHaveCSS("font-size", "14px");
  await expect(queue).toHaveCSS("position", "sticky");
  await expect(rail).toHaveCSS("position", "sticky");
  await expectNoPageOverflow(page);
}

test("1920px keeps the 238 / canvas / 238 execution workspace and readable editor", async ({
  page,
}) => {
  await expectDesktopWorkspace(page, { width: 1920, height: 1080 });
});

test("1440px keeps the canonical three-column execution workspace and readable editor", async ({
  page,
}) => {
  await expectDesktopWorkspace(page, { width: 1440, height: 1000 });
});

test("1200px keeps queue and canvas together while the evidence rail spans below", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
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
  expect(queueBox!.x).toBeLessThan(editorBox!.x);
  expect(railBox!.y).toBeGreaterThanOrEqual(
    Math.max(queueBox!.y + queueBox!.height, editorBox!.y + editorBox!.height) + 13,
  );
  expect(Math.abs(railBox!.x - workspaceBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(railBox!.width - workspaceBox!.width)).toBeLessThanOrEqual(1);
  await expect(rail).toHaveCSS("position", "static");
  await expectNoPageOverflow(page);
});

test("390px stacks queue, editor, and evidence rail without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
});
