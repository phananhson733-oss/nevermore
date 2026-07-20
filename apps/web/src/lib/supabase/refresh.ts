import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClientEnv } from "@/env";
import {
  hardenSessionCookieOptions,
  sessionCookieOptions,
} from "./session-cookie-options";

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
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
