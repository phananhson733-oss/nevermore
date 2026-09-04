import { describe, expect, it } from "vitest";

import {
  isAgentProfileDraft,
  isConfirmedAgentProfile,
} from "../../components/agents/agent-profile.ts";
import {
  AGENT_PROFILE_REFRESH_SCHEMA_VERSION,
  type AgentProfileRefreshResult,
} from "../agents/profile-refresh-contract.ts";
import {
  agentDraftToWebsiteProfile,
  applyProfileRefreshToWebsiteDraft,
  importWebsiteProfile,
  referenceWebsiteProfile,
  type AgentWebsiteProfileRunContext,
} from "./agent-profile-bridge.ts";
import {
  emptyMarketingWebsiteProfile,
  MARKETING_WEBSITE_PROFILE_VERSION,
  profileSha256,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileReferenceV1,
} from "./contracts.ts";

const RUN: AgentWebsiteProfileRunContext = {
  agent: "seo",
  targetUrl: "https://example.com/pricing",
  presentationLocale: "en",
  device: "desktop",
  pageType: "product",
  targetQuery: "evidence led seo",
  auditScope: "page-only",
};

const REFERENCE: WebsiteProfileReferenceV1 = {
  schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
  websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
  snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
  snapshotRevision: 3,
  profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
  profileHash: "a".repeat(64),
};

function websiteProfile(): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "Example",
    oneLinePositioning: "A focused example product",
    valueProposition: "Make examples easier to verify.",
    primaryIcp: "Teams that need repeatable examples",
    primaryCta: "Start verifying",
    country: "US",
    locale: "en-US",
    coreFeatures: ["Verification"],
    fieldProvenance: [
      {
        path: "/productName",
        derivation: "declared",
        confidence: "high",
        source: "user_edit",
        limitation: null,
        observedAt: null,
        evidenceUrls: [],
      },
      {
        path: "/valueProposition",
        derivation: "inferred",
        confidence: "medium",
        source: "public_page",
        limitation: null,
        observedAt: "2026-08-27T08:00:00.000Z",
        evidenceUrls: ["https://example.com/"],
      },
      ...(["primaryCta", "primaryIcp", "country", "locale"] as const).map(
        (field) => ({
          path: `/${field}` as const,
          derivation: "declared" as const,
          confidence: "high" as const,
          source: "user_edit" as const,
          limitation: null,
          observedAt: null,
          evidenceUrls: [],
        }),
      ),
    ],
  };
}

function refresh(): AgentProfileRefreshResult {
  return {
    schemaVersion: AGENT_PROFILE_REFRESH_SCHEMA_VERSION,
    agent: "seo",
    request: {
      submittedUrl: RUN.targetUrl,
      normalizedUrl: RUN.targetUrl,
      targetHost: "example.com",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
    },
    availability: "partial",
    observedAt: "2026-08-27T09:00:00.000Z",
    cache: {
      status: "fresh",
      capturedAt: "2026-08-27T09:00:00.000Z",
    },
    diagnostics: {
      resolvedOrigin: "https://example.com",
      pagesFetched: 1,
      productPagesFetched: 1,
      stopReason: null,
      contextSufficient: false,
      sourceUrls: ["https://example.com/"],
      fieldsAvailable: 2,
      fieldsMissing: 24,
    },
    fields: [
      {
        path: "productName",
        state: "available",
        value: "Crawler suggestion",
        derivation: "inferred",
        confidence: "medium",
        source: "public_page",
        limitation: null,
        evidenceUrls: ["https://example.com/"],
      },
      {
        path: "valueProposition",
        state: "available",
        value: "Fresh source-backed value proposition",
        derivation: "inferred",
        confidence: "high",
        source: "public_page",
        limitation: null,
        evidenceUrls: ["https://example.com/"],
      },
      {
        path: "buyer",
        state: "unavailable",
        value: null,
        derivation: "missing",
        confidence: "unknown",
        source: "not_available",
        limitation: "No buying role was present in the bounded public pages.",
        evidenceUrls: [],
      },
    ],
  };
}

describe("website profile to Agent bridge", () => {
  it("references an exact snapshot while keeping run fields outside the website profile", async () => {
    const profile = websiteProfile();
    const reference = {
      ...REFERENCE,
      profileHash: await profileSha256(profile),
    };
    const linked = await referenceWebsiteProfile(profile, reference, RUN);

    expect(linked.kind).toBe("reference");
    expect(linked.reference).toEqual(reference);
    expect(linked.draft).toMatchObject({
      agent: "seo",
      targetUrl: RUN.targetUrl,
      productName: "Example",
      country: "US",
      locale: "en-US",
      device: "desktop",
      pageType: "product",
      targetQuery: "evidence led seo",
      auditScope: "page-only",
      reviewState: "confirmed",
    });

    expect(isAgentProfileDraft(linked.draft)).toBe(true);
    expect(isConfirmedAgentProfile(linked.draft)).toBe(true);
    const persisted = agentDraftToWebsiteProfile(linked.draft);
    expect(persisted).toMatchObject({
      productName: "Example",
      valueProposition: "Make examples easier to verify.",
      locale: "en-US",
    });
    for (const provenance of websiteProfile().fieldProvenance) {
      expect(persisted.fieldProvenance).toContainEqual(provenance);
    }
    expect(persisted).not.toHaveProperty("agent");
    expect(persisted).not.toHaveProperty("device");
    expect(persisted).not.toHaveProperty("targetQuery");
  });

  it("refuses to label a different profile as an exact snapshot reference", async () => {
    const profile = websiteProfile();
    const matchingReference = {
      ...REFERENCE,
      profileHash: await profileSha256(profile),
    };

    await expect(
      referenceWebsiteProfile(
        { ...profile, productName: "Tampered" },
        matchingReference,
        RUN,
      ),
    ).rejects.toThrow(/profile hash/i);
  });

  it("imports a detached copy that still requires confirmation for this run", () => {
    const original = websiteProfile();
    const imported = importWebsiteProfile(original, RUN);

    expect(imported.kind).toBe("import");
    expect(imported.reference).toBeNull();
    expect(imported.draft.reviewState).toBe("needs_confirmation");
    expect(imported.draft.sources.product).toBe("saved_website_profile");
    expect(imported.draft).not.toBe(original);
    expect(isAgentProfileDraft(imported.draft)).toBe(true);
  });

  it("keeps user edits while applying eligible public-page refresh fields", () => {
    const original = websiteProfile();
    const originalProductProvenance = original.fieldProvenance.find(
      (entry) => entry.path === "/productName",
    );
    const updated = applyProfileRefreshToWebsiteDraft(original, refresh(), {
      origin: "https://example.com",
      canonicalSiteKey: "example.com",
    });

    expect(updated.productName).toBe("Example");
    expect(updated.valueProposition).toBe(
      "Fresh source-backed value proposition",
    );
    expect(
      updated.fieldProvenance.find(
        (entry) => entry.path === "/valueProposition",
      ),
    ).toMatchObject({
      derivation: "inferred",
      confidence: "high",
      source: "public_page",
      observedAt: "2026-08-27T09:00:00.000Z",
    });
    expect(
      updated.fieldProvenance.find((entry) => entry.path === "/productName"),
    ).toEqual(originalProductProvenance);
    expect(
      updated.fieldProvenance.find((entry) => entry.path === "/buyer"),
    ).toEqual({
      path: "/buyer",
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      limitation: "No buying role was present in the bounded public pages.",
      observedAt: null,
      evidenceUrls: [],
    });
  });

  it("rejects a refresh captured for a different account website", () => {
    const foreignRefresh = {
      ...refresh(),
      request: {
        ...refresh().request,
        normalizedUrl: "https://other.example/",
        targetHost: "other.example",
      },
      diagnostics: {
        ...refresh().diagnostics,
        resolvedOrigin: "https://other.example",
      },
    };

    expect(() =>
      applyProfileRefreshToWebsiteDraft(websiteProfile(), foreignRefresh, {
        origin: "https://example.com",
        canonicalSiteKey: "example.com",
      }),
    ).toThrow(/different website/i);
  });
});
