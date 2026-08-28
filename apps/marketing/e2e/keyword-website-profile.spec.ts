import { createHash } from "node:crypto";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import type { KeywordOpportunityResult } from "@sf/public-tools/keyword-opportunity/types";

import {
  GRANT_TTL_SECONDS,
  IDENTITY_TTL_SECONDS,
} from "../src/lib/auth/grant-cookie";
import { seal } from "../src/lib/auth/sealed-cookie";
import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  canonicalProfileJson,
  emptyMarketingWebsiteProfile,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
  type WebsiteProfileReferenceV1,
  type WebsiteSummary,
} from "../src/lib/account-websites/contracts";

const NOW = "2026-08-28T00:00:00.000Z";
const GOOGLE_SUBJECT = "108124453711223344556";
const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";
const SNAPSHOT_REVISION = 4;

// The standalone server is started with this same test-only key. No OAuth,
// Supabase, GSC or provider credential is present in the browser process.
process.env.TOKEN_ENCRYPTION_KEY = "cd".repeat(32);

interface StageOneRequest {
  readonly siteUrl: string;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly seeds: readonly string[];
  readonly websiteProfileReference?: WebsiteProfileReferenceV1;
}

interface StageTwoRequest {
  readonly contextToken: string;
  readonly requestId: string;
}

interface KeywordHarness {
  readonly reference: WebsiteProfileReferenceV1;
  readonly stageOneRequests: StageOneRequest[];
  readonly stageTwoRequests: StageTwoRequest[];
  readonly sessionRequests: () => number;
  readonly websiteListRequests: () => number;
  readonly websiteDetailRequests: () => number;
  readonly websiteWrites: () => readonly string[];
}

function keywordProfile(): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "Acme Revenue",
    oneLinePositioning: "Revenue operations for clinics",
    valueProposition: "Find and fix revenue leakage",
    categories: ["Revenue operations"],
    coreFeatures: ["Claim automation"],
    useCases: ["Recover denied claims"],
    icpInterests: ["Faster cash flow"],
    primaryIcp: "Clinic finance teams",
    jtbd: "Reduce days in accounts receivable",
    country: "US",
    locale: "en-US",
  };
}

function profileHash(profile: MarketingWebsiteProfileV1): string {
  return createHash("sha256")
    .update(canonicalProfileJson(profile))
    .digest("hex");
}

function confirmedWebsite(profile: MarketingWebsiteProfileV1): {
  readonly summary: WebsiteSummary;
  readonly details: WebsiteDetails;
  readonly reference: WebsiteProfileReferenceV1;
} {
  const hash = profileHash(profile);
  const reference: WebsiteProfileReferenceV1 = {
    schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
    websiteId: WEBSITE_ID,
    snapshotId: SNAPSHOT_ID,
    snapshotRevision: SNAPSHOT_REVISION,
    profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
    profileHash: hash,
  };
  const summary: WebsiteSummary = {
    websiteId: WEBSITE_ID,
    origin: "https://example.com",
    host: "example.com",
    canonicalSiteKey: "example.com",
    displayName: "Example saved profile",
    isPrimary: true,
    profileState: "confirmed",
    confirmedSnapshotId: SNAPSHOT_ID,
    confirmedSnapshotRevision: SNAPSHOT_REVISION,
    confirmedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    summary,
    reference,
    details: {
      ...summary,
      submittedUrl: "https://example.com/",
      draft: {
        draftVersion: 1,
        updatedAt: NOW,
        profileHash: hash,
        profile,
      },
      currentConfirmedSnapshot: {
        ...reference,
        confirmedAt: NOW,
        profile,
      },
    },
  };
}

function minimalResult(siteUrl: string): KeywordOpportunityResult {
  return {
    availability: "insufficient_evidence",
    marketCode: "US",
    languageCode: "en",
    context: {
      siteUrl,
      pagesFetched: 3,
      productPagesFetched: 1,
      propositions: [],
      contextSufficient: true,
      stopReason: "fixture_complete",
    },
    rows: [],
    withheld: [],
    incomplete: [],
    clusters: [],
    funnel: {
      generated: 0,
      deduplicated: 0,
      providerReturned: 0,
      volumePositive: 0,
      explicitZero: 0,
      providerNoData: 0,
      alreadyCovered: null,
      serpSampled: 0,
      winnableEvidence: 0,
      shown: 0,
    },
    unavailableStages: ["gsc_coverage"],
    nextStepSuggestions: [],
  };
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installConnectedCookies(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "gg_id",
      value: seal(
        "gg_id",
        { sub: GOOGLE_SUBJECT, email: "owner@example.test" },
        IDENTITY_TTL_SECONDS,
      ),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
    {
      name: "gg_sites",
      value: seal(
        "gg_sites",
        { properties: ["sc-domain:example.com"], total: 1 },
        GRANT_TTL_SECONDS,
      ),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function installHarness(page: Page): Promise<KeywordHarness> {
  const profile = keywordProfile();
  const website = confirmedWebsite(profile);
  const stageOneRequests: StageOneRequest[] = [];
  const stageTwoRequests: StageTwoRequest[] = [];
  const writes: string[] = [];
  let sessionRequests = 0;
  let websiteListRequests = 0;
  let websiteDetailRequests = 0;

  await page.addInitScript(({ updatedAt }) => {
    window.localStorage.setItem(
      "gengrowth_consent",
      JSON.stringify({
        consent_version: "1.0",
        necessary: true,
        analytics: false,
        marketing: false,
        updated_at: updatedAt,
      }),
    );
  }, { updatedAt: NOW });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    // Keep the global header signed out so its independent account-menu query
    // cannot be confused with the picker's explicit lazy read. The picker uses
    // the account session seam below and is the consumer under test.
    if (path === "/api/auth/profile") {
      await fulfillJson(route, 401, { error: { code: "auth_required" } });
      return;
    }
    if (path === "/api/auth/session") {
      sessionRequests += 1;
      await fulfillJson(route, 200, { signedIn: true });
      return;
    }
    if (path === "/api/auth/one-tap/nonce") {
      await fulfillJson(route, 503, { error: { code: "unavailable" } });
      return;
    }
    if (path === "/api/account/websites" && method === "GET") {
      websiteListRequests += 1;
      await fulfillJson(route, 200, {
        data: { websites: [website.summary] },
      });
      return;
    }
    if (path === `/api/account/websites/${WEBSITE_ID}` && method === "GET") {
      websiteDetailRequests += 1;
      await fulfillJson(route, 200, { data: { website: website.details } });
      return;
    }
    if (path.startsWith("/api/account/websites") && method !== "GET") {
      writes.push(`${method} ${path}`);
      await fulfillJson(route, 405, { error: { code: "not_allowed" } });
      return;
    }
    if (path === "/api/tools/hidden-keywords/context" && method === "POST") {
      const body = request.postDataJSON() as StageOneRequest;
      stageOneRequests.push(body);
      await fulfillJson(route, 200, {
        data: {
          contextToken:
            body.websiteProfileReference === undefined
              ? "keyword-context-import-e2e"
              : "keyword-context-reference-e2e",
          propositions: [],
          pagesFetched: 3,
          productPagesFetched: 1,
          contextSufficient: true,
          ...(body.websiteProfileReference === undefined
            ? {}
            : { websiteProfileReference: body.websiteProfileReference }),
        },
      });
      return;
    }
    if (
      path === "/api/tools/hidden-keywords/opportunities" &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as StageTwoRequest;
      stageTwoRequests.push(body);
      const latest = stageOneRequests.at(-1);
      await fulfillJson(route, 200, {
        data: {
          run: {
            tool: "keyword_opportunity_map",
            schemaVersion: "keyword_opportunity_map.v2",
            mode: "public_preview",
            scope: "site",
            persistence: "none",
            completedAt: NOW,
          },
          result: minimalResult(latest?.siteUrl ?? "https://example.com"),
        },
      });
      return;
    }

    await fulfillJson(route, 404, { error: { code: "not_mocked" } });
  });

  return {
    reference: website.reference,
    stageOneRequests,
    stageTwoRequests,
    sessionRequests: () => sessionRequests,
    websiteListRequests: () => websiteListRequests,
    websiteDetailRequests: () => websiteDetailRequests,
    websiteWrites: () => writes,
  };
}

async function openExactPicker(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Use saved website profile" })
    .click();
  await expect(page.getByText("Exact URL match")).toBeVisible();
  await expect(page.locator("#agent-website-profile")).toHaveValue(WEBSITE_ID);
}

test.beforeEach(async ({ context }) => {
  await installConnectedCookies(context);
});

test("uses a lazy saved-profile picker and keeps detached import editable and unlinked", async ({
  page,
}) => {
  const harness = await installHarness(page);
  await page.goto("/tools/low-competition-keywords");

  await expect(
    page.getByRole("button", { name: "Use saved website profile" }),
  ).toBeVisible();
  expect(harness.sessionRequests()).toBe(0);
  expect(harness.websiteListRequests()).toBe(0);
  expect(harness.websiteDetailRequests()).toBe(0);

  await openExactPicker(page);
  expect(harness.sessionRequests()).toBe(1);
  expect(harness.websiteListRequests()).toBe(1);
  expect(harness.websiteDetailRequests()).toBe(1);
  await page.getByRole("button", { name: "Import" }).click();

  const detached = page.locator('[data-keyword-profile-context="import"]');
  await expect(detached).toContainText("Detached website profile import");
  const seedInput = page.getByLabel("Seed terms (optional)");
  await expect(seedInput).toHaveValue(
    [
      "Revenue operations",
      "Claim automation",
      "Recover denied claims",
      "Faster cash flow",
      "Clinic finance teams",
      "Reduce days in accounts receivable",
    ].join(", "),
  );
  await seedInput.fill("edited detached seed, another run-only term");
  await page.getByRole("button", { name: "Read my site" }).click();
  await expect(
    page.getByRole("heading", { name: "What we read off your site" }),
  ).toBeVisible();

  expect(harness.stageOneRequests).toHaveLength(1);
  expect(harness.stageOneRequests[0]).toEqual({
    siteUrl: "https://example.com",
    marketCode: "US",
    languageCode: "en",
    seeds: ["edited detached seed", "another run-only term"],
  });
  expect(
    Object.hasOwn(harness.stageOneRequests[0]!, "websiteProfileReference"),
  ).toBe(false);
  expect(harness.websiteWrites()).toEqual([]);
  await expect(detached).toBeVisible();
});

test("carries one exact reference through both stages while keeping the run overlay separate", async ({
  page,
}) => {
  const harness = await installHarness(page);
  await page.goto("/tools/low-competition-keywords");
  expect(harness.websiteListRequests()).toBe(0);
  await openExactPicker(page);
  await page
    .getByRole("button", { name: "Reference exact version" })
    .click();

  const pinned = page.locator('[data-keyword-profile-context="reference"]');
  await expect(pinned).toContainText("Exact website profile reference");
  await expect(pinned).toContainText(`Revision ${SNAPSHOT_REVISION}`);
  await expect(pinned).toContainText(harness.reference.profileHash.slice(0, 8));
  for (const seed of [
    "Revenue operations",
    "Claim automation",
    "Recover denied claims",
    "Faster cash flow",
    "Clinic finance teams",
    "Reduce days in accounts receivable",
  ]) {
    await expect(pinned).toContainText(seed);
  }

  // A www alias and a path preserve the exact host identity. These terms are
  // a separate run overlay; the six pinned terms never enter the client body.
  await page
    .getByLabel("Site to read")
    .fill("https://www.example.com/pricing");
  await expect(pinned).toBeVisible();
  const overlay = page.getByLabel("Additional seed terms (optional)");
  await expect(overlay).toHaveValue("");
  await overlay.fill("Clinic scheduling");
  await page.getByRole("button", { name: "Read my site" }).click();
  await expect(
    page.getByRole("heading", { name: "What we read off your site" }),
  ).toBeVisible();
  await expect(pinned).toContainText("Server accepted this exact version");

  expect(harness.stageOneRequests).toHaveLength(1);
  expect(harness.stageOneRequests[0]).toEqual({
    siteUrl: "https://www.example.com/pricing",
    marketCode: "US",
    languageCode: "en",
    seeds: ["Clinic scheduling"],
    websiteProfileReference: harness.reference,
  });

  await page
    .getByRole("button", { name: "Run the opportunity map" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Nothing reached the tables" }),
  ).toBeVisible();
  expect(harness.stageTwoRequests).toHaveLength(1);
  expect(harness.stageTwoRequests[0]).toMatchObject({
    contextToken: "keyword-context-reference-e2e",
  });
  expect(harness.stageTwoRequests[0]?.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  await expect(pinned).toContainText(`Revision ${SNAPSHOT_REVISION}`);
  await expect(pinned).toContainText(harness.reference.profileHash.slice(0, 8));
  expect(harness.websiteWrites()).toEqual([]);
});

test("preserves an exact reference on the same host and clears it for invalid or cross-host targets", async ({
  page,
}) => {
  const harness = await installHarness(page);
  await page.goto("/tools/low-competition-keywords");
  await openExactPicker(page);
  await page
    .getByRole("button", { name: "Reference exact version" })
    .click();
  const reference = page.locator('[data-keyword-profile-context="reference"]');
  await expect(reference).toBeVisible();

  await page.getByLabel("Site to read").fill("https://www.example.com/docs");
  await expect(reference).toBeVisible();
  await page.getByLabel("Site to read").fill("not a public url");
  await expect(reference).toHaveCount(0);

  // Re-establish the pin, then prove that a different public host also clears
  // it. Neither transition writes back to the saved website.
  await page.getByLabel("Site to read").fill("https://example.com/pricing");
  await expect(page.getByText("Exact URL match")).toBeVisible();
  await page
    .getByRole("button", { name: "Reference exact version" })
    .click();
  await expect(
    page.locator('[data-keyword-profile-context="reference"]'),
  ).toBeVisible();
  await page.getByLabel("Site to read").fill("https://other.example/path");
  await expect(
    page.locator('[data-keyword-profile-context="reference"]'),
  ).toHaveCount(0);
  expect(harness.stageOneRequests).toEqual([]);
  expect(harness.stageTwoRequests).toEqual([]);
  expect(harness.websiteWrites()).toEqual([]);
});
