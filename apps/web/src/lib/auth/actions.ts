"use server";

import { redirect } from "next/navigation";
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

/** Sign out and return to the login screen. */
export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
