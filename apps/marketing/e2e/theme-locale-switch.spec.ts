import { expect, test } from "@playwright/test";

test.use({ locale: "zh-CN" });

function url(path: string) {
  return new RegExp(`^http://127\\.0\\.0\\.1:\\d+${path}$`);
}

test("keeps the selected theme while switching between English and Chinese", async ({
  page,
}) => {
  await page.goto("/pricing");

  await page
    .getByRole("button", { name: "Dark theme on. Switch to light." })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(() => localStorage.getItem("gg-theme")),
  ).toBe("light");

  await page.getByRole("button", { name: "切换到中文" }).click();
  await expect(page).toHaveURL(url("/zh/pricing"));
  expect(
    await page.evaluate(() => localStorage.getItem("gg-theme")),
  ).toBe("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "当前浅色主题，切换到深色" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page).toHaveURL(url("/pricing"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Light theme on. Switch to dark." }),
  ).toBeVisible();
});
