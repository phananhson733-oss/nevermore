import { expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

test("Next development runtime renders without browser or CSP errors", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(globalThis, "__sfCspViolations", {
      configurable: false,
      value: violations,
    });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.effectiveDirective}:${event.blockedURI}`);
    });
  });
  await installCriticalFlowApi(page);

  const response = await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "E2E Critical Flow" }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("'unsafe-eval'");
  expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  expect(csp).not.toMatch(/style-src[^;]*'nonce-/);
  expect(browserErrors).toEqual([]);
  const cspViolations = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          readonly __sfCspViolations?: readonly string[];
        }
      ).__sfCspViolations ?? [],
  );
  expect(cspViolations).toEqual([]);
});
