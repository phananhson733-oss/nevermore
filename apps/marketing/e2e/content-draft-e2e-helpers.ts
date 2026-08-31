// @input -- standalone Marketing pages and deterministic endpoint replies
// @output -- context-wide API isolation and real Brief v2 confirmation gestures
// @pos -- shared browser-only acceptance helpers; no auth or provider simulation claims
import { expect, type Page, type Request, type Route } from "@playwright/test";
import { parseConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import type { ConfirmedBriefV2, ContentBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";

type Reply = (route: Route, request: Request) => Promise<void>;
export interface DraftApiGuard {
  readonly runRequests: Request[];
  readonly sectionRequests: Request[];
  readonly briefRequests: Request[];
  readonly consentRequests: Request[];
  readonly unexpected: string[];
}

/** Popup requests inherit this guard. Every API is fulfilled here or aborted. */
export async function installDraftApiGuard(page: Page, options: {
  readonly signedIn: boolean;
  readonly run?: Reply;
  readonly section?: Reply;
  readonly briefRun?: Reply;
}): Promise<DraftApiGuard> {
  const guard: DraftApiGuard = { runRequests: [], sectionRequests: [], briefRequests: [], consentRequests: [], unexpected: [] };
  const knownShell = new Set(["GET /api/auth/profile", "GET /api/auth/one-tap/nonce", "GET /api/credits/balance", "GET /api/credits/ledger", "GET /api/account/websites"]);
  await page.context().route("**/api/**", async (route) => {
    const request = route.request();
    const id = `${request.method()} ${new URL(request.url()).pathname}`;
    if (id === "GET /api/auth/session") {
      await fulfillJson({ signedIn: options.signedIn })(route);
      return;
    }
    if (id === "GET /api/account/websites" && options.signedIn) {
      await fulfillJson({ data: [] })(route);
      return;
    }
    if (id === "POST /api/consent") {
      guard.consentRequests.push(request);
      await route.fulfill({ status: 204 });
      return;
    }
    for (const [endpoint, reply, requests] of [
      ["POST /api/tools/content-draft/run", options.run, guard.runRequests],
      ["POST /api/tools/content-draft/section", options.section, guard.sectionRequests],
      ["POST /api/tools/content-brief/run", options.briefRun, guard.briefRequests],
    ] as const) {
      if (id === endpoint && reply !== undefined) {
        requests.push(request);
        await reply(route, request);
        return;
      }
    }
    if (!knownShell.has(id)) guard.unexpected.push(id);
    await route.abort("blockedbyclient");
  });
  return guard;
}

export function fulfillJson(body: unknown) {
  return async (route: Route): Promise<void> => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  };
}

export async function necessaryOnly(page: Page, locale: "en" | "zh"): Promise<void> {
  const button = page.getByRole("button", { name: locale === "zh" ? "仅必要" : "Necessary Only", exact: true });
  await expect(button).toBeVisible();
  const response = page.waitForResponse((value) => new URL(value.url()).pathname === "/api/consent");
  await button.click();
  expect((await response).status()).toBe(204);
  await expect(button).toHaveCount(0);
}

export async function parseConfirmed(value: unknown): Promise<ConfirmedBriefV2> {
  const parsed = await parseConfirmedBriefV2(value);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`Confirmed Brief fixture/receipt rejected: ${parsed.path}`);
  return parsed.value;
}

/** Uses the current producer, not a synthetic legacy result or a direct storage write. */
export async function openConfirmedBriefV2(page: Page, brief: ContentBriefV2, options: { readonly locale?: "en" | "zh"; readonly edit?: boolean } = {}): Promise<ConfirmedBriefV2> {
  const locale = options.locale ?? "en";
  await page.goto(`/${locale}/tools/content-brief`);
  await necessaryOnly(page, locale);
  await page.locator('input[name="primary"]').fill(brief.context.input.primary);
  await page.locator("[data-run-brief]").click();
  await expect(page.locator("[data-confirm-brief]")).toBeVisible();
  await expect(page.locator("a[data-generate-draft]")).toHaveCount(0);
  if (options.edit) {
    await page.locator('[data-outline-h2="O1"]').fill("Check reporting collection dates");
    await page.locator('[data-h3-editor="O1"] > summary').click();
    await page.locator('[data-outline-h3="O1"]').fill("Collection date\nFinalized period");
    await page.locator('[data-move-up="O2"]').click();
  }
  await page.locator("[data-confirm-brief]").click();
  await expect(page.locator("a[data-generate-draft]")).toBeVisible();
  const raw = await page.locator("[data-confirmed-json]").textContent();
  return parseConfirmed(JSON.parse(raw ?? "null"));
}
