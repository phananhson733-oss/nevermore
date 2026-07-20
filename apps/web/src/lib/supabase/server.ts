import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseClientEnv } from "@/env";
import {
  hardenSessionCookieOptions,
  sessionCookieOptions,
} from "./session-cookie-options";

/**
 * Supabase server client bound to the request cookie jar. Used by route handlers
 * and server components to read the authenticated user. Session cookies are
 * HttpOnly/Secure/SameSite=Lax (spec §14.1); the anon key is browser-safe.
 */
export async function createSupabaseServerClient() {
  const env = getSupabaseClientEnv();
  const cookieStore = await cookies();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(
              name,
              value,
              hardenSessionCookieOptions(options),
            );
          }
        } catch {
          // Called from a Server Component render where cookies are read-only;
          // the middleware refresh path performs the actual write.
        }
      },
    },
  });
}
