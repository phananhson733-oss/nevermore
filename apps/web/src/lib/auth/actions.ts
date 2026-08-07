"use server";

import { redirect } from "next/navigation";
import { getEnv } from "@/env";
import { withBasePath } from "@/lib/base-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signInFailed, type SignInState } from "./action-state.ts";
import { safePostLoginPath } from "./redirect.ts";

/**
 * Supabase Auth server actions (spec §14.1). Sign-in rotates the session cookie
 * (HttpOnly/Secure/SameSite=Lax, written by the @supabase/ssr client). The
 * post-login redirect target is validated to be a same-origin path so it can't
 * be turned into an open redirect.
 */

/** `useActionState`-compatible email/password sign-in. */
export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return signInFailed();
  }
  const next = safePostLoginPath(formData.get("next"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Do not leak provider internals; a generic message avoids user enumeration.
    return signInFailed();
  }
  redirect(next);
}

/**
 * Start the Google sign-in redirect (spec §1.6).
 *
 * Supabase mints the provider URL and stores the PKCE verifier in a cookie the
 * `@supabase/ssr` client owns, so the exchange in `/auth/callback` can only be
 * completed by the browser that started the flow.
 *
 * `next` rides in the callback's query string rather than in Supabase's OAuth
 * `state`: the provider round-trip is outside our control, and `state` is
 * already carrying Supabase's own CSRF value. It is re-validated on the way
 * back, so a tampered value degrades to the safe default instead of becoming an
 * open redirect.
 */
export async function signInWithGoogleAction(
  formData: FormData,
): Promise<void> {
  const next = safePostLoginPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  const callback = new URL(withBasePath("/auth/callback"), getEnv().APP_ORIGIN);
  callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });

  // Without a provider URL there is nothing to redirect to. Returning to the
  // login screen with the error marker beats throwing a 500 at someone who just
  // clicked a button.
  if (error || !data?.url) {
    redirect(`/login?error=oauth&next=${encodeURIComponent(next)}`);
  }
  redirect(data.url);
}

/** Sign out and return to the login screen. */
export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
