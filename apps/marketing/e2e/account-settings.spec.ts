import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page, type Route } from "@playwright/test";

import {
  AGENT_PROFILE_REFRESH_FIELD_PATHS,
  type AgentProfileRefreshField,
} from "../src/lib/agents/profile-refresh-contract.ts";
import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  canonicalProfileJson,
  emptyMarketingWebsiteProfile,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
  type WebsiteSummary,
} from "../src/lib/account-websites/contracts.ts";

const NOW = "2026-08-28T00:00:00.000Z";
const SITE_IDS = [
  "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
  "b4f53f12-8090-4c5f-8ddb-7d9587758d7a",
] as const;
const SNAPSHOT_IDS = [
  "a53f4ddb-7cd6-42da-af53-88cc68b41987",
  "2d44e7fb-ef13-43e4-8325-8520ae3a86f3",
] as const;

interface MockSite {
  readonly id: string;
  readonly snapshotId: string;
  origin: string;
  host: string;
  displayName: string | null;
  isPrimary: boolean;
  draft: MarketingWebsiteProfileV1 | null;
  draftVersion: number;
  snapshot: MarketingWebsiteProfileV1 | null;
  snapshotRevision: number;
}

interface MockAccount {
  sites: MockSite[];
  conflictNextSave: boolean;
}

function hash(profile: MarketingWebsiteProfileV1): string {
  return createHash("sha256").update(canonicalProfileJson(profile)).digest("hex");
}

function readyProfile(
  name: string,
  overrides: Partial<MarketingWebsiteProfileV1> = {},
): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: name,
    oneLinePositioning: name + " positioning",
    valueProposition: name + " evidence-backed value",
    primaryCta: "Start now",
    primaryIcp: "Growth teams",
    country: "US",
    locale: "en-US",
    fieldProvenance: [
      "productName",
      "primaryCta",
      "primaryIcp",
      "country",
      "locale",
    ].map((field) => ({
      path: ("/" + field) as
        | "/productName"
        | "/primaryCta"
        | "/primaryIcp"
        | "/country"
        | "/locale",
      derivation: "declared" as const,
      confidence: "high" as const,
      source: "user_edit" as const,
      limitation: null,
      observedAt: null,
      evidenceUrls: [],
    })),
    ...overrides,
  };
}

function summary(site: MockSite): WebsiteSummary {
  const draftHash = site.draft === null ? null : hash(site.draft);
  const snapshotHash = site.snapshot === null ? null : hash(site.snapshot);
  const state =
    draftHash === null
      ? "not_generated"
      : snapshotHash === null
        ? "draft"
        : draftHash === snapshotHash
          ? "confirmed"
          : "unconfirmed_changes";
  return {
    websiteId: site.id,
    origin: site.origin,
    host: site.host,
    canonicalSiteKey: site.host,
    displayName: site.displayName,
    isPrimary: site.isPrimary,
    profileState: state,
    confirmedSnapshotId: site.snapshot === null ? null : site.snapshotId,
    confirmedSnapshotRevision:
      site.snapshot === null ? null : site.snapshotRevision,
    confirmedAt: site.snapshot === null ? null : NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function details(site: MockSite): WebsiteDetails {
  const row = summary(site);
  return {
    ...row,
    draft:
      site.draft === null
        ? null
        : {
            draftVersion: site.draftVersion,
            updatedAt: NOW,
            profileHash: hash(site.draft),
            profile: site.draft,
          },
    currentConfirmedSnapshot:
      site.snapshot === null
        ? null
        : {
            schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
            websiteId: site.id,
            snapshotId: site.snapshotId,
            snapshotRevision: site.snapshotRevision,
            profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
            profileHash: hash(site.snapshot),
            confirmedAt: NOW,
            profile: site.snapshot,
          },
  };
}

function refreshEnvelope(origin: string) {
  const targetHost = new URL(origin).hostname;
  const available: Partial<
    Record<
      (typeof AGENT_PROFILE_REFRESH_FIELD_PATHS)[number],
      string | readonly string[]
    >
  > = {
    productName: "Generated Example",
    oneLinePositioning: "Generated positioning",
    valueProposition: "Generated evidence-backed value",
    primaryIcp: "Generated growth teams",
    coreFeatures: ["Evidence capture"],
  };
  const fields = AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path) => {
    const value = available[path];
    if (value !== undefined) {
      return {
        path,
        state: "available",
        value,
        derivation: "inferred",
        confidence: "high",
        source: "public_page",
        limitation: null,
        evidenceUrls: [origin + "/"],
      } as AgentProfileRefreshField;
    }
    return {
      path,
      state: "unavailable",
      value: null,
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      limitation: "Not found in the bounded fixture pages.",
      evidenceUrls: [],
    } as AgentProfileRefreshField;
  });
  return {
    data: {
      schemaVersion: "agent_profile_refresh.v1",
      agent: "seo",
      request: {
        submittedUrl: origin,
        normalizedUrl: origin + "/",
        targetHost,
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
      },
      availability: "partial",
      observedAt: NOW,
      cache: { status: "fresh", capturedAt: NOW },
      diagnostics: {
        resolvedOrigin: origin,
        pagesFetched: 1,
        productPagesFetched: 1,
        stopReason: null,
        contextSufficient: false,
        sourceUrls: [origin + "/"],
        fieldsAvailable: Object.keys(available).length,
        fieldsMissing: fields.length - Object.keys(available).length,
      },
      fields,
    },
  };
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installConsent(page: Page) {
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
}

async function installAccountApi(page: Page, account: MockAccount) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/profile") {
      await fulfillJson(route, 200, {
        data: {
          email: "ada@example.test",
          displayName: "Ada Lovelace",
          avatarUrl: null,
        },
      });
      return;
    }
    if (path === "/api/auth/session") {
      await fulfillJson(route, 200, { signedIn: true });
      return;
    }
    if (path === "/api/auth/one-tap/nonce") {
      await fulfillJson(route, 503, { error: { code: "unavailable" } });
      return;
    }
    if (path === "/api/credits/balance") {
      await fulfillJson(route, 200, {
        data: {
          balance: { permanent: 140, daily: 0, total: 140 },
          mode: "welfare",
          dailyGrant: {
            grantedToday: true,
            amount: 20,
            welfareRemaining: 460,
            welfareCap: 600,
          },
          referral: { code: "ab3kd9xz", rewardedCount: 0, cap: 20 },
        },
      });
      return;
    }
    if (path === "/api/credits/ledger") {
      await fulfillJson(route, 200, {
        data: { entries: [], nextCursor: null },
      });
      return;
    }
    if (path === "/api/account/websites" && method === "GET") {
      await fulfillJson(route, 200, {
        data: { websites: account.sites.map(summary) },
      });
      return;
    }
    if (path === "/api/account/websites" && method === "POST") {
      const body = request.postDataJSON() as {
        url: string;
        displayName: string | null;
      };
      const parsed = new URL(
        body.url.startsWith("http") ? body.url : "https://" + body.url,
      );
      const host = parsed.hostname.replace(/^www\./u, "");
      const existing = account.sites.find((site) => site.host === host);
      if (existing !== undefined) {
        await fulfillJson(route, 409, {
          error: {
            code: "website_exists",
            details: { website: summary(existing) },
          },
        });
        return;
      }
      const index = account.sites.length;
      const site: MockSite = {
        id: SITE_IDS[index] as string,
        snapshotId: SNAPSHOT_IDS[index] as string,
        origin: "https://" + host,
        host,
        displayName: body.displayName,
        isPrimary: account.sites.length === 0,
        draft: null,
        draftVersion: 0,
        snapshot: null,
        snapshotRevision: 0,
      };
      account.sites.push(site);
      await fulfillJson(route, 201, { data: { website: details(site) } });
      return;
    }

    const confirmMatch = path.match(
      /^\/api\/account\/websites\/([^/]+)\/confirm$/u,
    );
    if (confirmMatch !== null && method === "POST") {
      const site = account.sites.find((entry) => entry.id === confirmMatch[1]);
      if (site === undefined || site.draft === null) {
        await fulfillJson(route, 404, {
          error: { code: "website_not_found" },
        });
        return;
      }
      const changed =
        site.snapshot === null || hash(site.snapshot) !== hash(site.draft);
      if (changed) site.snapshotRevision += 1;
      site.snapshot = site.draft;
      await fulfillJson(route, 200, { data: { website: details(site) } });
      return;
    }

    const detailMatch = path.match(/^\/api\/account\/websites\/([^/]+)$/u);
    if (detailMatch !== null) {
      const site = account.sites.find((entry) => entry.id === detailMatch[1]);
      if (site === undefined) {
        await fulfillJson(route, 404, {
          error: { code: "website_not_found" },
        });
        return;
      }
      if (method === "GET") {
        await fulfillJson(route, 200, { data: { website: details(site) } });
        return;
      }
      const body = request.postDataJSON() as {
        intent: "set_primary" | "save_profile";
        profile?: MarketingWebsiteProfileV1;
      };
      if (body.intent === "set_primary") {
        for (const entry of account.sites) entry.isPrimary = entry.id === site.id;
        await fulfillJson(route, 200, { data: { website: details(site) } });
        return;
      }
      if (account.conflictNextSave) {
        account.conflictNextSave = false;
        site.draft = readyProfile("Server concurrent value");
        site.draftVersion += 1;
        await fulfillJson(route, 409, {
          error: {
            code: "profile_conflict",
            details: { website: details(site) },
          },
        });
        return;
      }
      site.draft = body.profile as MarketingWebsiteProfileV1;
      site.draftVersion += 1;
      await fulfillJson(route, 200, { data: { website: details(site) } });
      return;
    }

    if (path === "/api/agents/seo/profile-refresh") {
      const body = request.postDataJSON() as { url: string };
      await fulfillJson(route, 200, refreshEnvelope(body.url));
      return;
    }

    await fulfillJson(route, 404, { error: { code: "not_mocked" } });
  });
}

test("desktop account flow adds, generates, confirms, switches primary, conflicts, and references", async ({
  page,
}) => {
  const account: MockAccount = { sites: [], conflictNextSave: false };
  await installConsent(page);
  await installAccountApi(page, account);

  await page.goto("/account/websites");
  await expect(page.getByRole("heading", { name: "Websites" })).toBeVisible();
  await expect(page.getByText("Add your first website")).toBeVisible();

  const avatar = page.getByRole("button", { name: "Ada Lovelace" });
  await avatar.click();
  await expect(page.getByRole("menu")).toContainText("Settings");
  await expect(page.getByRole("menu")).not.toContainText("Integrations");
  await avatar.press("Escape");
  await expect(avatar).toBeFocused();

  await page.getByRole("button", { name: "Add website" }).click();
  await page.getByLabel("Website URL").fill("example.com");
  await page.getByLabel("Display name (optional)").fill("Example");
  await page
    .getByRole("button", { name: "Add and generate profile" })
    .click();
  await expect(page).toHaveURL(/\/account\/websites\/[^?]+\?generate=1/u);
  await expect(page.getByLabel("Product name")).toHaveValue("Generated Example");
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm profile" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Confirm profile" }).click();
  await expect(page.getByText("Confirmed v1")).toBeVisible();

  await page.goto("/account/websites");
  await page.getByRole("button", { name: "Add website" }).click();
  await page.getByLabel("Website URL").fill("secondary.com");
  await page.getByLabel("Display name (optional)").fill("Secondary");
  await page.getByRole("button", { name: "Add only" }).click();
  await page.goto("/account/websites");
  await page.getByRole("button", { name: "Make Secondary primary" }).click();
  await expect(
    page.locator('[data-website-id="' + SITE_IDS[1] + '"]'),
  ).toContainText("Primary");

  await page.goto("/account/websites/" + SITE_IDS[0]);
  account.conflictNextSave = true;
  await page.getByLabel("Product name").fill("Local conflicting value");
  await expect(page.getByText("Resolve conflict")).toBeVisible();
  await expect(
    page.getByText('Server: "Server concurrent value"', { exact: true }),
  ).toBeVisible();

  await page.goto("/agents/seo");
  await page
    .getByLabel("Target URL")
    .fill("https://www.example.com/pricing");
  await page.getByRole("button", { name: "Use saved website profile" }).click();
  await expect(page.getByText("Exact URL match")).toBeVisible();
  await page.getByRole("button", { name: "Reference exact version" }).click();
  await expect(
    page.locator('[data-website-profile-context="reference"]'),
  ).toContainText("Example");
  await expect(page.locator('[data-profile-card="product"]')).toContainText(
    "Generated Example",
  );

  await page.getByLabel("Target URL").fill("unrelated.example");
  await expect(page.locator("#agent-website-profile")).toHaveValue("");
});

test.describe("mobile account settings", () => {
  test.use({
    userAgent: devices["Pixel 5"].userAgent,
    viewport: devices["Pixel 5"].viewport,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
  });

  test("Chinese account controls remain click-only, themeable, and accessible", async ({
    page,
  }) => {
    const site: MockSite = {
      id: SITE_IDS[0],
      snapshotId: SNAPSHOT_IDS[0],
      origin: "https://example.com",
      host: "example.com",
      displayName: "示例网站",
      isPrimary: true,
      draft: readyProfile("示例产品"),
      draftVersion: 1,
      snapshot: readyProfile("示例产品"),
      snapshotRevision: 1,
    };
    await installAccountApi(page, {
      sites: [site],
      conflictNextSave: false,
    });
    await installConsent(page);
    await page.goto("/zh/account/websites");

    await page.getByRole("button", { name: "Open menu" }).click();
    const mobileNav = page.getByRole("navigation", {
      name: "Mobile navigation",
    });
    await expect(mobileNav).toContainText("积分");
    await expect(mobileNav).toContainText("示例网站");
    await expect(mobileNav).toContainText("设置");
    await expect(mobileNav).toContainText("Agents");
    await expect(mobileNav).toContainText("邀请好友");

    const themeToggle = mobileNav.getByRole("button", { name: /切换到浅色/u });
    await themeToggle.scrollIntoViewIfNeeded();
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });

    const openSheetAccessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(
      openSheetAccessibility.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);

    await page.getByRole("button", { name: "Close" }).click();
    await expect(mobileNav).toBeHidden();

    const accessibility = await new AxeBuilder({ page }).include("main").analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });
});
