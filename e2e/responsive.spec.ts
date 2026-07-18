import { test, expect, type Page } from "@playwright/test";
import {
  PROJECT_SCREENS,
  seedProject,
  type SeededProject,
} from "./fixtures.ts";

/**
 * AC-042 — responsive layout. Every authenticated screen must render without a
 * horizontal scrollbar at the four target breakpoints (mobile / tablet / laptop /
 * desktop) and expose a `main` landmark. A page that overflows horizontally or
 * fails to render its main region is a layout defect.
 */

const VIEWPORTS = [
  { label: "mobile-390", width: 390, height: 844 },
  { label: "tablet-768", width: 768, height: 1024 },
  { label: "laptop-1024", width: 1024, height: 768 },
  { label: "desktop-1440", width: 1440, height: 900 },
] as const;

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // Allow a 1px rounding tolerance; anything beyond is a real overflow.
    return doc.scrollWidth > doc.clientWidth + 1;
  });
}

let project: SeededProject;

test.beforeAll(async ({ request }) => {
  project = await seedProject(request);
});

for (const screen of PROJECT_SCREENS) {
  for (const vp of VIEWPORTS) {
    test(`${screen} renders without horizontal overflow @ ${vp.label}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const response = await page.goto(`/p/${project.projectId}/${screen}`);
      expect(response?.status(), `${screen} should not 5xx`).toBeLessThan(500);

      // The app shell must expose a main landmark on every screen (a build or
      // runtime error would fail to render it or return a 5xx above).
      await expect(page.getByRole("main")).toBeVisible();

      expect(
        await hasHorizontalOverflow(page),
        `${screen} overflows horizontally at ${vp.width}px`,
      ).toBe(false);
    });
  }
}
