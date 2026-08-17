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
    storePendingAgentIntent(storage, "seo", "https://example.com", start);

    expect(
      readPendingAgentIntent(storage, "seo", start + AGENT_INTENT_TTL_MS - 1),
    )?.toMatchObject({
      agent: "seo",
      purpose: "run_confirmed_profile",
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
      "gengrowth:agent-intent:seo:v2",
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
    const profile = confirmAgentProfile(
      updateAgentProfile(
        createAgentProfileDraft("tech", "https://astrologywiki.com/pricing"),
        { country: "US", locale: "en-US" },
      ),
    );

    const intent = storeConfirmedAgentRunIntent(storage, profile, 1_000);

    expect(intent).toMatchObject({
      purpose: "run_confirmed_profile",
      agent: "tech",
      url: "https://astrologywiki.com/pricing",
      confirmedProfile: {
        agent: "tech",
        targetUrl: "https://astrologywiki.com/pricing",
        reviewState: "confirmed",
      },
    });
    expect(isRunnablePendingAgentIntent(intent!)).toBe(true);
    expect(
      isRunnablePendingAgentIntent({
        ...intent!,
        url: "https://astrologywiki.com/other",
      }),
    ).toBe(false);
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
    const intent = storeConfirmedAgentRunIntent(storage, profile)!;

    schedulePendingAgentIntentExpiry(storage, intent);
    vi.advanceTimersByTime(AGENT_INTENT_TTL_MS - 1);

    expect(storage.getItem(pendingAgentIntentKey("tech"))).not.toBeNull();

    vi.advanceTimersByTime(1);

    expect(storage.getItem(pendingAgentIntentKey("tech"))).toBeNull();
  });

  it("fails closed on a v2 payload with an unknown purpose", () => {
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

  it("removes the legacy v1 slot instead of interpreting an unversioned purpose", () => {
    const storage = new MemoryStorage();
    const legacyKey = "gengrowth:agent-intent:seo:v1";
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

  it("never resumes an intent on the other Agent", () => {
    const storage = new MemoryStorage();
    storePendingAgentIntent(storage, "seo", "https://seo.example", 1_000);

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
    storePendingAgentIntent(storage, "seo", "https://seo.example", 1_000);
    storePendingAgentIntent(storage, "tech", "https://tech.example", 1_000);

    clearPendingAgentIntent(storage, "seo");

    expect(readPendingAgentIntent(storage, "seo", 1_001)).toBeNull();
    expect(readPendingAgentIntent(storage, "tech", 1_001)?.url).toBe(
      "https://tech.example",
    );
  });

  it("restores an auth-raced intent without extending its original expiry", () => {
    const storage = new MemoryStorage();
    const intent = storePendingAgentIntent(
      storage,
      "seo",
      "https://example.com",
      1_000,
    )!;
    clearPendingAgentIntent(storage, "seo");

    expect(restorePendingAgentIntent(storage, "seo", intent, 2_000)).toEqual(
      intent,
    );
    expect(readPendingAgentIntent(storage, "seo", 2_000)?.expiresAt).toBe(
      1_000 + AGENT_INTENT_TTL_MS,
    );
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
      createAgentProfileDraft("seo", "https://example.com"),
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
