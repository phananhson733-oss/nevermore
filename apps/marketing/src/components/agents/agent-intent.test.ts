// @input  -- in-memory Storage seam and Agent pending-intent helpers
// @output -- regression coverage for TTL, exact-Agent isolation, and cleanup
// @pos    -- unit guard for the sign-in/reload handoff

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_INTENT_TTL_MS,
  clearPendingAgentIntent,
  getSessionIntentStorage,
  isProfileRefreshPendingAgentIntent,
  isProfileSearchPendingAgentIntent,
  isRunnablePendingAgentIntent,
  pendingAgentIntentKey,
  readPendingAgentIntent,
  restorePendingAgentIntent,
  schedulePendingAgentIntentExpiry,
  storeAgentProfileRefreshIntent,
  storeAgentProfileSearchIntent,
  storeConfirmedAgentRunIntent,
  storePageFocusedAgentIntent,
  storePendingAgentIntent,
} from "./agent-intent";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("Agent pending intents", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns no storage when the browser sessionStorage getter throws", () => {
    const browser = Object.create(null) as { readonly sessionStorage: Storage };
    Object.defineProperty(browser, "sessionStorage", {
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });

    expect(getSessionIntentStorage(browser)).toBeNull();
  });

  it("survives within ten minutes and expires at the TTL boundary", () => {
    const storage = new MemoryStorage();
    const start = 1_000;
    storePendingAgentIntent(
      storage,
      "seo",
      "https://example.com",
      "prepare_profile",
      start,
    );

    expect(
      readPendingAgentIntent(storage, "seo", start + AGENT_INTENT_TTL_MS - 1),
    )?.toMatchObject({
      agent: "seo",
      purpose: "prepare_profile",
      url: "https://example.com",
    });
    expect(
      readPendingAgentIntent(storage, "seo", start + AGENT_INTENT_TTL_MS),
    ).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
  });

  it("versions homepage preparation separately from an authorized run", () => {
    const storage = new MemoryStorage();
    const prepared = storePendingAgentIntent(
      storage,
      "seo",
      "https://example.com",
      "prepare_profile",
      1_000,
    );

    expect(pendingAgentIntentKey("seo")).toBe(
      "gengrowth:agent-intent:seo:v4",
    );
    expect(prepared?.purpose).toBe("prepare_profile");
    expect(readPendingAgentIntent(storage, "seo", 1_001)?.purpose).toBe(
      "prepare_profile",
    );
    expect(
      isRunnablePendingAgentIntent(
        readPendingAgentIntent(storage, "seo", 1_001)!,
      ),
    ).toBe(false);
  });

  it("resumes only a confirmed profile with the exact Agent and URL snapshot", () => {
    const storage = new MemoryStorage();
    const editableProfile = confirmAgentProfile(
      updateAgentProfile(
        createAgentProfileDraft("tech", "https://astrologywiki.com/pricing"),
        {
          country: "US",
          locale: "en-US",
          directCompetitors: ["manual.example"],
        },
      ),
    );
    const confirmedProfile = confirmAgentProfile(
      updateAgentProfile(editableProfile, {
        targetQuery: "technical seo audit",
        directCompetitors: ["provider.example", "manual.example"],
      }),
    );

    const intent = storeConfirmedAgentRunIntent(
      storage,
      confirmedProfile,
      editableProfile,
      1_000,
    );

    expect(intent).toMatchObject({
      purpose: "run_confirmed_profile",
      agent: "tech",
      url: "https://astrologywiki.com/pricing",
      confirmedProfile: {
        agent: "tech",
        targetUrl: "https://astrologywiki.com/pricing",
        reviewState: "confirmed",
        targetQuery: "technical seo audit",
        directCompetitors: ["provider.example", "manual.example"],
      },
      editableProfile: {
        agent: "tech",
        targetUrl: "https://astrologywiki.com/pricing",
        reviewState: "confirmed",
        targetQuery: "",
        directCompetitors: ["manual.example"],
      },
    });
    expect(isRunnablePendingAgentIntent(intent!)).toBe(true);
    expect(readPendingAgentIntent(storage, "tech", 1_001)).toMatchObject({
      confirmedProfile: {
        targetQuery: "technical seo audit",
        directCompetitors: ["provider.example", "manual.example"],
      },
      editableProfile: {
        targetQuery: "",
        directCompetitors: ["manual.example"],
      },
    });
    expect(
      isRunnablePendingAgentIntent({
        ...intent!,
        url: "https://astrologywiki.com/other",
      }),
    ).toBe(false);
  });

  it.each([
    {
      label: "missing confirmed Profile",
      mutate: (intent: Record<string, unknown>) => {
        delete intent.confirmedProfile;
      },
    },
    {
      label: "missing editable Profile",
      mutate: (intent: Record<string, unknown>) => {
        delete intent.editableProfile;
      },
    },
    {
      label: "mismatched editable Profile URL",
      mutate: (intent: Record<string, unknown>) => {
        intent.editableProfile = {
          ...(intent.editableProfile as Record<string, unknown>),
          targetUrl: "https://astrologywiki.com/other",
        };
      },
    },
  ])("rejects a runnable intent with $label", ({ mutate }) => {
    const storage = new MemoryStorage();
    const profile = confirmAgentProfile(
      updateAgentProfile(
        createAgentProfileDraft("seo", "https://astrologywiki.com/pricing"),
        { country: "US", locale: "en-US" },
      ),
    );
    const malformed = structuredClone({
      agent: "seo",
      purpose: "run_confirmed_profile",
      url: "https://astrologywiki.com/pricing",
      createdAt: 1_000,
      expiresAt: 1_000 + AGENT_INTENT_TTL_MS,
      confirmedProfile: profile,
      editableProfile: profile,
    }) as Record<string, unknown>;
    mutate(malformed);
    storage.setItem(pendingAgentIntentKey("seo"), JSON.stringify(malformed));

    expect(readPendingAgentIntent(storage, "seo", 1_001)).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
  });

  it("does not create a runnable intent without both explicit Profile snapshots", () => {
    const storage = new MemoryStorage();

    expect(
      storePendingAgentIntent(
        storage,
        "seo",
        "https://astrologywiki.com",
        "run_confirmed_profile",
        1_000,
      ),
    ).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
  });

  it("physically removes a confirmed profile handoff at its expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const storage = new MemoryStorage();
    const profile = confirmAgentProfile(
      updateAgentProfile(
        createAgentProfileDraft("tech", "https://astrologywiki.com/pricing"),
        { country: "US", locale: "en-US" },
      ),
    );
    const intent = storeConfirmedAgentRunIntent(storage, profile, profile)!;

    schedulePendingAgentIntentExpiry(storage, intent);
    vi.advanceTimersByTime(AGENT_INTENT_TTL_MS - 1);

    expect(storage.getItem(pendingAgentIntentKey("tech"))).not.toBeNull();

    vi.advanceTimersByTime(1);

    expect(storage.getItem(pendingAgentIntentKey("tech"))).toBeNull();
  });

  it("fails closed on a current payload with an unknown purpose", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      pendingAgentIntentKey("seo"),
      JSON.stringify({
        agent: "seo",
        purpose: "auto_run_from_homepage",
        url: "https://wrong.example",
        createdAt: 1_000,
        expiresAt: 2_000,
      }),
    );

    expect(readPendingAgentIntent(storage, "seo", 1_001)).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
  });

  it.each([
    "gengrowth:agent-intent:seo:v1",
    "gengrowth:agent-intent:seo:v2",
    "gengrowth:agent-intent:seo:v3",
  ])("removes the superseded slot %s rather than reading it", (legacyKey) => {
    const storage = new MemoryStorage();
    storage.setItem(
      legacyKey,
      JSON.stringify({
        agent: "seo",
        url: "https://legacy.example",
        createdAt: 1_000,
        expiresAt: 2_000,
      }),
    );

    expect(readPendingAgentIntent(storage, "seo", 1_001)).toBeNull();
    expect(storage.getItem(legacyKey)).toBeNull();
  });

  it("carries a page-focused launch without making it runnable", () => {
    const storage = new MemoryStorage();
    const stored = storePageFocusedAgentIntent(
      storage,
      "https://example.com/pricing",
      1_000,
    );

    expect(stored?.purpose).toBe("page_focused_launch");
    expect(stored?.scope).toBe("page");

    const resumed = readPendingAgentIntent(storage, "seo", 1_001);
    expect(resumed?.scope).toBe("page");
    // Coming back from sign-in restores the form; it never starts the crawl.
    expect(resumed && isRunnablePendingAgentIntent(resumed)).toBe(false);
  });

  it("keeps a page-focused launch on the SEO Agent only", () => {
    const storage = new MemoryStorage();
    storePageFocusedAgentIntent(storage, "https://example.com/", 1_000);

    expect(readPendingAgentIntent(storage, "tech", 1_001)).toBeNull();
  });

  it("rejects a stored scope outside the known values", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      pendingAgentIntentKey("seo"),
      JSON.stringify({
        agent: "seo",
        purpose: "prepare_profile",
        url: "https://example.com",
        scope: "everything",
        createdAt: 1_000,
        expiresAt: 2_000,
      }),
    );

    expect(readPendingAgentIntent(storage, "seo", 1_001)).toBeNull();
  });

  it("rejects a purpose that is not in the known set", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      pendingAgentIntentKey("seo"),
      JSON.stringify({
        agent: "seo",
        purpose: "publish_everything",
        url: "https://example.com",
        createdAt: 1_000,
        expiresAt: 2_000,
      }),
    );

    expect(readPendingAgentIntent(storage, "seo", 1_001)).toBeNull();
  });

  it("never resumes an intent on the other Agent", () => {
    const storage = new MemoryStorage();
    storePendingAgentIntent(
      storage,
      "seo",
      "https://seo.example",
      "prepare_profile",
      1_000,
    );

    expect(readPendingAgentIntent(storage, "tech", 1_001)).toBeNull();
    expect(readPendingAgentIntent(storage, "seo", 1_001)?.url).toBe(
      "https://seo.example",
    );
  });

  it("rejects a mismatched payload even if it is placed in this Agent's key", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      pendingAgentIntentKey("seo"),
      JSON.stringify({
        agent: "tech",
        url: "https://wrong.example",
        createdAt: 1_000,
        expiresAt: 2_000,
      }),
    );

    expect(readPendingAgentIntent(storage, "seo", 1_001)).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
  });

  it("rejects a future-created payload that could otherwise outlive ten minutes", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      pendingAgentIntentKey("seo"),
      JSON.stringify({
        agent: "seo",
        url: "https://future.example",
        createdAt: 20_000,
        expiresAt: 20_000 + AGENT_INTENT_TTL_MS,
      }),
    );

    expect(readPendingAgentIntent(storage, "seo", 1_000)).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
  });

  it("clears only the abandoned Agent intent", () => {
    const storage = new MemoryStorage();
    storePendingAgentIntent(
      storage,
      "seo",
      "https://seo.example",
      "prepare_profile",
      1_000,
    );
    storePendingAgentIntent(
      storage,
      "tech",
      "https://tech.example",
      "prepare_profile",
      1_000,
    );

    clearPendingAgentIntent(storage, "seo");

    expect(readPendingAgentIntent(storage, "seo", 1_001)).toBeNull();
    expect(readPendingAgentIntent(storage, "tech", 1_001)?.url).toBe(
      "https://tech.example",
    );
  });

  it("restores an auth-raced intent without extending its original expiry", () => {
    const storage = new MemoryStorage();
    const editableProfile = confirmAgentProfile(
      updateAgentProfile(
        createAgentProfileDraft("seo", "https://astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
    );
    const confirmedProfile = confirmAgentProfile(
      updateAgentProfile(editableProfile, { targetQuery: "seo audit" }),
    );
    const intent = storeConfirmedAgentRunIntent(
      storage,
      confirmedProfile,
      editableProfile,
      1_000,
    )!;
    clearPendingAgentIntent(storage, "seo");

    expect(restorePendingAgentIntent(storage, "seo", intent, 2_000)).toEqual(
      intent,
    );
    expect(readPendingAgentIntent(storage, "seo", 2_000)?.expiresAt).toBe(
      1_000 + AGENT_INTENT_TTL_MS,
    );
    expect(readPendingAgentIntent(storage, "seo", 2_000)).toMatchObject({
      confirmedProfile: { targetQuery: "seo audit" },
      editableProfile: { targetQuery: "" },
    });
  });

  it("stores a refresh-profile intent with the exact local draft and mode", () => {
    const storage = new MemoryStorage();
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "https://astrologywiki.com/tools/birth-chart"),
      { country: "US", locale: "en-US" },
    );

    const intent = storeAgentProfileRefreshIntent(storage, profile, "prefer_cache");

    expect(intent).toMatchObject({
      agent: "seo",
      purpose: "refresh_profile",
      url: "https://astrologywiki.com/tools/birth-chart",
      refreshMode: "prefer_cache",
      refreshProfile: {
        agent: "seo",
        targetUrl: "https://astrologywiki.com/tools/birth-chart",
        host: "astrologywiki.com",
        country: "US",
        locale: "en-US",
        reviewState: "needs_confirmation",
      },
    });
    expect(readPendingAgentIntent(storage, "seo", Date.now())).toMatchObject({
      purpose: "refresh_profile",
      refreshMode: "prefer_cache",
    });
    expect(isProfileRefreshPendingAgentIntent(intent!)).toBe(true);
    expect(isRunnablePendingAgentIntent(intent!)).toBe(false);
  });

  it.each([
    { targetUrl: "https://example.com", country: "US", locale: "en-US" },
    { targetUrl: "https://astrologywiki.com", country: "ZZ", locale: "en-US" },
    { targetUrl: "https://astrologywiki.com", country: "US", locale: "en_US" },
  ])(
    "does not persist refresh or search resume state for invalid run inputs: $targetUrl $country $locale",
    ({ targetUrl, country, locale }) => {
      const refreshStorage = new MemoryStorage();
      const searchStorage = new MemoryStorage();
      const profile = updateAgentProfile(
        createAgentProfileDraft("seo", targetUrl),
        { country, locale },
      );

      expect(
        storeAgentProfileRefreshIntent(
          refreshStorage,
          profile,
          "prefer_cache",
          1_000,
        ),
      ).toBeNull();
      expect(
        storeAgentProfileSearchIntent(searchStorage, profile, 1_000),
      ).toBeNull();
      expect(refreshStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
      expect(searchStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
    },
  );

  it("rejects malformed refresh-profile payloads and clears them fail-closed", () => {
    const storage = new MemoryStorage();
    const now = 20_000;
    const baseProfile = updateAgentProfile(
      createAgentProfileDraft("seo", "https://astrologywiki.com/tools/birth-chart"),
      { country: "US", locale: "en-US" },
    );

    storage.setItem(
      pendingAgentIntentKey("seo"),
      JSON.stringify({
        agent: "seo",
        purpose: "refresh_profile",
        url: "https://astrologywiki.com/tools/birth-chart",
        createdAt: now,
        expiresAt: now + AGENT_INTENT_TTL_MS,
        refreshMode: "prefer_cache",
        refreshProfile: { ...baseProfile, country: "USA" },
      }),
    );
    expect(readPendingAgentIntent(storage, "seo", now + 1)).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();

    storage.setItem(
      pendingAgentIntentKey("seo"),
      JSON.stringify({
        agent: "seo",
        purpose: "refresh_profile",
        url: "https://astrologywiki.com/tools/birth-chart",
        createdAt: now,
        expiresAt: now + AGENT_INTENT_TTL_MS,
        refreshMode: "refresh-now",
        refreshProfile: baseProfile,
      }),
    );
    expect(readPendingAgentIntent(storage, "seo", now + 1)).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();

    storage.setItem(
      pendingAgentIntentKey("seo"),
      JSON.stringify({
        agent: "seo",
        purpose: "refresh_profile",
        url: "https://astrologywiki.com/tools/birth-chart",
        createdAt: now,
        expiresAt: now + AGENT_INTENT_TTL_MS,
        refreshMode: "refresh",
        refreshProfile: { ...baseProfile, locale: "" },
      }),
    );
    expect(readPendingAgentIntent(storage, "seo", now + 1)).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();

    const missingFieldProfile = { ...baseProfile } as Record<string, unknown>;
    delete missingFieldProfile.valueProposition;
    storage.setItem(
      pendingAgentIntentKey("seo"),
      JSON.stringify({
        agent: "seo",
        purpose: "refresh_profile",
        url: "https://astrologywiki.com/tools/birth-chart",
        createdAt: now,
        expiresAt: now + AGENT_INTENT_TTL_MS,
        refreshMode: "prefer_cache",
        refreshProfile: missingFieldProfile,
      }),
    );
    expect(readPendingAgentIntent(storage, "seo", now + 1)).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
  });

  it("accepts a canonical non-region BCP 47 target language", () => {
    const storage = new MemoryStorage();
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "https://acme.com"),
      { country: "US", locale: "zh-Hant" },
    );

    expect(
      storeAgentProfileRefreshIntent(
        storage,
        profile,
        "prefer_cache",
        1_000,
      ),
    ).not.toBeNull();
    expect(
      readPendingAgentIntent(storage, "seo", 1_001)?.refreshProfile?.locale,
    ).toBe("zh-Hant");
  });

  it("never resumes a refresh-profile intent on the other Agent and expires on the same TTL", () => {
    const storage = new MemoryStorage();
    const profile = updateAgentProfile(
      createAgentProfileDraft("tech", "https://astrologywiki.com/pricing"),
      { country: "CN", locale: "zh-CN" },
    );
    const now = 5_000;
    const intent = storeAgentProfileRefreshIntent(storage, profile, "refresh", now)!;

    expect(readPendingAgentIntent(storage, "seo", now + 1)).toBeNull();
    expect(isProfileRefreshPendingAgentIntent(readPendingAgentIntent(storage, "tech", now + 1)!)).toBe(
      true,
    );
    expect(readPendingAgentIntent(storage, "tech", now + AGENT_INTENT_TTL_MS)).toBeNull();
    expect(intent.expiresAt).toBe(now + AGENT_INTENT_TTL_MS);
  });

  it("carries a search-landscape draft across the sign-in reload", () => {
    const storage = new MemoryStorage();
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "https://astrologywiki.com"),
      { country: "US", locale: "en-US", productName: "AstrologyWiki" },
    );
    const now = 5_000;
    const intent = storeAgentProfileSearchIntent(storage, profile, now)!;

    const restored = readPendingAgentIntent(storage, "seo", now + 1)!;
    expect(isProfileSearchPendingAgentIntent(restored)).toBe(true);
    expect(restored.searchProfile?.productName).toBe("AstrologyWiki");
    expect(restored.searchProfile?.country).toBe("US");
    expect(intent.expiresAt).toBe(now + AGENT_INTENT_TTL_MS);
  });

  it("never lets a search draft resume as a run or a refresh", () => {
    const storage = new MemoryStorage();
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "https://astrologywiki.com"),
      { country: "US", locale: "en-US" },
    );
    const stored = storeAgentProfileSearchIntent(storage, profile, 1_000)!;

    expect(isRunnablePendingAgentIntent(stored)).toBe(false);
    expect(isProfileRefreshPendingAgentIntent(stored)).toBe(false);
  });

  it("expires a search draft on the same TTL and stays Agent-scoped", () => {
    const storage = new MemoryStorage();
    const profile = updateAgentProfile(
      createAgentProfileDraft("tech", "https://astrologywiki.com"),
      { country: "US", locale: "en-US" },
    );
    const now = 5_000;
    storeAgentProfileSearchIntent(storage, profile, now);

    expect(readPendingAgentIntent(storage, "seo", now + 1)).toBeNull();
    expect(
      readPendingAgentIntent(storage, "tech", now + AGENT_INTENT_TTL_MS),
    ).toBeNull();
  });
});
