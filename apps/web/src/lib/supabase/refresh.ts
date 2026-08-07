import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { CookieOptions } from "@supabase/ssr";
import { getSupabaseClientEnv } from "@/env";
import {
  hardenSessionCookieOptions,
  legacyHostOnlyExpiry,
  sessionCookieOptions,
} from "./session-cookie-options";

/** Serialize a deletion for a host-only cookie of this name. */
function serializeExpiry(name: string, options: CookieOptions): string {
  const parts = [`${name}=`, "Path=/", "Max-Age=0", "SameSite=Lax"];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Refresh the Supabase session at the edge and surface the authenticated user.
 * Returns the response carrying rotated cookies plus the resolved user (or null).
 * Following the @supabase/ssr contract, no logic runs between client creation
 * and `getUser()`.
 */
export async function updateSession(
  request: NextRequest,
  requestHeaderOverrides?: Headers,
): Promise<{ response: NextResponse; user: User | null }> {
  const nextResponse = (): NextResponse => {
    const headers = new Headers(request.headers);
    requestHeaderOverrides?.forEach((value, key) => headers.set(key, value));
    return NextResponse.next({ request: { headers } });
  };
  let response = nextResponse();
  const env = getSupabaseClientEnv();

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = nextResponse();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(
            name,
            value,
            hardenSessionCookieOptions(options),
          );
        }
        // Appended AFTER every `cookies.set`, and as raw headers: `set` is
        // keyed by name (so it would overwrite the deletion) and it rebuilds
        // the Set-Cookie list (so a deletion appended between two `set` calls
        // is discarded). The deletion differs from the real cookie by Domain,
        // so the browser treats them as two cookies and applies both — the
        // scoped one is stored, the legacy host-only twin is expired.
        const legacy = legacyHostOnlyExpiry();
        if (legacy) {
          for (const { name } of cookiesToSet) {
            response.headers.append(
              "set-cookie",
              serializeExpiry(name, legacy),
            );
          }
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
