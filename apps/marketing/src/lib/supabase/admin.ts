// @input  -- @supabase/supabase-js, env SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
// @output -- createAdminSupabaseClient() bypasses RLS for seed / admin operations
// @pos    -- Admin layer, used by seed API and server-only admin tasks
// once this file is updated, update header comments and _DIR.md in this folder
import { createClient } from "@supabase/supabase-js";

function normalizeEnv(raw: string | undefined): string {
  return raw?.replace(/\\n/g, "").trim() ?? "";
}

function firstSet(...names: readonly string[]): string {
  for (const name of names) {
    const value = normalizeEnv(process.env[name]);
    if (value) return value;
  }
  return "";
}

/**
 * Accept both the historical and the current Supabase variable names.
 *
 * Production carries SUPABASE_URL and SUPABASE_SECRET_KEY — the names Supabase
 * moved to — while this function only ever read NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. Every admin call therefore threw before reaching
 * the network, which is why the public crawl tools answered 503
 * quota_unavailable the moment they started requiring a durable quota, and why
 * short-link redirects had been failing silently for longer.
 */
export function createAdminSupabaseClient() {
  const url = firstSet("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const serviceKey = firstSet(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
  );

  if (!url || !serviceKey) {
    throw new Error(
      "Missing Supabase admin credentials. Set NEXT_PUBLIC_SUPABASE_URL or " +
      "SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY."
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
