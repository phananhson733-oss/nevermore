// @input  -- in-memory Storage seam and Agent pending-intent helpers
// @output -- regression coverage for TTL, exact-Agent isolation, and cleanup
// @pos    -- unit guard for the sign-in/reload handoff

import { describe, expect, it } from "vitest";

import {
  AGENT_INTENT_TTL_MS,
  clearPendingAgentIntent,
  getSessionIntentStorage,
  pendingAgentIntentKey,
  readPendingAgentIntent,
  restorePendingAgentIntent,
  storePendingAgentIntent,
} from "./agent-intent";

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
    )?.toMatchObject({ agent: "seo", url: "https://example.com" });
    expect(
      readPendingAgentIntent(storage, "seo", start + AGENT_INTENT_TTL_MS),
    ).toBeNull();
    expect(storage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
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
});
