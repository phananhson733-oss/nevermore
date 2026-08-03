import { afterEach, describe, expect, it } from "vitest";
import { createAdminSupabaseClient } from "./admin.ts";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

/**
 * The names diverged and nobody noticed, because every caller of this client
 * swallows its failure. Production carries SUPABASE_URL and
 * SUPABASE_SECRET_KEY; this function only read NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY, so it threw before any network call. The public
 * crawl tools surfaced it as a permanent 503 quota_unavailable the moment they
 * began requiring a durable quota.
 */
describe("createAdminSupabaseClient", () => {
  it("builds from the historical names", () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    });
    expect(() => createAdminSupabaseClient()).not.toThrow();
  });

  it("builds from the names production actually carries", () => {
    setEnv({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "secret",
    });
    expect(() => createAdminSupabaseClient()).not.toThrow();
  });

  it("accepts either name for each half independently", () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "secret",
    });
    expect(() => createAdminSupabaseClient()).not.toThrow();
  });

  it("still throws when neither key name is set", () => {
    setEnv({ SUPABASE_URL: "https://example.supabase.co" });
    expect(() => createAdminSupabaseClient()).toThrow(/Supabase admin/);
  });

  it("still throws when neither url name is set", () => {
    setEnv({ SUPABASE_SECRET_KEY: "secret" });
    expect(() => createAdminSupabaseClient()).toThrow(/Supabase admin/);
  });
});
