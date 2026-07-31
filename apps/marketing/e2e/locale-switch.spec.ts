import { expect, test } from "@playwright/test";

/**
 * Regression cover for the language switcher going dead on a Chinese browser.
 *
 * `localePrefix: "as-needed"` moved English onto the bare path, which put every
 * unprefixed URL inside next-intl's locale detection. A zh-CN browser asking for
 * "/" was answered with a 307 to /zh, so the switcher's push back to "/" bounced
 * straight to /zh and the button looked broken. Detection is off now: the locale
 * comes from the URL, and these tests run under a zh-CN browser on purpose —
 * that is the configuration where the bug reproduced.
 */
test.use({ locale: "zh-CN" });

const toChinese = 'button[aria-label="切换到中文"]';
const toEnglish = 'button[aria-label="Switch to English"]';

/**
 * URL assertions are anchored on the whole URL. A trailing-only pattern such as
 * `/pricing$` also matches /zh/pricing, which is exactly the redirect these
 * tests exist to catch, so a loose pattern would pass while the bug is present.
 */
function url(path: string) {
  return new RegExp(`^http://127\\.0\\.0\\.1:\\d+${path}$`);
}

test("a zh browser gets the English home page at the bare path", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(url("/"));
  await expect(page.locator(toChinese)).toBeVisible();
});

test("a zh browser reaches an English-only page without being redirected", async ({
  page,
}) => {
  const response = await page.goto("/pricing");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(url("/pricing"));
});

test("switching to Chinese moves to the /zh prefix", async ({ page }) => {
  await page.goto("/pricing");
  await page.locator(toChinese).click();
  await expect(page).toHaveURL(url("/zh/pricing"));
});

test("switching back to English returns to the unprefixed path", async ({
  page,
}) => {
  await page.goto("/zh/pricing");
  await page.locator(toEnglish).click();
  await expect(page).toHaveURL(url("/pricing"));
});

test("switching back to English from the Chinese home page reaches /", async ({
  page,
}) => {
  await page.goto("/zh");
  await page.locator(toEnglish).click();
  await expect(page).toHaveURL(url("/"));
});
