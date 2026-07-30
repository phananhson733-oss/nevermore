import { describe, expect, it } from "vitest";

import {
  hasConsentPersistenceConfig,
  isConsentStoreUnavailable,
} from "./persistence.ts";

describe("consent persistence availability", () => {
  it("requires both public Supabase values before creating a client", () => {
    expect(hasConsentPersistenceConfig({})).toBe(false);
    expect(
      hasConsentPersistenceConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toBe(false);
    expect(
      hasConsentPersistenceConfig({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toBe(true);
  });

  it("only treats a missing PostgREST table as an unavailable optional store", () => {
    expect(isConsentStoreUnavailable("PGRST205")).toBe(true);
    expect(isConsentStoreUnavailable("42501")).toBe(false);
    expect(isConsentStoreUnavailable(undefined)).toBe(false);
  });
});
