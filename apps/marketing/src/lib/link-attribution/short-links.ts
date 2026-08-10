// @input  -- Supabase admin client, user-provided short code and destination URL
// @output -- validation + persistence helpers for owned GenGrowth short links
// @pos    -- Link attribution domain layer shared by API registration and /go redirects
// once this file is updated, update header comments and _DIR.md in this folder
// Relative import, not the `@/` alias: the shared Vitest config maps `@/` to
// apps/web only, so an aliased import here would not resolve from a unit test.
import { createAdminSupabaseClient } from "../supabase/admin";

const OWNED_SHORT_LINK_HOSTS = new Set(["gengrowth.ai", "www.gengrowth.ai"]);
const SHORT_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export type ShortLinkRecord = {
  code: string;
  destination_url: string;
  redirect_status: number;
};

export type RegisterShortLinkResult =
  | {
      ok: true;
      code: string;
      destinationUrl: string;
      reused: boolean;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export function normalizeShortLinkCode(rawCode: unknown): string | null {
  if (typeof rawCode !== "string") return null;
  const code = rawCode.trim().toLowerCase();
  if (!SHORT_CODE_PATTERN.test(code)) return null;
  return code;
}

export function normalizeOwnedDestination(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;

  try {
    const destination = new URL(rawUrl.trim());
    if (!OWNED_SHORT_LINK_HOSTS.has(destination.hostname.toLowerCase())) {
      return null;
    }
    destination.protocol = "https:";
    return destination.href;
  } catch {
    return null;
  }
}

export async function findShortLink(
  code: string,
  admin: AdminClient = createAdminSupabaseClient(),
): Promise<ShortLinkRecord | null> {
  const { data, error } = await admin
    .from("link_redirects")
    .select("code, destination_url, redirect_status")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    // Every error is an error. Whether this deployment serves short links at
    // all is declared by the caller, not guessed at from a Postgres code: a
    // missing table can equally mean a rolled-back migration, the wrong
    // project, or a schema that stopped being exposed, and answering "no such
    // link" to any of those retires a published URL for good.
    throw new Error(error.message);
  }

  return (data as ShortLinkRecord | null) ?? null;
}

export async function registerShortLink(
  rawCode: unknown,
  rawDestinationUrl: unknown,
  admin: AdminClient = createAdminSupabaseClient(),
): Promise<RegisterShortLinkResult> {
  const code = normalizeShortLinkCode(rawCode);
  if (!code) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_CODE",
      message:
        "Short-link code must use 1-80 lowercase letters, numbers, or hyphens.",
    };
  }

  const destinationUrl = normalizeOwnedDestination(rawDestinationUrl);
  if (!destinationUrl) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_DESTINATION",
      message: "Destination must be on gengrowth.ai or www.gengrowth.ai.",
    };
  }

  const existing = await findShortLink(code, admin);
  if (existing) {
    if (existing.destination_url === destinationUrl) {
      return { ok: true, code, destinationUrl, reused: true };
    }

    return {
      ok: false,
      status: 409,
      code: "CODE_CONFLICT",
      message: "This short-link code already points to another destination.",
    };
  }

  const payload = {
    code,
    destination_url: destinationUrl,
    redirect_status: 302,
  };

  const { error } = await admin
    .from("link_redirects")
    .insert(payload)
    .select("code, destination_url, redirect_status")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return { ok: true, code, destinationUrl, reused: false };
}
